import { describe, test, expect, afterEach } from 'bun:test';
import { join } from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { loadCursors, saveCursors } from '../../src/core/cursor';
import type { CursorState } from '../../src/types';

describe('cursor persistence', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  test('loadCursors returns empty state for missing file', async () => {
    const state = await loadCursors('/tmp/nonexistent-synapse-cursors.json');
    expect(state.files).toEqual({});
    expect(state.updatedAt).toBeDefined();
  });

  test('save then load round-trip', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'synapse-cursor-'));
    const path = join(tmpDir, 'cursors.json');

    const state: CursorState = {
      files: {
        '/some/file.jsonl': {
          inode: 123,
          mtimeMs: 1000,
          size: 500,
          offset: 250,
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      },
      updatedAt: '2025-01-01T00:00:00.000Z',
    };

    await saveCursors(state, path);
    const loaded = await loadCursors(path);

    expect(loaded).toEqual(state);
  });

  test('saveCursors creates parent directory', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'synapse-cursor-'));
    const path = join(tmpDir, 'nested', 'dir', 'cursors.json');

    const state: CursorState = { files: {}, updatedAt: new Date().toISOString() };
    await saveCursors(state, path);
    const loaded = await loadCursors(path);
    expect(loaded.files).toEqual({});
  });
});
