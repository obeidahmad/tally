// A small RFC 4180 reader and the statement mapping helpers.
export const DELIMITERS = [',', ';', '\t'] as const;
export const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export type Mapping = {
  date: number; dateFormat: DateFormat; amount?: number; debit?: number; credit?: number;
  payee: number; note?: number; decimal: '.' | ',';
};

// Records of `text` split on `d`; null when a quote is never closed. `max` stops early.
export function records(text: string, d: string, max = Infinity): string[][] | null {
  const out: string[][] = [];
  let row: string[] = [];
  let f = '';
  let quoted = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end = () => { row.push(f); f = ''; };
  for (; i < text.length && out.length < max; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c !== '"') f += c;
      else if (text[i + 1] === '"') { f += '"'; i++; } else quoted = false;
    } else if (c === '"' && f === '') quoted = true;
    else if (c === d) end();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      end();
      if (row.length > 1 || row[0] !== '') out.push(row); // blank lines are not records
      row = [];
    } else f += c;
  }
  if (quoted) return null;
  if (out.length < max && (f !== '' || row.length)) { end(); if (row.length > 1 || row[0] !== '') out.push(row); }
  return out;
}

// null: not a CSV statement (no header, a single column, rows of different lengths, an open quote).
export function readCsv(text: string) {
  let best: { delimiter: string; width: number } | null = null;
  for (const d of DELIMITERS) {
    const w = records(text, d, 1)?.[0]?.length ?? 0;
    if (w > (best?.width ?? 1)) best = { delimiter: d, width: w };
  }
  if (!best) return null;
  const all = records(text, best.delimiter);
  if (!all || all.some((r) => r.length !== best!.width)) return null;
  return { delimiter: best.delimiter, headers: all[0]!, rows: all.slice(1) };
}

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
// 'YYYY-MM-DD' of a real date written in `fmt`, else null.
export function readDate(v: string, fmt: DateFormat): string | null {
  const sep = fmt === 'YYYY-MM-DD' ? '-' : fmt === 'DD.MM.YYYY' ? '.' : '/';
  const p = v.trim().split(sep);
  if (p.length !== 3 || !p.every((x) => /^\d+$/.test(x))) return null;
  const [a, b, c] = p.map(Number) as [number, number, number];
  const [y, m, d] = fmt === 'YYYY-MM-DD' ? [a, b, c] : fmt === 'MM/DD/YYYY' ? [c, a, b] : [c, b, a];
  const iso = `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
  if (p[fmt === 'YYYY-MM-DD' ? 0 : 2]!.length !== 4) return null;
  const t = new Date(iso + 'T00:00:00Z');
  return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === iso ? iso : null;
}

// Signed minor units of "-1.234,50" and the like; null when unreadable.
export function readAmount(v: string, decimal: '.' | ',', exponent: number): number | null {
  let s = v.replace(/[\s '’]/g, '');
  s = decimal === '.' ? s.replace(/,/g, '') : s.replace(/\./g, '').replace(',', '.');
  const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(s);
  if (!m || !(m[2] || m[3])) return null;
  const frac = m[3] ?? '';
  if (/[1-9]/.test(frac.slice(exponent))) return null;
  const n = Number((m[2] || '0') + frac.slice(0, exponent).padEnd(exponent, '0'));
  return Number.isSafeInteger(n) && n <= 10 ** 13 ? (m[1] === '-' ? -n : n) : null;
}

const HINTS: [keyof Mapping, RegExp][] = [
  ['date', /date|datum|fecha/i],
  ['amount', /amount|montant|betrag|importe/i],
  ['debit', /debit|withdraw|paid out|soll/i],
  ['credit', /credit|deposit|paid in|haben/i],
  ['payee', /payee|beschreib|empf|description|merchant|beneficiar|counterpart|libell|name/i],
  ['note', /note|referenz|verwendung|reference|memo|details|purpose/i],
];
export type Guess = { [K in keyof Mapping]: Mapping[K] | null };

// The best mapping from header names and the first rows; null per field it cannot guess.
export function guessMapping(headers: string[], rows: string[][]): Guess {
  const g: Guess = { date: null, dateFormat: null, amount: null, debit: null, credit: null, payee: null, note: null, decimal: null };
  const taken = new Set<number>();
  for (const [k, re] of HINTS) {
    const i = headers.findIndex((h, j) => !taken.has(j) && re.test(h));
    if (i >= 0) { (g as any)[k] = i; taken.add(i); }
  }
  if (g.amount !== null) g.debit = g.credit = null;
  const sample = rows.slice(0, 20);
  if (g.date !== null) {
    const vals = sample.map((r) => r[g.date!]!).filter((v) => v.trim());
    g.dateFormat = DATE_FORMATS.find((f) => vals.length && vals.every((v) => readDate(v, f))) ?? null;
  }
  const cols = [g.amount, g.debit, g.credit].filter((x): x is number => x !== null);
  if (cols.length) g.decimal = sample.some((r) => cols.some((c) => /,\d{1,2}$/.test(r[c]!.trim()))) ? ',' : '.';
  return g;
}
