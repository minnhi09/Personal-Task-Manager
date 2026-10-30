import { z } from 'zod';
import type { FastifyInstance } from 'fastify';

import { requireUser } from '../auth.js';
import { badRequest, conflict, notFound } from '../http.js';
import {
  createCalendarItem,
  deleteCalendarItem,
  findCalendarItem,
  findProject,
  findTask,
  listCalendarItems,
  listCalendarOverrides,
  listTasks,
  projectBelongsToUser,
  recurrenceFromRow,
  updateCalendarItem,
  upsertCalendarOverride,
  type CalendarItemRow,
  type CalendarItemValues,
  type CalendarOverrideValues
} from '../db/repository.js';
import type { CalendarDisplayKind, CalendarItem, CalendarItemKind, CalendarRecurrence } from '../types.js';

const recurrenceSchema = z.object({
  frequency: z.enum(['NONE', 'DAILY', 'WEEKLY', 'MONTHLY']).default('NONE'),
  interval: z.number().int().min(1).max(365).default(1),
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null)
});

const calendarSchema = z.object({
  kind: z.enum(['TASK_BLOCK', 'EVENT']),
  taskId: z.string().uuid().nullable().optional(),
  title: z.string().trim().max(200).nullable().optional(),
  description: z.string().max(5000).nullable().optional(),
  allDay: z.boolean().default(false),
  start: z.string().min(1),
  end: z.string().min(1),
  color: z.string().trim().max(30).nullable().optional(),
  recurrence: recurrenceSchema.optional(),
  version: z.number().int().positive().optional(),
  scope: z.enum(['THIS', 'SERIES']).optional(),
  occurrenceStart: z.string().min(1).optional()
});

const paramsSchema = z.object({ id: z.string().uuid() });

type Boundary = { value: string; date: Date };
type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
  return { year: values.year, month: values.month, day: values.day, hour: values.hour, minute: values.minute, second: values.second };
}

function localDate(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone);
  return `${parts.year.toString().padStart(4, '0')}-${parts.month.toString().padStart(2, '0')}-${parts.day.toString().padStart(2, '0')}`;
}

function localDateTimeToIso(value: string, timeZone: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) throw new Error('Thời điểm không hợp lệ.');
  const localAsUtc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0));
  if (Number.isNaN(localAsUtc)) throw new Error('Thời điểm không hợp lệ.');
  let instant = new Date(localAsUtc);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const zoned = localParts(instant, timeZone);
    const displayedAsUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second);
    instant = new Date(localAsUtc - (displayedAsUtc - instant.getTime()));
  }
  if (Number.isNaN(instant.getTime())) throw new Error('Thời điểm không hợp lệ.');
  return instant.toISOString();
}

