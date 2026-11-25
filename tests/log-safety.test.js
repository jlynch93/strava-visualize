const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

// Worker logs go to Cloudflare's log store, which is kept and searchable, so
// a log call must never carry a credential. Anything a log call reads (its
// code, not the wording of its message) that is named like a secret, or is a
// whole env, config or headers object, fails this test.
const ROOT = path.resolve(__dirname, "..");
const FILES = ["server.js", ...sourceFiles(path.join(ROOT, "src")).map((file) => path.relative(ROOT, file))];
const SECRET_NAME = /\b\w*(token|secret|passw(or)?d|api_?key|authorization|cookie|credential)\w*\b|\b(env|config|headers)\b(?!\s*\.\s*\w+\s*\.\s*(id|name)\b)/i;

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// The argument text of each console.* call with the wording of every string
// removed, keeping the ${...} expressions a template literal evaluates.
function logCalls(source) {
  const calls = [];
  const opener = /\bconsole\.(log|info|warn|error|debug)\(/g;
  let match;
  while ((match = opener.exec(source))) {
    let i = opener.lastIndex;
    let depth = 1;
    let code = "";
    while (i < source.length && depth > 0) {
      const char = source[i];
      if (char === '"' || char === "'") {
        i += 1;
        while (i < source.length && source[i] !== char) i += source[i] === "\\" ? 2 : 1;
        code += '""';
      } else if (char === "`") {
        i += 1;
        let inner = "";
        while (i < source.length && source[i] !== "`") {
          if (source[i] === "\\") { i += 2; continue; }
          if (source[i] === "$" && source[i + 1] === "{") {
            let braces = 1;
            const start = i + 2;
            i = start;
            while (i < source.length && braces > 0) {
              if (source[i] === "{") braces += 1;
              else if (source[i] === "}") braces -= 1;
              i += 1;
            }
            inner += ` ${source.slice(start, i - 1)} `;
            continue;
          }
          i += 1;
        }
        code += inner;
      } else {
        if (char === "(") depth += 1;
        else if (char === ")") depth -= 1;
        if (depth > 0) code += char;
      }
      i += 1;
    }
    calls.push({ line: source.slice(0, match.index).split("\n").length, code });
  }
  return calls;
}

test("no server log call reads a token, secret, key, cookie or whole env/config/headers", () => {
  const problems = [];
  let checked = 0;
  for (const file of FILES) {
    for (const call of logCalls(fs.readFileSync(path.join(ROOT, file), "utf8"))) {
      checked += 1;
      const hit = call.code.match(SECRET_NAME);
      if (hit) problems.push(`${file}:${call.line} logs "${hit[0]}": ${call.code.trim().slice(0, 120)}`);
    }
  }
  assert.ok(checked >= 10, `found only ${checked} log calls; the scan has stopped seeing them`);
  assert.deepEqual(problems, []);
});

test("the log scan catches a token in a log call and ignores the wording of messages", () => {
  const hits = (source) => logCalls(source).map((call) => (call.code.match(SECRET_NAME) || [""])[0]);
  assert.deepEqual(hits("console.warn(`${provider.name} deregistration failed for token ${accessToken}: ${error.message}`);"), ["accessToken"]);
  assert.deepEqual(hits('console.log(JSON.stringify({ event: "x", tokens }));'), ["tokens"]);
  assert.deepEqual(hits("console.error(request.headers.get(\"cookie\"), env);"), ["headers"]);
  assert.deepEqual(hits("console.log({ env });"), ["env"]);
  assert.deepEqual(hits('console.warn(JSON.stringify({ event: "a", message: "Set RUNSIGNUP_API_REG_TOKEN and the secret" }));'), [""]);
  assert.deepEqual(hits("console.warn(`${provider.name} failed: ${error.message}`);"), [""]);
});
