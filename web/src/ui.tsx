import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { EMOJIS, KIND_WORDS, type Loaded, type PocketKind, type Section } from './api';
import { monthName, monthTitle } from './dates';
import { formatMinor } from './money';

/* ---------- Fields ---------- */

type ControlProps = { id: string; className: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

export function Field({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: (p: ControlProps) => ReactNode;
}) {
  const id = useId();
  const msgId = `${id}-msg`;
  return (
    <div className="ty-field">
      <label className="ty-label" htmlFor={id}>{label}</label>
      {children({
        id,
        className: error ? 'ty-input ty-input--error' : 'ty-input',
        ...(error ? { 'aria-invalid': true as const } : {}),
        'aria-describedby': error || hint ? msgId : undefined,
      })}
      {error ? <span className="ty-error" id={msgId}>{error}</span> : hint ? <span className="ty-cap" id={msgId}>{hint}</span> : null}
    </div>
  );
}

export function TextField({ label, value, onChange, error, type = 'text', autoComplete, hint, disabled, max, placeholder }: {
  placeholder?: string; label: string; max?: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string; hint?: string; disabled?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => <input {...p} type={type} max={max} placeholder={placeholder} value={value} autoComplete={autoComplete} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function AmountField({ label, value, onChange, error, currency, hint, disabled }: {
  label: string; value: string; onChange: (v: string) => void; error?: string; currency: string; hint?: string; disabled?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => (
        <div className="ty-affix">
          <input {...p} className={`${p.className} ty-input--amount`} inputMode="decimal" autoComplete="off" disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} />
          <span className="ty-muted">{currency}</span>
        </div>
      )}
    </Field>
  );
}

const CURRENCIES: string[] = Intl.supportedValuesOf('currency');

export function CurrencyField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error?: string }) {
  return (
    <Field label="Base currency" error={error}>
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
        </select>
      )}
    </Field>
  );
}

const currencyNames = new Intl.DisplayNames('en', { type: 'currency' });

/** A pocket's currency: the base currency first, then the others alphabetically, as "USD · US Dollar". */
export function PocketCurrencyField({ value, onChange, error, offered, base, locked }: {
  value: string; onChange: (v: string) => void; error?: string; offered: string[]; base: string; locked: boolean;
}) {
  const codes = [...new Set([base, ...offered.filter((c) => c !== base).sort(), value])];
  return (
    <Field label="Currency" error={error} hint={locked ? 'A pocket with transactions keeps its currency.' : undefined}>
      {(p) => (
        <select {...p} value={value} disabled={locked} onChange={(e) => onChange(e.target.value)}>
          {codes.map((c) => <option key={c} value={c}>{c} · {currencyNames.of(c) ?? c}</option>)}
        </select>
      )}
    </Field>
  );
}

export function KindField({ value, onChange, error, omit }: { value: PocketKind; onChange: (v: PocketKind) => void; error?: string; omit?: PocketKind }) {
  return (
    <Field label="Kind" error={error}>
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value as PocketKind)}>
          {(Object.keys(KIND_WORDS) as PocketKind[]).filter((k) => k !== omit).map((k) => <option key={k} value={k}>{KIND_WORDS[k]}</option>)}
        </select>
      )}
    </Field>
  );
}

