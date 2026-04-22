import { Database } from 'bun:sqlite';
import { existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import type { SourceAdapter } from '../types';
import type {
  Source,
  FileCursor,
  FileFingerprint,
  ParseResult,
  CanonicalMessage,
  CanonicalSession,
} from '../../types';

const DEFAULT_DB_PATH = join(
  homedir(),
  '.local',
  'share',
  'opencode',
  'opencode.db',
);

interface SessionRow {
  id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
}

interface MessageRow {
  id: string;
  session_id: string;
  time_created: number;
  data: string;
}

interface PartRow {
  message_id: string;
  time_created: number;
  data: string;
}

interface MessageData {
  role?: string;
  tokens?: { input?: number; output?: number; cache?: { read?: number } };
  model?: { modelID?: string };
}

interface PartData {
  type?: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status?: string;
    input?: unknown;
    output?: unknown;
    error?: string;
  };
  reasoning?: { text?: string };
}

export class OpenCodeAdapter implements SourceAdapter {
  source: Source = 'opencode';
  private dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = dbPath ?? DEFAULT_DB_PATH;
  }

  async discover(): Promise<string[]> {
    if (existsSync(this.dbPath)) return [this.dbPath];
    return [];
  }

  shouldSkip(
    cursor: FileCursor | undefined,
    fingerprint: FileFingerprint,
  ): boolean {
    if (!cursor) return false;
    return (
      cursor.mtimeMs === fingerprint.mtimeMs &&
      cursor.size === fingerprint.size
    );
  }

  async parse(dbPath: string, _startOffset: number): Promise<ParseResult[]> {
    const db = new Database(dbPath, { readonly: true });
    try {
      return this.parseDb(db);
    } finally {
      db.close();
    }
  }

  private parseDb(db: Database): ParseResult[] {
    const sessions = db
      .query(
        'SELECT id, title, directory, time_created, time_updated FROM session ORDER BY time_created',
      )
      .all() as SessionRow[];

    const results: ParseResult[] = [];

    for (const session of sessions) {
      const messages = db
        .query(
          'SELECT id, session_id, time_created, data FROM message WHERE session_id = ? ORDER BY time_created, id',
        )
        .all(session.id) as MessageRow[];

      if (messages.length === 0) continue;

      const canonicalMessages: CanonicalMessage[] = [];
      let model: string | undefined;
      let totalInput = 0;
      let totalOutput = 0;
      let totalCached = 0;

      for (const msg of messages) {
        const msgData = JSON.parse(msg.data) as MessageData;
        const role = msgData.role as 'user' | 'assistant' | undefined;
        if (!role) continue;

        if (msgData.model?.modelID) model = msgData.model.modelID;
        if (msgData.tokens) {
          totalInput += msgData.tokens.input ?? 0;
          totalOutput += msgData.tokens.output ?? 0;
          totalCached += msgData.tokens.cache?.read ?? 0;
        }

        const parts = db
          .query(
            'SELECT message_id, time_created, data FROM part WHERE message_id = ? ORDER BY id',
          )
          .all(msg.id) as PartRow[];

        const textParts: string[] = [];
        let toolName: string | undefined;
        let toolInput: string | undefined;
        let toolResult: string | undefined;

        for (const part of parts) {
          const pd = JSON.parse(part.data) as PartData;
          if (pd.type === 'text' && pd.text) {
            textParts.push(pd.text);
          } else if (pd.type === 'reasoning' && pd.reasoning?.text) {
            // skip reasoning blocks
          } else if (pd.type === 'tool' && pd.tool) {
            toolName = pd.tool;
            if (pd.state?.input != null) {
              toolInput =
                typeof pd.state.input === 'string'
                  ? pd.state.input
                  : JSON.stringify(pd.state.input);
            }
            if (pd.state?.output != null) {
              toolResult =
                typeof pd.state.output === 'string'
                  ? pd.state.output
                  : JSON.stringify(pd.state.output);
            }
            if (pd.state?.error) {
              toolResult = pd.state.error;
            }
          }
        }

        const content = textParts.join('\n');
        const timestamp = new Date(msg.time_created).toISOString();

        if (toolName) {
          canonicalMessages.push({
            role: 'tool',
            content: content || '',
            toolName,
            toolInput,
            toolResult,
            model: msgData.model?.modelID,
            inputTokens: msgData.tokens?.input,
            outputTokens: msgData.tokens?.output,
            cachedTokens: msgData.tokens?.cache?.read,
            timestamp,
          });
        } else if (content) {
          canonicalMessages.push({
            role,
            content,
            model: msgData.model?.modelID,
            inputTokens: msgData.tokens?.input,
            outputTokens: msgData.tokens?.output,
            cachedTokens: msgData.tokens?.cache?.read,
            timestamp,
          });
        }
      }

      if (canonicalMessages.length === 0) continue;

      const startedAt = new Date(session.time_created).toISOString();
      const lastMessageAt = new Date(session.time_updated).toISOString();
      const durationSeconds = Math.round(
        (session.time_updated - session.time_created) / 1000,
      );
      const projectName = basename(session.directory);
      const projectRef = createHash('sha256')
        .update(session.directory)
        .digest('hex');

      const canonical: CanonicalSession = {
        sessionKey: `opencode:${session.id}`,
        source: 'opencode',
        startedAt,
        lastMessageAt,
        durationSeconds,
        projectRef,
        projectName,
        model,
        title: session.title || undefined,
        messages: canonicalMessages,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalCachedTokens: totalCached,
      };

      results.push({ canonical });
    }

    return results;
  }

  buildCursor(fingerprint: FileFingerprint, _results: ParseResult[]): FileCursor {
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: fingerprint.size,
      updatedAt: new Date().toISOString(),
    };
  }
}

export const openCodeAdapter = new OpenCodeAdapter();
