import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { SourceAdapter } from '../types';
import type { Source, FileCursor, FileFingerprint, ParseResult } from '../../types';
import { fileUnchanged } from '../fingerprint';
import { parseClaudeFile } from './parser';

export class ClaudeCodeAdapter implements SourceAdapter {
  source: Source = 'claude-code';
  private claudeDir: string;

  constructor(claudeDir?: string) {
    this.claudeDir = claudeDir ?? join(homedir(), '.claude', 'projects');
  }

  async discover(): Promise<string[]> {
    const files: string[] = [];
    await this.scanDir(this.claudeDir, files);
    return files;
  }

  private async scanDir(dir: string, files: string[]): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'subagents') continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.scanDir(full, files);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(full);
      }
    }
  }

  shouldSkip(cursor: FileCursor | undefined, fingerprint: FileFingerprint): boolean {
    return fileUnchanged(cursor, fingerprint);
  }

  async parse(filePath: string, startOffset: number): Promise<ParseResult[]> {
    return parseClaudeFile(filePath, startOffset);
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
}

export const claudeCodeAdapter = new ClaudeCodeAdapter();
