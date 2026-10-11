import test from 'node:test';
import assert from 'node:assert/strict';

import { setNowOverride } from '../site/js/lib/dates.js';
import { pickStart } from '../site/js/ui/view-my.js';

// Пн 12.10.2026 … Нд 18.10.2026; наступний тиждень — з Пн 19.10.
const lesson = (date, start, end) => ({ date, start, end });
const friday = [lesson('2026-10-16', '08:30', '09:50'), lesson('2026-10-16', '10:10', '11:30')];
const nextMonday = [lesson('2026-10-19', '08:30', '09:50')];

test('pickStart: у вихідні без пар тиждень переходить на наступний, як і день', () => {
  setNowOverride('2026-10-17T10:00');
  const week = pickStart(nextMonday, 'week', '2026-10-17');
  assert.equal(week.date, '2026-10-19');
  assert.match(week.note, /наступний тиждень/);
  const day = pickStart(nextMonday, 'day', '2026-10-17');
  assert.equal(day.date, '2026-10-19');
  assert.match(day.note, /Сьогодні пар немає/);
});

test('pickStart: у пʼятницю після останньої пари — теж наступний тиждень', () => {
  setNowOverride('2026-10-16T15:00');
  const lessons = [...friday, ...nextMonday];
  assert.equal(pickStart(lessons, 'week', '2026-10-16').date, '2026-10-19');
  const day = pickStart(lessons, 'day', '2026-10-16');
  assert.equal(day.date, '2026-10-19');
  assert.match(day.note, /вже закінчилися/);
});

test('pickStart: поки на тижні є пари, лишається поточний тиждень', () => {
  setNowOverride('2026-10-16T10:40');
  assert.deepEqual(pickStart([...friday, ...nextMonday], 'week', '2026-10-16'), { date: '2026-10-16', found: true });
  setNowOverride('2026-10-17T09:00');
  const saturday = [lesson('2026-10-17', '11:50', '13:10'), ...nextMonday];
  assert.equal(pickStart(saturday, 'week', '2026-10-17').date, '2026-10-17', 'субота з парами — цей тиждень');
});

test('pickStart: якщо наступний тиждень порожній — найближчий тиждень з парами', () => {
  setNowOverride('2026-10-17T10:00');
  const week = pickStart([lesson('2026-10-27', '08:30', '09:50')], 'week', '2026-10-17');
  assert.equal(week.date, '2026-10-27');
  assert.match(week.note, /найближчий тиждень з парами/);
});

test('pickStart: попереду пар немає — вирішує виклик', () => {
  setNowOverride('2026-10-17T10:00');
  assert.deepEqual(pickStart([], 'week', '2026-10-17'), { date: '2026-10-17', found: false });
  setNowOverride(null);
});
