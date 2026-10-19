import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { EndingNotice, loadConnections } from '../bank';
import { api, ApiError, useLoad, type Budget, type Holding, type Rates, type BudgetSection, type BudgetSubsection, type End, type Move, type Months, type Pocket, type RestRule, type Section, type Source } from '../api';
import { currentMonth, isMonth, monthName, monthTitle, shiftMonth } from '../dates';
import { CloseDialog, endKey, MoveDialog, SectionDialog, SubsectionDialog, TransactionDialog } from '../dialogs';
import { formatMinor, percentText } from '../money';
import { baseCurrency, useAuth } from '../auth';
import { EmptyCard, Load, StatePill, SubEmoji, subLabel, TopButton, Topbar, useRescueFocus, useToast } from '../ui';
import { pick } from '../pick';

/** Pill and meter state for one subsection, from whole minor units. */
export function rowState(budget: number, spent: number) {
  const left = budget - spent;
  const pct = budget > 0 ? Math.min(100, Math.floor((spent * 100) / budget)) : 0;
  if (left < 0) return { pill: 'ty-pill ty-pill--negative', text: `${formatMinor(left)} over`, meter: 'ty-meter ty-meter--negative', pct: 100 };
  if (left === 0) return { pill: 'ty-pill', text: '0.00 left', meter: 'ty-meter', pct };
  if (spent * 10 > budget * 9) return { pill: 'ty-pill ty-pill--warning', text: `${formatMinor(left)} left`, meter: 'ty-meter ty-meter--warning', pct };
  return { pill: 'ty-pill ty-pill--positive', text: formatMinor(left), meter: 'ty-meter', pct };
}

const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');

type Dialog =
  | { t: 'tx'; kind?: 'income' } | { t: 'section'; section?: BudgetSection }
  | { t: 'sub'; sectionId: number; sub?: BudgetSubsection; position?: number; count: number; held?: string } | { t: 'close' } | { t: 'move'; from: End };

const dash = (n: number) => (n === 0 ? '—' : formatMinor(n));
const sum = (sec: BudgetSection, k: 'budgetMinor' | 'spentMinor' | 'availableMinor' | 'carriedMinor') => sec.subsections.reduce((t, x) => t + x[k], 0);

const COLLAPSED = 'tally.collapsed';
function loadCollapsed(): number[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(COLLAPSED) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : [];
  } catch { return []; }
}

/** "60% to Savings, 40% to next month's income", "kept in Needs" */
function restRule(rule: RestRule | undefined, id: number, names: Map<number, string>) {
  return (rule?.shares ?? []).map((x) => {
    const to = x.sectionId === null ? "to next month's income" : x.sectionId === id ? `kept in ${names.get(id)}` : `to ${names.get(x.sectionId)}`;
    return x.basisPoints < 10000 ? `${percentText(x.basisPoints)}% ${to}` : to;
  }).join(', ');
}

