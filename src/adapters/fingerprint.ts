import { stat } from 'node:fs/promises';
import type { FileCursor, FileFingerprint } from '../types';

/** Get file fingerprint (inode + mtime + size) */
export async function getFingerprint(filePath: string): Promise<FileFingerprint> {
  const s = await stat(filePath);
  return {
    inode: s.ino,
    mtimeMs: s.mtimeMs,
    size: s.size,
  };
}

/** Return true if the file has not changed since the cursor was recorded */
export function fileUnchanged(
  cursor: FileCursor | undefined,
  fingerprint: FileFingerprint,
): boolean {
  if (!cursor) return false;
  return (
    cursor.inode === fingerprint.inode &&
    cursor.mtimeMs === fingerprint.mtimeMs &&
    cursor.size === fingerprint.size
  );
}
