import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import type { CanonicalMessage, CanonicalSession, ParseResult } from '../../types';

interface ClaudeLine {
  type: string;
  subtype?: string;
  sessionId?: string;
  uuid?: string;
  parentUuid?: string | null;
  timestamp?: string;
  message?: {
    role: string;
    content: string | ContentBlock[];
    model?: string;
    usage?: TokenUsage;
  };
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | ContentBlock[];
  is_error?: boolean;
  citations?: unknown;
}

interface TokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface SessionAccumulator {
  sessionId: string;
  messages: CanonicalMessage[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCachedTokens: number;
  model?: string;
  startedAt?: string;
  lastMessageAt?: string;
}

export function extractProjectName(filePath: string): string {
  // ~/.claude/projects/-Users-symbolstar-superset/*.jsonl
  // Extract the directory name and decode: -Users-symbolstar → /Users/symbolstar
  const parts = filePath.split('/');
  const projectsIdx = parts.indexOf('projects');
  if (projectsIdx === -1 || projectsIdx + 1 >= parts.length) return 'unknown';
  const encoded = parts[projectsIdx + 1];
  return encoded.replace(/-/g, '/');
}

export function extractProjectRef(filePath: string): string {
  const parts = filePath.split('/');
  const projectsIdx = parts.indexOf('projects');
  if (projectsIdx === -1 || projectsIdx + 1 >= parts.length) return '';
  const dirName = parts[projectsIdx + 1];
  return createHash('sha256').update(dirName).digest('hex');
}

function extractTextFromContent(content: string | ContentBlock[]): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join('\n');
}

function extractToolUseMessages(content: ContentBlock[], timestamp: string, model?: string): CanonicalMessage[] {
  return content
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({
      role: 'tool' as const,
      content: '',
      toolName: b.name,
      toolInput: typeof b.input === 'string' ? b.input : JSON.stringify(b.input),
      timestamp,
      model,
    }));
}

function extractToolResults(content: ContentBlock[], timestamp: string): CanonicalMessage[] {
  return content
    .filter((b) => b.type === 'tool_result')
    .map((b) => {
      const resultText = typeof b.content === 'string'
        ? b.content
        : Array.isArray(b.content)
          ? b.content.filter((c) => c.type === 'text').map((c) => c.text || '').join('\n')
          : '';
      return {
        role: 'tool' as const,
        content: resultText,
        toolName: b.tool_use_id,
        toolResult: resultText,
        timestamp,
      };
    });
}

function processLine(line: ClaudeLine, sessions: Map<string, SessionAccumulator>): void {
  // Skip non-message types
  if (!line.type || line.type === 'queue-operation' || line.type === 'system'
    || line.type === 'permission-mode' || line.type === 'file-history-snapshot') return;
  if (line.type !== 'user' && line.type !== 'assistant') return;

  const sessionId = line.sessionId;
  if (!sessionId) return;

  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      sessionId,
      messages: [],
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCachedTokens: 0,
    });
  }
  const acc = sessions.get(sessionId)!;
  const ts = line.timestamp || new Date().toISOString();

  if (!acc.startedAt) acc.startedAt = ts;
  acc.lastMessageAt = ts;

  const msg = line.message;
  if (!msg) return;

  if (line.type === 'user') {
    if (typeof msg.content === 'string') {
      acc.messages.push({ role: 'user', content: msg.content, timestamp: ts });
    } else if (Array.isArray(msg.content)) {
      // Could contain tool_result blocks or text blocks
      const textContent = extractTextFromContent(msg.content);
      const toolResults = extractToolResults(msg.content, ts);
      if (textContent) {
        acc.messages.push({ role: 'user', content: textContent, timestamp: ts });
      }
      acc.messages.push(...toolResults);
    }
  } else if (line.type === 'assistant') {
    const content = msg.content;
    const model = msg.model;
    if (!acc.model && model) acc.model = model;

    // Accumulate tokens
    const usage = msg.usage;
    if (usage) {
      acc.totalInputTokens += usage.input_tokens || 0;
      acc.totalOutputTokens += usage.output_tokens || 0;
      acc.totalCachedTokens += (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    }

    if (typeof content === 'string') {
      acc.messages.push({ role: 'assistant', content, timestamp: ts, model });
    } else if (Array.isArray(content)) {
      // Skip thinking blocks, extract text and tool_use
      const textContent = extractTextFromContent(content);
      const toolUses = extractToolUseMessages(content, ts, model);
      if (textContent) {
        acc.messages.push({
          role: 'assistant', content: textContent, timestamp: ts, model,
          inputTokens: usage?.input_tokens, outputTokens: usage?.output_tokens,
        });
      }
      acc.messages.push(...toolUses);
    }
  }
}

function generateTitle(projectName: string, messages: CanonicalMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content);
  const preview = firstUser ? firstUser.content.slice(0, 80) : 'untitled';
  const shortProject = projectName.split('/').pop() || projectName;
  return `${shortProject}: ${preview}`;
}

export async function parseClaudeFile(filePath: string, startOffset = 0): Promise<ParseResult[]> {
  const sessions = new Map<string, SessionAccumulator>();

  const stream = createReadStream(filePath, { start: startOffset, encoding: 'utf-8' });
  const rl = createInterface({ input: stream, crlfDelay: Number.POSITIVE_INFINITY });

  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as ClaudeLine;
      processLine(parsed, sessions);
    } catch {
      // Skip malformed lines
    }
  }

  const projectName = extractProjectName(filePath);
  const projectRef = extractProjectRef(filePath);

  const results: ParseResult[] = [];
  for (const acc of sessions.values()) {
    if (acc.messages.length === 0) continue;
    const startedAt = acc.startedAt || new Date().toISOString();
    const lastMessageAt = acc.lastMessageAt || startedAt;
    const durationSeconds = Math.round(
      (new Date(lastMessageAt).getTime() - new Date(startedAt).getTime()) / 1000
    );

    const canonical: CanonicalSession = {
      sessionKey: `claude-code:${acc.sessionId}`,
      source: 'claude-code',
      startedAt,
      lastMessageAt,
      durationSeconds,
      projectRef,
      projectName,
      model: acc.model,
      title: generateTitle(projectName, acc.messages),
      messages: acc.messages,
      totalInputTokens: acc.totalInputTokens,
      totalOutputTokens: acc.totalOutputTokens,
      totalCachedTokens: acc.totalCachedTokens,
    };
    results.push({ canonical });
  }

  return results;
}