function Row({ sub, from, held, onOpen }: { sub: BudgetSubsection; from: string; held?: string; onOpen?: () => void }) {
  const isGoal = sub.kind === 'goal';
  const target = sub.capMinor ?? 0;
  const carried = sub.carriedMinor ?? 0;
  const moved = sub.movedMinor ?? 0;
  const left = sub.budgetMinor + carried + moved - sub.spentMinor;
  const s = rowState(sub.budgetMinor + carried + moved, sub.spentMinor);
  const say = left < 0 ? `${formatMinor(-left)} over` : `${formatMinor(left)} left`;
  const saved = sub.availableMinor;
  const pct = target > 0 ? Math.floor((saved * 100) / target) : 0;
  const by = isGoal && sub.targetMonth ? `${monthName(sub.targetMonth).slice(0, 3)} ${sub.targetMonth.slice(0, 4)}` : '';
  const behind = sub.goalStatus === 'behind';
  const rule = isGoal ? (by ? `${formatMinor(target)} by ${by}` : `Goal ${formatMinor(target)} · ${pct}%`)
    : sub.budgetKind === 'percent' && sub.budgetBasisPoints !== null ? `${percentText(sub.budgetBasisPoints)}%` : 'Fixed';
  // the longer rule: the cell's title
  const title = [
    sub.budgetKind === 'percent' && sub.budgetBasisPoints !== null && `${percentText(sub.budgetBasisPoints)}% of what is left`,
    !isGoal && sub.keep === 'cap' && `rolls over up to ${formatMinor(target)}`,
    !isGoal && sub.keep === 'none' && 'does not roll over',
    isGoal && `fills to ${formatMinor(target)}`,
    isGoal && by && `${pct}% saved`,
    carried !== 0 && `${carried > 0 ? '+' : ''}${formatMinor(carried)} from ${from}`,
    held,
  ].filter(Boolean).join(' · ');
  return (
    <div className={onOpen ? 'ty-btable__row app-pick' : 'ty-btable__row'} {...(onOpen ? pick(onOpen) : {})}>
      <div className="ty-btable__name"><span className="ty-btable__text"><SubEmoji emoji={sub.emoji} />{sub.name}</span></div>
      <div className="ty-btable__rule ty-x" title={title}>{rule}</div>
      <div className="ty-num ty-right ty-x">{dash(carried)}</div>
      <div className="ty-num ty-right ty-x ty-m">{dash(moved)}</div>
      <div className={behind ? 'ty-num ty-right ty-x ty-warn' : 'ty-num ty-right ty-x'} title={behind ? `Needs ${formatMinor(sub.neededMinor ?? 0)} a month to reach ${formatMinor(target)} by ${by}` : undefined}>{formatMinor(sub.budgetMinor)}</div>
      <div className="ty-num ty-right">{formatMinor(sub.spentMinor)}</div>
      <div className="ty-right">{sub.goalStatus === 'done' ? <span className="ty-pill ty-pill--positive">Reached</span> : sub.goalStatus === 'past' ? <span className="ty-pill ty-pill--warning">Date passed</span> : isGoal ? <span className="ty-pill">{formatMinor(saved)}</span> : <span className={s.pill} role="img" aria-label={say} title={say}>{formatMinor(left)}</span>}</div>
    </div>
  );
}

function MovedCard({ moves, sections, closed }: { moves: Move[]; sections: BudgetSection[]; closed: boolean }) {
  const names = new Map(sections.flatMap((s) => [[`r${s.id}`, `Rest of ${s.name}`], ...s.subsections.map((x) => [`s${x.id}`, subLabel(x)])] as [string, string][]));
  return (
    <section className="ty-card ty-stack" aria-label="Moved this month">
      <h2 className="text-title" style={{ margin: 0 }}>Moved this month</h2>
      {moves.map((m) => (
        <div key={m.id} className="app-move">
          <div>
            <div>{formatMinor(m.amountMinor)} from {names.get(endKey(m.from))} to {names.get(endKey(m.to))}</div>
            <div className="ty-cap">{m.reason}</div>
          </div>
          {!closed && <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => void api('DELETE', `/moves/${m.id}`).catch(() => {})}>Undo</button>}
        </div>
      ))}
    </section>
  );
}

