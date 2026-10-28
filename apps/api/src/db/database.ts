import fs from 'node:fs';
import path from 'node:path';

import { DatabaseSync } from 'node:sqlite';

import { config } from '../config.js';

let database: DatabaseSync | undefined;

export function getDatabase(): DatabaseSync {
  if (database) return database;

  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
  database = new DatabaseSync(config.databasePath);
  database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  return database;
}

export function closeDatabase(): void {
  database?.close();
  database = undefined;
}
