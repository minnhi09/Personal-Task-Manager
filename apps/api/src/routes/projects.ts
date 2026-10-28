import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth.js';
import { createProject, deleteProject, findProject, listProjects, updateProject } from '../db/repository.js';
import { badRequest, conflict, notFound } from '../http.js';

const projectSchema = z.object({
  name: z.string().trim().min(1).max(80),
  color: z.string().trim().max(32).nullable().optional(),
  version: z.number().int().positive().optional()
});

const paramsSchema = z.object({ id: z.string().uuid() });

export async function registerProjectRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/projects', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    reply.send({ projects: listProjects(user.id) });
  });

  app.post('/api/v1/projects', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = projectSchema.safeParse(request.body);
    if (!parsed.success) {
      badRequest(reply, 'Tên Project chưa hợp lệ.', parsed.error.flatten());
      return;
    }
    const project = createProject(user.id, parsed.data.name, parsed.data.color ?? null);
    reply.code(201).send({ project });
  });

  app.patch('/api/v1/projects/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const parsed = projectSchema.safeParse(request.body);
    if (!params.success || !parsed.success || parsed.data.version === undefined) {
      badRequest(reply, 'Dữ liệu cập nhật Project chưa hợp lệ.');
      return;
    }
    const project = updateProject(user.id, params.data.id, parsed.data.name, parsed.data.color ?? null, parsed.data.version);
    if (project === undefined) return notFound(reply, 'Project không tồn tại.');
    if (project === 'CONFLICT') return conflict(reply);
    reply.send({ project });
  });

  app.delete('/api/v1/projects/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const body = z.object({ version: z.number().int().positive() }).safeParse(request.body);
    if (!params.success || !body.success) {
      badRequest(reply, 'Cần cung cấp version hiện tại của Project.');
      return;
    }
    const result = deleteProject(user.id, params.data.id, body.data.version);
    if (result === 'NOT_FOUND') return notFound(reply, 'Project không tồn tại.');
    if (result === 'CONFLICT') return conflict(reply);
    reply.code(204).send();
  });
}
