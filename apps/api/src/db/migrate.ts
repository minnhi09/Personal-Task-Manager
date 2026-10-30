import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getDatabase } from './database.js';

const migrationsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'migrations');

export function migrate(): void {
  const db = getDatabase();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`);

  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: string }>).map((row) => row.version)
  );
  const files = fs.readdirSync(migrationsDirectory).filter((file) => file.endsWith('.sql')).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDirectory, file), 'utf8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    console.log(`Applied migration ${file}`);
  }
}

export function resetDatabase(): void {
  const db = getDatabase();
  db.exec(`
    DROP TABLE IF EXISTS calendar_item_overrides;
    DROP TABLE IF EXISTS calendar_items;
    DROP TABLE IF EXISTS tasks;
    DROP TABLE IF EXISTS projects;
    DROP TABLE IF EXISTS mobile_tokens;
    DROP TABLE IF EXISTS sessions;
    DROP TABLE IF EXISTS users;
    DROP TABLE IF EXISTS schema_migrations;
  `);
  migrate();
}