/** The 32 pocket emoji as native radios; each one's accessible name is its name. */
export function EmojiPicker({ value, onChange, error, onClear }: { value: string; onChange: (v: string) => void; error?: string; onClear?: () => void }) {
  const name = useId();
  return (
    <fieldset className="ty-fieldset">
      <legend className="ty-label">Emoji</legend>
      <div className="ty-emojis ty-emoji">
        {EMOJIS.map(([char, label]) => (
          <label key={label}><input type="radio" name={name} aria-label={label} checked={value === char} onChange={() => onChange(char)} />{char}</label>
        ))}
      </div>
      {onClear && <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" disabled={!value} onClick={onClear}>No emoji</button></div>}
      {error && <span className="ty-error">{error}</span>}
    </fieldset>
  );
}

/** A subsection's emoji before its name, when it has one. */
export const SubEmoji = ({ emoji }: { emoji?: string | null }) => (emoji ? <><span className="ty-emoji" aria-hidden="true">{emoji}</span> </> : null);
/** A transaction row's round mark: the subsection's emoji on its section's tint, else the payee's first letter, "⋯" for a split. */
export function TxAvatar({ title, sub, split }: { title?: string; sub?: { emoji?: string | null; slot: number }; split?: boolean }) {
  const slot = sub && sub.slot >= 1 && sub.slot <= 8 ? ` ty-avatar--${sub.slot}` : '';
  return <span className={`ty-avatar${slot}`} aria-hidden="true">{split ? '⋯' : sub?.emoji ? <span className="ty-emoji">{sub.emoji}</span> : (title || '?').trim().charAt(0).toUpperCase()}</span>;
}
/** The same as plain text, for an option. */
export const subLabel = (x: { name: string; emoji?: string | null }) => (x.emoji ? `${x.emoji} ${x.name}` : x.name);

/** Subsection select grouped by section. */
export function SubsectionOptions({ sections }: { sections: Section[] }) {
  return <>{sections.filter((s) => s.subsections.length).map((s) => (
    <optgroup key={s.id} label={s.name}>
      {s.subsections.map((x) => <option key={x.id} value={x.id}>{subLabel(x)}</option>)}
    </optgroup>
  ))}</>;
}

export const StatePill = ({ closed }: { closed: boolean }) => (closed ? <span className="ty-pill">Closed</span> : <span className="ty-pill ty-pill--positive">Open</span>);

export const FormError = ({ message }: { message: string }) => (message ? <div className="ty-error" role="alert">{message}</div> : null);

/* ---------- Dialog ---------- */

/** A native modal dialog. Mount it to open it; it calls onClose on Escape and when closed. */
export function Modal({ title, sub, onClose, children, backdropCloses }: { title: string; sub?: string; onClose: () => void; children: ReactNode; backdropCloses?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current!;
    const opener = document.activeElement as HTMLElement | null;
    if (!d.open) d.showModal();
    return () => {
      d.close();
      if (opener?.isConnected) opener.focus(); // belt and braces: the browser also restores focus
    };
  }, []);
  return (
    <dialog ref={ref} className="ty-dialog" aria-labelledby={titleId} onClose={onClose} onClick={backdropCloses ? (e) => { if (e.target === e.currentTarget) onClose(); } : undefined}>
      {sub ? (
        <div><h2 className="text-title" id={titleId}>{title}</h2><p className="ty-cap" style={{ margin: '0.25rem 0 0' }}>{sub}</p></div>
      ) : <h2 className="text-title" id={titleId}>{title}</h2>}
      {children}
    </dialog>
  );
}

/* ---------- Toast ---------- */

type ToastState = { id: number; message: string; undo?: () => void } | null;
const ToastCtx = createContext<(message: string, undo?: () => void) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast]);
  return (
    <ToastCtx.Provider value={(message, undo) => setToast({ id: Date.now() + Math.random(), message, undo })}>
      {children}
      <div role="status">
        {toast && (
          <div className="ty-toast" key={toast.id}>
            <span>{toast.message}</span>
            {toast.undo && (
              <button className="ty-btn ty-btn--quiet" onClick={() => { toast.undo!(); setToast(null); }}>Undo</button>
            )}
          </div>
        )}
      </div>
    </ToastCtx.Provider>
  );
}

/* ---------- Page states ---------- */

export function Load<T>({ state, children }: { state: Loaded<T>; children: (data: T) => ReactNode }) {
  if (state.failed) {
    return (
      <div className="ty-card ty-stack">
        <div>Couldn't load this page. Check that Tally's server is running.</div>
        <div><button className="ty-btn" onClick={state.retry}>Try again</button></div>
      </div>
    );
  }
  if (state.data === undefined) return <div className="ty-cap">Loading…</div>;
  return <>{children(state.data)}</>;
}

