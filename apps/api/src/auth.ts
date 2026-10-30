import argon2 from 'argon2';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { config } from './config.js';
import {
  createMobileToken,
  createSession,
  deleteExpiredMobileTokens,
  deleteExpiredSessions,
  deleteSession,
  findUserByEmail,
  findUserByMobileToken,
  findUserBySession,
  revokeMobileToken
} from './db/repository.js';
import type { User } from './types.js';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(config.sessionCookieName, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlDays * 24 * 60 * 60
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.sessionCookieName, { path: '/' });
}

export function createLoginSession(reply: FastifyReply, userId: string): void {
  deleteExpiredSessions();
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86_400_000).toISOString();
  setSessionCookie(reply, createSession(userId, expiresAt));
}

export function createMobileLoginToken(userId: string): { token: string; expiresAt: string } {
  deleteExpiredMobileTokens();
  const expiresAt = new Date(Date.now() + config.mobileTokenTtlDays * 86_400_000).toISOString();
  return { token: createMobileToken(userId, expiresAt), expiresAt };
}

function bearerToken(request: FastifyRequest): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
}

export function readUser(request: FastifyRequest): User | undefined {
  const token = bearerToken(request);
  if (token) {
    const user = findUserByMobileToken(token);
    if (user) request.user = user;
    return user;
  }
  const sessionId = request.cookies[config.sessionCookieName];
  if (!sessionId) return undefined;
  const user = findUserBySession(sessionId);
  if (user) request.user = user;
  return user;
}

export function logoutMobile(request: FastifyRequest): void {
  const token = bearerToken(request);
  if (token) revokeMobileToken(token);
}

export function requireUser(request: FastifyRequest, reply: FastifyReply): User | undefined {
  const user = readUser(request);
  if (!user) {
    reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Bạn cần đăng nhập để tiếp tục.' } });
    return undefined;
  }
  return user;
}

export function logout(request: FastifyRequest, reply: FastifyReply): void {
  const sessionId = request.cookies[config.sessionCookieName];
  if (sessionId) deleteSession(sessionId);
  clearSessionCookie(reply);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function getExistingUserPasswordHash(email: string): string | undefined {
  return findUserByEmail(normalizeEmail(email))?.password_hash;
}
