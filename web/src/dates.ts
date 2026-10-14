const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const pad = (n: number) => String(n).padStart(2, '0');

export const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const currentMonth = (d = new Date()) => today(d).slice(0, 7);
export const isMonth = (s: string | null): s is string => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);

export function shiftMonth(month: string, by: number): string {
  const n = Number(month.slice(0, 4)) * 12 + (Number(month.slice(5)) - 1) + by;
  return `${Math.floor(n / 12)}-${pad((n % 12) + 1)}`;
}

/** "2026-10" -> "October 2026" */
export const monthTitle = (month: string) => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;

/** "2026-10-11" -> "11 October" */
export const dayHeading = (date: string) => `${Number(date.slice(8))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** "2026-10" -> "October" */
export const monthName = (month: string) => MONTHS[Number(month.slice(5)) - 1];
