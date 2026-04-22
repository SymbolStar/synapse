import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export function runMigrations(db: Database): void {
  const schemaPath = join(import.meta.dir, "schema.sql");
  const sql = readFileSync(schemaPath, "utf-8");
  db.exec(sql);
}
