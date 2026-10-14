import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type User = { id: number; username: string; displayName: string; isOwner: boolean; baseCurrency: string };
export type PocketKind = 'bank' | 'cash' | 'fund' | 'broker';
export type Pocket = { id: number; name: string; kind: PocketKind; emoji: string; currency: string; openingBalanceMinor: number; balanceMinor: number };
export type Subsection = { id: number; sectionId: number; name: string; budgetMinor: number; position: number };
export type Source = { id: number; name: string; boxId: number; isLeftovers: boolean };
export type RestRule = { shares: { sectionId: number | null; basisPoints: number }[]; overspent: 'income' | 'section' };
export type Section = { id: number; name: string; colorSlot: number; position: number; subsections: Subsection[]; rest: RestRule };
export type Months = { lastClosed: string | null; toClose: string | null };
export type CloseSummary = {
  month: string; nextMonth: string;
  rows: { fromSectionId: number | null; basisPoints: number; toSectionId: number | null; amountMinor: number }[];
  keptMinor: number; incomeMinor: number;
};
export type Transaction = {
  id: number; date: string; kind: 'expense' | 'income'; amountMinor: number;
  pocketId: number; subsectionId: number | null; sourceId: number | null; payee: string; note: string; source: 'manual';
};
export type BudgetSubsection = { id: number; name: string; budgetMinor: number; spentMinor: number; availableMinor: number; carriedMinor: number };
export type BudgetSection = {
  id: number; name: string; colorSlot: number; budgetedMinor: number; restMinor: number; spentMinor: number; availableMinor: number;
  subsections: BudgetSubsection[];
};
export type Budget = {
  month: string; currency: string; closed: boolean;
  totals: { incomeMinor: number; budgetedMinor: number; spentMinor: number; availableMinor: number; leftOverMinor: number };
  sections: BudgetSection[];
};

export type StepBody =
  | { kind: 'amount'; sectionId: number; amountMinor: number }
  | { kind: 'percent'; shares: { sectionId: number; basisPoints: number }[] };
export type PipelineStep =
  | { id: number; position: number; kind: 'amount'; sectionId: number; amountMinor: number; takenMinor: number; leftMinor: number }
  | { id: number; position: number; kind: 'percent'; leftMinor: number; shares: { sectionId: number; basisPoints: number; takenMinor: number }[] };
export type PipelineBox = {
  id: number; incomeMinor: number; leftOverMinor: number;
  sources: { id: number; name: string; incomeMinor: number; isLeftovers: boolean }[]; steps: PipelineStep[];
};
export type Pipeline = {
  month: string; currency: string; closed: boolean; boxes: PipelineBox[];
  sections: { id: number; name: string; colorSlot: number; receivedMinor: number; carriedMinor: number; rest: RestRule }[]; leftOverMinor: number;
};

/** The 32 pocket emoji in picker order: [character, name]. Built with fromCodePoint so no variation selector sneaks in. */
export const EMOJIS: [string, string][] = ([
  [0x1F3E6, 'Bank'], [0x1F4B3, 'Card'], [0x1F4B5, 'Banknote'], [0x1F4B6, 'Euro note'],
  [0x1F4B7, 'Pound note'], [0x1F4B0, 'Money bag'], [0x1FA99, 'Coin'], [0x1F45B, 'Purse'],
  [0x1F437, 'Piggy bank'], [0x1F4C8, 'Chart'], [0x1F331, 'Seedling'], [0x1F48E, 'Gem'],
  [0x1F512, 'Lock'], [0x1F3E0, 'House'], [0x1F697, 'Car'], [0x2708, 'Plane'],
  [0x1F381, 'Gift'], [0x1F393, 'Graduation cap'], [0x1F476, 'Baby'], [0x2764, 'Heart'],
  [0x2B50, 'Star'], [0x2602, 'Umbrella'], [0x1F6D2, 'Shopping cart'], [0x1F4BC, 'Briefcase'],
  [0x1F4F1, 'Phone'], [0x1F30D, 'Globe'], [0x1F3D6, 'Beach'], [0x1F6E0, 'Tools'],
  [0x1F3AF, 'Target'], [0x1F9FE, 'Receipt'], [0x1F932, 'Open hands'], [0x1F54C, 'Mosque'],
] as [number, string][]).map(([c, name]) => [String.fromCodePoint(c), name]);

export const DEFAULT_EMOJI: Record<PocketKind, string> = {
  bank: String.fromCodePoint(0x1F3E6), cash: String.fromCodePoint(0x1F4B5),
  fund: String.fromCodePoint(0x1F331), broker: String.fromCodePoint(0x1F4C8),
};

export const KIND_WORDS: Record<PocketKind, string> = { bank: 'Bank account', cash: 'Cash', fund: 'Fund', broker: 'Broker' };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

// Any 401 `unauthenticated` calls this; the app sets it to clear the signed-in user.
let onUnauthenticated: () => void = () => {};
export const setUnauthenticatedHandler = (fn: () => void) => { onUnauthenticated = fn; };

// Bumped after every successful change; useLoad refetches when it moves.
let version = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export async function api<T = void>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' }, // server rejects changing calls without it, even with no body
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'network', "Couldn't reach Tally's server. Check that it is running.");
  }
  if (!res.ok) {
    const e = (await res.json().catch(() => null))?.error;
    const err = new ApiError(res.status, e?.code ?? 'unknown', e?.message ?? 'Something went wrong. Try again.', e?.fields);
    if (res.status === 401 && err.code === 'unauthenticated') onUnauthenticated();
    throw err;
  }
  // signing out must not refetch the open pages (they would come back as 401s)
  if (method !== 'GET' && path !== '/auth/logout') { version++; listeners.forEach((f) => f()); }
  return res.status === 204 ? (undefined as T) : res.json();
}

export type Loaded<T> = { data?: T; failed: boolean; retry: () => void };

/** Fetches on mount, when `deps` change and after any change made through api(). Keeps old data while refetching. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): Loaded<T> {
  const v = useSyncExternalStore(subscribe, () => version);
  const [state, setState] = useState<{ data?: T; failed: boolean }>({ failed: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    fn().then(
      (data) => live && setState({ data, failed: false }),
      () => live && setState({ failed: true }),
    );
    return () => { live = false; };
  }, [v, attempt, ...deps]);
  const retry = useCallback(() => { setState({ failed: false }); setAttempt((n) => n + 1); }, []);
  return { ...state, retry };
}

/** Tracks the field and form errors of one dialog or form. */
export function useForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const on = (action: () => Promise<void>) => async (e?: { preventDefault(): void }) => {
    e?.preventDefault();
    setErrors({}); setFormError(''); setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setFormError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    }
    setBusy(false);
  };
  return { errors, formError, busy, on };
}

export const fieldError = (field: string, message: string) => new ApiError(400, 'validation', message, { [field]: message });
