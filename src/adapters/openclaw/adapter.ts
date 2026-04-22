import { readdir } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SourceAdapter } from '../types';
import type {
  Source,
  FileCursor,
  FileFingerprint,
  ParseResult,
  CanonicalMessage,
  CanonicalSession,
} from '../../types';
import { fileUnchanged } from '../fingerprint';

const DEFAULT_OPENCLAW_DIR = join(homedir(), '.openclaw', 'agents');

interface SessionLine {
  type: 'session';
  id: string;
  timestamp: string;
  cwd?: string;
}

interface MessageLine {
  type: 'message';
  id: string;
  timestamp: string;
  message: {
    role: 'user' | 'assistant' | 'toolResult';
    content?: string | ContentBlock[];
    toolCallId?: string;
    toolName?: string;
    api?: string;
    provider?: string;
    model?: string;
    usage?: {
      input?: number;
      output?: number;
      cacheRead?: number;
    };
    stopReason?: string;
    timestamp?: number;
  };
}

interface ModelChangeLine {
  type: 'model_change';
  timestamp: string;
  modelId: string;
  provider?: string;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

type JSONLLine = SessionLine | MessageLine | ModelChangeLine | { type: string };

export class OpenClawAdapter implements SourceAdapter {
  source: Source = 'openclaw';
  private openclawDir: string;

  constructor(openclawDir?: string) {
    this.openclawDir = openclawDir ?? DEFAULT_OPENCLAW_DIR;
  }

  async discover(): Promise<string[]> {
    const files: string[] = [];
    let agents: Awaited<ReturnType<typeof readdir>>;
    try {
      agents = await readdir(this.openclawDir, { withFileTypes: true });
    } catch {
      return files;
    }

    for (const agent of agents) {
      if (!agent.isDirectory()) continue;
      const sessionsDir = join(this.openclawDir, agent.name, 'sessions');
      let entries: Awaited<ReturnType<typeof readdir>>;
      try {
        entries = await readdir(sessionsDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (
          entry.isFile() &&
          entry.name.endsWith('.jsonl') &&
          !entry.name.endsWith('.lock') &&
          !entry.name.endsWith('.reset')
        ) {
          files.push(join(sessionsDir, entry.name));
        }
      }
    }
    return files;
  }

  shouldSkip(cursor: FileCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  }

  async parse(filePath: string, startOffset: number): Promise<ParseResult[]> {
    // Extract agent name from path: .../agents/{agentName}/sessions/{uuid}.jsonl
    const parts = filePath.split('/');
    const sessionsIdx = parts.lastIndexOf('sessions');
    const agentName = sessionsIdx >= 2 ? parts[sessionsIdx - 1] : 'unknown';
    const sessionId = basename(filePath, '.jsonl');

    const lines = await this.readLines(filePath, startOffset);
    if (lines.length === 0) return [];

    let currentModel: string | undefined;
    let cwd: string | undefined;
    let sessionTimestamp: string | undefined;
    const messages: CanonicalMessage[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;

    for (const line of lines) {
      const parsed = line as JSONLLine;

      if (parsed.type === 'session') {
        const sl = parsed as SessionLine;
        cwd = sl.cwd;
        sessionTimestamp = sl.timestamp;
      } else if (parsed.type === 'model_change') {
        const ml = parsed as ModelChangeLine;
        currentModel = ml.modelId;
      } else if (parsed.type === 'message') {
        const ml = parsed as MessageLine;
        const msg = ml.message;

        if (msg.role === 'toolResult') {
          const content = extractContent(msg.content);
          if (content) {
            messages.push({
              role: 'tool',
              content,
              toolName: msg.toolName,
              timestamp: ml.timestamp,
            });
          }
          continue;
        }

        if (msg.role !== 'user' && msg.role !== 'assistant') continue;

        // Track usage from assistant messages
        if (msg.usage) {
          totalInput += msg.usage.input ?? 0;
          totalOutput += msg.usage.output ?? 0;
          totalCached += msg.usage.cacheRead ?? 0;
        }

        if (msg.model) currentModel = msg.model;

        const content = extractContent(msg.content);

        // Check for tool calls in content blocks
        const toolCalls = extractToolCalls(msg.content);
        if (toolCalls.length > 0) {
          // Add text part first if any
          if (content) {
            messages.push({
              role: msg.role,
              content,
              model: msg.role === 'assistant' ? (msg.model ?? currentModel) : undefined,
              inputTokens: msg.usage?.input,
              outputTokens: msg.usage?.output,
              cachedTokens: msg.usage?.cacheRead,
              timestamp: ml.timestamp,
            });
          }
          for (const tc of toolCalls) {
            messages.push({
              role: 'tool',
              content: '',
              toolName: tc.name,
              toolInput: typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments),
              timestamp: ml.timestamp,
            });
          }
        } else if (content) {
          messages.push({
            role: msg.role,
            content,
            model: msg.role === 'assistant' ? (msg.model ?? currentModel) : undefined,
            inputTokens: msg.usage?.input,
            outputTokens: msg.usage?.output,
            cachedTokens: msg.usage?.cacheRead,
            timestamp: ml.timestamp,
          });
        }
      }
      // skip thinking_level_change, custom, etc.
    }

    if (messages.length === 0) return [];

    const startedAt = sessionTimestamp ?? messages[0].timestamp;
    const lastMessageAt = messages[messages.length - 1].timestamp;
    const durationSeconds = Math.round(
      (new Date(lastMessageAt).getTime() - new Date(startedAt).getTime()) / 1000,
    );

    const projectName = cwd ? basename(cwd) : undefined;
    const projectRef = cwd
      ? createHash('sha256').update(cwd).digest('hex')
      : undefined;

    // Generate title from first user message
    const firstUser = messages.find((m) => m.role === 'user');
    const titlePrefix = `[${agentName}]`;
    const titleBody = firstUser
      ? firstUser.content.slice(0, 80).split('\n')[0]
      : 'Empty session';
    const title = `${titlePrefix} ${titleBody}`;

    const canonical: CanonicalSession = {
      sessionKey: `openclaw:${agentName}:${sessionId}`,
      source: 'openclaw',
      startedAt,
      lastMessageAt,
      durationSeconds,
      projectRef,
      projectName,
      model: currentModel,
      title,
      messages,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCachedTokens: totalCached,
    };

    return [{ canonical }];
  }

  buildCursor(fingerprint: FileFingerprint): FileCursor {
    return {
      inode: fingerprint.inode,
      mtimeMs: fingerprint.mtimeMs,
      size: fingerprint.size,
      offset: fingerprint.size,
      updatedAt: new Date().toISOString(),
    };
  }

  private async readLines(filePath: string, startOffset: number): Promise<unknown[]> {
    const lines: unknown[] = [];
    const stream = createReadStream(filePath, {
      start: startOffset,
      encoding: 'utf-8',
    });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    for await (const line of rl) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        lines.push(JSON.parse(trimmed));
      } catch {
        // skip malformed lines
      }
    }
    return lines;
  }
}

function extractContent(content: string | ContentBlock[] | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

function extractToolCalls(
  content: string | ContentBlock[] | undefined,
): { name: string; arguments: unknown }[] {
  if (!content || typeof content === 'string') return [];
  return content
    .filter((b) => b.type === 'toolCall' && b.name)
    .map((b) => ({ name: b.name!, arguments: b.arguments }));
}

export const openClawAdapter = new OpenClawAdapter();
