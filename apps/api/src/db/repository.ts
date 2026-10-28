import { randomUUID } from 'node:crypto';

import { getDatabase } from './database.js';
import type { DeadlineType, Project, Task, TaskPriority, TaskStatus, User } from '../types.js';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  timezone: string;
  created_at: string;
};

type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

type TaskRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadline_type: DeadlineType;
  due_date: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  version: number;
};

export function toUser(row: UserRow): User {
  return { id: row.id, email: row.email, timezone: row.timezone, createdAt: row.created_at };
}

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    color: row.color,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: row.version
  };
}

export function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.user_id,
    projectId: row.project_id,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    deadlineType: row.deadline_type,
    dueDate: row.due_date,
    dueAt: row.due_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    version: row.version
  };
}

export function findUserByEmail(email: string): (UserRow & { password_hash: string }) | undefined {
  return getDatabase().prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE').get(email) as (UserRow & { password_hash: string }) | undefined;
}

export function findUserById(id: string): UserRow | undefined {
  return getDatabase().prepare('SELECT id, email, timezone, created_at FROM users WHERE id = ?').get(id) as UserRow | undefined;
}

export function createUser(email: string, passwordHash: string): User {
  const now = new Date().toISOString();
  const row: UserRow = {
    id: randomUUID(),
    email,
    password_hash: passwordHash,
    timezone: 'Asia/Bangkok',
    created_at: now
  };
  getDatabase().prepare(
    'INSERT INTO users (id, email, password_hash, timezone, created_at) VALUES (@id, @email, @password_hash, @timezone, @created_at)'
  ).run(row);
  return toUser(row);
}

export function createSession(userId: string, expiresAt: string): string {
  const id = randomUUID();
  getDatabase().prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(id, userId, expiresAt, new Date().toISOString());
  return id;
}

