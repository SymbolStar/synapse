import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenCodeAdapter } from '../../../src/adapters/opencode/adapter';
import type { FileCursor, FileFingerprint } from '../../../src/types';

function createTestDb(dbPath: string): Database {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      slug TEXT NOT NULL,
      directory TEXT NOT NULL,
      title TEXT NOT NULL,
      version TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL
    );
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      time_created INTEGER NOT NULL,
      time_updated INTEGER NOT NULL,
      data TEXT NOT NULL
    );
  `);
  return db;
}

function insertTestData(db: Database) {
  const now = Date.now();
  db.exec(`
    INSERT INTO session VALUES ('s1', 'p1', 'slug', '/Users/test/myproject', 'Test Session', '1', ${now - 60000}, ${now});
    INSERT INTO message VALUES ('m1', 's1', ${now - 60000}, ${now - 60000}, '${JSON.stringify({ role: 'user', time: { created: now - 60000 } }).replace(/'/g, "''")}');
    INSERT INTO message VALUES ('m2', 's1', ${now - 30000}, ${now - 30000}, '${JSON.stringify({ role: 'assistant', model: { modelID: 'claude-sonnet' }, tokens: { input: 100, output: 50, cache: { read: 10 } } }).replace(/'/g, "''")}');
    INSERT INTO part VALUES ('pt1', 'm1', 's1', ${now - 60000}, ${now - 60000}, '${JSON.stringify({ type: 'text', text: 'Hello world' }).replace(/'/g, "''")}');
    INSERT INTO part VALUES ('pt2', 'm2', 's1', ${now - 30000}, ${now - 30000}, '${JSON.stringify({ type: 'text', text: 'Hi there!' }).replace(/'/g, "''")}');
  `);
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'synapse-opencode-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('OpenCodeAdapter', () => {
  test('discover returns db path when file exists', async () => {
    const dbPath = join(tempDir, 'opencode.db');
    const db = createTestDb(dbPath);
    db.close();

    const adapter = new OpenCodeAdapter(dbPath);
    const files = await adapter.discover();
    expect(files).toEqual([dbPath]);
  });

  test('discover returns empty when db missing', async () => {
    const adapter = new OpenCodeAdapter(join(tempDir, 'nope.db'));
    const files = await adapter.discover();
    expect(files).toEqual([]);
  });

  test('shouldSkip returns true when mtime and size match', () => {
    const adapter = new OpenCodeAdapter();
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 500 };
    const cursor: FileCursor = {
      inode: 99,
      mtimeMs: 1000,
      size: 500,
      offset: 500,
      updatedAt: '',
    };
    expect(adapter.shouldSkip(cursor, fp)).toBe(true);
  });

  test('shouldSkip returns false when no cursor', () => {
    const adapter = new OpenCodeAdapter();
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 500 };
    expect(adapter.shouldSkip(undefined, fp)).toBe(false);
  });

  test('shouldSkip returns false when file changed', () => {
    const adapter = new OpenCodeAdapter();
    const fp: FileFingerprint = { inode: 1, mtimeMs: 2000, size: 600 };
    const cursor: FileCursor = {
      inode: 1,
      mtimeMs: 1000,
      size: 500,
      offset: 500,
      updatedAt: '',
    };
    expect(adapter.shouldSkip(cursor, fp)).toBe(false);
  });

  test('parse extracts sessions with messages', async () => {
    const dbPath = join(tempDir, 'opencode.db');
    const db = createTestDb(dbPath);
    insertTestData(db);
    db.close();

    const adapter = new OpenCodeAdapter(dbPath);
    const results = await adapter.parse(dbPath, 0);

    expect(results.length).toBe(1);
    const session = results[0].canonical;
    expect(session.source).toBe('opencode');
    expect(session.sessionKey).toBe('opencode:s1');
    expect(session.projectName).toBe('myproject');
    expect(session.model).toBe('claude-sonnet');
    expect(session.title).toBe('Test Session');
    expect(session.messages.length).toBe(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toBe('Hello world');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('Hi there!');
    expect(session.totalInputTokens).toBe(100);
    expect(session.totalOutputTokens).toBe(50);
    expect(session.totalCachedTokens).toBe(10);
  });

  test('parse handles tool parts', async () => {
    const dbPath = join(tempDir, 'opencode.db');
    const db = createTestDb(dbPath);
    const now = Date.now();
    db.exec(`
      INSERT INTO session VALUES ('s2', 'p1', 'slug', '/tmp/proj', 'Tool Session', '1', ${now}, ${now + 1000});
      INSERT INTO message VALUES ('m3', 's2', ${now}, ${now}, '${JSON.stringify({ role: 'assistant', tokens: { input: 10, output: 5 } }).replace(/'/g, "''")}');
      INSERT INTO part VALUES ('pt3', 'm3', 's2', ${now}, ${now}, '${JSON.stringify({ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' }, output: 'file.txt' } }).replace(/'/g, "''")}');
    `);
    db.close();

    const adapter = new OpenCodeAdapter(dbPath);
    const results = await adapter.parse(dbPath, 0);

    expect(results.length).toBe(1);
    const msg = results[0].canonical.messages[0];
    expect(msg.role).toBe('tool');
    expect(msg.toolName).toBe('bash');
    expect(msg.toolInput).toBe('{"command":"ls"}');
    expect(msg.toolResult).toBe('file.txt');
  });

  test('parse skips empty sessions', async () => {
    const dbPath = join(tempDir, 'opencode.db');
    const db = createTestDb(dbPath);
    const now = Date.now();
    db.exec(`
      INSERT INTO session VALUES ('empty', 'p1', 'slug', '/tmp/x', 'Empty', '1', ${now}, ${now});
    `);
    db.close();

    const adapter = new OpenCodeAdapter(dbPath);
    const results = await adapter.parse(dbPath, 0);
    expect(results.length).toBe(0);
  });

  test('buildCursor returns cursor with fingerprint data', () => {
    const adapter = new OpenCodeAdapter();
    const fp: FileFingerprint = { inode: 42, mtimeMs: 9999, size: 1234 };
    const cursor = adapter.buildCursor(fp, []);
    expect(cursor.mtimeMs).toBe(9999);
    expect(cursor.size).toBe(1234);
    expect(cursor.updatedAt).toBeTruthy();
  });
});
