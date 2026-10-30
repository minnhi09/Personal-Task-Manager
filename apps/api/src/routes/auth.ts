import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { config } from '../config.js';
import { createLoginSession, createMobileLoginToken, getExistingUserPasswordHash, hashPassword, logout, normalizeEmail, readUser, verifyPassword, logoutMobile } from '../auth.js';
import { createUser, findUserByEmail } from '../db/repository.js';
import { badRequest } from '../http.js';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128)
});

const failedLogins = new Map<string, { count: number; resetAt: number }>();

function loginKey(request: { ip: string }, email: string): string {
  return `${request.ip}:${email}`;
}

function loginBlocked(request: { ip: string }, email: string): boolean {
  const state = failedLogins.get(loginKey(request, email));
  if (!state || state.resetAt <= Date.now()) {
    if (state) failedLogins.delete(loginKey(request, email));
    return false;
  }
  return state.count >= 5;
}

function recordLoginFailure(request: { ip: string }, email: string): void {
  const key = loginKey(request, email);
  const current = failedLogins.get(key);
  if (!current || current.resetAt <= Date.now()) {
    failedLogins.set(key, { count: 1, resetAt: Date.now() + 60_000 });
    return;
  }
  current.count += 1;
}

function clearLoginFailures(request: { ip: string }, email: string): void {
  failedLogins.delete(loginKey(request, email));
}

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/register', async (request, reply) => {
    if (!config.allowRegistration) {
      reply.code(403).send({ error: { code: 'REGISTRATION_DISABLED', message: 'Đăng ký công khai đang bị tắt.' } });
      return;
    }
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      badRequest(reply, 'Email hoặc mật khẩu chưa hợp lệ.', parsed.error.flatten());
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    if (getExistingUserPasswordHash(email)) {
      reply.code(409).send({ error: { code: 'EMAIL_IN_USE', message: 'Email này đã được sử dụng.' } });
      return;
    }

    try {
      const user = createUser(email, await hashPassword(parsed.data.password));
      createLoginSession(reply, user.id);
      reply.code(201).send({ user });
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) {
        reply.code(409).send({ error: { code: 'EMAIL_IN_USE', message: 'Email này đã được sử dụng.' } });
        return;
      }
      throw error;
    }
  });

  app.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      badRequest(reply, 'Email hoặc mật khẩu chưa hợp lệ.', parsed.error.flatten());
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    if (loginBlocked(request, email)) {
      reply.code(429).send({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Bạn thử đăng nhập quá nhiều lần. Hãy thử lại sau một phút.' } });
      return;
    }
    const passwordHash = getExistingUserPasswordHash(email);
    if (!passwordHash || !(await verifyPassword(passwordHash, parsed.data.password))) {
      recordLoginFailure(request, email);
      reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
      return;
    }
    clearLoginFailures(request, email);

    // The login response does not rely on a previous session. Load the public user after verification.
    const loginUser = findUserByEmail(email);
    if (!loginUser) {
      reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
      return;
    }
    const publicUser = {
      id: loginUser.id,
      email: loginUser.email,
      timezone: loginUser.timezone,
      createdAt: loginUser.created_at
    };
    createLoginSession(reply, publicUser.id);
    reply.send({ user: publicUser });
  });

  app.post('/api/v1/auth/mobile/login', async (request, reply) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) {
      badRequest(reply, 'Email hoặc mật khẩu chưa hợp lệ.', parsed.error.flatten());
      return;
    }

    const email = normalizeEmail(parsed.data.email);
    if (loginBlocked(request, email)) {
      reply.code(429).send({ error: { code: 'LOGIN_RATE_LIMITED', message: 'Bạn thử đăng nhập quá nhiều lần. Hãy thử lại sau một phút.' } });
      return;
    }
    const passwordHash = getExistingUserPasswordHash(email);
    if (!passwordHash || !(await verifyPassword(passwordHash, parsed.data.password))) {
      recordLoginFailure(request, email);
      reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
      return;
    }

    const loginUser = findUserByEmail(email);
    if (!loginUser) {
      recordLoginFailure(request, email);
      reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
      return;
    }
    clearLoginFailures(request, email);
    const publicUser = {
      id: loginUser.id,
      email: loginUser.email,
      timezone: loginUser.timezone,
      createdAt: loginUser.created_at
    };
    const mobile = createMobileLoginToken(publicUser.id);
    reply.send({ ...mobile, user: publicUser });
  });

  app.get('/api/v1/auth/me', async (request, reply) => {
    const user = readUser(request);
    reply.send({ user: user ?? null });
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    logout(request, reply);
    reply.send({ ok: true });
  });

  app.post('/api/v1/auth/mobile/logout', async (request, reply) => {
    logoutMobile(request);
    reply.send({ ok: true });
  });
}
