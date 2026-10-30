import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { getDatabase } from './database.js';
import type {
  CalendarItemKind,
  CalendarRecurrence,
  CalendarRecurrenceFrequency,
  DeadlineType,
  Project,
  Task,
  TaskPriority,
  TaskStatus,
  User
} from '../types.js';

type UserRow = {
  id: string;
  email: string;
  password_hash: string;
  timezone: string;
  created_at: string;
};

type MobileTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
  revoked_at: string | null;
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

export type CalendarItemValues = {
  kind: CalendarItemKind;
  taskId: string | null;
  title: string | null;
  description: string | null;
  allDay: boolean;
  start: string;
  end: string;
  color: string | null;
  recurrence: CalendarRecurrence;
};

export type CalendarItemRow = {
  id: string;
  user_id: string;
  kind: CalendarItemKind;
  task_id: string | null;
  title: string | null;
  description: string | null;
  all_day: number;
  start_value: string;
  end_value: string;
  color: string | null;
  recurrence_frequency: CalendarRecurrenceFrequency;
  recurrence_interval: number;
  recurrence_weekdays: string;
  recurrence_until: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
};

export type CalendarOverrideRow = {
  id: string;
  calendar_item_id: string;
  user_id: string;
  occurrence_start: string;
  cancelled: number;
  title: string | null;
  description: string | null;
  all_day: number | null;
  start_value: string | null;
  end_value: string | null;
  color: string | null;
  created_at: string;
  updated_at: string;
  version: number;
};

export function recurrenceFromRow(row: CalendarItemRow): CalendarRecurrence {
  return {
    frequency: row.recurrence_frequency,
    interval: row.recurrence_interval,
    weekdays: row.recurrence_weekdays
      ? row.recurrence_weekdays.split(',').map(Number).filter((value) => Number.isInteger(value) && value >= 0 && value <= 6)
      : [],
    until: row.recurrence_until
  };
}

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
    timezone: 'Asia/Ho_Chi_Minh',
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

function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createMobileToken(userId: string, expiresAt: string): string {
  const token = randomBytes(32).toString('base64url');
  const row: MobileTokenRow = {
    id: randomUUID(),
    user_id: userId,
    token_hash: hashOpaqueToken(token),
    expires_at: expiresAt,
    created_at: new Date().toISOString(),
    revoked_at: null
  };
  getDatabase().prepare(`
    INSERT INTO mobile_tokens (id, user_id, token_hash, expires_at, created_at, revoked_at)
    VALUES (@id, @user_id, @token_hash, @expires_at, @created_at, @revoked_at)
  `).run(row);
  return token;
}

export function findUserByMobileToken(token: string): User | undefined {
  const row = getDatabase().prepare(`
    SELECT u.id, u.email, u.timezone, u.created_at
    FROM mobile_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ? AND t.expires_at > ? AND t.revoked_at IS NULL
  `).get(hashOpaqueToken(token), new Date().toISOString()) as UserRow | undefined;
  return row ? toUser(row) : undefined;
}

