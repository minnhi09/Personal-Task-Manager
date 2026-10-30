import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { formatDeadline, getDeadlineBucket, localDateInTimeZone } from '../src/domain/deadline.js';

const now = new Date('2026-10-28T04:00:00.000Z'); // 11:00 in Asia/Ho_Chi_Minh

describe('deadline rules', () => {
  it('uses the account local calendar for date-only deadlines', () => {
    assert.equal(localDateInTimeZone(now, 'Asia/Ho_Chi_Minh'), '2026-10-28');
    assert.equal(getDeadlineBucket({ deadlineType: 'DATE', dueDate: '2026-10-27', dueAt: null }, now), 'OVERDUE');
    assert.equal(getDeadlineBucket({ deadlineType: 'DATE', dueDate: '2026-10-28', dueAt: null }, now), 'TODAY');
    assert.equal(getDeadlineBucket({ deadlineType: 'DATE', dueDate: '2026-10-29', dueAt: null }, now), 'UPCOMING');
  });

  it('compares datetime deadlines as absolute instants', () => {
    assert.equal(getDeadlineBucket({ deadlineType: 'DATETIME', dueDate: null, dueAt: '2026-10-28T03:59:59.000Z' }, now), 'OVERDUE');
    assert.equal(getDeadlineBucket({ deadlineType: 'DATETIME', dueDate: null, dueAt: '2026-10-28T04:00:01.000Z' }, now), 'TODAY');
  });

  it('keeps tasks without a deadline out of deadline groups', () => {
    assert.equal(getDeadlineBucket({ deadlineType: 'NONE', dueDate: null, dueAt: null }, now), 'NO_DEADLINE');
  });

  it('formats a date-only deadline as the same calendar date', () => {
    const label = formatDeadline({ deadlineType: 'DATE', dueDate: '2026-10-28', dueAt: null }, 'America/Los_Angeles');
    assert.match(label, /28/);
  });
});
