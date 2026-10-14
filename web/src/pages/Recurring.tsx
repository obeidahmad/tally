import { useState } from 'react';
import { api, useLoad, type Section } from '../api';
import { formatMinor } from '../money';
import { today } from '../dates';
import { Load, Topbar } from '../ui';

type Item = {
  key: string; payee: string; cadence: 'weekly' | 'monthly' | 'yearly'; amountMinor: number;
  lastDate: string; nextDate: string; count: number; subsectionId: number | null; monthlyMinor: number;
};
type Recurring = { items: Item[]; dismissed: Item[]; monthlyMinor: number };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = (d: string) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const weekday = (d: string) => DAYS[new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8))).getDay()];
const CADENCE = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');

export default function RecurringPage() {
  const [showHidden, setShowHidden] = useState(false);
  const state = useLoad(async () => {
    const [r, s] = await Promise.all([api<Recurring>('GET', '/recurring'), api<{ sections: Section[] }>('GET', '/sections')]);
    return { ...r, sections: s.sections };
  }, []);

  return (
    <>
      <Topbar title="Recurring" />
      <header className="ty-month__top ty-wide">
        <h1 className="text-display" style={{ margin: 0 }} tabIndex={-1}>Recurring</h1>
      </header>
      <Load state={state}>
        {({ items, dismissed, monthlyMinor, sections }) => {
          const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, slot: s.colorSlot }] as const)));
                  const t = today();
          const limit = today(new Date(Date.now() + 7 * 864e5));
          const soon = items.filter((i) => i.nextDate >= t && i.nextDate <= limit);
          const tag = (i: Item) => {
            const sub = i.subsectionId === null ? undefined : subs.get(i.subsectionId);
            return sub && <><span className={dot(sub.slot)} />{sub.name}</>;
          };
          const row = (i: Item, extra: string, button: { label: string; method: 'POST' | 'DELETE' } | null) => (
            <div key={i.key} className="ty-trow">
              <div className="ty-trow__who">
                <b>{i.payee}</b>
                <span className="ty-cap">{extra}</span>
                <span className="ty-cap ty-trow__meta"><span className="ty-tag">{tag(i)}</span></span>
                {button && (
                  <button className="ty-btn ty-btn--quiet ty-btn--sm" style={{ justifySelf: 'start', marginLeft: 'calc(-1 * var(--space-3))' }} onClick={() => api(button.method, `/recurring/${encodeURIComponent(i.key)}/dismiss`, {})}>{button.label}</button>
                )}
              </div>
              <div className="ty-tag ty-wide">{tag(i)}</div>
              <div className="ty-wide" />
              <div className="ty-num ty-right">{formatMinor(-i.amountMinor)}</div>
            </div>
          );
          if (items.length === 0 && dismissed.length === 0) {
            return <div className="ty-card">Nothing recurring yet. Tally finds a payment once it has been paid three times on a regular schedule.</div>;
          }
          return (
            <>
              <p style={{ margin: 0 }}>About {formatMinor(monthlyMinor)} a month in {items.length} recurring payment{items.length === 1 ? '' : 's'}.</p>
              {soon.length > 0 && (
                <>
                  <h2 className="ty-label" style={{ margin: 0 }}>Due in the next 7 days</h2>
                  <section className="ty-section" aria-label="Due in the next 7 days">
                    {soon.map((i) => row(i, `due ${weekday(i.nextDate)} ${short(i.nextDate)}`, null))}
                  </section>
                </>
              )}
              <h2 className="ty-label" style={{ margin: 0 }}>All</h2>
              {items.length === 0 ? <div className="ty-card">Nothing is recurring right now.</div> : (
                <section className="ty-section" aria-label="All">
                  {items.map((i) => row(i, `${CADENCE[i.cadence]} · last paid ${short(i.lastDate)} · next ${short(i.nextDate)}`, { label: 'Not recurring', method: 'POST' }))}
                </section>
              )}
              {dismissed.length > 0 && (
                <>
                  <div>
                    <button className="ty-btn ty-btn--quiet" aria-expanded={showHidden} onClick={() => setShowHidden(!showHidden)}>Hidden ({dismissed.length})</button>
                  </div>
                  {showHidden && (
                    <section className="ty-section" aria-label="Hidden">
                      {dismissed.map((i) => row(i, `${CADENCE[i.cadence]} · last paid ${short(i.lastDate)}`, { label: 'Show again', method: 'DELETE' }))}
                    </section>
                  )}
                </>
              )}
            </>
          );
        }}
      </Load>
    </>
  );
}
