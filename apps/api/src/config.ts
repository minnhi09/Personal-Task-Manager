import 'dotenv/config';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function findWorkspaceRoot(start: string): string {
  let current = start;
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
    const parent = path.dirname(current);
    if (parent === current) return process.cwd();
    current = parent;
  }
}

const projectRoot = findWorkspaceRoot(path.dirname(fileURLToPath(import.meta.url)));

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: positiveInteger(process.env.API_PORT, 3001),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  databasePath: path.resolve(projectRoot, process.env.DATABASE_PATH ?? './data/personal-task-manager.db'),
  sessionTtlDays: positiveInteger(process.env.SESSION_TTL_DAYS, 30),
  mobileTokenTtlDays: positiveInteger(process.env.MOBILE_TOKEN_TTL_DAYS, 30),
  isProduction: process.env.NODE_ENV === 'production',
  allowRegistration: process.env.ALLOW_REGISTRATION
    ? process.env.ALLOW_REGISTRATION === 'true'
    : process.env.NODE_ENV !== 'production',
  sessionCookieName: 'ptm_session'
};
