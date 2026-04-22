import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const DEFAULT_DB_DIR = join(homedir(), ".synapse");
const DEFAULT_DB_PATH = join(DEFAULT_DB_DIR, "synapse.db");

export function openDatabase(dbPath: string = DEFAULT_DB_PATH): Database {
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });

  const db = new Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  return db;
}

export function closeDatabase(db: Database): void {
  db.close();
}
