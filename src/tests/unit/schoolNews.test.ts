import { describe, it, expect } from 'vitest';
import { NEWS_LIST_LIMIT, NEWS_MAX_PAST_START_DAYS, NEWS_SHOW_DAYS, enrolmentNews, enrolmentNewsOn, visibleNews } from '../../services/schoolNews.logic.js';

// School news — what an enrolment post says, and which posts Home shows.

const PKG = { programme: 'Full Day', age: 4 };
const TODAY = new Date(2026, 10, 26); // 26 Nov 2026
const daysAgo = (n: number) => new Date(TODAY.getTime() - n * 24 * 60 * 60 * 1000);

describe('School news', () => {
  it('celebrates a new child by class and start date only — never their name', () => {
    expect(enrolmentNews(PKG, new Date(2026, 11, 3), TODAY)).toEqual({
      title: 'A new friend is joining Full Day (4Y)!',
      body: 'Starting 3 Dec 2026 — let\'s make them welcome.',
    });
    expect(enrolmentNews(PKG, new Date(2026, 10, 20), TODAY)?.body).toBe('Started 20 Nov 2026 — say hello and make them welcome.');
  });

  it('doesn’t post for a start date long past — importing old records isn’t news', () => {
    expect(enrolmentNews(PKG, daysAgo(NEWS_MAX_PAST_START_DAYS), TODAY)).not.toBeNull();
    expect(enrolmentNews(PKG, daysAgo(NEWS_MAX_PAST_START_DAYS + 1), TODAY)).toBeNull();
  });

  it('is on unless switched off', () => {
    expect(enrolmentNewsOn(undefined)).toBe(true);
    expect(enrolmentNewsOn(true)).toBe(true);
    expect(enrolmentNewsOn(false)).toBe(false);
    expect(enrolmentNewsOn('false')).toBe(false);
  });

  it('shows recent posts nobody hid, newest first, a handful at most', () => {
    const post = (id: string, ago: number, hidden = false) => ({ id, postedAt: daysAgo(ago), hiddenAt: hidden ? TODAY : null });
    const rows = [post('old', NEWS_SHOW_DAYS + 1), post('hidden', 1, true), post('a', 3), post('b', 1)];
    expect(visibleNews(rows, TODAY).map(r => r.id)).toEqual(['b', 'a']);
    const many = Array.from({ length: NEWS_LIST_LIMIT + 3 }, (_, i) => post(`p${i}`, i % NEWS_SHOW_DAYS));
    expect(visibleNews(many, TODAY)).toHaveLength(NEWS_LIST_LIMIT);
  });
});
