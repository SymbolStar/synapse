import { join } from 'node:path';
import { homedir } from 'node:os';

export const SYNAPSE_DIR = '.synapse';
export const DB_FILENAME = 'synapse.db';
export const CURSOR_FILENAME = 'cursors.json';
export const METADATA_BATCH_SIZE = 50;
export const VERSION = '0.1.0';
export const PARSER_REVISION = 1;
export const SCHEMA_VERSION = 1;
export const DEFAULT_SEARCH_LIMIT = 10;
export const MAX_SEARCH_LIMIT = 100;

export function getSynapseDir(): string {
  return join(homedir(), SYNAPSE_DIR);
}

export function getDbPath(): string {
  return join(getSynapseDir(), DB_FILENAME);
}

export function getCursorPath(): string {
  return join(getSynapseDir(), CURSOR_FILENAME);
}
