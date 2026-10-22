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
export const DEFAULT_EMOJI = { bank: 0x1f3e6, cash: 0x1f4b5, fund: 0x1f331, broker: 0x1f4c8, credit: 0x1f4b3, loan: 0x1f9fe, property: 0x1f3e0 };

export const pocket = z
  .object({
    name,
    kind: z.enum(['bank', 'cash', 'fund', 'broker', 'credit', 'loan', 'property'], { error: 'Choose a kind.' }),
    emoji: z.enum(EMOJI, { error: 'Choose an emoji.' }).optional(),
    currency: z.string({ error: 'Choose a currency.' }).optional(),
    openingBalanceMinor: z.unknown().optional(),
    valueMinor: z.unknown().optional(),
  })
  .superRefine((p, ctx) => {
    const v = p.openingBalanceMinor;
    if (p.kind !== 'property' && !(Number.isInteger(v) && Math.abs(v as number) <= MAX))
      ctx.addIssue({ code: 'custom', path: ['openingBalanceMinor'], message: 'Enter a whole number of minor units.' });
  })
  // A debt is owed as a positive amount and kept negative; a property holds values, not an opening balance.
  .transform((p) => ({
    ...p,
    openingBalanceMinor: p.kind === 'property' ? 0 : p.kind === 'credit' || p.kind === 'loan' ? -Math.abs(p.openingBalanceMinor as number) : (p.openingBalanceMinor as number),
  }));
export const section = z.object({ name });
const whole = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
// Money and percentage fields are checked by hand: which rule applies depends on kind, budgetKind and keep.
export const subsection = z
  .object({
    name,
    kind: z.enum(['spending', 'goal'], { error: 'Choose a kind.' }),
    budgetKind: z.enum(['amount', 'percent'], { error: 'Choose how the budget is set.' }),
    keep: z.enum(['all', 'cap', 'none'], { error: 'Choose what it keeps.' }),
    budgetMinor: z.any().optional(),
    budgetBasisPoints: z.any().optional(),
    capMinor: z.any().optional(),
    emoji: z.enum(EMOJI, { error: 'Choose an emoji.' }).nullable().optional(),
    targetMonth: z.any().optional(),
  })
  .superRefine((b, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (b.targetMonth != null) {
      if (b.kind !== 'goal') bad('targetMonth', 'Only a savings goal has a target date.');
      else if (typeof b.targetMonth !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(b.targetMonth)) bad('targetMonth', 'Choose a month.');
    }
    if (b.budgetKind === 'amount' && !whole(b.budgetMinor, 0, MAX)) bad('budgetMinor', 'Enter an amount, 0 or more.');
    if (b.budgetKind === 'percent' && !whole(b.budgetBasisPoints, 1, 10000)) bad('budgetBasisPoints', 'Enter a percentage above 0 and up to 100.');
    if (b.kind === 'goal' && b.keep !== 'cap') bad('keep', 'Choose what it keeps.');
    if (b.keep === 'cap' && b.kind === 'goal' && !whole(b.capMinor, 1, MAX)) bad('capMinor', 'Enter a target above zero.');
    if (b.keep === 'cap' && b.kind === 'spending' && !whole(b.capMinor, 0, MAX)) bad('capMinor', 'Enter an amount, 0 or more.');
  })
  .transform((b) => ({
    name: b.name, kind: b.kind, budgetKind: b.budgetKind, keep: b.keep,
    budgetMinor: b.budgetKind === 'amount' ? (b.budgetMinor as number) : 0,
    budgetBasisPoints: b.budgetKind === 'percent' ? (b.budgetBasisPoints as number) : null,
    capMinor: b.keep === 'cap' ? (b.capMinor as number) : null,
    emoji: b.emoji ?? null, targetMonth: (b.targetMonth as string | null | undefined) ?? null,
  }));
export const subsectionPosition = z.number({ error: 'Choose a position.' }).int('Choose a position.');