function parseBoundary(value: string, timeZone: string): Boundary {
  if (validDate(value)) return { value, date: new Date(`${value}T00:00:00Z`) };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Khoảng thời gian lịch không hợp lệ.');
  return { value: localDate(date, timeZone), date };
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonths(value: string, amount: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const index = year * 12 + month - 1 + amount;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  const nextDay = Math.min(day, daysInMonth(nextYear, nextMonth));
  return `${String(nextYear).padStart(4, '0')}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

function dayOfWeek(value: string): number {
  return new Date(`${value}T00:00:00Z`).getUTCDay();
}

function localTimeFromBase(start: string, allDay: boolean, timeZone: string): { date: string; hour: number; minute: number; second: number } {
  if (allDay) return { date: start, hour: 0, minute: 0, second: 0 };
  const parts = localParts(new Date(start), timeZone);
  return { date: `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`, hour: parts.hour, minute: parts.minute, second: parts.second };
}

function occurrenceStartValue(base: CalendarItemRow, date: string, timeZone: string): string {
  if (base.all_day) return date;
  const time = localTimeFromBase(base.start_value, false, timeZone);
  return localDateTimeToIso(`${date}T${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}:${String(time.second).padStart(2, '0')}`, timeZone);
}

function durationMs(base: CalendarItemRow): number {
  if (base.all_day) return 0;
  return new Date(base.end_value).getTime() - new Date(base.start_value).getTime();
}

function occurrenceEndValue(base: CalendarItemRow, start: string, timeZone: string): string {
  if (base.all_day) {
    const length = Math.max(1, Math.round((new Date(`${base.end_value}T00:00:00Z`).getTime() - new Date(`${base.start_value}T00:00:00Z`).getTime()) / 86_400_000));
    return addDays(start, length);
  }
  return new Date(new Date(start).getTime() + durationMs(base)).toISOString();
}

function rangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string, allDayLeft: boolean, allDayRight: boolean, timeZone: string): boolean {
  if (allDayLeft && allDayRight) return leftStart < rightEnd && rightStart < leftEnd;
  if (!allDayLeft && !allDayRight) return new Date(leftStart).getTime() < new Date(rightEnd).getTime() && new Date(rightStart).getTime() < new Date(leftEnd).getTime();
  const allDayStart = allDayLeft ? leftStart : rightStart;
  const allDayEnd = allDayLeft ? leftEnd : rightEnd;
  const timedStart = allDayLeft ? rightStart : leftStart;
  const timedEnd = allDayLeft ? rightEnd : leftEnd;
  if (new Date(timedEnd).getTime() <= new Date(timedStart).getTime()) return false;
  let timedDate = localDate(new Date(timedStart), timeZone);
  const lastTimedDate = localDate(new Date(new Date(timedEnd).getTime() - 1), timeZone);
  while (timedDate <= lastTimedDate) {
    if (allDayStart <= timedDate && timedDate < allDayEnd) return true;
    timedDate = addDays(timedDate, 1);
  }
  return false;
}

function recurrenceDates(base: CalendarItemRow, rangeStart: string, rangeEnd: string, timeZone: string): string[] {
  const recurrence = recurrenceFromRow(base);
  const baseTime = localTimeFromBase(base.start_value, Boolean(base.all_day), timeZone);
  const firstDate = baseTime.date;
  const until = recurrence.until;
  const dates: string[] = [];
  const cursorStart = addDays(rangeStart, -2);
  const cursorEnd = addDays(rangeEnd, 2);
  if (recurrence.frequency === 'NONE') {
    if (base.all_day ? base.start_value < rangeEnd && rangeStart < base.end_value : new Date(base.start_value) < new Date(`${rangeEnd}T23:59:59.999Z`) && new Date(base.end_value) > new Date(`${rangeStart}T00:00:00Z`)) {
      dates.push(firstDate);
    }
    return dates;
  }
  let date = cursorStart < firstDate ? firstDate : cursorStart;
  while (date < cursorEnd) {
    if (date >= firstDate && (!until || date <= until)) {
      const days = Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${firstDate}T00:00:00Z`).getTime()) / 86_400_000);
      let matches = false;
      if (recurrence.frequency === 'DAILY') matches = days % recurrence.interval === 0;
      if (recurrence.frequency === 'WEEKLY') {
        const weekdays = recurrence.weekdays.length ? recurrence.weekdays : [dayOfWeek(firstDate)];
        const firstWeekMonday = addDays(firstDate, -(dayOfWeek(firstDate) + 6) % 7);
        const weekIndex = Math.floor(Math.round((new Date(`${date}T00:00:00Z`).getTime() - new Date(`${firstWeekMonday}T00:00:00Z`).getTime()) / 86_400_000) / 7);
        matches = weekIndex % recurrence.interval === 0 && weekdays.includes(dayOfWeek(date));
      }
      if (recurrence.frequency === 'MONTHLY') {
        const [firstYear, firstMonth] = firstDate.split('-').map(Number);
        const [year, month] = date.split('-').map(Number);
        const monthIndex = (year - firstYear) * 12 + month - firstMonth;
        const targetDay = Math.min(Number(firstDate.slice(8, 10)), daysInMonth(year, month));
        matches = monthIndex >= 0 && monthIndex % recurrence.interval === 0 && Number(date.slice(8, 10)) === targetDay;
      }
      if (matches) dates.push(date);
    }
    date = addDays(date, 1);
  }
  return dates;
}

