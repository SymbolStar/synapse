// Core types for Synapse

export type Source = 'claude-code' | 'opencode' | 'openclaw';

export interface CanonicalMessage {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolName?: string;
  toolInput?: string;
  toolResult?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  timestamp: string;
}

export interface CanonicalSession {
  sessionKey: string;
  source: Source;
  startedAt: string;
  lastMessageAt: string;
  durationSeconds: number;
  projectRef?: string;
  projectName?: string;
  model?: string;
  title?: string;
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
}

export interface ParseResult {
  canonical: CanonicalSession;
  raw?: unknown;
}

export interface FileFingerprint {
  inode: number;
  mtimeMs: number;
  size: number;
}

export interface FileCursor {
  inode: number;
  mtimeMs: number;
  size: number;
  offset: number;
  updatedAt: string;
}

export interface CursorState {
  files: Record<string, FileCursor>;
  updatedAt: string;
}

export interface SyncResult {
  totalParsed: number;
  totalSkipped: number;
  totalFiles: number;
  errors: string[];
}

export interface SearchResult {
  sessionId: number;
  sessionKey: string;
  source: Source;
  projectName?: string;
  title?: string;
  snippet: string;
  timestamp: string;
}
