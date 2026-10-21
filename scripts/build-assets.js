const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const source = path.resolve(__dirname, "../public");
const output = path.resolve(__dirname, "../.build/public");
fs.mkdirSync(output, { recursive: true });
for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
  if (entry.isFile() && /^[\w-]+\.[a-f\d]{12}\.(?:js|css)$/.test(entry.name)) fs.unlinkSync(path.join(output, entry.name));
}
fs.cpSync(source, output, { recursive: true });
let html = fs.readFileSync(path.join(source, "index.html"), "utf8");
const manifest = {};
html = html.replace(/((?:src|href)=")\/([^"?]+\.(?:js|css))(?:\?[^" ]*)?"/g, (_, prefix, filename) => {
  const data = fs.readFileSync(path.join(source, filename));
  const hash = createHash("sha256").update(data).digest("hex").slice(0, 12);
  const extension = path.extname(filename);
  const fingerprint = `${filename.slice(0, -extension.length)}.${hash}${extension}`;
  fs.writeFileSync(path.join(output, fingerprint), data);
  manifest[filename] = fingerprint;
  return `${prefix}/${fingerprint}"`;
});
fs.writeFileSync(path.join(output, "index.html"), html);
fs.writeFileSync(path.join(output, "asset-manifest.json"), JSON.stringify(manifest, null, 2));
fs.writeFileSync(path.join(output, "_headers"), ["/", "  Cache-Control: no-store", "/index.html", "  Cache-Control: no-store", ...Object.values(manifest).flatMap((file) => [`/${file}`, "  Cache-Control: public, max-age=31536000, immutable"])].join("\n") + "\n");
console.log(`Built ${Object.keys(manifest).length} fingerprinted assets in .build/public.`);
