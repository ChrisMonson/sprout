import { describe, expect, it, beforeEach } from 'vitest';
import { openDb, type Db } from '../server/db.ts';
import { schedule, cancel, upcoming, takeDue, STALE_MS, MAX_SCHEDULED_PER_SPROUT } from '../server/notifications.ts';

describe('notifications', () => {
  let db: Db;
  const now = 1_800_000_000_000;
  beforeEach(() => { db = openDb(':memory:'); });

  it('delivers a notification once it is due, and only once', () => {
    schedule(db, 's1', { title: 'Feed it', at: now + 60_000 }, now);
    expect(takeDue(db, now)).toHaveLength(0);
    expect(takeDue(db, now + 60_000).map(n => n.title)).toEqual(['Feed it']);
    expect(takeDue(db, now + 120_000)).toHaveLength(0);
  });

  it('sends right away when no time is given', () => {
    schedule(db, 's1', { title: 'Now' }, now);
    expect(takeDue(db, now)).toHaveLength(1);
  });

  it('replaces an earlier notification with the same key', () => {
    schedule(db, 's1', { title: 'Feed at 8', at: now + 1000, key: 'next-feeding' }, now);
    schedule(db, 's1', { title: 'Feed at 9', at: now + 2000, key: 'next-feeding' }, now);
    expect(upcoming(db, 's1').map(n => n.title)).toEqual(['Feed at 9']);
  });

  it('keys are per sprout', () => {
    schedule(db, 's1', { title: 'A', at: now + 1000, key: 'k' }, now);
    schedule(db, 's2', { title: 'B', at: now + 1000, key: 'k' }, now);
    expect(upcoming(db, 's1')).toHaveLength(1);
    expect(upcoming(db, 's2')).toHaveLength(1);
  });

  it('cancels by key', () => {
    schedule(db, 's1', { title: 'A', at: now + 1000, key: 'k' }, now);
    expect(cancel(db, 's1', 'k')).toBe(1);
    expect(takeDue(db, now + 5000)).toHaveLength(0);
  });

  it('drops notifications that are long overdue instead of sending them late', () => {
    schedule(db, 's1', { title: 'Old', at: now }, now);
    expect(takeDue(db, now + STALE_MS + 1)).toHaveLength(0);
  });

  it('rejects empty titles and too many scheduled at once', () => {
    expect(() => schedule(db, 's1', { title: '  ' }, now)).toThrow();
    for (let i = 0; i < MAX_SCHEDULED_PER_SPROUT; i++) schedule(db, 's1', { title: `n${i}`, at: now + 1000 }, now);
    expect(() => schedule(db, 's1', { title: 'one more', at: now + 1000 }, now)).toThrow();
  });
});
