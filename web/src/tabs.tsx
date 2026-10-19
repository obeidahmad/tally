import { useEffect, useRef, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';

/** The page's tab, from `?tab=`; an unknown or missing value is the first. */
export function useTab<T extends string>(values: readonly T[]): [T, (t: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab');
  const tab = values.find((v) => v === raw) ?? values[0];
  const set = (t: T) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });
  return [tab, set];
}

/** The content of the selected tab. */
export const TabPanel = ({ tab, children }: { tab: string; children: ReactNode }) => <div role="tabpanel" id="tabpanel" aria-labelledby={`tab-${tab}`} className="ty-panel">{children}</div>;

/** Page tabs (design system `Tabs`): roving tabindex, arrows, Home and End move and select. */
export function Tabs<T extends string>({ label, tabs, value, onChange }: {
  label: string; tabs: readonly { value: T; label: string }[]; value: T; onChange: (t: T) => void;
}) {
  const move = (e: React.KeyboardEvent, i: number) => {
    const to = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    onChange(tabs[to].value);
    (e.currentTarget.parentElement?.children[to] as HTMLElement | undefined)?.focus();
  };
  const list = useRef<HTMLDivElement>(null);
  // on a phone the row scrolls sideways: keep the selected tab in view
  useEffect(() => { list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); }, [value]);
  return (
    <div className="ty-tabs" role="tablist" aria-label={label} ref={list}>
      {tabs.map((t, i) => (
        <a key={t.value} className="ty-tab" role="tab" id={`tab-${t.value}`} aria-controls="tabpanel" href={`?tab=${t.value}`} aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1}
          onClick={(e) => { e.preventDefault(); onChange(t.value); }} onKeyDown={(e) => move(e, i)}>{t.label}</a>
      ))}
    </div>
  );
}