export const date = z
  .string({ error: 'Enter a date.' })
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date.')
  .refine((s) => {
    const d = new Date(s + 'T00:00:00Z');
    return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Enter a real date.');

const DIFFERENT = 'Choose a different pocket.';
export const transaction = z
  .object({
    date,
    kind: z.enum(['expense', 'income', 'transfer'], { error: 'Choose expense or income.' }),
    amountMinor: minor(1, 'Enter an amount above zero, as a whole number of minor units.'),
    pocketId: z.number({ error: 'Choose a pocket.' }).int('Choose a pocket.'),
    subsectionId: z.number({ error: 'Choose a subsection.' }).int('Choose a subsection.').nullable().optional(),
    payee: z.string({ error: 'Enter a payee.' }).trim().max(120, 'Use 120 characters or fewer.').default(''),
    sourceId: z.number({ error: 'Choose a source.' }).int('Choose a source.').nullable().default(null),
    note: z.string({ error: 'Enter a note.' }).max(500, 'Use 500 characters or fewer.').default(''),
    toPocketId: z.unknown().optional(),
    toAmountMinor: z.unknown().optional(),
  })
  .superRefine((t, ctx) => {
    const bad = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (t.kind === 'transfer') {
      if (t.subsectionId != null) bad('subsectionId', 'A transfer has no subsection.');
      if (!Number.isInteger(t.toPocketId) || t.toPocketId === t.pocketId) bad('toPocketId', DIFFERENT);
      if (t.toAmountMinor != null && !(Number.isInteger(t.toAmountMinor) && (t.toAmountMinor as number) >= 1 && (t.toAmountMinor as number) <= MAX))
        bad('toAmountMinor', 'Enter the amount that arrived.');
      if (t.sourceId !== null) bad('sourceId', 'A transfer has no source.');
      return;
    }
    if (t.subsectionId === undefined) bad('subsectionId', 'Choose a subsection.');
    if (t.kind === 'expense' && t.subsectionId === null) bad('subsectionId', 'Choose a subsection.');
    if (t.kind === 'income' && t.subsectionId != null) bad('subsectionId', 'Income has no subsection.');
    if (t.kind === 'expense' && !t.payee) bad('payee', 'Enter a payee.');
    if (t.kind === 'expense' && t.sourceId !== null) bad('sourceId', 'An expense has no source.');
    if (t.kind === 'income' && t.sourceId === null) bad('sourceId', 'Choose a source.');
  })
  .transform((t) => {
    const { toPocketId, toAmountMinor, ...rest } = t;
    const transfer = t.kind === 'transfer';
    return {
      ...rest,
      subsectionId: t.subsectionId ?? null,
      payee: t.kind === 'expense' ? t.payee : '',
      toPocketId: transfer ? (toPocketId as number) : null,
      toAmountMinor: transfer ? ((toAmountMinor as number | null | undefined) ?? null) : null,
    };
  });

export const rateQuery = z.object({ date: date.optional() });
export const pocketValue = z.object({ valueMinor: minor(0, 'Enter an amount, 0 or more.'), date });
export const reconcile = z.object({ balanceMinor: minor(-MAX, 'Enter a whole number of minor units.'), date });

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
const ids = (msg: string) => z.union([id, z.array(id)], { error: msg }).transform((v) => (Array.isArray(v) ? v : [v]));
export const txQuery = z.object({
  month: month.optional(),
  pocketId: ids('Choose a pocket.').optional(),
  subsectionId: ids('Choose a subsection.').optional(),
  unsorted: z.enum(['0', '1']).optional(),
  kind: z.enum(['expense', 'income', 'transfer'], { error: 'Choose expense, income or transfer.' }).optional(),
  from: date.optional(),
  to: date.optional(),
  q: z.string({ error: 'Enter text to search for.' }).max(200, 'Use 200 characters or fewer.').optional(),
  tag: z.string({ error: 'Choose a tag.' }).trim().min(1, 'Choose a tag.').max(30, 'Choose a tag.').optional(),
});

export const importText = z.object({
  pocketId: z.number({ error: 'Choose a pocket.' }).int('Choose a pocket.'),
  text: z.string({ error: 'Choose a file.' }).max(5_000_000, 'The file is too large.'),
});
const col = z.number().int().min(0).max(10000);
const COLUMNS = 'Choose the columns of this file.';
export const importBody = importText.extend({
  mapping: z
    .object({
      date: col, dateFormat: z.enum(['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY']), amount: col.nullish(), debit: col.nullish(), credit: col.nullish(),
      payee: col, note: col.nullish(), decimal: z.enum(['.', ',']),
    }, { error: COLUMNS })
    .refine((m) => (m.amount != null) !== (m.debit != null || m.credit != null) && (m.debit != null) === (m.credit != null), COLUMNS),
});

export const rule = z.object({
  match: text(1, 60, 'Enter the text to look for.'),
  subsectionId: z.number().int().nullish(),
  sourceId: z.number().int().nullish(),
});

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

// An end names exactly one of subsectionId or sectionId; whether it is the person's own is checked against the database.
const end = (msg: string) =>
  z.unknown().transform((v, ctx): { subsectionId: number } | { sectionId: number } => {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const keys = Object.keys(o);
    if (keys.length === 1 && (keys[0] === 'subsectionId' || keys[0] === 'sectionId') && Number.isSafeInteger(o[keys[0]!]))
      return { [keys[0]!]: o[keys[0]!] } as any;
    ctx.addIssue({ code: 'custom', message: msg });
    return z.NEVER;
  });
export const move = z.object({
  month,
  from: end('Choose where the money comes from.'),
  to: end('Choose where the money goes.'),
  amountMinor: minor(1, 'Enter an amount above zero.'),
  reason: text(1, 200, 'Say why you are moving this money.'),
});

const ref = (msg: string) => z.number({ error: msg }).int(msg);
export const holding = z.object({
  name,
  pocketId: ref('Choose a pocket.'),
  subsectionId: ref('Choose a subsection.'),
  paidMinor: minor(0, 'Enter an amount, 0 or more.'),
  worthMinor: minor(0, 'Enter an amount, 0 or more.').optional(),
  worthCurrency: z.string({ error: 'Choose a currency.' }).optional(),
});
export const sale = z.object({
  date,
  receivedMinor: minor(0, 'Enter an amount, 0 or more.'),
  sourceId: z.number({ error: 'Choose a source.' }).int('Choose a source.').nullable().optional(),
});
export const nextMonthPocket = z.object({ nextMonthPocketId: z.number({ error: 'Choose a pocket.' }).int('Choose a pocket.').nullable().optional() });