function overrideMap(rows: ReturnType<typeof listCalendarOverrides>): Map<string, ReturnType<typeof listCalendarOverrides>[number]> {
  return new Map(rows.map((row) => [row.occurrence_start, row]));
}

function expandItem(base: CalendarItemRow, overrides: ReturnType<typeof listCalendarOverrides>, rangeStart: string, rangeEnd: string, timeZone: string): CalendarItem[] {
  const task = base.task_id ? findTask(base.user_id, base.task_id) : undefined;
  const project = task?.projectId ? findProject(base.user_id, task.projectId) : undefined;
  if (base.kind === 'TASK_BLOCK' && !task) return [];
  const recurrence = recurrenceFromRow(base);
  const map = overrideMap(overrides);
  const instances: CalendarItem[] = [];
  for (const date of recurrenceDates(base, rangeStart, rangeEnd, timeZone)) {
    const originalStart = occurrenceStartValue(base, date, timeZone);
    const override = map.get(originalStart);
    if (override?.cancelled) continue;
    const start = override?.start_value ?? originalStart;
    const end = override?.end_value ?? occurrenceEndValue(base, originalStart, timeZone);
    const allDay = override?.all_day === null || override?.all_day === undefined ? Boolean(base.all_day) : Boolean(override.all_day);
    const startInRange = allDay ? start < rangeEnd && rangeStart < end : new Date(start) < new Date(`${rangeEnd}T23:59:59.999Z`) && new Date(end) > new Date(`${rangeStart}T00:00:00Z`);
    if (!startInRange) continue;
    instances.push({
      id: `${base.id}:${encodeURIComponent(originalStart)}`,
      userId: base.user_id,
      kind: base.kind,
      taskId: base.task_id,
      projectId: task?.projectId ?? null,
      title: override?.title ?? (base.kind === 'TASK_BLOCK' ? task?.title ?? 'Task đã xóa' : base.title ?? ''),
      description: override?.description ?? base.description,
      start,
      end,
      allDay,
      color: override?.color ?? base.color ?? project?.color ?? null,
      recurrence: recurrence.frequency === 'NONE' ? null : recurrence,
      seriesId: base.id,
      occurrenceStart: originalStart,
      isOccurrence: recurrence.frequency !== 'NONE',
      isOverride: Boolean(override),
      version: base.version
    });
  }
  return instances;
}

function normalizeValues(input: z.infer<typeof calendarSchema>, userId: string, timeZone: string): { values?: CalendarItemValues; error?: string } {
  const recurrence: CalendarRecurrence = {
    frequency: input.recurrence?.frequency ?? 'NONE',
    interval: input.recurrence?.interval ?? 1,
    weekdays: [...new Set(input.recurrence?.weekdays ?? [])].sort((left, right) => left - right),
    until: input.recurrence?.until ?? null
  };
  if (input.kind === 'TASK_BLOCK') {
    if (!input.taskId || !findTask(userId, input.taskId)) return { error: 'Task không tồn tại.' };
    if (recurrence.frequency !== 'NONE') return { error: 'Phiên Task chưa hỗ trợ lặp lại.' };
  }
  if (input.kind === 'EVENT' && !(input.title ?? '').trim()) return { error: 'Sự kiện cần có tiêu đề.' };
  if (recurrence.until && !validDate(recurrence.until)) return { error: 'Ngày kết thúc lặp không hợp lệ.' };
  let start = input.start;
  let end = input.end;
  if (input.allDay) {
    if (!validDate(start) || !validDate(end) || start >= end) return { error: 'Khoảng ngày cả ngày không hợp lệ.' };
  } else {
    try {
      start = /(?:Z|[+-]\d{2}:?\d{2})$/.test(start) ? new Date(start).toISOString() : localDateTimeToIso(start, timeZone);
      end = /(?:Z|[+-]\d{2}:?\d{2})$/.test(end) ? new Date(end).toISOString() : localDateTimeToIso(end, timeZone);
    } catch {
      return { error: 'Khoảng thời gian có giờ không hợp lệ.' };
    }
    if (new Date(start).getTime() >= new Date(end).getTime()) return { error: 'Thời điểm kết thúc phải sau thời điểm bắt đầu.' };
  }
  const recurrenceStartDate = input.allDay ? start : localDate(new Date(start), timeZone);
  if (recurrence.until && recurrence.until < recurrenceStartDate) return { error: 'Ngày kết thúc lặp phải từ ngày bắt đầu trở đi.' };
  if (recurrence.frequency === 'WEEKLY' && recurrence.weekdays.length === 0) {
    recurrence.weekdays = [input.allDay ? dayOfWeek(start) : dayOfWeek(localDate(new Date(start), timeZone))];
  }
  return {
    values: {
      kind: input.kind as CalendarItemKind,
      taskId: input.kind === 'TASK_BLOCK' ? input.taskId ?? null : null,
      title: input.kind === 'EVENT' ? input.title?.trim() ?? null : null,
      description: input.description?.trim() || null,
      allDay: input.allDay,
      start,
      end,
      color: input.color?.trim() || null,
      recurrence
    }
  };
}

