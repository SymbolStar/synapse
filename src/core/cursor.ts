import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
import { getCursorPath } from '../constants';
import type { CursorState } from '../types';

const emptyCursorState = (): CursorState => ({
  files: {},
  updatedAt: new Date().toISOString(),
});

/** Load cursor state from disk. Returns empty state if file doesn't exist. */
export async function loadCursors(cursorPath?: string): Promise<CursorState> {
  const path = cursorPath ?? getCursorPath();
  try {
    const data = await readFile(path, 'utf-8');
    return JSON.parse(data) as CursorState;
  } catch {
    return emptyCursorState();
  }
}

/** Save cursor state to disk atomically (write to tmp then rename). */
export async function saveCursors(
  state: CursorState,
  cursorPath?: string,
): Promise<void> {
  const path = cursorPath ?? getCursorPath();
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmp, path);
}
