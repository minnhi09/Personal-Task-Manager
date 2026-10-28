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
});
