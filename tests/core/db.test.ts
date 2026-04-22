import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openDatabase, closeDatabase } from "../../src/core/db";
import { runMigrations } from "../../src/core/migrate";
import type { Database } from "bun:sqlite";

describe("database", () => {
  let db: Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "synapse-test-"));
    db = openDatabase(join(tempDir, "test.db"));
    runMigrations(db);
  });

  afterEach(() => {
    closeDatabase(db);
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("opens database with WAL mode", () => {
    const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe("wal");
  });

  test("has foreign keys enabled", () => {
    const result = db.query("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(result.foreign_keys).toBe(1);
  });

  test("creates all tables", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("projects");
    expect(names).toContain("sessions");
    expect(names).toContain("messages");
    expect(names).toContain("messages_fts");
  });

  test("creates indexes", () => {
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name);
    expect(names).toContain("idx_sessions_project");
    expect(names).toContain("idx_sessions_source");
    expect(names).toContain("idx_messages_session");
  });

  test("migrations are idempotent", () => {
    expect(() => runMigrations(db)).not.toThrow();
  });

  test("insert and select project", () => {
    db.run("INSERT INTO projects (id, path, name) VALUES (?, ?, ?)", ["p1", "/tmp/proj", "proj"]);
    const row = db.query("SELECT * FROM projects WHERE id = ?").get("p1") as { id: string; path: string; name: string };
    expect(row.id).toBe("p1");
    expect(row.path).toBe("/tmp/proj");
    expect(row.name).toBe("proj");
  });

  test("insert and select session", () => {
    db.run("INSERT INTO projects (id, path, name) VALUES (?, ?, ?)", ["p1", "/tmp/proj", "proj"]);
    db.run(
      "INSERT INTO sessions (id, source, project_id, started_at, indexed_at) VALUES (?, ?, ?, ?, ?)",
      ["s1", "claude-code", "p1", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
    );
    const row = db.query("SELECT * FROM sessions WHERE id = ?").get("s1") as { id: string; source: string };
    expect(row.id).toBe("s1");
    expect(row.source).toBe("claude-code");
  });

  test("insert and select message with FTS", () => {
    db.run("INSERT INTO projects (id, path, name) VALUES (?, ?, ?)", ["p1", "/tmp/proj", "proj"]);
    db.run(
      "INSERT INTO sessions (id, source, project_id, started_at, indexed_at) VALUES (?, ?, ?, ?, ?)",
      ["s1", "claude-code", "p1", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
    );
    db.run(
      "INSERT INTO messages (id, session_id, ordinal, role, content) VALUES (?, ?, ?, ?, ?)",
      ["m1", "s1", 1, "user", "fix the authentication bug"],
    );

    const row = db.query("SELECT * FROM messages WHERE id = ?").get("m1") as { id: string; content: string };
    expect(row.content).toBe("fix the authentication bug");

    // FTS trigger should have indexed the content
    const fts = db
      .query("SELECT content FROM messages_fts WHERE messages_fts MATCH ?")
      .all("authentication") as { content: string }[];
    expect(fts.length).toBe(1);
    expect(fts[0].content).toBe("fix the authentication bug");
  });

  test("cascade delete messages when session deleted", () => {
    db.run("INSERT INTO projects (id, path, name) VALUES (?, ?, ?)", ["p1", "/tmp/proj", "proj"]);
    db.run(
      "INSERT INTO sessions (id, source, project_id, started_at, indexed_at) VALUES (?, ?, ?, ?, ?)",
      ["s1", "claude-code", "p1", "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z"],
    );
    db.run(
      "INSERT INTO messages (id, session_id, ordinal, role, content) VALUES (?, ?, ?, ?, ?)",
      ["m1", "s1", 1, "user", "hello"],
    );
    db.run("DELETE FROM sessions WHERE id = ?", ["s1"]);
    const msgs = db.query("SELECT * FROM messages WHERE session_id = ?").all("s1");
    expect(msgs.length).toBe(0);
  });
});
