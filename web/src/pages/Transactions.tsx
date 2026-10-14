import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAutoSync } from '../bank';
import { api, useLoad, type Pocket, type Section, type Source, type Transaction } from '../api';
import { currentMonth, dayHeading, monthTitle, shiftMonth } from '../dates';
import { TransactionDialog } from '../dialogs';
import { ImportDialog } from '../import';
import { formatMinor } from '../money';
import { useAuth } from '../auth';
import { pick } from '../pick';
import { EmptyCard, Field, Load, SubsectionOptions, Topbar, useRescueFocus } from '../ui';

const MONTHS_BACK = 36;
const ORIGIN: Record<Transaction['source'], string> = { manual: 'entered by hand', import: 'from a statement', bank: 'from your bank', broker: 'from Trading212' };
const UNSORTED = 'unsorted'; // the Subsection filter's "Needs sorting" choice

export default function TransactionsPage() {
  const { user } = useAuth();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [subsectionId, setSubsectionId] = useState(params.get('unsorted') ? UNSORTED : '');
  const [pocketId, setPocketId] = useState('');
  const [dialog, setDialog] = useState<{ tx?: Transaction; importing?: boolean } | null>(null);
  const close = () => setDialog(null);
  useAutoSync();

  const state = useLoad(
    async () => {
      const unsorted = subsectionId === UNSORTED;
      const q = new URLSearchParams(unsorted ? { unsorted: '1' } : { month });
      if (subsectionId && !unsorted) q.set('subsectionId', subsectionId);
      if (pocketId) q.set('pocketId', pocketId);
      const [t, p, s, src, u] = await Promise.all([
        api<{ transactions: Transaction[] }>('GET', `/transactions?${q}`),
        api<{ pockets: Pocket[] }>('GET', '/pockets'),
        api<{ sections: Section[] }>('GET', '/sections'),
        api<{ sources: Source[] }>('GET', '/sources'),
        api<{ transactions: Transaction[] }>('GET', '/transactions?unsorted=1'),
      ]);
      return { transactions: t.transactions, pockets: p.pockets, sections: s.sections, sources: src.sources, unsortedCount: u.transactions.length };
    },
    [month, subsectionId, pocketId],
  );

  useRescueFocus(state.data ? state.data.transactions.length === 0 : undefined);

  // shortcut: the Month filter lists only the last 36 months; lift it when someone needs older history (derive the list from the oldest transaction).
  const months = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(now, -i));

  return (
    <>
      <Topbar title="Transactions" add={{ label: 'Add transaction', onClick: () => setDialog({}), spend: true }} />
      <header className="ty-month">
        <div className="ty-month__top ty-wide">
          <h1 className="text-display" style={{ margin: 0 }} tabIndex={-1}>Transactions</h1>
          <span className="ty-grow" />
          <button className="ty-btn" onClick={() => setDialog({ importing: true })}>Import a statement</button>
          <button className="ty-btn ty-btn--spend" onClick={() => setDialog({})}>Add transaction</button>
        </div>
        <Link className="ty-btn ty-month__add" to="/recurring">Recurring</Link>
        <button className="ty-btn ty-month__add" onClick={() => navigate('/reports')}>Reports</button>
      </header>
      <div><button className="app-phone-only ty-btn" onClick={() => setDialog({ importing: true })}>Import a statement</button></div>
      <div className="app-filters">
        <Field label="Month">
          {(p) => (
            <select {...p} value={month} disabled={subsectionId === UNSORTED} onChange={(e) => setMonth(e.target.value)}>
              {months.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
            </select>
          )}
        </Field>
        <Field label="Subsection">
          {(p) => (
            <select {...p} value={subsectionId} onChange={(e) => setSubsectionId(e.target.value)}>
              <option value="">All subsections</option>
              {state.data && (state.data.unsortedCount > 0 || subsectionId === UNSORTED) && <option value={UNSORTED}>Needs sorting ({state.data.unsortedCount})</option>}
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
        {({ transactions, pockets, sections, sources }) => {
          const unsortedView = subsectionId === UNSORTED;
          const sourceName = new Map(sources.map((x) => [x.id, x.name]));
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
                <EmptyCard text={unsortedView ? 'Nothing needs sorting.' : `No transactions in ${monthTitle(month)}.`} action="Add transaction" onAction={() => setDialog({})} />
              ) : (
                <section className="ty-section" aria-label="Transactions">
                  {days.map(([date, list]) => (
                    <div key={date}>
                      <div className="ty-day ty-label">{dayHeading(date)}</div>
                      {list.map((t) => {
                        const sub = t.subsectionId === null ? undefined : subs.get(t.subsectionId);
                        const transfer = t.kind === 'transfer';
                        const imported = t.source !== 'manual';
                        const unsorted = imported && (t.kind === 'income' ? t.sourceId === null : t.subsectionId === null);
                        const where = unsorted ? '' : sub?.name ?? (transfer ? '' : 'Income');
                        const p = pocketById.get(t.pocketId);
                        const pocket = p && <><span className="ty-emoji">{p.emoji}</span> {p.name}</>;
                        const code = p?.currency ?? user.baseCurrency;
                        const to = t.toPocketId === null ? undefined : pocketById.get(t.toPocketId);
                        const moved = to && to.currency !== code
                          ? `Transfer · ${formatMinor(t.amountMinor)} ${code} became ${formatMinor(t.toAmountMinor ?? 0)} ${to.currency} at ${(Number(t.toAmountMinor) / t.amountMinor).toFixed(4)}`
                          : `Transfer · ${formatMinor(t.amountMinor)} ${code}`;
                        const abroad = !transfer && code !== user.baseCurrency;
                        const amount = abroad
                          ? <div className="ty-right"><div className={`ty-num${t.kind === 'income' ? ' ty-num--pos' : ''}`}>{t.kind === 'income' ? '+' : ''}{formatMinor(t.kind === 'income' ? t.amountMinor : -t.amountMinor)} {code}</div><div className="ty-cap">≈ {formatMinor(t.baseAmountMinor)} {user.baseCurrency}</div></div>
                          : transfer ? <div className="ty-num ty-right">{formatMinor(-t.amountMinor)}</div>
                          : t.kind === 'income'
                            ? <div className="ty-num ty-right ty-num--pos">+{formatMinor(t.amountMinor)}</div>
                            : <div className="ty-num ty-right">{formatMinor(-t.amountMinor)}</div>;
                        return (
                          <div key={t.id} className="ty-trow app-pick" {...pick(() => setDialog({ tx: t }))}>
                            <div className="ty-trow__who">
                              <b>{transfer ? `Moved to ${to?.name ?? 'another pocket'}` : t.kind === 'income' ? (t.sourceId === null ? t.payee : sourceName.get(t.sourceId)) : t.payee}</b>
                              <span className="ty-cap">{transfer ? moved : `${t.kind === 'income' ? 'Income · ' : ''}${t.kind === 'income' ? ORIGIN[t.source] : ORIGIN[t.source][0].toUpperCase() + ORIGIN[t.source].slice(1)}`}</span>
                              <span className="ty-cap ty-trow__meta">{unsorted ? <><span className="ty-pill ty-pill--warning">Needs sorting</span> · {pocket}</> : t.kind === 'income' ? pocket : <>{where && `${where} · `}{pocket}</>}</span>
                            </div>
                            <div className="ty-tag ty-wide">
                              {unsorted ? <span className="ty-pill ty-pill--warning">Needs sorting</span> : where && <><span className={sub && sub.slot >= 1 ? `ty-dot ty-dot--${sub.slot}` : 'ty-dot'} />{where}</>}
                            </div>
                            <div className="ty-wide">{pocket}</div>
                            {amount}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </section>
              )}
              {dialog?.importing && <ImportDialog pockets={pockets} onClose={close} />}
              {dialog && !dialog.importing && <TransactionDialog tx={dialog.tx} pockets={pockets} sections={sections} sources={sources} currency={user.baseCurrency} onClose={close} />}
            </>
          );
        }}
      </Load>
    </>
  );
}
