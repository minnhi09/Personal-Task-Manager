export type TaskStatus = 'TODO' | 'IN_PROGRESS' | 'DONE';
export type TaskPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export type DeadlineType = 'NONE' | 'DATE' | 'DATETIME';

export type CalendarItemKind = 'TASK_BLOCK' | 'EVENT';
export type CalendarDisplayKind = CalendarItemKind | 'DEADLINE';
export type CalendarRecurrenceFrequency = 'NONE' | 'DAILY' | 'WEEKLY' | 'MONTHLY';
export type CalendarEditScope = 'THIS' | 'SERIES';

export type User = {
  id: string;
  email: string;
  timezone: string;
  createdAt: string;
};

export type Project = {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type Task = {
  id: string;
  userId: string;
  projectId: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  deadlineType: DeadlineType;
  dueDate: string | null;
  dueAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  version: number;
};

export type DeadlineBucket = 'NO_DEADLINE' | 'OVERDUE' | 'TODAY' | 'UPCOMING';

export type CalendarRecurrence = {
  frequency: CalendarRecurrenceFrequency;
  interval: number;
  weekdays: number[];
  until: string | null;
};

export type CalendarItem = {
  id: string;
  userId: string;
  kind: CalendarDisplayKind;
  taskId: string | null;
  projectId: string | null;
  title: string;
  description: string | null;
  start: string;
  end: string;
  allDay: boolean;
  color: string | null;
  recurrence: CalendarRecurrence | null;
  seriesId: string;
  occurrenceStart: string;
  isOccurrence: boolean;
  isOverride: boolean;
  version: number;
};
