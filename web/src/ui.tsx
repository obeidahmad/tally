import { createContext, useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EMOJIS, KIND_WORDS, type Loaded, type PocketKind, type Section } from './api';

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

export function TextField({ label, value, onChange, error, type = 'text', autoComplete, hint, disabled, max }: {
  label: string; max?: string; value: string; onChange: (v: string) => void; error?: string; type?: string; autoComplete?: string; hint?: string; disabled?: boolean;
}) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(p) => <input {...p} type={type} max={max} value={value} autoComplete={autoComplete} disabled={disabled} onChange={(e) => onChange(e.target.value)} />}
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
export function Modal({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children: ReactNode }) {
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
    <dialog ref={ref} className="ty-dialog" aria-labelledby={titleId} onClose={onClose}>
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

/* ---------- Phone top bar and focus ---------- */

/** The phone's translucent top bar (hidden on desktop by the design CSS). */
export function Topbar({ title, add, month }: {
  title: string;
  add?: { label: string; onClick: () => void; spend?: boolean };
  month?: { onPrev: () => void; onNext: () => void; nextDisabled: boolean };
}) {
  return (
    <div className="ty-topbar">
      {month && <button className="ty-btn ty-btn--icon" aria-label="Previous month" onClick={month.onPrev}>‹</button>}
      <h1 className="text-title" style={{ margin: 0 }} tabIndex={-1}>{title}</h1>
      {month && <button className="ty-btn ty-btn--icon" aria-label="Next month" disabled={month.nextDisabled} onClick={month.onNext}>›</button>}
      <span className="ty-grow" />
      {add && <button className={`ty-btn ty-btn--${add.spend ? 'spend' : 'primary'}`} aria-label={add.label} onClick={add.onClick}>Add</button>}
    </div>
  );
}

/** When the page flips between empty and filled, the card that opened a dialog is gone: put focus on the visible page heading, whatever else took it meanwhile. */
export function useRescueFocus(empty: boolean | undefined) {
  const prev = useRef(empty);
  useEffect(() => {
    const was = prev.current;
    prev.current = empty;
    if (was === undefined || empty === undefined || was === empty) return;
    // a select or field in use is the person's own place: a filter changing the list must not take it
    if (document.querySelector('dialog[open]') || document.activeElement?.matches('select, input, textarea')) return;
    [...document.querySelectorAll<HTMLElement>('.ty-main h1[tabindex="-1"]')].find((h) => h.offsetParent !== null)?.focus();
  }, [empty]);
}