export function findUserBySession(sessionId: string): User | undefined {
  const row = getDatabase().prepare(`
    SELECT u.id, u.email, u.timezone, u.created_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ?
  `).get(sessionId, new Date().toISOString()) as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function deleteSession(sessionId: string): void {
  getDatabase().prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function deleteExpiredSessions(): void {
  getDatabase().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

export function listProjects(userId: string): Project[] {
  const rows = getDatabase().prepare('SELECT * FROM projects WHERE user_id = ? AND deleted_at IS NULL ORDER BY name COLLATE NOCASE').all(userId) as ProjectRow[];
  return rows.map(toProject);
}

export function findProject(userId: string, projectId: string): Project | undefined {
  const row = getDatabase().prepare('SELECT * FROM projects WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(projectId, userId) as ProjectRow | undefined;
  return row ? toProject(row) : undefined;
}

export function createProject(userId: string, name: string, color: string | null): Project {
  const now = new Date().toISOString();
  const row: ProjectRow = { id: randomUUID(), user_id: userId, name, color, created_at: now, updated_at: now, version: 1 };
  getDatabase().prepare(
    'INSERT INTO projects (id, user_id, name, color, created_at, updated_at, version) VALUES (@id, @user_id, @name, @color, @created_at, @updated_at, @version)'
  ).run(row);
  return toProject(row);
}

export function updateProject(userId: string, projectId: string, name: string, color: string | null, version: number): Project | 'CONFLICT' | undefined {
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`
    UPDATE projects
    SET name = ?, color = ?, updated_at = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?
  `).run(name, color, now, projectId, userId, version);
  if (result.changes === 0) {
    const existing = findProject(userId, projectId);
    return existing ? 'CONFLICT' : undefined;
  }
  return findProject(userId, projectId);
}

export function deleteProject(userId: string, projectId: string, version: number): 'CONFLICT' | 'NOT_FOUND' | 'OK' {
  const db = getDatabase();
  const transaction = (callback: () => 'CONFLICT' | 'NOT_FOUND' | 'OK') => {
    db.exec('BEGIN');
    try {
      const result = callback();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  };
  return transaction(() => {
    const result = db.prepare(`UPDATE projects SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?`).run(new Date().toISOString(), new Date().toISOString(), projectId, userId, version);
    if (result.changes > 0) {
      db.prepare('UPDATE tasks SET project_id = NULL, updated_at = ?, version = version + 1 WHERE project_id = ? AND user_id = ? AND deleted_at IS NULL').run(new Date().toISOString(), projectId, userId);
      return 'OK' as const;
    }
    return findProject(userId, projectId) ? ('CONFLICT' as const) : ('NOT_FOUND' as const);
  });
}

export type TaskFilters = {
  search?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  projectId?: string;
};

export function listTasks(userId: string, filters: TaskFilters = {}): Task[] {
  const where = ['user_id = ?', 'deleted_at IS NULL'];
  const values: Array<string> = [userId];
  if (filters.search) {
    where.push('(title LIKE ? OR description LIKE ?)');
    const query = `%${filters.search}%`;
    values.push(query, query);
  }
  if (filters.status) {
    where.push('status = ?');
    values.push(filters.status);
  }
  if (filters.priority) {
    where.push('priority = ?');
    values.push(filters.priority);
  }
  if (filters.projectId === 'none') {
    where.push('project_id IS NULL');
  } else if (filters.projectId) {
    where.push('project_id = ?');
    values.push(filters.projectId);
  }
  const rows = getDatabase().prepare(`SELECT * FROM tasks WHERE ${where.join(' AND ')} ORDER BY CASE status WHEN 'DONE' THEN 1 ELSE 0 END, CASE deadline_type WHEN 'NONE' THEN 1 ELSE 0 END, due_at, due_date, created_at DESC`).all(...values) as TaskRow[];
  return rows.map(toTask);
}

export function findTask(userId: string, taskId: string): Task | undefined {
  const row = getDatabase().prepare('SELECT * FROM tasks WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(taskId, userId) as TaskRow | undefined;
  return row ? toTask(row) : undefined;
}

export type TaskValues = {
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadlineType: DeadlineType;
  dueDate: string | null;
  dueAt: string | null;
};

export function createTask(userId: string, values: TaskValues): Task {
  const now = new Date().toISOString();
  const row: TaskRow = {
    id: randomUUID(),
    user_id: userId,
    project_id: values.projectId,
    title: values.title,
    description: values.description,
    status: values.status,
    priority: values.priority,
    deadline_type: values.deadlineType,
    due_date: values.dueDate,
    due_at: values.dueAt,
    created_at: now,
    updated_at: now,
    completed_at: values.status === 'DONE' ? now : null,
    version: 1
  };
  getDatabase().prepare(`
    INSERT INTO tasks (id, user_id, project_id, title, description, status, priority, deadline_type, due_date, due_at, created_at, updated_at, completed_at, version)
    VALUES (@id, @user_id, @project_id, @title, @description, @status, @priority, @deadline_type, @due_date, @due_at, @created_at, @updated_at, @completed_at, @version)
  `).run(row);
  return toTask(row);
}

export function updateTask(userId: string, taskId: string, values: TaskValues, version: number): Task | 'CONFLICT' | undefined {
  const now = new Date().toISOString();
  const completedAt = values.status === 'DONE' ? now : null;
  const result = getDatabase().prepare(`
    UPDATE tasks
    SET project_id = ?, title = ?, description = ?, status = ?, priority = ?, deadline_type = ?, due_date = ?, due_at = ?, updated_at = ?, completed_at = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?
  `).run(values.projectId, values.title, values.description, values.status, values.priority, values.deadlineType, values.dueDate, values.dueAt, now, completedAt, taskId, userId, version);
  if (result.changes === 0) {
    const existing = findTask(userId, taskId);
    return existing ? 'CONFLICT' : undefined;
  }
  return findTask(userId, taskId);
}

export function deleteTask(userId: string, taskId: string, version: number): 'CONFLICT' | 'NOT_FOUND' | 'OK' {
  const result = getDatabase().prepare('UPDATE tasks SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?').run(new Date().toISOString(), new Date().toISOString(), taskId, userId, version);
  if (result.changes > 0) return 'OK';
  return findTask(userId, taskId) ? 'CONFLICT' : 'NOT_FOUND';
}

export function projectBelongsToUser(userId: string, projectId: string | null): boolean {
  return projectId === null || Boolean(findProject(userId, projectId));
}
