// Local development server. It runs the same Worker as production
// (src/worker.js), with public/ as the asset binding and a SQLite file
// standing in for Cloudflare D1.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { pathToFileURL } = require("node:url");
const { LocalD1 } = require("./scripts/d1-sqlite.js");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, ".data");
const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
};

function loadLocalEnv() {
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator === -1) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  } catch {
    // A .env file is optional; environment variables work too.
  }
}

// Locally, keep a generated encryption key next to the database so stored
// provider tokens stay readable across restarts.
function localEncryptionKey() {
  if (process.env.TOKEN_ENCRYPTION_KEY) return process.env.TOKEN_ENCRYPTION_KEY;
  const keyFile = path.join(DATA_DIR, "token-encryption.key");
  try {
    return fs.readFileSync(keyFile, "utf8").trim();
  } catch {
    const key = crypto.randomBytes(32).toString("base64");
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
    return key;
  }
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" }
  });
}

const assets = {
  async fetch(request) {
    const url = new URL(request.url);
    let requestedPath;
    try {
      requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
      if (requestedPath.includes("\0")) throw new Error("Invalid path");
    } catch {
      return jsonResponse(400, { error: "The requested path is not valid." });
    }
    const filePath = path.join(PUBLIC_DIR, path.normalize(requestedPath));
    const relativePath = path.relative(PUBLIC_DIR, filePath);
    if (relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) {
      return new Response("Forbidden", { status: 403 });
    }
    try {
      const data = await fs.promises.readFile(filePath);
      return new Response(data, { headers: { "content-type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream" } });
    } catch {
      // Mirror Workers' single-page-application fallback.
      const index = await fs.promises.readFile(path.join(PUBLIC_DIR, "index.html"));
      return new Response(index, { headers: { "content-type": MIME_TYPES[".html"] } });
    }
  }
};

function toRequest(req, origin) {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
    else if (value !== undefined) headers.set(key, value);
  }
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(new URL(req.url, origin), {
    method: req.method,
    headers,
    body: hasBody ? Readable.toWeb(req) : undefined,
    duplex: hasBody ? "half" : undefined
  });
}

async function writeResponse(res, response) {
  const headers = {};
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  res.writeHead(response.status, headers);
  res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
}

async function start() {
  loadLocalEnv();
  const port = Number(process.env.PORT || 4173);
  const { default: worker } = await import(pathToFileURL(path.join(ROOT, "src", "worker.js")).href);
  const env = {
    ...process.env,
    TOKEN_ENCRYPTION_KEY: localEncryptionKey(),
    DB: new LocalD1(process.env.LOCAL_DB_PATH || path.join(DATA_DIR, "local.sqlite")),
    ASSETS: assets
  };
  const origin = `http://localhost:${port}`;
  const server = http.createServer(async (req, res) => {
    try {
      await writeResponse(res, await worker.fetch(toRequest(req, origin), env));
    } catch (error) {
      await writeResponse(res, jsonResponse(400, { error: error.message || "The request is not valid." }));
    }
  });
  server.listen(port, () => {
    console.log(`Strava Visualize is running at ${origin}`);
  });
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