export default function BudgetPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const now = currentMonth();
  const asked = params.get('month');
  const month = isMonth(asked) ? asked : now;
  const toast = useToast();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [reopenError, setReopenError] = useState('');
  const close = () => setDialog(null);
  const go = (m: string) => setParams(m === now ? {} : { month: m });

  const state = useLoad(
    async () => {
      const [budget, months, p, s, src, mv, h, r, connections] = await Promise.all([
        api<Budget>('GET', `/budget?month=${month}`),
        api<Months>('GET', '/months'),
        api<{ pockets: Pocket[] }>('GET', '/pockets'),
        api<{ sections: Section[] }>('GET', '/sections'),
        api<{ sources: Source[] }>('GET', '/sources'),
        api<{ moves: Move[] }>('GET', `/moves?month=${month}`),
        api<{ holdings: Holding[] }>('GET', '/holdings'),
        api<Rates>('GET', '/rates'),
        loadConnections(),
      ]);
      return { budget, months, pockets: p.pockets, sections: s.sections, sources: src.sources, moves: mv.moves, holdings: h.holdings.filter((x) => !x.soldDate), rates: r, connections };
    },
    [month],
  );

  useRescueFocus(state.data ? state.data.budget.sections.length === 0 : undefined);

  const [collapsed, setCollapsed] = useState(loadCollapsed);
  const toggle = (id: number) => setCollapsed((c) => {
    const next = c.includes(id) ? c.filter((x) => x !== id) : [...c, id];
    try { localStorage.setItem(COLLAPSED, JSON.stringify(next)); } catch { /* private window: it just will not be remembered */ }
    return next;
  });

  const toClose = state.data?.months.toClose;
  const closeNote = toClose && (
    <div className="ty-inset">
      <span>{monthTitle(toClose)} has ended. Close it to carry what is left into {monthName(shiftMonth(toClose, 1))}.</span>
      <div><button className="ty-btn ty-btn--sm" onClick={() => setDialog({ t: 'close' })}>Close {monthName(toClose)}</button></div>
    </div>
  );
  const open = state.data && !state.data.budget.closed;

  return (
    <>
      <Topbar
        title="Budget"
        month={{ label: monthTitle(month), onPrev: () => go(shiftMonth(month, -1)), onNext: () => go(shiftMonth(month, 1)), nextDisabled: month >= now }}
        actions={state.data && (<>
          <span className="ty-wide"><StatePill closed={state.data.budget.closed} /></span>
          {open && <TopButton label="Add income" wide onClick={() => setDialog({ t: 'tx', kind: 'income' })} />}
          {open && <TopButton label="Add transaction" primary onClick={() => setDialog({ t: 'tx' })} />}
        </>)}
      />
      {state.data && (<>
        {state.data.budget.closed && (
          <div className="ty-inset">
            <span>{monthTitle(month)} is closed.</span>
            {state.data.months.lastClosed === month && (
              <div>
                <button className="ty-btn ty-btn--sm" onClick={() => {
                  setReopenError('');
                  api('POST', `/months/${month}/reopen`).then(() => toast(`${monthTitle(month)} reopened`), (e) => setReopenError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'));
                }}>Reopen</button>
                {reopenError && <span className="ty-error" role="alert"> {reopenError}</span>}
              </div>
            )}
          </div>
        )}
        {closeNote}
        {state.data.budget.unsortedCount > 0 && (
          <div className="ty-inset">
            <span>{state.data.budget.unsortedCount} imported {state.data.budget.unsortedCount === 1 ? 'transaction needs' : 'transactions need'} a subsection or source.</span>
            <div><Link className="ty-link" to="/transactions?unsorted=1">Sort them</Link></div>
          </div>
        )}
        {state.data.connections.map((c) => <EndingNotice key={c.id} connection={c} />)}
        <div className="ty-statcards">
          <div className="ty-statcard"><span className="ty-statcard__num ty-statcard__num--pos">{formatMinor(state.data.budget.totals.incomeMinor)}</span><span className="ty-label">Income</span></div>
          <div className="ty-statcard"><span className="ty-statcard__num">{formatMinor(state.data.budget.totals.budgetedMinor)}</span><span className="ty-label">Budgeted</span></div>
          <div className="ty-statcard"><span className="ty-statcard__num ty-statcard__num--neg">{formatMinor(state.data.budget.totals.spentMinor)}</span><span className="ty-label">Spent</span></div>
          <div className="ty-statcard"><span className="ty-statcard__num">{formatMinor(state.data.budget.totals.leftOverMinor)}</span><span className="ty-label">Left over</span></div>
        </div>
        {open && <div className="app-phone-block"><button className="ty-btn app-full" onClick={() => setDialog({ t: 'tx', kind: 'income' })}>Add income</button></div>}
      </>)}
      <Load state={state}>
        {({ budget, months, pockets, sections, sources, moves, holdings, rates }) => {
          // in the base currency at today's rate (the rates are units per 1 base)
          const perBase = (c: string) => (c === baseCurrency(user) ? 1 : Number(rates.currencies.find((x) => x.currency === c)?.rate));
          const heldNote = (id: number) => {
            const hs = holdings.filter((x) => x.subsectionId === id);
            if (hs.length === 0) return undefined;
            const cur = (pid: number) => pockets.find((p) => p.id === pid)?.currency ?? baseCurrency(user);
            const paid = hs.reduce((t, x) => t + x.paidMinor / perBase(cur(x.pocketId)), 0);
            const worth = hs.reduce((t, x) => t + x.worthMinor / perBase(x.worthCurrency), 0);
            return Number.isFinite(paid + worth) ? `paid ${formatMinor(Math.round(paid))} · worth ${formatMinor(Math.round(worth))}` : undefined;
          };
          const names = new Map(sections.map((s) => [s.id, s.name]));
          const movedCard = moves.length > 0 && <MovedCard moves={moves} sections={budget.sections} closed={budget.closed} />;
          const short = budget.sections.flatMap((s) => s.subsections).filter((x) => x.goalStatus === 'behind' || x.goalStatus === 'past')
            .map((x) => ({ x, over: Math.max(0, (x.neededMinor ?? 0) - x.budgetMinor) })).filter((g) => g.over > 0);
          const goalsNote = budget.underfundedMinor > 0 && (
            <div className="ty-stack" aria-label="Goals behind">
              <div>Goals need {formatMinor(budget.underfundedMinor)} more this month</div>
              {short.map(({ x, over }) => <div key={x.id} className="ty-sumrow ty-cap"><span><SubEmoji emoji={x.emoji} />{x.name}</span><span className="ty-num">{formatMinor(over)}</span></div>)}
            </div>
          );
          const leftOver = budget.totals.leftOverMinor > 0 && (
            <div className="ty-cap ty-wide">
              {formatMinor(budget.totals.leftOverMinor)} is left over: no step in the pipeline takes it.{' '}
              <Link className="ty-link" to={month === now ? '/pipeline' : `/pipeline?month=${month}`}>Open the pipeline</Link>
            </div>
          );
          const hasAside = leftOver || goalsNote || movedCard;
          return (
          <>
            <div className={hasAside ? 'ty-budget' : undefined}>
              <div className="ty-budget__main">
                {budget.sections.length === 0 ? (
                  <EmptyCard text="No sections yet. A section is a group such as Needs or Savings." action="Add section" onAction={() => setDialog({ t: 'section' })} />
                ) : (<>
                  <div className={moves.length > 0 ? 'ty-btable ty-btable--moved' : 'ty-btable'}>
                    <div className="ty-btable__head ty-label">
                      <span>Subsection</span><span className="ty-x">Rule</span><span className="ty-x ty-right" title="From last month">Carried</span><span className="ty-x ty-m ty-right">Moved</span>
                      <span className="ty-x ty-right">Budgeted</span><span className="ty-right">Spent</span><span className="ty-right">Available</span>
                    </div>
                    {budget.sections.map((sec) => {
                      const open = !collapsed.includes(sec.id);
                      const rest = restRule(sections.find((s) => s.id === sec.id)?.rest, sec.id, names);
                      return (
                        <section key={sec.id} className="ty-btable__sect" aria-label={sec.name}>
                          <div className="ty-btable__sec">
                            <div className="ty-btable__name">
                              <button className="ty-chev" aria-expanded={open} aria-label={`${sec.name} subsections`} onClick={() => toggle(sec.id)} />
                              <span className={dot(sec.colorSlot)} /><b className="text-heading ty-btable__text">{sec.name}</b>
                              {!budget.closed && (<>
                                <button className="ty-btn ty-btn--quiet ty-btn--sm ty-btn--icon" aria-label={`Edit ${sec.name}`} title={`Edit ${sec.name}`} onClick={() => setDialog({ t: 'section', section: sec })}>✎</button>
                                <button className="ty-btn ty-btn--quiet ty-btn--sm ty-btn--icon" aria-label={`Add subsection to ${sec.name}`} title={`Add subsection to ${sec.name}`} onClick={() => setDialog({ t: 'sub', sectionId: sec.id, count: sec.subsections.length })}>+</button>
                              </>)}
                            </div>
                            <span className="ty-x" />
                            <span className="ty-num ty-right ty-x">{dash(sum(sec, 'carriedMinor'))}</span>
                            <span className="ty-num ty-right ty-x ty-m">{dash(sec.movedMinor ?? 0)}</span>
                            <span className="ty-num ty-right ty-x">{formatMinor(sec.budgetedMinor)}</span>
                            <span className="ty-num ty-right ty-sp">{formatMinor(sum(sec, 'spentMinor'))}</span>
                            <span className="ty-num ty-right">{formatMinor(sec.availableMinor)}</span>
                          </div>
                          {open && (<>
                            {sec.subsections.map((sub, i) => (
                              <Row key={sub.id} sub={sub} from={monthName(shiftMonth(month, -1))} held={heldNote(sub.id)} onOpen={budget.closed ? undefined : () => setDialog({ t: 'sub', sectionId: sec.id, sub, position: i + 1, count: sec.subsections.length, held: heldNote(sub.id) })} />
                            ))}
                            <div className="ty-btable__row">
                              <div className="ty-btable__name"><span className="ty-btable__text">Rest</span></div>
                              <div className="ty-btable__rule ty-x" title={rest}>{rest}</div>
                              <span className="ty-x" /><span className="ty-x ty-m" /><span className="ty-x" /><span />
                              <div className="ty-right"><span className={sec.restMinor < 0 ? 'ty-pill ty-pill--negative' : sec.restMinor > 0 ? 'ty-pill ty-pill--positive' : 'ty-pill'}>{formatMinor(sec.restMinor)}</span></div>
                            </div>
                          </>)}
                        </section>
                      );
                    })}
                  </div>
                  <div><button className="ty-btn" onClick={() => setDialog({ t: 'section' })}>Add section</button></div>
                </>)}
              </div>
              {hasAside && (
                <aside className="ty-budget__aside">
                  {(leftOver || goalsNote) && <section className="ty-card ty-stack" aria-label="Month summary">{leftOver}{goalsNote}</section>}
                  {movedCard}
                </aside>
              )}
            </div>
            {dialog?.t === 'close' && months.toClose && <CloseDialog month={months.toClose} sections={budget.sections} onClose={close} />}
            {dialog?.t === 'move' && <MoveDialog month={month} sections={budget.sections} from={dialog.from} currency={baseCurrency(user)} onClose={close} />}
            {dialog?.t === 'tx' && <TransactionDialog kind={dialog.kind} pockets={pockets} sections={sections} sources={sources} currency={baseCurrency(user)} onClose={close} />}
          </>
          );
        }}
      </Load>
      {dialog?.t === 'section' && <SectionDialog section={dialog.section} onMove={() => setDialog({ t: 'move', from: { sectionId: dialog.section!.id } })} onClose={close} />}
      {dialog?.t === 'sub' && <SubsectionDialog sectionId={dialog.sectionId} sub={dialog.sub} position={dialog.position} count={dialog.count} held={dialog.held} currency={baseCurrency(user)} onMove={() => setDialog({ t: 'move', from: { subsectionId: dialog.sub!.id } })} onClose={close} />}
    </>
  );
}
