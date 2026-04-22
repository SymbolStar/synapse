import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  SYNAPSE_DIR,
  DB_FILENAME,
  CURSOR_FILENAME,
  METADATA_BATCH_SIZE,
  VERSION,
  PARSER_REVISION,
  SCHEMA_VERSION,
  DEFAULT_SEARCH_LIMIT,
  MAX_SEARCH_LIMIT,
  getSynapseDir,
  getDbPath,
  getCursorPath,
} from '../src/constants';
import type {
  Source,
  CanonicalMessage,
  CanonicalSession,
  ParseResult,
  FileFingerprint,
  FileCursor,
  CursorState,
  SyncResult,
  SearchResult,
} from '../src/types';

describe('constants', () => {
  test('directory and file names', () => {
    expect(SYNAPSE_DIR).toBe('.synapse');
    expect(DB_FILENAME).toBe('synapse.db');
    expect(CURSOR_FILENAME).toBe('cursors.json');
  });

  test('numeric constants', () => {
    expect(METADATA_BATCH_SIZE).toBe(50);
    expect(PARSER_REVISION).toBe(1);
    expect(SCHEMA_VERSION).toBe(1);
    expect(DEFAULT_SEARCH_LIMIT).toBe(10);
    expect(MAX_SEARCH_LIMIT).toBe(100);
  });

  test('version', () => {
    expect(VERSION).toBe('0.1.0');
  });

  test('getSynapseDir returns ~/.synapse', () => {
    expect(getSynapseDir()).toBe(join(homedir(), '.synapse'));
  });

  test('getDbPath returns ~/.synapse/synapse.db', () => {
    expect(getDbPath()).toBe(join(homedir(), '.synapse', 'synapse.db'));
  });

  test('getCursorPath returns ~/.synapse/cursors.json', () => {
    expect(getCursorPath()).toBe(join(homedir(), '.synapse', 'cursors.json'));
  });
});

describe('types', () => {
  test('CanonicalMessage satisfies interface', () => {
    const msg: CanonicalMessage = {
      role: 'user',
      content: 'hello',
      timestamp: '2025-01-01T00:00:00Z',
    };
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('hello');
    expect(msg.toolName).toBeUndefined();
  });

  test('CanonicalSession satisfies interface', () => {
    const session: CanonicalSession = {
      sessionKey: 'abc-123',
      source: 'claude-code',
      startedAt: '2025-01-01T00:00:00Z',
      lastMessageAt: '2025-01-01T00:01:00Z',
      durationSeconds: 60,
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
    };
    expect(session.source).toBe('claude-code');
    expect(session.messages).toHaveLength(0);
    expect(session.projectRef).toBeUndefined();
  });

  test('ParseResult wraps canonical session', () => {
    const result: ParseResult = {
      canonical: {
        sessionKey: 'k',
        source: 'opencode',
        startedAt: '',
        lastMessageAt: '',
        durationSeconds: 0,
        messages: [],
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCachedTokens: 0,
      },
    };
    expect(result.canonical.source).toBe('opencode');
    expect(result.raw).toBeUndefined();
  });

  test('FileFingerprint satisfies interface', () => {
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 512 };
    expect(fp.inode).toBe(1);
  });

  test('FileCursor extends fingerprint with offset', () => {
    const cursor: FileCursor = {
      inode: 1,
      mtimeMs: 1000,
      size: 512,
      offset: 256,
      updatedAt: '2025-01-01T00:00:00Z',
    };
    expect(cursor.offset).toBe(256);
  });

  test('CursorState holds file cursors', () => {
    const state: CursorState = {
      files: {},
      updatedAt: '2025-01-01T00:00:00Z',
    };
    expect(Object.keys(state.files)).toHaveLength(0);
  });

  test('SyncResult satisfies interface', () => {
    const result: SyncResult = {
      totalParsed: 5,
      totalSkipped: 2,
      totalFiles: 7,
      errors: [],
    };
    expect(result.totalParsed + result.totalSkipped).toBe(result.totalFiles);
  });

  test('SearchResult satisfies interface', () => {
    const sr: SearchResult = {
      sessionId: 1,
      sessionKey: 'k',
      source: 'openclaw',
      snippet: 'matched text',
      timestamp: '2025-01-01T00:00:00Z',
    };
    expect(sr.source).toBe('openclaw');
    expect(sr.projectName).toBeUndefined();
  });
});