function itemRange(item: CalendarItem): { start: string; end: string; allDay: boolean } {
  return { start: item.start, end: item.end, allDay: item.allDay };
}

function findConflicts(userId: string, candidate: CalendarItem, excludeSeriesId: string | undefined, rangeStart: string, rangeEnd: string, timeZone: string): Array<{ id: string; title: string; start: string; end: string; kind: CalendarDisplayKind }> {
  const conflicts: Array<{ id: string; title: string; start: string; end: string; kind: CalendarDisplayKind }> = [];
  for (const base of listCalendarItems(userId)) {
    if (base.id === excludeSeriesId) continue;
    const task = base.task_id ? findTask(userId, base.task_id) : undefined;
    if (base.kind === 'TASK_BLOCK' && !task) continue;
    for (const existing of expandItem(base, listCalendarOverrides(userId, base.id), rangeStart, rangeEnd, timeZone)) {
      if (!rangesOverlap(candidate.start, candidate.end, existing.start, existing.end, candidate.allDay, existing.allDay, timeZone)) continue;
      conflicts.push({ id: existing.id, title: existing.title, start: existing.start, end: existing.end, kind: existing.kind });
    }
  }
  return conflicts;
}

function presentDeadline(task: ReturnType<typeof findTask>, _timeZone: string): CalendarItem | null {
  if (!task || task.deadlineType === 'NONE') return null;
  if (task.deadlineType === 'DATE' && task.dueDate) {
    return {
      id: `deadline:${task.id}`,
      userId: task.userId,
      kind: 'DEADLINE',
      taskId: task.id,
      projectId: task.projectId,
      title: `Deadline: ${task.title}`,
      description: task.description,
      start: task.dueDate,
      end: addDays(task.dueDate, 1),
      allDay: true,
      color: '#d29c4c',
      recurrence: null,
      seriesId: `deadline:${task.id}`,
      occurrenceStart: task.dueDate,
      isOccurrence: false,
      isOverride: false,
      version: task.version
    };
  }
  if (task.deadlineType === 'DATETIME' && task.dueAt) {
    const end = new Date(new Date(task.dueAt).getTime() + 15 * 60_000).toISOString();
    return {
      id: `deadline:${task.id}`,
      userId: task.userId,
      kind: 'DEADLINE',
      taskId: task.id,
      projectId: task.projectId,
      title: `Deadline: ${task.title}`,
      description: task.description,
      start: task.dueAt,
      end,
      allDay: false,
      color: '#d29c4c',
      recurrence: null,
      seriesId: `deadline:${task.id}`,
      occurrenceStart: task.dueAt,
      isOccurrence: false,
      isOverride: false,
      version: task.version
    };
  }
  return null;
}

