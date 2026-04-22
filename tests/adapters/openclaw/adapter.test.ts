import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { OpenClawAdapter } from '../../../src/adapters/openclaw/adapter';
import type { FileCursor, FileFingerprint } from '../../../src/types';

function sessionLine(id: string, cwd: string) {
  return JSON.stringify({
    type: 'session',
    version: 3,
    id,
    timestamp: '2026-04-22T02:00:00.000Z',
    cwd,
  });
}

function modelChangeLine(modelId: string) {
  return JSON.stringify({
    type: 'model_change',
    id: 'mc1',
    timestamp: '2026-04-22T02:00:01.000Z',
    provider: 'anthropic',
    modelId,
  });
}

function userMessageLine(text: string) {
  return JSON.stringify({
    type: 'message',
    id: 'u1',
    parentId: 'mc1',
    timestamp: '2026-04-22T02:00:02.000Z',
    message: {
      role: 'user',
      content: [{ type: 'text', text }],
      timestamp: 1776826802000,
    },
  });
}

function assistantMessageLine(text: string, model?: string) {
  return JSON.stringify({
    type: 'message',
    id: 'a1',
    parentId: 'u1',
    timestamp: '2026-04-22T02:01:00.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text }],
      model: model ?? 'claude-opus-4.6-1m',
      usage: { input: 100, output: 50, cacheRead: 10 },
      stopReason: 'stop',
      timestamp: 1776826860000,
    },
  });
}

function toolCallMessageLine() {
  return JSON.stringify({
    type: 'message',
    id: 'a2',
    parentId: 'u1',
    timestamp: '2026-04-22T02:01:30.000Z',
    message: {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me check.' },
        { type: 'toolCall', id: 'tc1', name: 'web_fetch', arguments: { url: 'https://example.com' } },
      ],
      model: 'claude-opus-4.6-1m',
      usage: { input: 200, output: 80 },
      stopReason: 'toolUse',
      timestamp: 1776826890000,
    },
  });
}

function toolResultLine() {
  return JSON.stringify({
    type: 'message',
    id: 'tr1',
    parentId: 'a2',
    timestamp: '2026-04-22T02:01:35.000Z',
    message: {
      role: 'toolResult',
      toolCallId: 'tc1',
      toolName: 'web_fetch',
      content: [{ type: 'text', text: 'Page content here' }],
    },
  });
}

function thinkingChangeLine() {
  return JSON.stringify({
    type: 'thinking_level_change',
    id: 'tl1',
    timestamp: '2026-04-22T02:00:00.500Z',
    thinkingLevel: 'low',
  });
}

function customLine() {
  return JSON.stringify({
    type: 'custom',
    customType: 'model-snapshot',
    data: {},
    id: 'c1',
    timestamp: '2026-04-22T02:00:00.600Z',
  });
}

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'synapse-openclaw-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

async function writeFixture(agentName: string, sessionId: string, lines: string[]): Promise<string> {
  const sessionsDir = join(tempDir, agentName, 'sessions');
  await mkdir(sessionsDir, { recursive: true });
  const filePath = join(sessionsDir, `${sessionId}.jsonl`);
  await writeFile(filePath, lines.join('\n') + '\n');
  return filePath;
}

