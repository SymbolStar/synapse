import { describe, test, expect } from 'bun:test';
import { join } from 'node:path';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { getFingerprint, fileUnchanged } from '../../src/adapters/fingerprint';
import type { FileCursor } from '../../src/types';

describe('getFingerprint', () => {
  test('returns inode, mtimeMs, and size', async () => {
    const path = join(tmpdir(), `synapse-fp-test-${Date.now()}.txt`);
    await writeFile(path, 'hello world');
    try {
      const fp = await getFingerprint(path);
      expect(fp.inode).toBeGreaterThan(0);
      expect(fp.mtimeMs).toBeGreaterThan(0);
      expect(fp.size).toBe(11);
    } finally {
      await unlink(path).catch(() => {});
    }
  });

  test('throws for nonexistent file', async () => {
    await expect(getFingerprint('/tmp/nonexistent-synapse-test')).rejects.toThrow();
  });
});

describe('fileUnchanged', () => {
  test('returns false when cursor is undefined', () => {
    expect(fileUnchanged(undefined, { inode: 1, mtimeMs: 100, size: 10 })).toBe(false);
  });

  test('returns true when fingerprint matches cursor', () => {
    const cursor: FileCursor = {
      inode: 1,
      mtimeMs: 100,
      size: 10,
      offset: 0,
      updatedAt: new Date().toISOString(),
    };
    expect(fileUnchanged(cursor, { inode: 1, mtimeMs: 100, size: 10 })).toBe(true);
  });

  test('returns false when size differs', () => {
    const cursor: FileCursor = {
      inode: 1,
      mtimeMs: 100,
      size: 10,
      offset: 0,
      updatedAt: new Date().toISOString(),
    };
    expect(fileUnchanged(cursor, { inode: 1, mtimeMs: 100, size: 20 })).toBe(false);
  });

  test('returns false when mtime differs', () => {
    const cursor: FileCursor = {
      inode: 1,
      mtimeMs: 100,
      size: 10,
      offset: 0,
      updatedAt: new Date().toISOString(),
    };
    expect(fileUnchanged(cursor, { inode: 1, mtimeMs: 200, size: 10 })).toBe(false);
  });
});
