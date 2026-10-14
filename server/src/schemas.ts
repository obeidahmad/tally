import { z } from 'zod';

const MAX = 10 ** 13;
const CURRENCIES = new Set(Intl.supportedValuesOf('currency'));

const text = (min: number, max: number, empty: string) =>
  z.string({ error: empty }).trim().min(min, empty).max(max, `Use ${max} characters or fewer.`);

// Money is only ever a whole number of minor units.
const minor = (min: number, msg: string) =>
  z.number({ error: msg }).int(msg).min(min, msg).max(MAX, msg);

export const name = text(1, 60, 'Enter a name.');
export const username = z
  .string({ error: 'Enter a username.' })
  .toLowerCase()
  .regex(/^[a-z0-9_.-]{3,32}$/, 'Use 3 to 32 letters, numbers, dots, dashes or underscores.');
export const displayName = text(1, 60, 'Enter a name.');
export const password = z
  .string({ error: 'Enter a password.' })
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Use 200 characters or fewer.');
export const baseCurrency = z
  .string({ error: 'Choose a currency.' })
  .refine((c) => CURRENCIES.has(c), 'Choose a currency.');

export const newAccount = z.object({ username, displayName, password, baseCurrency });
export const login = z.object({
  username: z.string({ error: 'Enter a username.' }).toLowerCase(),
  password: z.string({ error: 'Enter a password.' }),
});
export const changePassword = z.object({
  currentPassword: z.string({ error: 'Enter your current password.' }),
  newPassword: password,
});

// Single code points, no variation selector; built from numbers so none slips in.
export const EMOJI = [
  0x1f3e6, 0x1f4b3, 0x1f4b5, 0x1f4b6, 0x1f4b7, 0x1f4b0, 0x1fa99, 0x1f45b,
  0x1f437, 0x1f4c8, 0x1f331, 0x1f48e, 0x1f512, 0x1f3e0, 0x1f697, 0x2708,
  0x1f381, 0x1f393, 0x1f476, 0x2764, 0x2b50, 0x2602, 0x1f6d2, 0x1f4bc,
  0x1f4f1, 0x1f30d, 0x1f3d6, 0x1f6e0, 0x1f3af, 0x1f9fe, 0x1f932, 0x1f54c,
].map((c) => String.fromCodePoint(c)) as [string, ...string[]];
export const DEFAULT_EMOJI = { bank: 0x1f3e6, cash: 0x1f4b5, fund: 0x1f331, broker: 0x1f4c8 };

export const pocket = z.object({
  name,
  kind: z.enum(['bank', 'cash', 'fund', 'broker'], { error: 'Choose a kind.' }),
  emoji: z.enum(EMOJI, { error: 'Choose an emoji.' }).optional(),
  openingBalanceMinor: minor(-MAX, 'Enter a whole number of minor units.'),
});
export const section = z.object({ name });
export const subsection = z.object({ name, budgetMinor: minor(0, 'Enter a budget of zero or more.') });

const date = z
  .string({ error: 'Enter a date.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Enter a real date.');

export const transaction = z
  .object({
    date,
    kind: z.enum(['expense', 'income'], { error: 'Choose expense or income.' }),
    amountMinor: minor(1, 'Enter an amount above zero, as a whole number of minor units.'),
    pocketId: z.number({ error: 'Choose a pocket.' }).int('Choose a pocket.'),
    subsectionId: z.number({ error: 'Choose a subsection.' }).int('Choose a subsection.').nullable(),
    payee: z.string({ error: 'Enter a payee.' }).trim().max(120, 'Use 120 characters or fewer.').default(''),
    sourceId: z.number({ error: 'Choose a source.' }).int('Choose a source.').nullable().default(null),
    note: z.string({ error: 'Enter a note.' }).max(500, 'Use 500 characters or fewer.').default(''),
  })
  .superRefine((t, ctx) => {
    if (t.kind === 'expense' && t.subsectionId === null)
      ctx.addIssue({ code: 'custom', path: ['subsectionId'], message: 'Choose a subsection.' });
    if (t.kind === 'income' && t.subsectionId !== null)
      ctx.addIssue({ code: 'custom', path: ['subsectionId'], message: 'Income has no subsection.' });
    if (t.kind === 'expense' && !t.payee)
      ctx.addIssue({ code: 'custom', path: ['payee'], message: 'Enter a payee.' });
    if (t.kind === 'expense' && t.sourceId !== null)
      ctx.addIssue({ code: 'custom', path: ['sourceId'], message: 'An expense has no source.' });
    if (t.kind === 'income' && t.sourceId === null)
      ctx.addIssue({ code: 'custom', path: ['sourceId'], message: 'Choose a source.' });
  })
  .transform((t) => (t.kind === 'income' ? { ...t, payee: '' } : t));

export const source = z.object({ name });
const POS = 'Choose a position.';
const position = z.number({ error: POS }).int(POS).optional();
export const stepKind = z.object({ kind: z.enum(['amount', 'percent'], { error: 'Choose what the step takes.' }) });
export const amountStep = z.object({
  sectionId: z.number({ error: 'Choose a section.' }).int('Choose a section.'),
  amountMinor: minor(1, 'Enter an amount above zero.'),
  position,
});
// Shares are checked rule by rule so each failure gets its own sentence on `shares`.
export const percentStep = z.object({
  shares: z.unknown().superRefine((v, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (!Array.isArray(v) || v.length < 1 || v.length > 8) return bad('Add at least one section.');
    const rows = v.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}));
    const ids = rows.map((x) => x.sectionId);
    if (!ids.every(Number.isInteger) || new Set(ids).size !== ids.length) return bad('Choose a different section in every row.');
    const bp = rows.map((x) => x.basisPoints as number);
    if (!bp.every((n) => Number.isInteger(n) && n >= 1 && n <= 10000))
      return bad('Enter a percentage above 0 and up to 100 in every row.');
    if (bp.reduce((a, n) => a + n, 0) > 10000) bad('The percentages of one step can add up to at most 100.');
  }),
  position,
});

export const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use a month like 2026-10.');
const id = z.string().regex(/^\d+$/, 'Use a whole number.').transform(Number);
export const monthQuery = z.object({ month });
export const txQuery = z.object({ month, pocketId: id.optional(), subsectionId: id.optional() });

// Rest rules are checked rule by rule so each failure gets its own sentence on `shares`.
export const restRule = z.object({
  shares: z.unknown().superRefine((v, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (!Array.isArray(v) || v.length < 1 || v.length > 8) return bad('Add at least one destination.');
    const rows = v.map((x) => (x && typeof x === 'object' ? (x as Record<string, unknown>) : {}));
    const ids = rows.map((x) => x.sectionId);
    if (!ids.every((x) => x === null || Number.isInteger(x)) || new Set(ids).size !== ids.length) return bad('Choose a different destination in every row.');
    const bp = rows.map((x) => x.basisPoints as number);
    if (!bp.every((n) => Number.isInteger(n) && n >= 1 && n <= 10000)) return bad('Enter a percentage above 0 and up to 100 in every row.');
    if (bp.reduce((a, n) => a + n, 0) !== 10000) bad('The percentages must add up to 100.');
  }),
  overspent: z.enum(['income', 'section'], { error: 'Choose where an overspent rest goes.' }),
});
