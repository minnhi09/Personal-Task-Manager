import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireUser } from '../auth.js';
import { formatDeadline, getDeadlineBucket, normalizeDueAt, relativeDeadline } from '../domain/deadline.js';
import { createTask, deleteTask, listTasks, projectBelongsToUser, updateTask, type TaskValues } from '../db/repository.js';
import { badRequest, conflict, notFound } from '../http.js';
import type { DeadlineType, Task, TaskPriority, TaskStatus } from '../types.js';

const taskSchema = z.object({
  projectId: z.string().uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(['TODO', 'IN_PROGRESS', 'DONE']).optional(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  deadlineType: z.enum(['NONE', 'DATE', 'DATETIME']).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  version: z.number().int().positive().optional()
});

const paramsSchema = z.object({ id: z.string().uuid() });

function taskValues(input: z.infer<typeof taskSchema>): { values?: TaskValues; error?: string } {
  const deadlineType = (input.deadlineType ?? 'NONE') as DeadlineType;
  const dueDate = input.dueDate ?? null;
  let dueAt: string | null = null;
  if (deadlineType === 'NONE' && (dueDate || input.dueAt)) return { error: 'Task không có deadline không được có ngày hoặc giờ hạn.' };
  if (deadlineType === 'DATE' && (!dueDate || input.dueAt)) return { error: 'Deadline chỉ có ngày cần dueDate và không có dueAt.' };
  if (deadlineType === 'DATE' && dueDate) {
    const [year, month, day] = dueDate.split('-').map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
      return { error: 'dueDate không phải ngày hợp lệ.' };
    }
  }
  if (deadlineType === 'DATETIME' && (dueDate || !input.dueAt)) return { error: 'Deadline có giờ cần dueAt và không có dueDate.' };
  if (deadlineType === 'DATETIME' && input.dueAt) {
    try {
      dueAt = normalizeDueAt(input.dueAt);
    } catch {
      return { error: 'dueAt không phải thời điểm hợp lệ.' };
    }
  }
  return {
    values: {
      projectId: input.projectId ?? null,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      status: (input.status ?? 'TODO') as TaskStatus,
      priority: (input.priority ?? 'MEDIUM') as TaskPriority,
      deadlineType,
      dueDate: deadlineType === 'DATE' ? dueDate : null,
      dueAt
    }
  };
}

function presentTask(task: Task, timezone: string) {
  return {
    ...task,
    deadlineBucket: getDeadlineBucket(task, new Date(), timezone),
    deadlineLabel: formatDeadline(task, timezone),
    relativeDeadline: relativeDeadline(task, new Date(), timezone)
  };
}

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/tasks', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const query = request.query as Record<string, string | undefined>;
    const status = query.status && ['TODO', 'IN_PROGRESS', 'DONE'].includes(query.status) ? query.status as TaskStatus : undefined;
    const priority = query.priority && ['LOW', 'MEDIUM', 'HIGH'].includes(query.priority) ? query.priority as TaskPriority : undefined;
    const tasks = listTasks(user.id, { search: query.search?.trim() || undefined, projectId: query.projectId, status, priority })
      .map((task) => presentTask(task, user.timezone));
    const bucketOrder: Record<string, number> = { OVERDUE: 0, TODAY: 1, UPCOMING: 2, NO_DEADLINE: 3 };
    tasks.sort((left, right) => {
      const statusDifference = Number(left.status === 'DONE') - Number(right.status === 'DONE');
      if (statusDifference !== 0) return statusDifference;
      const bucketDifference = bucketOrder[left.deadlineBucket] - bucketOrder[right.deadlineBucket];
      if (bucketDifference !== 0) return bucketDifference;
      const leftDue = left.dueAt ?? left.dueDate ?? left.createdAt;
      const rightDue = right.dueAt ?? right.dueDate ?? right.createdAt;
      return leftDue.localeCompare(rightDue);
    });
    reply.send({ tasks });
  });

  app.post('/api/v1/tasks', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = taskSchema.safeParse(request.body);
    if (!parsed.success) {
      badRequest(reply, 'Dữ liệu Task chưa hợp lệ.', parsed.error.flatten());
      return;
    }
    const checked = taskValues(parsed.data);
    if (!checked.values) return badRequest(reply, checked.error ?? 'Dữ liệu deadline chưa hợp lệ.');
    if (!projectBelongsToUser(user.id, checked.values.projectId)) return notFound(reply, 'Project không tồn tại.');
    const task = createTask(user.id, checked.values);
    reply.code(201).send({ task: presentTask(task, user.timezone) });
  });

  app.patch('/api/v1/tasks/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const parsed = taskSchema.safeParse(request.body);
    if (!params.success || !parsed.success || parsed.data.version === undefined) {
      badRequest(reply, 'Dữ liệu cập nhật Task chưa hợp lệ.');
      return;
    }
    const checked = taskValues(parsed.data);
    if (!checked.values) return badRequest(reply, checked.error ?? 'Dữ liệu deadline chưa hợp lệ.');
    if (!projectBelongsToUser(user.id, checked.values.projectId)) return notFound(reply, 'Project không tồn tại.');
    const task = updateTask(user.id, params.data.id, checked.values, parsed.data.version);
    if (task === undefined) return notFound(reply, 'Task không tồn tại.');
    if (task === 'CONFLICT') return conflict(reply);
    reply.send({ task: presentTask(task, user.timezone) });
  });

  app.delete('/api/v1/tasks/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const body = z.object({ version: z.number().int().positive() }).safeParse(request.body);
    if (!params.success || !body.success) {
      badRequest(reply, 'Cần cung cấp version hiện tại của Task.');
      return;
    }
    const result = deleteTask(user.id, params.data.id, body.data.version);
    if (result === 'NOT_FOUND') return notFound(reply, 'Task không tồn tại.');
    if (result === 'CONFLICT') return conflict(reply);
    reply.code(204).send();
  });
}
