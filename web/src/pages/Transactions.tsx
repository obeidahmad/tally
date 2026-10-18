import { useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAutoSync } from '../bank';
import { api, useLoad, type Pocket, type Section, type Source, type Transaction } from '../api';
import { BulkDialog, type BulkAction } from '../bulk';
import { currentMonth, dayLabel, monthTitle, shiftMonth } from '../dates';
import { TransactionDialog } from '../dialogs';
import { ImportDialog } from '../import';
import { formatMinor } from '../money';
import { baseCurrency, useAuth } from '../auth';
import { pick } from '../pick';
import { EmptyCard, Field, Load, SubEmoji, SubsectionOptions, Topbar, useRescueFocus } from '../ui';

const MONTHS_BACK = 36;
const ORIGIN: Record<Transaction['source'], string> = { manual: '', import: 'from a statement', bank: 'from your bank', broker: 'from Trading212', adjustment: '' };
const FILTERS = ['q', 'subsectionId', 'pocketId', 'kind', 'from', 'to', 'tag', 'unsorted'];
const HOLD_MS = 500; // a long press on a phone starts selecting

const Clip = () => (
  <svg className="app-clip" viewBox="0 0 16 16" role="img" aria-label="Has receipt" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <title>Has receipt</title>
    <path d="M13 7.5 7.8 12.7a3 3 0 0 1-4.2-4.2l5.5-5.5a2 2 0 0 1 2.8 2.8L6.4 11.3a1 1 0 0 1-1.4-1.4L10 5" />
  </svg>
);

