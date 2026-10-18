import { useState } from 'react';
import { api, useLoad, type Section } from '../api';
import { formatMinor } from '../money';
import { currentMonth, dayHeading, dayLabel, monthTitle, shiftMonth, today } from '../dates';
import { Load, SubEmoji, Topbar, useMedia } from '../ui';

type Item = {
  key: string; payee: string; cadence: 'weekly' | 'monthly' | 'yearly'; amountMinor: number;
  lastDate: string; nextDate: string; count: number; subsectionId: number | null; monthlyMinor: number;
  status: 'paid' | 'due' | 'missed' | 'upcoming'; priceChange: { fromMinor: number; toMinor: number; date: string } | null;
};
type Calendar = { month: string; days: { date: string; items: { key: string; payee: string; amountMinor: number; subsectionId: number | null; paid: boolean }[] }[] };
type Recurring = { items: Item[]; dismissed: Item[]; monthlyMinor: number };

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const short = (d: string) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const weekday = (d: string) => DAYS[new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8))).getDay()];
const CADENCE = { weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly' };
const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function CalendarCard({ sections }: { sections: Section[] }) {
  const [month, setMonth] = useState(currentMonth());
  const phone = useMedia('(max-width: 640px)');
  const state = useLoad(() => api<Calendar>('GET', `/recurring/calendar?month=${month}`), [month]);
  const emoji = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, x.emoji] as const)));
  const now = today();
  const chip = (d: Calendar['days'][number]['items'][number]) => (
    <li key={d.key} className={d.paid ? 'ty-cal__chip ty-cal__chip--paid' : 'ty-cal__chip'}>
      <span className="ty-cal__payee">{d.paid && <span aria-hidden="true">✓ </span>}<SubEmoji emoji={d.subsectionId === null ? null : emoji.get(d.subsectionId)} />{d.payee}</span>
      <span className="ty-cal__amt"><span className="ty-num">{formatMinor(-d.amountMinor)}</span>{d.paid && <span className="ty-cap">Paid</span>}</span>
    </li>
  );
  const lead = (new Date(Date.UTC(+month.slice(0, 4), +month.slice(5) - 1, 1)).getUTCDay() + 6) % 7;
  return (
    <section className="ty-card ty-stack" aria-label="Bills calendar">
      <div className="ty-month__top">
        <h2 className="text-heading" style={{ margin: 0 }}>Bills calendar</h2>
        <span className="ty-grow" />
        <button className="ty-btn ty-btn--icon" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>‹</button>
        <span className="text-body" style={{ fontWeight: 600 }}>{monthTitle(month)}</span>
        <button className="ty-btn ty-btn--icon" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>›</button>
      </div>
      <Load state={state}>{({ days }) => phone ? (
        days.every((d) => d.items.length === 0) ? <div className="ty-cap">No bills in {monthTitle(month)}.</div> : (
          <div className="ty-stack">{days.filter((d) => d.items.length).map((d) => (
            <div key={d.date} className={d.date === now ? 'ty-cal__day ty-cal__day--today' : 'ty-cal__day'}>
              <div className="ty-label">{dayLabel(d.date)}</div>
              <ul className="ty-cal__items">{d.items.map(chip)}</ul>
            </div>
          ))}</div>
        )
      ) : (
        <div className="ty-cal" role="group" aria-label={`Bills in ${monthTitle(month)}`}>
          {WEEKDAYS.map((w) => <div key={w} className="ty-label ty-cal__head">{w}</div>)}
          {Array.from({ length: lead }, (_, i) => <div key={`b${i}`} />)}
          {days.map((d) => (
            <div key={d.date} className={d.date === now ? 'ty-cal__day ty-cal__day--today' : 'ty-cal__day'} aria-current={d.date === now ? 'date' : undefined}>
              <span className="ty-cap">{Number(d.date.slice(8))}</span>
              {d.items.length > 0 && <ul className="ty-cal__items">{d.items.map(chip)}</ul>}
            </div>
          ))}
        </div>
      )}</Load>
    </section>
  );
}

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
          const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, emoji: x.emoji, slot: s.colorSlot }] as const)));
                  const t = today();
          const limit = today(new Date(Date.now() + 7 * 864e5));
          const soon = items.filter((i) => i.nextDate >= t && i.nextDate <= limit);
          const tag = (i: Item) => {
            const sub = i.subsectionId === null ? undefined : subs.get(i.subsectionId);
            return sub && <><span className={dot(sub.slot)} /><SubEmoji emoji={sub.emoji} />{sub.name}</>;
          };
          const pill = (i: Item) => (i.status === 'paid' ? <span className="ty-pill ty-pill--positive">Paid</span>
            : i.status === 'due' ? <span className="ty-pill ty-pill--warning">Due {weekday(i.nextDate)}</span>
            : i.status === 'missed' ? <span className="ty-pill ty-pill--negative">Missed</span> : null);
          const rises = items.filter((i) => i.priceChange);
          const row = (i: Item, extra: string, button: { label: string; method: 'POST' | 'DELETE' } | null) => (
            <div key={i.key} className="ty-trow">
              <div className="ty-trow__who">
                <span className="ty-inline"><b>{i.payee}</b>{pill(i)}</span>
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
              <CalendarCard sections={sections} />
              {soon.length > 0 && (
                <>
                  <h2 className="ty-label" style={{ margin: 0 }}>Due in the next 7 days</h2>
                  <section className="ty-section" aria-label="Due in the next 7 days">
                    {soon.map((i) => row(i, `due ${weekday(i.nextDate)} ${short(i.nextDate)}`, null))}
                  </section>
                </>
              )}
              {rises.map((i) => (
                <div key={i.key} className="ty-inset" role="status">
                  {i.payee} went up from {formatMinor(i.priceChange!.fromMinor)} to {formatMinor(i.priceChange!.toMinor)} on {dayHeading(i.priceChange!.date)}.
                </div>
              ))}
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