describe('OpenClawAdapter', () => {
  test('discover finds .jsonl files across agents', async () => {
    await writeFixture('judy', 'abc-123', [sessionLine('abc-123', '/tmp/proj')]);
    await writeFixture('milly', 'def-456', [sessionLine('def-456', '/tmp/proj2')]);
    // Write a .lock file that should be skipped
    const lockDir = join(tempDir, 'judy', 'sessions');
    await writeFile(join(lockDir, 'abc-123.lock'), '');

    const adapter = new OpenClawAdapter(tempDir);
    const files = await adapter.discover();
    expect(files.length).toBe(2);
    expect(files.every((f) => f.endsWith('.jsonl'))).toBe(true);
  });

  test('discover returns empty for non-existent dir', async () => {
    const adapter = new OpenClawAdapter(join(tempDir, 'nope'));
    const files = await adapter.discover();
    expect(files).toEqual([]);
  });

  test('shouldSkip returns true for unchanged files', () => {
    const adapter = new OpenClawAdapter(tempDir);
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 500 };
    const cursor: FileCursor = { inode: 1, mtimeMs: 1000, size: 500, offset: 500, updatedAt: '' };
    expect(adapter.shouldSkip(cursor, fp)).toBe(true);
  });

  test('shouldSkip returns false when no cursor', () => {
    const adapter = new OpenClawAdapter(tempDir);
    const fp: FileFingerprint = { inode: 1, mtimeMs: 1000, size: 500 };
    expect(adapter.shouldSkip(undefined, fp)).toBe(false);
  });

  test('shouldSkip returns false when file changed', () => {
    const adapter = new OpenClawAdapter(tempDir);
    const fp: FileFingerprint = { inode: 1, mtimeMs: 2000, size: 600 };
    const cursor: FileCursor = { inode: 1, mtimeMs: 1000, size: 500, offset: 500, updatedAt: '' };
    expect(adapter.shouldSkip(cursor, fp)).toBe(false);
  });

  test('parse extracts messages from JSONL', async () => {
    const filePath = await writeFixture('judy', 'sess-001', [
      sessionLine('sess-001', '/Users/test/myproject'),
      modelChangeLine('claude-opus-4.6-1m'),
      thinkingChangeLine(),
      customLine(),
      userMessageLine('Hello Judy!'),
      assistantMessageLine('Hi there!'),
    ]);

    const adapter = new OpenClawAdapter(tempDir);
    const results = await adapter.parse(filePath, 0);

    expect(results.length).toBe(1);
    const session = results[0].canonical;
    expect(session.source).toBe('openclaw');
    expect(session.sessionKey).toBe('openclaw:judy:sess-001');
    expect(session.projectName).toBe('myproject');
    expect(session.model).toBe('claude-opus-4.6-1m');
    expect(session.title).toContain('[judy]');
    expect(session.title).toContain('Hello Judy!');
    expect(session.messages.length).toBe(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toBe('Hello Judy!');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('Hi there!');
    expect(session.totalInputTokens).toBe(100);
    expect(session.totalOutputTokens).toBe(50);
    expect(session.totalCachedTokens).toBe(10);
  });

  test('parse handles tool calls and results', async () => {
    const filePath = await writeFixture('milly', 'sess-002', [
      sessionLine('sess-002', '/tmp/proj'),
      userMessageLine('fetch this page'),
      toolCallMessageLine(),
      toolResultLine(),
    ]);

    const adapter = new OpenClawAdapter(tempDir);
    const results = await adapter.parse(filePath, 0);

    expect(results.length).toBe(1);
    const msgs = results[0].canonical.messages;
    // user, assistant text, tool call, tool result
    expect(msgs.length).toBe(4);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect(msgs[1].content).toBe('Let me check.');
    expect(msgs[2].role).toBe('tool');
    expect(msgs[2].toolName).toBe('web_fetch');
    expect(msgs[2].toolInput).toContain('example.com');
    expect(msgs[3].role).toBe('tool');
    expect(msgs[3].toolName).toBe('web_fetch');
    expect(msgs[3].content).toBe('Page content here');
  });

  test('parse returns empty for file with no messages', async () => {
    const filePath = await writeFixture('judy', 'sess-003', [
      sessionLine('sess-003', '/tmp/x'),
      modelChangeLine('some-model'),
      thinkingChangeLine(),
    ]);

    const adapter = new OpenClawAdapter(tempDir);
    const results = await adapter.parse(filePath, 0);
    expect(results.length).toBe(0);
  });

  test('parse with startOffset skips bytes', async () => {
    const line1 = sessionLine('sess-004', '/tmp/proj');
    const line2 = userMessageLine('first message');
    const line3 = assistantMessageLine('response');

    const filePath = await writeFixture('judy', 'sess-004', [line1, line2, line3]);

    const adapter = new OpenClawAdapter(tempDir);
    // Start after the session line
    const offset = Buffer.byteLength(line1 + '\n');
    const results = await adapter.parse(filePath, offset);

    expect(results.length).toBe(1);
    // Without the session line, cwd won't be set
    expect(results[0].canonical.projectName).toBeUndefined();
    expect(results[0].canonical.messages.length).toBe(2);
  });

  test('buildCursor sets offset to file size', () => {
    const adapter = new OpenClawAdapter(tempDir);
    const fp: FileFingerprint = { inode: 42, mtimeMs: 9999, size: 1234 };
    const cursor = adapter.buildCursor(fp);
    expect(cursor.offset).toBe(1234);
    expect(cursor.inode).toBe(42);
    expect(cursor.mtimeMs).toBe(9999);
    expect(cursor.size).toBe(1234);
    expect(cursor.updatedAt).toBeTruthy();
  });

  test('parse handles string content', async () => {
    const line = JSON.stringify({
      type: 'message',
      id: 'u2',
      timestamp: '2026-04-22T03:00:00.000Z',
      message: { role: 'user', content: 'plain string content' },
    });
    const filePath = await writeFixture('judy', 'sess-005', [
      sessionLine('sess-005', '/tmp/x'),
      line,
    ]);

    const adapter = new OpenClawAdapter(tempDir);
    const results = await adapter.parse(filePath, 0);
    expect(results.length).toBe(1);
    expect(results[0].canonical.messages[0].content).toBe('plain string content');
  });
});
