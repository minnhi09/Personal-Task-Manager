import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ptm-api-'));
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = path.join(testDirectory, 'test.db');
process.env.WEB_ORIGIN = 'http://localhost:5173';

const { buildApp } = await import('../src/server.js');
const { closeDatabase } = await import('../src/db/database.js');

const app = await buildApp();

function sessionCookie(response: { headers: { [key: string]: unknown } }): string {
  const header = response.headers['set-cookie'];
  const value = Array.isArray(header) ? header[0] : header;
  assert.ok(typeof value === 'string', 'expected a session cookie');
  return value.split(';', 1)[0];
}

describe('API authentication and ownership', () => {
  before(async () => app.ready());
  after(async () => {
    await app.close();
    closeDatabase();
    fs.rmSync(testDirectory, { recursive: true, force: true });
  });

  it('creates an account, task and rejects stale versions', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'alice@example.com', password: 'strongpass123' }
    });
    assert.equal(registration.statusCode, 201);
    const cookie = sessionCookie(registration);

    const projectResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: { cookie },
      payload: { name: 'Công việc cá nhân' }
    });
    assert.equal(projectResponse.statusCode, 201);
    const project = projectResponse.json().project;

    const taskResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { cookie },
      payload: {
        projectId: project.id,
        title: 'Task kiểm thử',
        status: 'TODO',
        priority: 'HIGH',
        deadlineType: 'DATE',
        dueDate: '2099-10-29'
      }
    });
    assert.equal(taskResponse.statusCode, 201);
    const task = taskResponse.json().task;
    assert.equal(task.deadlineBucket, 'UPCOMING');

    const update = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      headers: { cookie },
      payload: { ...task, dueDate: '2099-10-29', version: 1, userId: undefined, deadlineBucket: undefined, deadlineLabel: undefined, relativeDeadline: undefined }
    });
    assert.equal(update.statusCode, 200);
    assert.equal(update.json().task.version, 2);

    const stale = await app.inject({
      method: 'PATCH',
      url: `/api/v1/tasks/${task.id}`,
      headers: { cookie },
      payload: { title: 'Ghi đè cũ', status: 'TODO', priority: 'HIGH', deadlineType: 'DATE', dueDate: '2099-10-29', projectId: project.id, version: 1 }
    });
    assert.equal(stale.statusCode, 409);
    assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
  });

  it('rejects state-changing cookie requests from another origin', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: 'https://malicious.example' },
      payload: { email: 'blocked@example.com', password: 'strongpass123' }
    });
    assert.equal(response.statusCode, 403);
    assert.equal(response.json().error.code, 'ORIGIN_FORBIDDEN');
  });

  it('does not expose another account data or projects', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'bob@example.com', password: 'strongpass123' }
    });
    const cookie = sessionCookie(registration);
    const tasks = await app.inject({ method: 'GET', url: '/api/v1/tasks', headers: { cookie } });
    assert.equal(tasks.statusCode, 200);
    assert.deepEqual(tasks.json().tasks, []);

    const foreignProject = '00000000-0000-4000-8000-000000000000';
    const attempt = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { cookie },
      payload: { projectId: foreignProject, title: 'Không hợp lệ', deadlineType: 'NONE' }
    });
    assert.equal(attempt.statusCode, 404);
  });

  it('supports mobile tokens and task detail access', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'mobile@example.com', password: 'strongpass123' }
    });
    assert.equal(registration.statusCode, 201);
    assert.equal(registration.json().user.timezone, 'Asia/Ho_Chi_Minh');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/login',
      payload: { email: 'mobile@example.com', password: 'strongpass123' }
    });
    assert.equal(login.statusCode, 200);
    const token = login.json().token;
    assert.equal(typeof token, 'string');
    assert.ok(login.json().expiresAt);

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { authorization: `Bearer ${token}` },
      payload: { title: 'Task trên Android', deadlineType: 'DATE', dueDate: '2099-10-30' }
    });
    assert.equal(created.statusCode, 201);
    const taskId = created.json().task.id;

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.json().task.id, taskId);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/mobile/logout',
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(logout.statusCode, 200);

    const afterLogout = await app.inject({
      method: 'GET',
      url: `/api/v1/tasks/${taskId}`,
      headers: { authorization: `Bearer ${token}` }
    });
    assert.equal(afterLogout.statusCode, 401);
  });

  it('creates calendar blocks, expands recurring events and reports overlaps', async () => {
    const registration = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'calendar@example.com', password: 'strongpass123' }
    });
    const cookie = sessionCookie(registration);

    const taskResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/tasks',
      headers: { cookie },
      payload: { title: 'Chuẩn bị demo', deadlineType: 'NONE' }
    });
    assert.equal(taskResponse.statusCode, 201);
    const taskId = taskResponse.json().task.id;

    const block = await app.inject({
      method: 'POST',
      url: '/api/v1/calendar',
      headers: { cookie },
      payload: {
        kind: 'TASK_BLOCK',
        taskId,
        allDay: false,
        start: '2099-10-30T09:00',
        end: '2099-10-30T10:00',
        recurrence: { frequency: 'NONE', interval: 1, weekdays: [], until: null }
      }
    });
    assert.equal(block.statusCode, 201);
    assert.equal(block.json().item.taskId, taskId);
    assert.equal(block.json().item.allDay, false);

    const recurring = await app.inject({
      method: 'POST',
      url: '/api/v1/calendar',
      headers: { cookie },
      payload: {
        kind: 'EVENT',
        title: 'Họp nhóm',
        allDay: false,
        start: '2099-10-27T10:00',
        end: '2099-10-27T11:00',
        recurrence: { frequency: 'WEEKLY', interval: 1, weekdays: [1, 3], until: '2099-11-15' }
      }
    });
    assert.equal(recurring.statusCode, 201);
    const recurringId = recurring.json().item.seriesId;

    const listed = await app.inject({
      method: 'GET',
      url: '/api/v1/calendar?start=2099-10-26&end=2099-11-10',
      headers: { cookie }
    });
    assert.equal(listed.statusCode, 200);
    const eventItems = listed.json().items.filter((item: { seriesId: string }) => item.seriesId === recurringId);
    assert.ok(eventItems.length >= 3);
    assert.deepEqual(listed.json().unscheduledTaskIds, []);

    const overlap = await app.inject({
      method: 'POST',
      url: '/api/v1/calendar',
      headers: { cookie },
      payload: {
        kind: 'EVENT',
        title: 'Việc trùng giờ',
        allDay: false,
        start: '2099-10-30T09:30',
        end: '2099-10-30T10:30',
        recurrence: { frequency: 'NONE', interval: 1, weekdays: [], until: null }
      }
    });
    assert.equal(overlap.statusCode, 201);
    assert.ok(overlap.json().conflicts.length >= 1);

    const monthly = await app.inject({
      method: 'POST',
      url: '/api/v1/calendar',
      headers: { cookie },
      payload: {
        kind: 'EVENT',
        title: 'Ngày chốt tháng',
        allDay: true,
        start: '2099-01-31',
        end: '2099-02-01',
        recurrence: { frequency: 'MONTHLY', interval: 1, weekdays: [], until: '2099-05-01' }
      }
    });
    assert.equal(monthly.statusCode, 201);
    const monthlyListed = await app.inject({ method: 'GET', url: '/api/v1/calendar?start=2099-01-01&end=2099-06-01', headers: { cookie } });
    const monthlyStarts = monthlyListed.json().items.filter((item: { seriesId: string }) => item.seriesId === monthly.json().item.seriesId).map((item: { start: string }) => item.start);
    assert.deepEqual(monthlyStarts, ['2099-01-31', '2099-02-28', '2099-03-31', '2099-04-30']);

    const deletedOccurrence = await app.inject({
      method: 'DELETE',
      url: `/api/v1/calendar/${recurringId}`,
      headers: { cookie },
      payload: { version: recurring.json().item.version, scope: 'THIS', occurrenceStart: eventItems[0].occurrenceStart }
    });
    assert.equal(deletedOccurrence.statusCode, 204);
  });
});
