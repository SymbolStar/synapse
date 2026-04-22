import type { Source, FileCursor, FileFingerprint, ParseResult } from '../types';

export interface SourceAdapter {
  source: Source;

  /** Find all session files for this source */
  discover(): Promise<string[]>;

  /** Return true if file can be skipped (unchanged since last cursor) */
  shouldSkip(cursor: FileCursor | undefined, fingerprint: FileFingerprint): boolean;

  /** Parse a session file starting from the given byte offset */
  parse(filePath: string, startOffset: number): Promise<ParseResult[]>;

  /** Build a cursor from fingerprint and parse results */
  buildCursor(fingerprint: FileFingerprint, results: ParseResult[]): FileCursor;
}
