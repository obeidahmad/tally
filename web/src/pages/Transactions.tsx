import { useState } from 'react';
import { api, useLoad, type Pocket, type Section, type Transaction } from '../api';
import { currentMonth, dayHeading, monthTitle, shiftMonth } from '../dates';
import { TransactionDialog } from '../dialogs';
import { formatMinor } from '../money';
import { useAuth } from '../auth';
import { pick } from '../pick';
import { EmptyCard, Field, Load, SubsectionOptions, Topbar, useRescueFocus } from '../ui';

const MONTHS_BACK = 36;

export default function TransactionsPage() {
  const { user } = useAuth();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const [subsectionId, setSubsectionId] = useState('');
  const [pocketId, setPocketId] = useState('');
  const [dialog, setDialog] = useState<{ tx?: Transaction } | null>(null);
  const close = () => setDialog(null);

  const state = useLoad(
    async () => {
      const q = new URLSearchParams({ month });
      if (subsectionId) q.set('subsectionId', subsectionId);
      if (pocketId) q.set('pocketId', pocketId);
      const [t, p, s] = await Promise.all([
        api<{ transactions: Transaction[] }>('GET', `/transactions?${q}`),
        api<{ pockets: Pocket[] }>('GET', '/pockets'),
        api<{ sections: Section[] }>('GET', '/sections'),
      ]);
      return { transactions: t.transactions, pockets: p.pockets, sections: s.sections };
    },
    [month, subsectionId, pocketId],
  );

  useRescueFocus(state.data ? state.data.transactions.length === 0 : undefined);

  // shortcut: the Month filter lists only the last 36 months; lift it when someone needs older history (derive the list from the oldest transaction).
  const months = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(now, -i));

  return (
    <>
      <Topbar title="Transactions" add={{ label: 'Add transaction', onClick: () => setDialog({}), spend: true }} />
      <header className="ty-month__top ty-wide">
        <h1 className="text-display" style={{ margin: 0 }} tabIndex={-1}>Transactions</h1>
        <span className="ty-grow" />
        <button className="ty-btn ty-btn--spend" onClick={() => setDialog({})}>Add transaction</button>
      </header>
      <div className="app-filters">
        <Field label="Month">
          {(p) => (
            <select {...p} value={month} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Subsection">
          {(p) => (
            <select {...p} value={subsectionId} onChange={(e) => setSubsectionId(e.target.value)}>
              <option value="">All subsections</option>
              {state.data && <SubsectionOptions sections={state.data.sections} />}
            </select>
          )}
        </Field>
        <Field label="Pocket">
          {(p) => (
            <select {...p} value={pocketId} onChange={(e) => setPocketId(e.target.value)}>
              <option value="">All pockets</option>
              {state.data?.pockets.map((x) => <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>)}
            </select>
          )}
        </Field>
      </div>
      <Load state={state}>
        {({ transactions, pockets, sections }) => {
          const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, slot: s.colorSlot }] as const)));
          const pocketById = new Map(pockets.map((p) => [p.id, p]));
          const days: [string, Transaction[]][] = [];
          for (const t of transactions) {
            if (days.at(-1)?.[0] === t.date) days.at(-1)![1].push(t);
            else days.push([t.date, [t]]);
          }
          return (
            <>
              {transactions.length === 0 ? (
                <EmptyCard text={`No transactions in ${monthTitle(month)}.`} action="Add transaction" onAction={() => setDialog({})} />
              ) : (
                <section className="ty-section" aria-label="Transactions">
                  {days.map(([date, list]) => (
                    <div key={date}>
                      <div className="ty-day ty-label">{dayHeading(date)}</div>
                      {list.map((t) => {
                        const sub = t.subsectionId === null ? undefined : subs.get(t.subsectionId);
                        const where = sub?.name ?? 'Income';
                        const p = pocketById.get(t.pocketId);
                        const pocket = p && <><span className="ty-emoji">{p.emoji}</span> {p.name}</>;
                        return (
                          <div key={t.id} className="ty-trow app-pick" {...pick(() => setDialog({ tx: t }))}>
                            <div className="ty-trow__who">
                              <b>{t.payee}</b>
                              <span className="ty-cap">{t.kind === 'income' ? 'Income · entered by hand' : 'Entered by hand'}</span>
                              <span className="ty-cap ty-trow__meta">{t.kind === 'income' ? pocket : <>{where} · {pocket}</>}</span>
                            </div>
                            <div className="ty-tag ty-wide">
                              <span className={sub && sub.slot >= 1 ? `ty-dot ty-dot--${sub.slot}` : 'ty-dot'} />{where}
                            </div>
                            <div className="ty-wide">{pocket}</div>
                            {t.kind === 'income'
                              ? <div className="ty-num ty-right ty-num--pos">+{formatMinor(t.amountMinor)}</div>
                              : <div className="ty-num ty-right">{formatMinor(-t.amountMinor)}</div>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </section>
              )}
              {dialog && <TransactionDialog tx={dialog.tx} pockets={pockets} sections={sections} currency={user.baseCurrency} onClose={close} />}
            </>
          );
        }}
      </Load>
    </>
  );
}
