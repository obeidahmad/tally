import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useLoad, type Budget, type BudgetSection, type BudgetSubsection, type Pocket, type Section } from '../api';
import { currentMonth, isMonth, monthTitle, shiftMonth } from '../dates';
import { SectionDialog, SubsectionDialog, TransactionDialog } from '../dialogs';
import { formatMinor, percentText } from '../money';
import { useAuth } from '../auth';
import { EmptyCard, Load, Topbar, useRescueFocus } from '../ui';
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
  | { t: 'sub'; sectionId: number; sub?: BudgetSubsection };

function Row({ sub, onOpen }: { sub: BudgetSubsection; onOpen: () => void }) {
  const s = rowState(sub.budgetMinor, sub.spentMinor);
  const summary = `${formatMinor(sub.spentMinor)} of ${formatMinor(sub.budgetMinor)} spent`;
  return (
    <div className="ty-brow app-pick" {...pick(onOpen)}>
      <div className="ty-brow__name">
        <div className="ty-brow__title"><span>{sub.name}</span></div>
        <div className={s.meter} role="img" aria-label={summary}><span style={{ width: `${s.pct}%` }} /></div>
        <div className="ty-cap ty-brow__sub">{summary}</div>
      </div>
      <div className="ty-num ty-right ty-wide">{formatMinor(sub.budgetMinor)}</div>
      <div className="ty-num ty-right ty-wide">{formatMinor(sub.spentMinor)}</div>
      <div className="ty-right"><span className={s.pill}>{s.text}</span></div>
    </div>
  );
}

export default function BudgetPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const now = currentMonth();
  const asked = params.get('month');
  const month = isMonth(asked) ? asked : now;
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const close = () => setDialog(null);
  const go = (m: string) => setParams(m === now ? {} : { month: m });

  const state = useLoad(
    async () => {
      const [budget, p, s] = await Promise.all([
        api<Budget>('GET', `/budget?month=${month}`),
        api<{ pockets: Pocket[] }>('GET', '/pockets'),
        api<{ sections: Section[] }>('GET', '/sections'),
      ]);
      return { budget, pockets: p.pockets, sections: s.sections };
    },
    [month],
  );

  useRescueFocus(state.data ? state.data.budget.sections.length === 0 : undefined);

  return (
    <>
      <Topbar
        title={monthTitle(month)}
        month={{ onPrev: () => go(shiftMonth(month, -1)), onNext: () => go(shiftMonth(month, 1)), nextDisabled: month >= now }}
        add={{ label: 'Add transaction', onClick: () => setDialog({ t: 'tx' }), spend: true }}
      />
      <header className="ty-month">
        <div className="ty-month__top ty-wide">
          <button className="ty-btn ty-btn--icon" aria-label="Previous month" onClick={() => go(shiftMonth(month, -1))}>‹</button>
          <h1 className="text-display" style={{ margin: 0 }} tabIndex={-1}>{monthTitle(month)}</h1>
          <button className="ty-btn ty-btn--icon" aria-label="Next month" disabled={month >= now} onClick={() => go(shiftMonth(month, 1))}>›</button>
          <span className="ty-grow" />
          <button className="ty-btn ty-btn--income ty-wide" onClick={() => setDialog({ t: 'tx', kind: 'income' })}>Add income</button>
          <button className="ty-btn ty-btn--spend" onClick={() => setDialog({ t: 'tx' })}>Add transaction</button>
        </div>
        {state.data && (<>
          <div className="ty-stats">
            <div className="ty-stat"><span className="ty-label">Income</span><span className="num-lg">{formatMinor(state.data.budget.totals.incomeMinor)}</span></div>
            <div className="ty-stat"><span className="ty-label">Budgeted</span><span className="num-lg">{formatMinor(state.data.budget.totals.budgetedMinor)}</span></div>
            <div className="ty-stat"><span className="ty-label">Spent so far</span><span className="num-lg">{formatMinor(state.data.budget.totals.spentMinor)}</span></div>
          </div>
          <button className="ty-btn ty-btn--income ty-month__add" onClick={() => setDialog({ t: 'tx', kind: 'income' })}>Add income</button>
        </>)}
      </header>
      <Load state={state}>
        {({ budget, pockets, sections }) => (
          <>
            {budget.sections.length === 0 ? (
              <EmptyCard text="No sections yet. A section is a group such as Needs or Savings." action="Add section" onAction={() => setDialog({ t: 'section' })} />
            ) : (
              <div className="ty-stack">
                {budget.sections.map((sec) => (
                  <section key={sec.id} className="ty-section" aria-label={sec.name}>
                    <div className="ty-shead">
                      <div className="ty-shead__name">
                        <span className={dot(sec.colorSlot)} /><b>{sec.name}</b>
                        <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setDialog({ t: 'section', section: sec })}>Edit</button>
                        {sec.budgetKind !== 'subsections' && (<>
                          <span className={sec.restMinor < 0 ? 'ty-pill ty-pill--warning' : 'ty-pill'}>Rest {formatMinor(sec.restMinor)}</span>
                          <span className="ty-cap">{sec.budgetKind === 'fixed' ? 'Fixed amount' : `${percentText(sec.budgetBasisPoints!)}% of income after fixed sections`}</span>
                        </>)}
                        <span className="ty-cap ty-shead__sub">{formatMinor(sec.spentMinor)} of {formatMinor(sec.budgetedMinor)} spent</span>
                      </div>
                      <div className="ty-shead__tot ty-wide"><span className="ty-label">Budgeted</span><span className="ty-num">{formatMinor(sec.budgetedMinor)}</span></div>
                      <div className="ty-shead__tot ty-wide"><span className="ty-label">Spent</span><span className="ty-num">{formatMinor(sec.spentMinor)}</span></div>
                      <div className="ty-shead__tot"><span className="ty-label">Available</span><span className="ty-num">{formatMinor(sec.availableMinor)}</span></div>
                    </div>
                    {sec.subsections.map((sub) => (
                      <Row key={sub.id} sub={sub} onOpen={() => setDialog({ t: 'sub', sectionId: sec.id, sub })} />
                    ))}
                    <div className="ty-section__add">
                      <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setDialog({ t: 'sub', sectionId: sec.id })}>Add subsection</button>
                    </div>
                  </section>
                ))}
                <div><button className="ty-btn" onClick={() => setDialog({ t: 'section' })}>Add section</button></div>
              </div>
            )}
            {dialog?.t === 'tx' && <TransactionDialog kind={dialog.kind} pockets={pockets} sections={sections} currency={user.baseCurrency} onClose={close} />}
          </>
        )}
      </Load>
      {dialog?.t === 'section' && <SectionDialog section={dialog.section} currency={user.baseCurrency} onClose={close} />}
      {dialog?.t === 'sub' && <SubsectionDialog sectionId={dialog.sectionId} sub={dialog.sub} currency={user.baseCurrency} onClose={close} />}
    </>
  );
}
