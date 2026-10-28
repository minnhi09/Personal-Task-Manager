import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { createLoginSession, getExistingUserPasswordHash, hashPassword, logout, normalizeEmail, readUser, verifyPassword } from '../auth.js';
import { createUser, findUserByEmail } from '../db/repository.js';
import { badRequest } from '../http.js';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320),
  password: z.string().min(8).max(128)
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/v1/auth/register', async (request, reply) => {
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
    const passwordHash = getExistingUserPasswordHash(email);
    if (!passwordHash || !(await verifyPassword(passwordHash, parsed.data.password))) {
      reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Email hoặc mật khẩu không đúng.' } });
      return;
    }

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

  app.get('/api/v1/auth/me', async (request, reply) => {
    const user = readUser(request);
    reply.send({ user: user ?? null });
  });

  app.post('/api/v1/auth/logout', async (request, reply) => {
    logout(request, reply);
    reply.send({ ok: true });
  });
}
