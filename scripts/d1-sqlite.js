// A small Cloudflare D1-compatible wrapper around Node's built-in SQLite, so
// the Worker can run unchanged under `npm start` and in tests.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const MIGRATIONS_DIR = path.join(__dirname, "..", "migrations");

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new Statement(this.db, this.sql, params.map((value) => (value === undefined ? null : value)));
  }

  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.params);
    if (!row) return null;
    const plain = { ...row };
    return column ? plain[column] ?? null : plain;
  }

  async all() {
    return { success: true, results: this.db.prepare(this.sql).all(...this.params).map((row) => ({ ...row })) };
  }

  async run() {
    const result = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1 {
  constructor(filename) {
    if (filename !== ":memory:") fs.mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  migrate() {
    this.db.exec("CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY)");
    const applied = new Set(this.db.prepare("SELECT name FROM _migrations").all().map((row) => row.name));
    for (const name of fs.readdirSync(MIGRATIONS_DIR).filter((file) => file.endsWith(".sql")).sort()) {
      if (applied.has(name)) continue;
      this.db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8"));
      this.db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(name);
    }
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }

  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(sql) {
    this.db.exec(sql);
    return { count: 1 };
  }
}

module.exports = { LocalD1 };
