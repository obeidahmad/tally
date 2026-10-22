import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { api, loadPlan, useLoad, type GoalStatus, type Pocket, type Section, type Source, type Transaction } from '../api';
import { baseCurrency, useAuth } from '../auth';
import { dayHeading, monthName, monthTitle, shiftMonth } from '../dates';
import { formatMinor } from '../money';
import { Load, SubEmoji, Topbar, TxAvatar } from '../ui';
import { TransfersToMake } from '../plan';
import { rowState } from './Budget';

type Home = {
  month: string;
  budget: { budgetedMinor: number; spentMinor: number; leftMinor: number; overspent: { subsectionId: number; overMinor: number }[] };
  networth: { minor: number; changeMinor: number; series: { month: string; minor: number }[] };
  cashflow: { incomeMinor: number; spendingMinor: number };
  upcoming: { key: string; payee: string; amountMinor: number; date: string }[];
  recent: Transaction[];
  goals: { subsectionId: number; savedMinor: number; targetMinor: number; goalStatus: GoalStatus | null }[];
  needsSorting: number;
  ageOfMoneyDays: number | null;
};

const SPARK_H = 56;
const PAD = 6;

/** The net worth line: 2px, no axes, a tooltip per point (hover, focus or tap). */
function Sparkline({ series }: { series: Home['networth']['series'] }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(320);
  const [at, setAt] = useState<number>();
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(Math.max(el.clientWidth, 120)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const vals = series.map((s) => s.minor);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i: number) => PAD + ((w - 2 * PAD) * i) / Math.max(series.length - 1, 1);
  const y = (v: number) => (hi === lo ? SPARK_H / 2 : PAD + (SPARK_H - 2 * PAD) * (1 - (v - lo) / (hi - lo)));
  const step = (w - 2 * PAD) / Math.max(series.length - 1, 1);
  const tip = at === undefined ? undefined : series[at];
  const id = useId().replace(/W/g, '');
  const line = series.map((s, i) => `${i ? 'L' : 'M'}${x(i)},${y(s.minor)}`).join('');
  return (
    <div className="ty-chart-plot" ref={box}>
      <svg width={w} height={SPARK_H} viewBox={`0 0 ${w} ${SPARK_H}`} onPointerDown={(e) => { if (e.target === e.currentTarget) setAt(undefined); }}>
        <defs><linearGradient id={`sp${id}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" className="ty-area-stop" stopOpacity="0.25" /><stop offset="1" className="ty-area-stop" stopOpacity="0" /></linearGradient></defs>
        <path d={`${line}L${x(series.length - 1)},${SPARK_H}L${x(0)},${SPARK_H}Z`} fill={`url(#sp${id})`} />
        <polyline className="ty-chart-line" fill="none" points={series.map((s, i) => `${x(i)},${y(s.minor)}`).join(' ')} />
        <circle className="ty-chart-dot" cx={x(series.length - 1)} cy={y(vals[vals.length - 1]!)} r={4} />
        {series.map((s, i) => (
          <rect key={s.month} className="ty-chart-hit" x={x(i) - step / 2} y={0} width={step} height={SPARK_H} fill="transparent"
            tabIndex={0} role="img" aria-label={`${monthTitle(s.month)}: ${formatMinor(s.minor)}`}
            onPointerEnter={() => setAt(i)} onFocus={() => setAt(i)} onClick={() => setAt(i)} onBlur={() => setAt(undefined)}
            onPointerLeave={(e) => { if (e.pointerType === 'mouse') setAt(undefined); }}
            onKeyDown={(e) => { if (e.key === 'Escape') setAt(undefined); }} />
        ))}
      </svg>
      {tip && at !== undefined && (
        <div className="ty-chart-tip" role="tooltip" style={{ left: x(at), transform: `translateX(${at > series.length / 2 ? 'calc(-100% - 0.75rem)' : '0.75rem'})` }}>
          <div className="ty-chart-tip__title">{monthTitle(tip.month)}</div>
          <div className="ty-chart-tip__row"><span className="ty-chart-tip__val">{formatMinor(tip.minor)}</span><span className="ty-cap">Net worth</span></div>
        </div>
      )}
    </div>
  );
}

const Meter = ({ cls, pct, label }: { cls: string; pct: number; label: string }) => (
  <div className={cls} role="img" aria-label={label}><span style={{ width: `${pct}%` }} /></div>
);

const GOAL_PILL: Record<GoalStatus, [string, string]> = {
  done: ['ty-pill ty-pill--positive', 'Reached'], on_track: ['ty-pill ty-pill--positive', 'On track'],
  behind: ['ty-pill ty-pill--warning', 'Behind'], past: ['ty-pill ty-pill--warning', 'Date passed'],
};

const HomeCard = ({ title, all, children }: { title: string; all?: string; children: ReactNode }) => (
  <section className="ty-card ty-stack" aria-label={title}>
    <div className="ty-card__head"><h2 className="text-title">{title}</h2>{all && <Link className="ty-viewall" to={all}>View all</Link>}</div>
    {children}
  </section>
);

export default function HomePage() {
  const { user } = useAuth();
  const [asTable, setAsTable] = useState(false);
  const state = useLoad(async () => {
    const [home, s, p, src, plan] = await Promise.all([
      api<Home>('GET', '/home'),
      api<{ sections: Section[] }>('GET', '/sections'),
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
      api<{ sources: Source[] }>('GET', '/sources'),
      loadPlan(),
    ]);
    return { home, sections: s.sections, pockets: p.pockets, sources: src.sources, plan };
  }, []);

  return (
    <>
      <Topbar title="Home" />
      <Load state={state}>
        {({ home: h, sections, pockets, sources, plan }) => {
          const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, x] as const)));
          const pocketById = new Map(pockets.map((p) => [p.id, p]));
          const sourceName = new Map(sources.map((x) => [x.id, x.name]));
          const slotOf = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, s.colorSlot] as const)));
          const b = h.budget;
          const st = rowState(b.budgetedMinor, b.spentMinor);
          const ratio = b.budgetedMinor > 0 ? b.spentMinor / b.budgetedMinor : 0; // under 90%: positive, 90 to 100%: amber, over: negative
          const kept = h.cashflow.incomeMinor - h.cashflow.spendingMinor;
          const change = h.networth.changeMinor;
          const prev = monthName(shiftMonth(h.month, -1));
          return (
            <>
              {h.needsSorting > 0 && (
                <div className="ty-inset">
                  <span>{h.needsSorting} {h.needsSorting === 1 ? 'transaction needs' : 'transactions need'} sorting.</span>
                  <div><Link className="ty-link" to="/transactions?unsorted=1">Sort them</Link></div>
                </div>
              )}
              {typeof plan !== 'string' && <TransfersToMake plan={plan} pockets={pockets} sections={sections} sources={sources} />}
              <div className="ty-home">
                <HomeCard title={`${monthName(h.month)} so far`}>
                  <div className="ty-sumrow"><span className="num-lg">{formatMinor(b.spentMinor)} <span className="ty-cap">of {formatMinor(b.budgetedMinor)}</span></span></div>
                  <Meter cls={ratio > 1 ? 'ty-meter ty-meter--negative' : ratio >= 0.9 ? 'ty-meter ty-meter--caution' : 'ty-meter'} pct={st.pct} label={`${formatMinor(b.spentMinor)} spent of ${formatMinor(b.budgetedMinor)}`} />
                  <div className="ty-cap">{b.leftMinor < 0 ? `${formatMinor(-b.leftMinor)} over` : `${formatMinor(b.leftMinor)} left`}</div>
                  {b.overspent.length > 0 && (
                    <div className="ty-stack">
                      <span className="ty-label">Over budget</span>
                      {b.overspent.map((o) => {
                        const x = subs.get(o.subsectionId);
                        return <div key={o.subsectionId} className="ty-sumrow"><span><SubEmoji emoji={x?.emoji} />{x?.name}</span><span className="ty-pill ty-pill--negative">{formatMinor(o.overMinor)} over</span></div>;
                      })}
                    </div>
                  )}
                  <div><Link className="ty-link" to="/budget">Open the budget</Link></div>
                </HomeCard>

                <HomeCard title="Net worth" all="/pockets">
                  <div className="ty-inline"><span className="num-lg">{formatMinor(h.networth.minor)}</span>
                    <span className={change > 0 ? 'ty-pill ty-pill--positive' : change < 0 ? 'ty-pill ty-pill--negative' : 'ty-pill'}>{change > 0 ? '+' : ''}{formatMinor(change)} since {prev}</span>
                  </div>
                  {asTable ? (
                    <table className="ty-table">
                      <thead><tr><th>Month</th><th>Net worth</th></tr></thead>
                      <tbody>{h.networth.series.map((s) => <tr key={s.month}><td>{monthTitle(s.month)}</td><td>{formatMinor(s.minor)}</td></tr>)}</tbody>
                    </table>
                  ) : <Sparkline series={h.networth.series} />}
                  <div><button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setAsTable(!asTable)}>{asTable ? 'Show as chart' : 'Show as table'}</button></div>
                </HomeCard>

                <HomeCard title="Cash flow this month">
                  <div className="ty-sumrow"><span>Income</span><span className="ty-num">{formatMinor(h.cashflow.incomeMinor)}</span></div>
                  <div className="ty-sumrow"><span>Spending</span><span className="ty-num">{formatMinor(h.cashflow.spendingMinor)}</span></div>
                  <div className="ty-cap">{kept >= 0 ? 'Saved' : 'Overspent'} {formatMinor(Math.abs(kept))}</div>
                </HomeCard>

                <HomeCard title="Coming up" all="/recurring">
                  {h.upcoming.length === 0 ? <div className="ty-cap">No bills in the next 14 days.</div> : h.upcoming.map((u) => (
                    <div key={`${u.key}-${u.date}`} className="ty-sumrow"><span>{u.payee} <span className="ty-cap">{dayHeading(u.date)}</span></span><span className="ty-num">{formatMinor(-u.amountMinor)}</span></div>
                  ))}
                </HomeCard>

                <HomeCard title="Recent transactions" all="/transactions">
                  <div className="ty-rows">
                    {h.recent.map((t) => {
                      const sub = t.subsectionId === null ? undefined : subs.get(t.subsectionId);
                      const p = pocketById.get(t.pocketId);
                      const transfer = t.kind === 'transfer';
                      const code = p?.currency ?? baseCurrency(user);
                      const abroad = !transfer && code !== baseCurrency(user);
                      const income = t.kind === 'income';
                      const who = transfer ? `Moved to ${pocketById.get(t.toPocketId ?? 0)?.name ?? 'another pocket'}` : income ? (t.sourceId === null ? t.payee : sourceName.get(t.sourceId)) : t.payee;
                      return (
                        <div key={t.id} className="ty-trow ty-trow--av">
                          <TxAvatar title={who} sub={sub ? { emoji: sub.emoji, slot: slotOf.get(t.subsectionId ?? 0) ?? 0 } : undefined} split={!!t.splits} />
                          <div className="ty-trow__who">
                            <b>{who}</b>
                            <span className="ty-cap ty-trow__meta">{dayHeading(t.date)}{sub && <> · <SubEmoji emoji={sub.emoji} />{sub.name}</>}{p && <> · <span className="ty-emoji">{p.emoji}</span> {p.name}</>}</span>
                          </div>
                          <div className={income ? 'ty-num ty-right ty-num--pos' : 'ty-num ty-right'}>{income ? '+' : ''}{formatMinor(income ? t.amountMinor : -t.amountMinor)}{abroad ? ` ${code}` : ''}</div>
                        </div>
                      );
                    })}
                    {h.recent.length === 0 && <div className="ty-cap ty-rows__empty">No transactions yet.</div>}
                  </div>
                  <div><Link className="ty-link" to="/transactions">All transactions</Link></div>
                </HomeCard>

                {h.goals.length > 0 && (
                  <HomeCard title="Goals" all="/budget">
                    {h.goals.map((g) => {
                      const x = subs.get(g.subsectionId);
                      const pct = g.targetMinor > 0 ? Math.max(0, Math.min(100, Math.floor((g.savedMinor * 100) / g.targetMinor))) : 0;
                      const pill = g.goalStatus ? GOAL_PILL[g.goalStatus] : null;
                      return (
                        <div key={g.subsectionId} className="ty-stack">
                          <div className="ty-sumrow"><b><SubEmoji emoji={x?.emoji} />{x?.name}</b>{pill ? <span className={pill[0]}>{pill[1]}</span> : <span className="ty-pill">{pct}%</span>}</div>
                          <Meter cls="ty-meter ty-meter--goal" pct={pct} label={`${formatMinor(g.savedMinor)} saved of ${formatMinor(g.targetMinor)}`} />
                          <div className="ty-cap">{formatMinor(g.savedMinor)} of {formatMinor(g.targetMinor)}</div>
                        </div>
                      );
                    })}
                  </HomeCard>
                )}

                <HomeCard title="Age of money">
                  {h.ageOfMoneyDays === null ? <div className="ty-cap">Not enough history yet.</div> : (<>
                    <div className="num-lg">{h.ageOfMoneyDays} {h.ageOfMoneyDays === 1 ? 'day' : 'days'}</div>
                    <div className="ty-cap">How long your money waits between arriving and being spent.</div>
                  </>)}
                </HomeCard>
              </div>
            </>
          );
        }}
      </Load>
    </>
  );
}
