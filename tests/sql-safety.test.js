const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

// Every value in a D1 query must go through a ? placeholder and .bind(). Text
// spliced into the SQL itself is how a request parameter becomes SQL
// injection, so each query's SQL must be a fixed string. The one exception is
// a WHERE clause joined from conditions that are themselves fixed strings,
// checked below.
const SRC = path.resolve(__dirname, "../src");
const ALLOWED = new Map([
  ["db.js", new Set(['conditions.join(" AND ")'])]
]);

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

// Reads the first argument of each .prepare( call: the kind of literal it is,
// whether anything is appended to it, and any ${...} expressions inside it.
function prepareCalls(source) {
  const calls = [];
  const opener = /\.prepare\(\s*/g;
  let match;
  while ((match = opener.exec(source))) {
    let i = opener.lastIndex;
    const quote = source[i];
    const line = source.slice(0, match.index).split("\n").length;
    if (!["`", '"', "'"].includes(quote)) {
      calls.push({ line, kind: "not a string literal", expressions: [] });
      continue;
    }
    const expressions = [];
    i += 1;
    while (i < source.length && source[i] !== quote) {
      if (source[i] === "\\") { i += 2; continue; }
      if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
        let depth = 1;
        const start = i + 2;
        i = start;
        while (i < source.length && depth > 0) {
          if (source[i] === "{") depth += 1;
          else if (source[i] === "}") depth -= 1;
          i += 1;
        }
        expressions.push(source.slice(start, i - 1).trim());
        continue;
      }
      i += 1;
    }
    const after = source.slice(i + 1).trimStart();
    calls.push({ line, kind: after.startsWith("+") ? "concatenated" : "literal", expressions });
  }
  return calls;
}

test("every D1 query keeps values out of the SQL text and binds them instead", () => {
  const problems = [];
  let checked = 0;
  for (const file of sourceFiles(SRC)) {
    const name = path.relative(SRC, file);
    const allowed = ALLOWED.get(name) || new Set();
    for (const call of prepareCalls(fs.readFileSync(file, "utf8"))) {
      checked += 1;
      if (call.kind !== "literal") problems.push(`${name}:${call.line} SQL is ${call.kind}`);
      for (const expression of call.expressions) {
        if (!allowed.has(expression)) problems.push(`${name}:${call.line} interpolates \${${expression}} into the SQL; use ? and .bind()`);
      }
    }
  }
  assert.ok(checked >= 20, `found only ${checked} queries; the scan has stopped seeing them`);
  assert.deepEqual(problems, []);
});

test("the activities WHERE clause is joined only from fixed conditions", () => {
  const source = fs.readFileSync(path.join(SRC, "db.js"), "utf8");
  const declared = source.match(/const conditions = \[([^\]]*)\];/);
  assert.ok(declared, "conditions declaration not found");
  const pieces = [...declared[1].matchAll(/"[^"]*"|'[^']*'|`[^`]*`|[^,\s]+/g)].map((m) => m[0]);
  const pushed = [...source.matchAll(/conditions\.push\(([^)]*)\)/g)].map((m) => m[1].trim());
  assert.ok(pushed.length > 0, "conditions.push calls not found");
  for (const piece of [...pieces, ...pushed]) {
    assert.match(piece, /^"[^"$]*\?[^"$]*"$/, `condition ${piece} must be a fixed string with a ? placeholder`);
  }
});

test("the scan catches a value spliced into the SQL", () => {
  const planted = 'db.prepare(`SELECT * FROM user_state WHERE key = \'${only}\'`).all();\n'
    + 'db.prepare("SELECT * FROM t WHERE id = " + id).all();\n'
    + 'db.prepare(sql).all();\n'
    + 'db.prepare("SELECT 1 WHERE a = ?").bind(a).all();';
  const calls = prepareCalls(planted);
  assert.deepEqual(calls.map((call) => call.kind), ["literal", "concatenated", "not a string literal", "literal"]);
  assert.deepEqual(calls[0].expressions, ["only"]);
  assert.deepEqual(calls[3].expressions, []);
});
