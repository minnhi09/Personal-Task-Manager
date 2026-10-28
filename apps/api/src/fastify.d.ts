import type { User } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}
