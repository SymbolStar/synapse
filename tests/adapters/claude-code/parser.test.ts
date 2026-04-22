import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { parseClaudeFile, extractProjectName, extractProjectRef } from '../../../src/adapters/claude-code/parser';

function jsonl(...lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

function makeUserLine(sessionId: string, content: string | object[], ts: string, parentUuid?: string | null) {
  return {
    type: 'user',
    sessionId,
    uuid: `u-${Date.now()}`,
    parentUuid: parentUuid ?? null,
    timestamp: ts,
    message: { role: 'user', content },
  };
}

function makeAssistantLine(sessionId: string, content: string | object[], ts: string, usage?: object) {
  return {
    type: 'assistant',
    sessionId,
    uuid: `a-${Date.now()}`,
    timestamp: ts,
    message: {
      role: 'assistant',
      model: 'claude-opus-4.6-1m',
      content,
      usage: usage ?? { input_tokens: 100, output_tokens: 50 },
    },
  };
}

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'synapse-test-'));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('parseClaudeFile', () => {
  test('parses user and assistant messages', async () => {
    const dir = join(tmpDir, 'projects', '-Users-symbolstar-myproject');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'session.jsonl');

    const data = jsonl(
      makeUserLine('sess1', 'hello world', '2026-04-15T10:00:00Z'),
      makeAssistantLine('sess1', [{ type: 'text', text: 'Hi there!' }], '2026-04-15T10:00:05Z', {
        input_tokens: 200, output_tokens: 30, cache_read_input_tokens: 10,
      }),
    );
    writeFileSync(filePath, data);

    const results = await parseClaudeFile(filePath);
    expect(results).toHaveLength(1);
    const session = results[0].canonical;
    expect(session.sessionKey).toBe('claude-code:sess1');
    expect(session.source).toBe('claude-code');
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].role).toBe('user');
    expect(session.messages[0].content).toBe('hello world');
    expect(session.messages[1].role).toBe('assistant');
    expect(session.messages[1].content).toBe('Hi there!');
    expect(session.totalInputTokens).toBe(200);
    expect(session.totalOutputTokens).toBe(30);
    expect(session.totalCachedTokens).toBe(10);
    expect(session.durationSeconds).toBe(5);
  });

  test('skips thinking, queue-operation, system, and other non-message types', async () => {
    const dir = join(tmpDir, 'projects', '-Users-test');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'test.jsonl');

    const data = jsonl(
      { type: 'permission-mode', permissionMode: 'default', sessionId: 's1' },
      { type: 'file-history-snapshot', messageId: 'x' },
      { type: 'queue-operation', sessionId: 's1' },
      makeUserLine('s1', 'real message', '2026-04-15T10:00:00Z'),
      makeAssistantLine('s1', [
        { type: 'thinking', thinking: 'hmm...' },
        { type: 'text', text: 'answer' },
      ], '2026-04-15T10:00:01Z'),
      { type: 'system', subtype: 'stop_hook_summary', sessionId: 's1' },
    );
    writeFileSync(filePath, data);

    const results = await parseClaudeFile(filePath);
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(2);
    expect(results[0].canonical.messages[1].content).toBe('answer');
  });

  test('handles tool_use and tool_result', async () => {
    const dir = join(tmpDir, 'projects', '-Users-test');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'test.jsonl');

    const data = jsonl(
      makeUserLine('s1', 'run ls', '2026-04-15T10:00:00Z'),
      makeAssistantLine('s1', [
        { type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'ls' } },
      ], '2026-04-15T10:00:01Z'),
      makeUserLine('s1', [
        { type: 'tool_result', tool_use_id: 'tool1', content: 'file1\nfile2', is_error: false },
      ], '2026-04-15T10:00:02Z'),
    );
    writeFileSync(filePath, data);

    const results = await parseClaudeFile(filePath);
    const msgs = results[0].canonical.messages;
    expect(msgs).toHaveLength(3);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('tool');
    expect(msgs[1].toolName).toBe('Bash');
    expect(msgs[2].role).toBe('tool');
    expect(msgs[2].toolResult).toBe('file1\nfile2');
  });

  test('handles token accumulation across multiple assistant messages', async () => {
    const dir = join(tmpDir, 'projects', '-Users-test');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'test.jsonl');

    const data = jsonl(
      makeUserLine('s1', 'q1', '2026-04-15T10:00:00Z'),
      makeAssistantLine('s1', 'a1', '2026-04-15T10:00:01Z', { input_tokens: 100, output_tokens: 50 }),
      makeUserLine('s1', 'q2', '2026-04-15T10:00:02Z'),
      makeAssistantLine('s1', 'a2', '2026-04-15T10:00:03Z', { input_tokens: 200, output_tokens: 75 }),
    );
    writeFileSync(filePath, data);

    const results = await parseClaudeFile(filePath);
    expect(results[0].canonical.totalInputTokens).toBe(300);
    expect(results[0].canonical.totalOutputTokens).toBe(125);
  });

  test('empty file returns empty results', async () => {
    const filePath = join(tmpDir, 'empty.jsonl');
    writeFileSync(filePath, '');

    const results = await parseClaudeFile(filePath);
    expect(results).toHaveLength(0);
  });

  test('multi-session file produces multiple results', async () => {
    const dir = join(tmpDir, 'projects', '-Users-test');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'test.jsonl');

    const data = jsonl(
      makeUserLine('sessA', 'hello A', '2026-04-15T10:00:00Z'),
      makeAssistantLine('sessA', 'reply A', '2026-04-15T10:00:01Z'),
      makeUserLine('sessB', 'hello B', '2026-04-15T11:00:00Z'),
      makeAssistantLine('sessB', 'reply B', '2026-04-15T11:00:01Z'),
    );
    writeFileSync(filePath, data);

    const results = await parseClaudeFile(filePath);
    expect(results).toHaveLength(2);
    const keys = results.map((r) => r.canonical.sessionKey).sort();
    expect(keys).toEqual(['claude-code:sessA', 'claude-code:sessB']);
  });

  test('startOffset skips bytes', async () => {
    const dir = join(tmpDir, 'projects', '-Users-test');
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    const filePath = join(dir, 'test.jsonl');

    const line1 = JSON.stringify(makeUserLine('s1', 'first', '2026-04-15T10:00:00Z'));
    const line2 = JSON.stringify(makeAssistantLine('s1', 'second', '2026-04-15T10:00:01Z'));
    writeFileSync(filePath, line1 + '\n' + line2 + '\n');

    // Start after first line
    const offset = Buffer.byteLength(line1 + '\n');
    const results = await parseClaudeFile(filePath, offset);
    expect(results).toHaveLength(1);
    expect(results[0].canonical.messages).toHaveLength(1);
    expect(results[0].canonical.messages[0].role).toBe('assistant');
  });
});

describe('extractProjectName', () => {
  test('decodes path-encoded directory', () => {
    const name = extractProjectName('/Users/x/.claude/projects/-Users-symbolstar-superset/file.jsonl');
    expect(name).toBe('/Users/symbolstar/superset');
  });

  test('returns unknown for non-matching path', () => {
    expect(extractProjectName('/some/random/path.jsonl')).toBe('unknown');
  });
});

describe('extractProjectRef', () => {
  test('returns SHA-256 hash of directory name', () => {
    const ref = extractProjectRef('/Users/x/.claude/projects/-Users-symbolstar-superset/file.jsonl');
    const expected = createHash('sha256').update('-Users-symbolstar-superset').digest('hex');
    expect(ref).toBe(expected);
  });
});