export const EmptyCard = ({ text, action, onAction }: { text: string; action: string; onAction: () => void }) => (
  <div className="ty-card ty-stack">
    <div>{text}</div>
    <div><button className="ty-btn" onClick={onAction}>{action}</button></div>
  </div>
);

/** Whether a media query matches now, following changes. */
export const useMedia = (query: string) => useSyncExternalStore(
  (cb) => { const m = matchMedia(query); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); },
  () => matchMedia(query).matches,
);

/* ---------- Top bar, logo and focus ---------- */

/** Where the shell wants the page's top bar: a sibling above the page, so it can stick to the window. */
export const TopSlotCtx = createContext<HTMLElement | null>(null);

/** The page's top bar: title, tabs, then the actions (and the month stepper) on the right. */
export function Topbar({ title, tabs, actions, month }: {
  title: string;
  tabs?: ReactNode;
  actions?: ReactNode;
  month?: { label: string; onPrev: () => void; onNext: () => void; nextDisabled?: boolean };
}) {
  const slot = useContext(TopSlotCtx);
  if (!slot) return null;
  return createPortal(
    <header className="ty-top">
      <h1 className="text-display ty-top__title" tabIndex={-1}>{title}</h1>
      {tabs}
      <div className="ty-top__actions">
        {month && (
          <span className="ty-monthnav">
            <button className="ty-btn ty-btn--quiet ty-btn--icon" aria-label="Previous month" onClick={month.onPrev}>‹</button>
            {month.label}
            <button className="ty-btn ty-btn--quiet ty-btn--icon" aria-label="Next month" disabled={month.nextDisabled} onClick={month.onNext}>›</button>
          </span>
        )}
        {actions}
      </div>
    </header>,
    slot,
  );
}

/** A top-bar action: the full label on desktop, one word on a phone. The full label is always the name. */
export const TopButton = ({ label, short = 'Add', primary, wide, onClick }: { label: string; short?: string; primary?: boolean; wide?: boolean; onClick: () => void }) => (
  <button className={`ty-btn${primary ? ' ty-btn--primary' : ''}${wide ? ' ty-wide' : ''}`} aria-label={label} onClick={onClick}>
    <span className="ty-wide">{label}</span><span className="app-phone-only">{short}</span>
  </button>
);

export const Logo = () => (
  <div className="ty-logo"><svg viewBox="0 0 24 24" aria-hidden="true"><rect width="24" height="24" rx="6" /><path d="M7.5 7v10M11 7v10M14.5 7v10M5.5 15L17 9" /></svg>Tally</div>
);

/** "Sunday, 18 October" */
export function longDay(date: string) {
  const d = new Date(`${date}T12:00:00`);
  return `${d.toLocaleDateString('en-GB', { weekday: 'long' })}, ${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'long' })}`;
}

/** When the page flips between empty and filled, the card that opened a dialog is gone: put focus on the page heading, whatever else took it meanwhile. */
export function useRescueFocus(empty: boolean | undefined) {
  const prev = useRef(empty);
  useEffect(() => {
    const was = prev.current;
    prev.current = empty;
    if (was === undefined || empty === undefined || was === empty) return;
    // a select or field in use is the person's own place: a filter changing the list must not take it
    if (document.querySelector('dialog[open]') || document.activeElement?.matches('select, input, textarea')) return;
    document.querySelector<HTMLElement>('.ty-top h1[tabindex="-1"]')?.focus();
  }, [empty]);
}

/* ---------- Area chart (net worth) ---------- */

const AH = 260, AL = 48, AT = 8, AB = 232;
const tick = (v: number) => (Math.abs(v) >= 1e6 ? `${+(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${+(v / 1000).toFixed(1)}K` : `${v}`);