function calendarRangeForItem(item: CalendarItem, timeZone: string): { start: string; end: string } {
  if (item.allDay) return { start: addDays(item.start, -1), end: addDays(item.end, 1) };
  const start = localDate(new Date(item.start), timeZone);
  const end = localDate(new Date(item.end), timeZone);
  return { start: addDays(start, -1), end: addDays(end, 2) };
}

export async function registerCalendarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v1/calendar', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const query = request.query as Record<string, string | undefined>;
    if (!query.start || !query.end) return badRequest(reply, 'Cần cung cấp start và end cho khoảng lịch.');
    let rangeStart: Boundary;
    let rangeEnd: Boundary;
    try {
      rangeStart = parseBoundary(query.start, user.timezone);
      rangeEnd = parseBoundary(query.end, user.timezone);
    } catch (error) {
      return badRequest(reply, error instanceof Error ? error.message : 'Khoảng lịch không hợp lệ.');
    }
    if (rangeStart.value >= rangeEnd.value) return badRequest(reply, 'Khoảng lịch không hợp lệ.');
    const requestedKinds = query.kinds ? query.kinds.split(',') : ['TASK_BLOCK', 'EVENT', 'DEADLINE'];
    const projectId = query.projectId && query.projectId !== 'all' ? query.projectId : undefined;
    const items: CalendarItem[] = [];
    for (const base of listCalendarItems(user.id)) {
      if (!requestedKinds.includes(base.kind)) continue;
      const expanded = expandItem(base, listCalendarOverrides(user.id, base.id), rangeStart.value, rangeEnd.value, user.timezone);
      items.push(...expanded.filter((item) => !projectId || item.projectId === projectId));
    }
    if (requestedKinds.includes('DEADLINE')) {
      for (const task of listTasks(user.id)) {
        if (projectId && task.projectId !== projectId) continue;
        const deadline = presentDeadline(task, user.timezone);
        if (!deadline) continue;
        const range = calendarRangeForItem(deadline, user.timezone);
        if (range.start < rangeEnd.value && rangeStart.value < range.end) items.push(deadline);
      }
    }
    const scheduledTaskIds = new Set(listCalendarItems(user.id).map((item) => item.task_id).filter((taskId): taskId is string => Boolean(taskId)));
    const unscheduledTaskIds = listTasks(user.id).filter((task) => task.status !== 'DONE' && !scheduledTaskIds.has(task.id)).map((task) => task.id);
    reply.send({ items, unscheduledTaskIds });
  });

  app.post('/api/v1/calendar', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const parsed = calendarSchema.safeParse(request.body);
    if (!parsed.success) return badRequest(reply, 'Dữ liệu mục lịch chưa hợp lệ.', parsed.error.flatten());
    const normalized = normalizeValues(parsed.data, user.id, user.timezone);
    if (!normalized.values) return badRequest(reply, normalized.error ?? 'Dữ liệu mục lịch chưa hợp lệ.');
    if (!projectBelongsToUser(user.id, normalized.values.taskId ? findTask(user.id, normalized.values.taskId)?.projectId ?? null : null)) return notFound(reply, 'Project không tồn tại.');
    const base = createCalendarItem(user.id, normalized.values);
    const range = normalized.values.allDay ? { start: addDays(normalized.values.start, -1), end: addDays(normalized.values.end, 1) } : { start: addDays(localDate(new Date(normalized.values.start), user.timezone), -1), end: addDays(localDate(new Date(normalized.values.end), user.timezone), 2) };
    const [item] = expandItem(base, [], range.start, range.end, user.timezone);
    const conflicts = item ? findConflicts(user.id, item, base.id, range.start, range.end, user.timezone) : [];
    reply.code(201).send({ item, conflicts });
  });

  app.patch('/api/v1/calendar/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const parsed = calendarSchema.safeParse(request.body);
    if (!params.success || !parsed.success || parsed.data.version === undefined) return badRequest(reply, 'Dữ liệu cập nhật mục lịch chưa hợp lệ.');
    const existing = findCalendarItem(user.id, params.data.id);
    if (!existing) return notFound(reply, 'Mục lịch không tồn tại.');
    const normalized = normalizeValues(parsed.data, user.id, user.timezone);
    if (!normalized.values) return badRequest(reply, normalized.error ?? 'Dữ liệu mục lịch chưa hợp lệ.');
    const scope = parsed.data.scope ?? 'SERIES';
    if (scope === 'THIS' && existing.recurrence_frequency === 'NONE') return badRequest(reply, 'Mục không lặp không có lần riêng để sửa.');
    if (scope === 'THIS') {
      if (!parsed.data.occurrenceStart) return badRequest(reply, 'Cần occurrenceStart khi sửa một lần lặp.');
      if (parsed.data.version !== existing.version) return conflict(reply);
      const overrideValues: CalendarOverrideValues = {
        cancelled: false,
        title: normalized.values.title,
        description: normalized.values.description,
        allDay: normalized.values.allDay,
        start: normalized.values.start,
        end: normalized.values.end,
        color: normalized.values.color
      };
      upsertCalendarOverride(user.id, existing.id, parsed.data.occurrenceStart, overrideValues);
      const range = normalized.values.allDay ? { start: addDays(normalized.values.start, -1), end: addDays(normalized.values.end, 1) } : { start: addDays(localDate(new Date(normalized.values.start), user.timezone), -1), end: addDays(localDate(new Date(normalized.values.end), user.timezone), 2) };
      const item = expandItem(existing, listCalendarOverrides(user.id, existing.id), range.start, range.end, user.timezone).find((candidate) => candidate.occurrenceStart === parsed.data.occurrenceStart);
      const conflicts = item ? findConflicts(user.id, item, existing.id, range.start, range.end, user.timezone) : [];
      return reply.send({ item, conflicts });
    }
    if (!projectBelongsToUser(user.id, normalized.values.taskId ? findTask(user.id, normalized.values.taskId)?.projectId ?? null : null)) return notFound(reply, 'Project không tồn tại.');
    const updated = updateCalendarItem(user.id, existing.id, normalized.values, parsed.data.version);
    if (updated === undefined) return notFound(reply, 'Mục lịch không tồn tại.');
    if (updated === 'CONFLICT') return conflict(reply);
    const range = normalized.values.allDay ? { start: addDays(normalized.values.start, -1), end: addDays(normalized.values.end, 1) } : { start: addDays(localDate(new Date(normalized.values.start), user.timezone), -1), end: addDays(localDate(new Date(normalized.values.end), user.timezone), 2) };
    const [item] = expandItem(updated, listCalendarOverrides(user.id, updated.id), range.start, range.end, user.timezone);
    const conflicts = item ? findConflicts(user.id, item, updated.id, range.start, range.end, user.timezone) : [];
    reply.send({ item, conflicts });
  });

  app.delete('/api/v1/calendar/:id', async (request, reply) => {
    const user = requireUser(request, reply);
    if (!user) return;
    const params = paramsSchema.safeParse(request.params);
    const body = z.object({ version: z.number().int().positive(), scope: z.enum(['THIS', 'SERIES']).default('SERIES'), occurrenceStart: z.string().optional() }).safeParse(request.body);
    if (!params.success || !body.success) return badRequest(reply, 'Cần cung cấp version của mục lịch.');
    const existing = findCalendarItem(user.id, params.data.id);
    if (!existing) return notFound(reply, 'Mục lịch không tồn tại.');
    if (body.data.scope === 'THIS') {
      if (existing.recurrence_frequency === 'NONE' || !body.data.occurrenceStart) return badRequest(reply, 'Lần riêng không hợp lệ.');
      if (body.data.version !== existing.version) return conflict(reply);
      upsertCalendarOverride(user.id, existing.id, body.data.occurrenceStart, { cancelled: true, title: null, description: null, allDay: null, start: null, end: null, color: null });
      return reply.code(204).send();
    }
    const result = deleteCalendarItem(user.id, params.data.id, body.data.version);
    if (result === 'NOT_FOUND') return notFound(reply, 'Mục lịch không tồn tại.');
    if (result === 'CONFLICT') return conflict(reply);
    reply.code(204).send();
  });
}
