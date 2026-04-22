import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ClaudeCodeAdapter } from '../../../src/adapters/claude-code/adapter';
import type { FileCursor, FileFingerprint } from '../../../src/types';

const SAMPLE_LINE = JSON.stringify({
  type: 'user',
  sessionId: 'sess-1',
  timestamp: '2025-01-01T00:00:00Z',
  message: { role: 'user', content: 'hello' },
});

const ASSISTANT_LINE = JSON.stringify({
  type: 'assistant',
  sessionId: 'sess-1',
  timestamp: '2025-01-01T00:01:00Z',
  message: { role: 'assistant', content: 'hi there', model: 'claude-3' },
});

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'synapse-adapter-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('ClaudeCodeAdapter', () => {
  test('discover finds .jsonl files recursively', async () => {
    const projDir = join(tempDir, 'myproject');
    await mkdir(projDir, { recursive: true });
    await writeFile(join(projDir, 'a.jsonl'), SAMPLE_LINE);
    await writeFile(join(projDir, 'b.jsonl'), SAMPLE_LINE);
    await writeFile(join(projDir, 'notes.txt'), 'not a jsonl');

    const adapter = new ClaudeCodeAdapter(tempDir);
    const files = await adapter.discover();
    expect(files.length).toBe(2);
    expect(files.every((f) => f.endsWith('.jsonl'))).toBe(true);
  });

  test('discover skips subagents directory', async () => {
    const projDir = join(tempDir, 'proj');
    const subagentsDir = join(projDir, 'subagents');
    await mkdir(subagentsDir, { recursive: true });
    await writeFile(join(projDir, 'main.jsonl'), SAMPLE_LINE);
    await writeFile(join(subagentsDir, 'sub.jsonl'), SAMPLE_LINE);

    const adapter = new ClaudeCodeAdapter(tempDir);
    const files = await adapter.discover();
    expect(files.length).toBe(1);
    expect(files[0]).toContain('main.jsonl');
  });

  test('discover returns empty for non-existent dir', async () => {
    const adapter = new ClaudeCodeAdapter(join(tempDir, 'nope'));
    const files = await adapter.discover();
    expect(files).toEqual([]);
  });

  test('shouldSkip returns true for unchanged files', () => {
    const adapter = new ClaudeCodeAdapter(tempDir);
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 500 };
    const cursor: FileCursor = { inode: 1, mtimeMs: 1000, size: 500, offset: 500, updatedAt: '' };
    expect(adapter.shouldSkip(cursor, fp)).toBe(true);
  });

  test('shouldSkip returns false when no cursor', () => {
    const adapter = new ClaudeCodeAdapter(tempDir);
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 500 };
    expect(adapter.shouldSkip(undefined, fp)).toBe(false);
  });

  test('shouldSkip returns false when file changed', () => {
    const adapter = new ClaudeCodeAdapter(tempDir);
    const fp: FileFingerprint = { inode: 1, mtimeMs: 2000, size: 600 };
    const cursor: FileCursor = { inode: 1, mtimeMs: 1000, size: 500, offset: 500, updatedAt: '' };
    expect(adapter.shouldSkip(cursor, fp)).toBe(false);
  });

  test('parse produces results from jsonl file', async () => {
    const projDir = join(tempDir, 'projects', '-Users-test-proj');
    await mkdir(projDir, { recursive: true });
    const filePath = join(projDir, 'session.jsonl');
    await writeFile(filePath, `${SAMPLE_LINE}\n${ASSISTANT_LINE}\n`);

    const adapter = new ClaudeCodeAdapter(tempDir);
    const results = await adapter.parse(filePath, 0);
    expect(results.length).toBe(1);
    expect(results[0].canonical.source).toBe('claude-code');
    expect(results[0].canonical.messages.length).toBeGreaterThanOrEqual(2);
  });

  test('buildCursor sets offset to file size', () => {
    const adapter = new ClaudeCodeAdapter(tempDir);
    const fp: FileFingerprint = { inode: 42, mtimeMs: 9999, size: 1234 };
    const cursor = adapter.buildCursor(fp);
    expect(cursor.offset).toBe(1234);
    expect(cursor.inode).toBe(42);
    expect(cursor.mtimeMs).toBe(9999);
    expect(cursor.size).toBe(1234);
    expect(cursor.updatedAt).toBeTruthy();
  });
});