/** A line with a soft fill over monthly points, with a crosshair, a tooltip per point and a table toggle. */
export function AreaChart({ series, name = 'Net worth' }: { series: { month: string; minor: number }[]; name?: string }) {
  const [at, setAt] = useState<number>();
  const [table, setTable] = useState(false);
  // drawn at its own width, so the labels keep their size on a phone
  const box = useRef<HTMLDivElement>(null);
  const [AW, setW] = useState(1000);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, 240)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const AR = AW - 8;
  const id = useId();
  const n = series.length;
  const vals = series.map((s) => s.minor / 100);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi === lo) { hi += 100; lo -= 100; }
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw) ?? 10) * mag;
  const min = Math.floor(lo / step) * step, max = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let v = min; v <= max + step / 2; v += step) ticks.push(v);
  const x = (i: number) => (n === 1 ? (AL + AR) / 2 : AL + ((AR - AL) * i) / (n - 1));
  const y = (v: number) => AB - ((AB - AT) * (v - min)) / (max - min);
  const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const every = Math.ceil(n / Math.max(2, Math.floor((AR - AL) / 90)));
  const tip = at === undefined ? undefined : series[at];
  return (
    <div className="ty-stack">
      {table ? (
        <div className="ty-chart-table"><table className="ty-table">
          <thead><tr><th>Month</th><th>{name}</th></tr></thead>
          <tbody>{series.map((s) => <tr key={s.month}><td>{monthTitle(s.month)}</td><td className="ty-num">{formatMinor(s.minor)}</td></tr>)}</tbody>
        </table></div>
      ) : (
        <div className="ty-chart-plot" ref={box}>
          <svg width={AW} height={AH} viewBox={`0 0 ${AW} ${AH}`} role="group" aria-label={`${name} over time`}>
            <defs><linearGradient id={`${id}f`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="ty-area-stop" stopOpacity="0.25" /><stop offset="1" className="ty-area-stop" stopOpacity="0" /></linearGradient></defs>
            <g className="ty-chart-axis">
              {ticks.map((v) => <g key={v}><line className="ty-chart-grid" x1={AL} x2={AR} y1={y(v)} y2={y(v)} /><text x={AL - 8} y={y(v) + 4} textAnchor="end">{tick(v)}</text></g>)}
              {series.map((s, i) => (i % every === 0 ? <text key={s.month} x={x(i)} y={AH - 6} textAnchor={i === 0 && n > 1 ? 'start' : i === n - 1 ? 'end' : 'middle'}>{`${monthName(s.month).slice(0, 3)} ${s.month.slice(0, 4)}`}</text> : null))}
            </g>
            {n > 1 && <path d={`${line}L${x(n - 1)},${AB}L${x(0)},${AB}Z`} fill={`url(#${id}f)`} />}
            <path className="ty-area-line" d={line} />
            {at !== undefined && <><line className="ty-area-cross" x1={x(at)} x2={x(at)} y1={AT} y2={AB} /><circle className="ty-area-dot" cx={x(at)} cy={y(vals[at]!)} r={5} /></>}
            {series.map((s, i) => {
              const w = n === 1 ? AR - AL : (AR - AL) / (n - 1);
              return (
                <rect key={s.month} className="ty-chart-hit" x={x(i) - w / 2} y={0} width={w} height={AB} fill="transparent" tabIndex={0} role="img" aria-label={`${monthTitle(s.month)}: ${formatMinor(s.minor)}`}
                  onPointerEnter={() => setAt(i)} onFocus={() => setAt(i)} onBlur={() => setAt(undefined)} onPointerLeave={() => setAt(undefined)} />
              );
            })}
          </svg>
          {tip && at !== undefined && (
            <div className="ty-chart-tip" role="tooltip" style={{ left: x(at), transform: `translateX(${at > (n - 1) / 2 ? 'calc(-100% - 0.75rem)' : '0.75rem'})` }}>
              <div className="ty-chart-tip__title">{monthTitle(tip.month)}</div>
              <div className="ty-chart-tip__row"><span className="ty-chart-tip__key" style={{ background: 'var(--sec-7)' }} /><span className="ty-cap">{name}</span><span className="ty-chart-tip__val">{formatMinor(tip.minor)}</span></div>
            </div>
          )}
        </div>
      )}
      <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setTable(!table)}>{table ? 'Show as chart' : 'Show as table'}</button></div>
    </div>
  );
}