export default function TransactionsPage() {
  const { user } = useAuth();
  const now = currentMonth();
  const [month, setMonth] = useState(now);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<{ tx?: Transaction; importing?: boolean } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulk, setBulk] = useState<BulkAction | null>(null);
  const [selecting, setSelecting] = useState(false); // the phone's "Select" button and long press turn it on
  const held = useRef<{ timer?: number; fired: boolean; touching: boolean }>({ fired: false, touching: false });
  const close = () => setDialog(null);
  useAutoSync();

  const get = (k: string) => params.get(k) ?? '';
  const set = (k: string, v: string) => {
    setSelected(new Set());
    setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; }, { replace: true });
  };
  const unsortedView = !!get('unsorted');
  const anyFilter = FILTERS.some(get);
  const range = !!(get('from') || get('to'));

  const state = useLoad(
    async () => {
      const q = new URLSearchParams(FILTERS.flatMap((k) => (get(k) ? [[k, k === 'unsorted' ? '1' : get(k)]] : [])));
      if (!unsortedView && !range) q.set('month', month);
      const [u, t, p, s, src, g] = await Promise.all([
        api<{ transactions: Transaction[] }>('GET', '/transactions?unsorted=1'),
        api<{ transactions: Transaction[] }>('GET', `/transactions?${q}`),
        api<{ pockets: Pocket[] }>('GET', '/pockets'),
        api<{ sections: Section[] }>('GET', '/sections'),
        api<{ sources: Source[] }>('GET', '/sources'),
        api<{ tags: { id: number; name: string; count: number }[] }>('GET', '/tags'),
      ]);
      return { unsortedCount: u.transactions.length, transactions: t.transactions, pockets: p.pockets, sections: s.sections, sources: src.sources, tags: g.tags.map((x) => x.name) };
    },
    [month, params.toString()],
  );

  useRescueFocus(state.data ? state.data.transactions.length === 0 : undefined);

  // shortcut: the Month filter lists only the last 36 months; lift it when someone needs older history (derive the list from the oldest transaction).
  const months = Array.from({ length: MONTHS_BACK }, (_, i) => shiftMonth(now, -i));
  const showBar = selecting || selected.size > 0;
  const stop = () => { setSelected(new Set()); setSelecting(false); };
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

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
      {showBar ? (
        <div className="app-selbar" role="toolbar" aria-label="Selected transactions">
          <b>{selected.size} selected</b>
          <span className="ty-grow" />
          <button className="ty-btn" disabled={!selected.size} onClick={() => setBulk('subsection')}>Change subsection</button>
          <button className="ty-btn" disabled={!selected.size} onClick={() => setBulk('addTag')}>Add tag</button>
          <button className="ty-btn" disabled={!selected.size} onClick={() => setBulk('removeTag')}>Remove tag</button>
          <button className="ty-btn ty-btn--danger" disabled={!selected.size} onClick={() => setBulk('delete')}>Delete</button>
          <button className="ty-btn ty-btn--quiet" onClick={stop}>Cancel</button>
        </div>
      ) : (
        <div className="app-filters">
          <Field label="Month">
            {(p) => (
              <select {...p} value={month} disabled={unsortedView || range} onChange={(e) => { setSelected(new Set()); setMonth(e.target.value); }}>
                {months.map((m) => <option key={m} value={m}>{monthTitle(m)}</option>)}
              </select>
            )}
          </Field>
          <Field label="Search">
            {(p) => <input {...p} type="search" placeholder="Search payee or note" value={get('q')} onChange={(e) => set('q', e.target.value)} />}
          </Field>
          <Field label="Subsection">
            {(p) => (
              <select {...p} value={get('subsectionId')} onChange={(e) => set('subsectionId', e.target.value)}>
                <option value="">All subsections</option>
                {state.data && <SubsectionOptions sections={state.data.sections} />}
              </select>
            )}
          </Field>
          <Field label="Pocket">
            {(p) => (
              <select {...p} value={get('pocketId')} onChange={(e) => set('pocketId', e.target.value)}>
                <option value="">All pockets</option>
                {state.data?.pockets.map((x) => <option key={x.id} value={x.id}>{x.emoji} {x.name}</option>)}
              </select>
            )}
          </Field>
          <Field label="Type">
            {(p) => (
              <select {...p} value={get('kind')} onChange={(e) => set('kind', e.target.value)}>
                <option value="">All types</option>
                <option value="expense">Expense</option>
                <option value="income">Income</option>
                <option value="transfer">Transfer</option>
              </select>
            )}
          </Field>
          <Field label="From">{(p) => <input {...p} type="date" value={get('from')} onChange={(e) => set('from', e.target.value)} />}</Field>
          <Field label="To">{(p) => <input {...p} type="date" value={get('to')} onChange={(e) => set('to', e.target.value)} />}</Field>
          <Field label="Tag">
            {(p) => (
              <select {...p} value={get('tag')} onChange={(e) => set('tag', e.target.value)}>
                <option value="">All tags</option>
                {state.data?.tags.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            )}
          </Field>
          <label className="ty-chip app-filters__chip">
            <input type="checkbox" checked={unsortedView} onChange={(e) => set('unsorted', e.target.checked ? '1' : '')} />Needs sorting{state.data && state.data.unsortedCount > 0 ? ` (${state.data.unsortedCount})` : ''}
          </label>
          {anyFilter && <button className="ty-btn ty-btn--quiet" onClick={() => { setSelected(new Set()); setParams({}, { replace: true }); }}>Clear filters</button>}
          <button className="ty-btn ty-btn--quiet app-phone-only" onClick={() => setSelecting(true)}>Select</button>
        </div>
      )}
      <Load state={state}>
        {({ transactions, pockets, sections, sources, tags }) => {
          const sourceName = new Map(sources.map((x) => [x.id, x.name]));
          const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, emoji: x.emoji, slot: s.colorSlot }] as const)));
          const pocketById = new Map(pockets.map((p) => [p.id, p]));
          const days: [string, Transaction[]][] = [];
          for (const t of transactions) {
            if (days.at(-1)?.[0] === t.date) days.at(-1)![1].push(t);
            else days.push([t.date, [t]]);
          }
          const allOn = transactions.length > 0 && transactions.every((t) => selected.has(t.id));
          return (
            <>
              {transactions.length === 0 ? (
                anyFilter
                  ? <div className="ty-card">No transactions match these filters.</div>
                  : <EmptyCard text={`No transactions in ${monthTitle(month)}.`} action="Add transaction" onAction={() => setDialog({})} />
              ) : (
                <section className={`ty-section${showBar ? ' app-sel--on' : ''}`} aria-label="Transactions">
                  <label className="app-sel app-sel--head">
                    <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? new Set() : new Set(transactions.map((t) => t.id)))} />
                    <span className="ty-label">Select all shown</span>
                  </label>
                  {days.map(([date, list]) => (
                    <div key={date}>
                      <div className="ty-day ty-label">{dayLabel(date)}</div>
                      {list.map((t) => {
                        const sub = t.subsectionId === null ? undefined : subs.get(t.subsectionId);
                        const transfer = t.kind === 'transfer';
                        const adjustment = t.source === 'adjustment';
                        const imported = t.source !== 'manual' && !adjustment;
                        const unsorted = imported && !t.splits && (t.kind === 'income' ? t.sourceId === null : t.subsectionId === null);
                        const where = unsorted || adjustment ? '' : t.splits ? `Split · ${t.splits.length} subsections` : sub?.name ?? (transfer ? '' : 'Income');
                        const mark = <SubEmoji emoji={sub?.emoji} />;
                        const p = pocketById.get(t.pocketId);
                        const pocket = p && <><span className="ty-emoji">{p.emoji}</span> {p.name}</>;
                        const code = p?.currency ?? baseCurrency(user);
                        const to = t.toPocketId === null ? undefined : pocketById.get(t.toPocketId);
                        const moved = to && to.currency !== code
                          ? `Transfer · ${formatMinor(t.amountMinor)} ${code} became ${formatMinor(t.toAmountMinor ?? 0)} ${to.currency} at ${(Number(t.toAmountMinor) / t.amountMinor).toFixed(4)}`
                          : `Transfer · ${formatMinor(t.amountMinor)} ${code}`;
                        // a second line only for a conversion, an import or sync source, another person, or a note
                        const second = [transfer && to && to.currency !== code && moved, !transfer && ORIGIN[t.source], t.createdBy !== user.id && `entered by ${t.createdByName}`, t.note].filter(Boolean).join(' · ');
                        const abroad = !transfer && code !== baseCurrency(user);
                        const amount = abroad
                          ? <div className="ty-right"><div className={`ty-num${t.kind === 'income' ? ' ty-num--pos' : ''}`}>{t.kind === 'income' ? '+' : ''}{formatMinor(t.kind === 'income' ? t.amountMinor : -t.amountMinor)} {code}</div><div className="ty-cap">≈ {formatMinor(t.baseAmountMinor)} {baseCurrency(user)}</div></div>
                          : transfer ? <div className="ty-num ty-right">{formatMinor(-t.amountMinor)}</div>
                          : t.kind === 'income'
                            ? <div className="ty-num ty-right ty-num--pos">+{formatMinor(t.amountMinor)}</div>
                            : <div className="ty-num ty-right">{formatMinor(-t.amountMinor)}</div>;
                        const tagPills = t.tags.map((x) => <span key={x} className="ty-pill">{x}</span>);
                        const label = adjustment ? <span className="ty-pill">Adjustment</span> : unsorted ? <span className="ty-pill ty-pill--warning">Needs sorting</span> : null;
                        const open = () => {
                          if (held.current.fired) { held.current.fired = false; return; } // the long press already selected it
                          if (showBar) toggle(t.id);
                          else setDialog({ tx: t });
                        };
                        const cancelHold = () => clearTimeout(held.current.timer);
                        const release = () => { cancelHold(); setTimeout(() => { held.current.touching = false; }, 600); };
                        return (
                          <div key={t.id} className="app-sel">
                            <input type="checkbox" className="app-sel__box" aria-label={`Select ${t.payee || t.kind} on ${dayLabel(t.date)}`} checked={selected.has(t.id)} onChange={() => toggle(t.id)} />
                            <div
                              className="ty-trow app-pick" {...pick(open)}
                              onPointerDown={(e) => { if (e.pointerType === 'touch') { held.current.touching = true; held.current.timer = window.setTimeout(() => { held.current.fired = true; setSelecting(true); toggle(t.id); }, HOLD_MS); } }}
                              onPointerMove={cancelHold} onPointerUp={release} onPointerLeave={cancelHold} onPointerCancel={release} onContextMenu={(e) => { if (held.current.touching || held.current.fired) e.preventDefault(); }}
                            >
                              <div className="ty-trow__who">
                                <span className="app-payee">
                                  <b>{transfer ? `Moved to ${to?.name ?? 'another pocket'}` : t.kind === 'income' ? (t.sourceId === null ? t.payee : sourceName.get(t.sourceId)) : t.payee}</b>
                                  {t.attachments.length > 0 && <Clip />}
                                  <span className="app-tags ty-wide">{tagPills}</span>
                                </span>
                                {second && <span className="ty-cap">{second[0].toUpperCase() + second.slice(1)}</span>}
                                <span className="ty-cap ty-trow__meta">{label ? <>{label} · {pocket}</> : t.kind === 'income' ? pocket : <>{where && <>{mark}{where} · </>}{pocket}</>}{tagPills.length > 0 && <span className="app-tags">{tagPills}</span>}</span>
                              </div>
                              <div className="ty-tag ty-wide">
                                {label ?? (where && <><span className={sub && sub.slot >= 1 && !t.splits ? `ty-dot ty-dot--${sub.slot}` : 'ty-dot'} />{mark}{where}</>)}
                              </div>
                              <div className="ty-wide">{pocket}</div>
                              {amount}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </section>
              )}
              {dialog?.importing && <ImportDialog pockets={pockets} onClose={close} />}
              {dialog && !dialog.importing && <TransactionDialog tx={dialog.tx} pockets={pockets} sections={sections} sources={sources} tags={tags} currency={baseCurrency(user)} onClose={close} />}
              {bulk && <BulkDialog action={bulk} ids={[...selected]} sections={sections} tags={tags} onDone={() => { setBulk(null); stop(); }} onClose={() => setBulk(null)} />}
            </>
          );
        }}
      </Load>
    </>
  );
}
