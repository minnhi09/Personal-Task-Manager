import type { DeadlineBucket, Task } from '../types.js';

export function localDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function getDeadlineBucket(task: Pick<Task, 'deadlineType' | 'dueDate' | 'dueAt'>, now = new Date(), timeZone = 'Asia/Bangkok'): DeadlineBucket {
  if (task.deadlineType === 'NONE') return 'NO_DEADLINE';

  if (task.deadlineType === 'DATE') {
    const today = localDateInTimeZone(now, timeZone);
    if (!task.dueDate) return 'NO_DEADLINE';
    if (task.dueDate < today) return 'OVERDUE';
    if (task.dueDate === today) return 'TODAY';
    return 'UPCOMING';
  }

  if (!task.dueAt) return 'NO_DEADLINE';
  const dueAt = Date.parse(task.dueAt);
  if (Number.isNaN(dueAt)) return 'NO_DEADLINE';
  if (dueAt < now.getTime()) return 'OVERDUE';
  if (localDateInTimeZone(new Date(dueAt), timeZone) === localDateInTimeZone(now, timeZone)) return 'TODAY';
  return 'UPCOMING';
}

export function normalizeDueAt(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error('Invalid dueAt');
  return parsed.toISOString();
}

export function formatDeadline(task: Pick<Task, 'deadlineType' | 'dueDate' | 'dueAt'>, timeZone = 'Asia/Bangkok'): string {
  if (task.deadlineType === 'NONE') return 'Không có hạn';
  if (task.deadlineType === 'DATE') {
    if (!task.dueDate) return 'Không có hạn';
    return new Intl.DateTimeFormat('vi-VN', { timeZone, dateStyle: 'medium' }).format(new Date(`${task.dueDate}T12:00:00Z`));
  }
  if (!task.dueAt) return 'Không có hạn';
  return new Intl.DateTimeFormat('vi-VN', { timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(task.dueAt));
}

export function relativeDeadline(task: Pick<Task, 'deadlineType' | 'dueDate' | 'dueAt'>, now = new Date(), timeZone = 'Asia/Bangkok'): string {
  const bucket = getDeadlineBucket(task, now, timeZone);
  if (bucket === 'NO_DEADLINE') return 'Không có hạn';
  if (bucket === 'TODAY') return 'Hôm nay';

  const today = localDateInTimeZone(now, timeZone);
  const target = task.deadlineType === 'DATE'
    ? task.dueDate
    : task.dueAt ? localDateInTimeZone(new Date(task.dueAt), timeZone) : null;
  if (!target) return 'Không có hạn';

  const dayDifference = Math.round((Date.parse(`${target}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (bucket === 'OVERDUE') return dayDifference === 0 ? 'Quá hạn hôm nay' : `Quá hạn ${Math.max(1, Math.abs(dayDifference))} ngày`;
  return `Còn ${dayDifference} ngày`;
}
