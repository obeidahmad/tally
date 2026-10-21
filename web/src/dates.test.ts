import { expect, it } from 'vitest';
import { currentMonth, dayHeading, dayLabel, isMonth, monthTitle, shiftMonth, today } from './dates';

it('shifts across year ends', () => {
  expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  expect(shiftMonth('2026-12', 1)).toBe('2027-01');
  expect(shiftMonth('2026-10', 0)).toBe('2026-10');
});
it('titles', () => {
  expect(monthTitle('2026-10')).toBe('October 2026');
  expect(dayHeading('2026-10-11')).toBe('11 October');
  expect(dayHeading('2026-03-05')).toBe('5 March');
  expect(dayLabel('2026-10-16')).toBe('Fri 16 Oct');
});
it('local today', () => {
  const d = new Date(2026, 0, 5, 23, 59);
  expect(today(d)).toBe('2026-01-05');
  expect(currentMonth(d)).toBe('2026-01');
});
it('validates months', () => {
  expect(isMonth('2026-10')).toBe(true);
  expect(isMonth('2026-13')).toBe(false);
  expect(isMonth(null)).toBe(false);
});
