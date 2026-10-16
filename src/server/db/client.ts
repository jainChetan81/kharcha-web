import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { sql } from "drizzle-orm";
import { SQLiteAsyncDialect } from "drizzle-orm/sqlite-core";
import { SQLiteRaw } from "drizzle-orm/sqlite-core/query-builders/raw";
import { drizzle, type SqliteRemoteDatabase } from "drizzle-orm/sqlite-proxy";
import * as schema from "./schema.ts";

export type Db = SqliteRemoteDatabase<typeof schema>;

// ponytail: drizzle-orm 0.45 has no node:sqlite driver, so sqlite-proxy bridges it.
// No native build on the VPS. Switch to the official driver when drizzle ships one.
function bridge(sqlite: DatabaseSync) {
  const exec = (query: string, params: unknown[], method: "run" | "all" | "values" | "get") => {
    const stmt = sqlite.prepare(query);
    const args = params as (string | number | null)[];
    if (method === "run") {
      stmt.run(...args);
      return { rows: [] };
    }
    stmt.setReturnArrays(true);
    // sqlite-proxy treats any truthy `rows` from get() as a row, so a miss must be undefined.
    if (method === "get") return { rows: stmt.get(...args) as unknown as unknown[] };
    return { rows: stmt.all(...args) as unknown[] };
  };
  return {
    one: async (query: string, params: unknown[], method: "run" | "all" | "values" | "get") =>
      exec(query, params, method),
    // Batches run as one synchronous SQLite transaction: atomic, and never interleaved.
    batch: async (items: { sql: string; params: unknown[]; method: "run" | "all" | "values" | "get" }[]) => {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const out = items.map((i) => exec(i.sql, i.params, i.method));
        sqlite.exec("COMMIT");
        return out;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

/**
 * Apply drizzle-kit migrations from ./drizzle (journal order), each in one transaction.
 * 0000_init is the baseline: no pre-Drizzle database was ever deployed. Delete a local
 * pre-Drizzle .data/kharcha.db rather than baselining it.
 */
function migrate(sqlite: DatabaseSync, folder: string): void {
  const journal = JSON.parse(readFileSync(path.join(folder, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  sqlite.exec("CREATE TABLE IF NOT EXISTS __migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set(
    (sqlite.prepare("SELECT tag FROM __migrations").all() as { tag: string }[]).map((r) => r.tag),
  );
  for (const { tag } of journal.entries) {
    if (done.has(tag)) continue;
    const statements = readFileSync(path.join(folder, `${tag}.sql`), "utf8").split("--> statement-breakpoint");
    sqlite.exec("BEGIN IMMEDIATE");
    try {
      for (const s of statements) if (s.trim()) sqlite.exec(s);
      sqlite.prepare("INSERT INTO __migrations VALUES (?, datetime('now'))").run(tag);
      sqlite.exec("COMMIT");
    } catch (error) {
      sqlite.exec("ROLLBACK");
      throw error;
    }
  }
}

export function openDb(file: string, migrations = path.resolve("drizzle")): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  migrate(sqlite, migrations);
  const { one, batch } = bridge(sqlite);
  const db = drizzle(one, batch, { schema });
  // ponytail: sqlite-proxy leaves raw all() rows as arrays. Use named rows here
  // until its driver supports object results; typed selects still use the bridge.
  const dialect = new SQLiteAsyncDialect();
  db.all = <T>(query: Parameters<Db["all"]>[0]) => {
    const sequel = typeof query === "string" ? sql.raw(query) : query.getSQL();
    const compiled = dialect.sqlToQuery(sequel);
    const stmt = sqlite.prepare(compiled.sql);
    const columns = stmt.columns().map((column) => column.name);
    return new SQLiteRaw<T[]>(
      async () => stmt.all(...compiled.params as SQLInputValue[]).map((row) => ({ ...row }) as T),
      () => sequel, "all", dialect,
      (result) => (result as { rows: unknown[][] }).rows.map((row) => Object.fromEntries(columns.map((column, i) => [column, row[i]]))),
    );
  };
  return db;
}

let shared: Db | undefined;
export function getDb(): Db {
  shared ??= openDb(path.join(process.env.STATE_DIRECTORY ?? ".data", "kharcha.db"));
  return shared;
}