export function revokeMobileToken(token: string): void {
  getDatabase().prepare('UPDATE mobile_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(new Date().toISOString(), hashOpaqueToken(token));
}

export function deleteExpiredMobileTokens(): void {
  getDatabase().prepare('DELETE FROM mobile_tokens WHERE expires_at <= ? OR revoked_at IS NOT NULL').run(new Date().toISOString());
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
  const db = getDatabase();
  const now = new Date().toISOString();
  db.exec('BEGIN');
  try {
    const result = db.prepare('UPDATE tasks SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?').run(now, now, taskId, userId, version);
    if (result.changes > 0) {
      db.prepare('UPDATE calendar_items SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE task_id = ? AND user_id = ? AND deleted_at IS NULL').run(now, now, taskId, userId);
      db.exec('COMMIT');
      return 'OK';
    }
    db.exec('ROLLBACK');
    return findTask(userId, taskId) ? 'CONFLICT' : 'NOT_FOUND';
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function projectBelongsToUser(userId: string, projectId: string | null): boolean {
  return projectId === null || Boolean(findProject(userId, projectId));
}

export function listCalendarItems(userId: string): CalendarItemRow[] {
  return getDatabase().prepare('SELECT * FROM calendar_items WHERE user_id = ? AND deleted_at IS NULL ORDER BY start_value').all(userId) as CalendarItemRow[];
}

export function findCalendarItem(userId: string, id: string): CalendarItemRow | undefined {
  return getDatabase().prepare('SELECT * FROM calendar_items WHERE id = ? AND user_id = ? AND deleted_at IS NULL').get(id, userId) as CalendarItemRow | undefined;
}

export function listCalendarOverrides(userId: string, itemId: string): CalendarOverrideRow[] {
  return getDatabase().prepare('SELECT * FROM calendar_item_overrides WHERE user_id = ? AND calendar_item_id = ? ORDER BY occurrence_start').all(userId, itemId) as CalendarOverrideRow[];
}

export function createCalendarItem(userId: string, values: CalendarItemValues): CalendarItemRow {
  const now = new Date().toISOString();
  const row = {
    id: randomUUID(),
    user_id: userId,
    kind: values.kind,
    task_id: values.taskId,
    title: values.title,
    description: values.description,
    all_day: values.allDay ? 1 : 0,
    start_value: values.start,
    end_value: values.end,
    color: values.color,
    recurrence_frequency: values.recurrence.frequency,
    recurrence_interval: values.recurrence.interval,
    recurrence_weekdays: values.recurrence.weekdays.join(','),
    recurrence_until: values.recurrence.until,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    version: 1
  };
  getDatabase().prepare(`
    INSERT INTO calendar_items (
      id, user_id, kind, task_id, title, description, all_day, start_value, end_value, color,
      recurrence_frequency, recurrence_interval, recurrence_weekdays, recurrence_until,
      created_at, updated_at, deleted_at, version
    ) VALUES (
      @id, @user_id, @kind, @task_id, @title, @description, @all_day, @start_value, @end_value, @color,
      @recurrence_frequency, @recurrence_interval, @recurrence_weekdays, @recurrence_until,
      @created_at, @updated_at, @deleted_at, @version
    )
  `).run(row);
  return row as CalendarItemRow;
}

export function updateCalendarItem(userId: string, id: string, values: CalendarItemValues, version: number): CalendarItemRow | 'CONFLICT' | undefined {
  const now = new Date().toISOString();
  const result = getDatabase().prepare(`
    UPDATE calendar_items
    SET kind = ?, task_id = ?, title = ?, description = ?, all_day = ?, start_value = ?, end_value = ?, color = ?,
        recurrence_frequency = ?, recurrence_interval = ?, recurrence_weekdays = ?, recurrence_until = ?,
        updated_at = ?, version = version + 1
    WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?
  `).run(
    values.kind,
    values.taskId,
    values.title,
    values.description,
    values.allDay ? 1 : 0,
    values.start,
    values.end,
    values.color,
    values.recurrence.frequency,
    values.recurrence.interval,
    values.recurrence.weekdays.join(','),
    values.recurrence.until,
    now,
    id,
    userId,
    version
  );
  if (result.changes === 0) {
    const existing = findCalendarItem(userId, id);
    return existing ? 'CONFLICT' : undefined;
  }
  return findCalendarItem(userId, id);
}

export function deleteCalendarItem(userId: string, id: string, version: number): 'CONFLICT' | 'NOT_FOUND' | 'OK' {
  const now = new Date().toISOString();
  const result = getDatabase().prepare('UPDATE calendar_items SET deleted_at = ?, updated_at = ?, version = version + 1 WHERE id = ? AND user_id = ? AND deleted_at IS NULL AND version = ?').run(now, now, id, userId, version);
  if (result.changes > 0) return 'OK';
  return findCalendarItem(userId, id) ? 'CONFLICT' : 'NOT_FOUND';
}

export type CalendarOverrideValues = {
  cancelled: boolean;
  title: string | null;
  description: string | null;
  allDay: boolean | null;
  start: string | null;
  end: string | null;
  color: string | null;
};

export function upsertCalendarOverride(userId: string, itemId: string, occurrenceStart: string, values: CalendarOverrideValues): CalendarOverrideRow {
  const db = getDatabase();
  const now = new Date().toISOString();
  const existing = db.prepare('SELECT * FROM calendar_item_overrides WHERE user_id = ? AND calendar_item_id = ? AND occurrence_start = ?').get(userId, itemId, occurrenceStart) as CalendarOverrideRow | undefined;
  if (existing) {
    db.prepare(`
      UPDATE calendar_item_overrides
      SET cancelled = ?, title = ?, description = ?, all_day = ?, start_value = ?, end_value = ?, color = ?, updated_at = ?, version = version + 1
      WHERE id = ? AND user_id = ?
    `).run(values.cancelled ? 1 : 0, values.title, values.description, values.allDay === null ? null : values.allDay ? 1 : 0, values.start, values.end, values.color, now, existing.id, userId);
    return db.prepare('SELECT * FROM calendar_item_overrides WHERE id = ?').get(existing.id) as CalendarOverrideRow;
  }
  const row = {
    id: randomUUID(),
    calendar_item_id: itemId,
    user_id: userId,
    occurrence_start: occurrenceStart,
    cancelled: values.cancelled ? 1 : 0,
    title: values.title,
    description: values.description,
    all_day: values.allDay === null ? null : values.allDay ? 1 : 0,
    start_value: values.start,
    end_value: values.end,
    color: values.color,
    created_at: now,
    updated_at: now,
    version: 1
  };
  db.prepare(`
    INSERT INTO calendar_item_overrides (
      id, calendar_item_id, user_id, occurrence_start, cancelled, title, description, all_day, start_value, end_value, color, created_at, updated_at, version
    ) VALUES (
      @id, @calendar_item_id, @user_id, @occurrence_start, @cancelled, @title, @description, @all_day, @start_value, @end_value, @color, @created_at, @updated_at, @version
    )
  `).run(row);
  return row as CalendarOverrideRow;
}
