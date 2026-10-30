import { pathToFileURL } from 'node:url';

import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';

import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerCalendarRoutes } from './routes/calendar.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerTaskRoutes } from './routes/tasks.js';

export async function buildApp(): Promise<FastifyInstance> {
  migrate();
  const app = Fastify({ logger: process.env.NODE_ENV === 'test' ? false : true });

  await app.register(cookie);
  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true
  });

  app.addHook('onRequest', async (request, reply) => {
    if (!['POST', 'PATCH', 'DELETE', 'PUT'].includes(request.method)) return;
    const origin = request.headers.origin;
    if (origin && origin !== config.webOrigin) {
      reply.code(403).send({ error: { code: 'ORIGIN_FORBIDDEN', message: 'Nguồn yêu cầu không hợp lệ.' } });
      return;
    }
  });

  app.get('/api/v1/health', async () => ({ ok: true }));

  await registerAuthRoutes(app);
  await registerCalendarRoutes(app);
  await registerProjectRoutes(app);
  await registerTaskRoutes(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (reply.sent) return;
    reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Đã xảy ra lỗi máy chủ.' } });
  });

  return app;
}

async function main(): Promise<void> {
  const app = await buildApp();
  await app.listen({ port: config.port, host: '127.0.0.1' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
