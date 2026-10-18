import { useState } from 'react';
import { useNavigate } from "react-router-dom";
import { api, KIND_WORDS, useLoad, type Holding, type NetWorth, type Pocket, type Section, type Source, type Where } from '../api';
import { bankByPocket, countsLine, loadConnections, syncedLine, useAutoSync } from '../bank';
import { loadT212Pocket, useT212Sync } from '../trading212';
import { PocketDialog, TransactionDialog } from '../dialogs';
import { formatMinor } from '../money';
import { baseCurrency, useAuth } from '../auth';
import { pick } from '../pick';
import { EmptyCard, Load, SubEmoji, Topbar, useRescueFocus } from '../ui';

/** "8,942.55 in EUR · 3,550.00 USD, worth 3,268.85 EUR at 0.9208" */
function netLine(n: NetWorth) {
  if (n.byCurrency.length === 1 && n.byCurrency[0].currency === n.currency && n.missingRates.length === 0) return ''; // it would only repeat the figure above
  return n.byCurrency.map((c) => {
    if (n.missingRates.includes(c.currency)) return `No exchange rate for ${c.currency} yet.`;
    if (c.currency === n.currency) return `${formatMinor(c.amountMinor)} in ${c.currency}`;
    return `${formatMinor(c.amountMinor)} ${c.currency}, worth ${formatMinor(c.baseMinor)} ${n.currency} at ${c.rate}`;
  }).join(' · ');
}

const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');

function WhereTable({ where, sections }: { where: Where; sections: Section[] }) {
  const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, emoji: x.emoji, slot: s.colorSlot }] as const)));
  if (where.rows.length === 0) return null;
  return (
    <section className="ty-stack" aria-labelledby="where-h">
      <h2 className="text-title" id="where-h" style={{ margin: 0 }}>Where each subsection's money sits</h2>
      <div className="ty-section ty-wide"><table className="ty-table">
        <thead><tr><th>Subsection</th>{where.pockets.map((p) => <th key={p.id}>{p.name}</th>)}<th>Total in {where.currency}</th></tr></thead>
        <tbody>{where.rows.map((r) => {
          const s = subs.get(r.subsectionId);
          return (
            <tr key={r.subsectionId}>
              <td><span className="ty-tag"><span className={dot(s?.slot ?? 0)} /><SubEmoji emoji={s?.emoji} />{s?.name}</span></td>
              {where.pockets.map((p) => {
                const c = r.cells.find((x) => x.pocketId === p.id);
                return c
                  ? <td key={p.id} className="ty-num">{formatMinor(c.amountMinor)}{p.currency !== where.currency && <span className="ty-cur">{p.currency}</span>}</td>
                  : <td key={p.id} className="ty-muted">–</td>;
              })}
              <td className="ty-num">{formatMinor(r.totalMinor)}</td>
            </tr>
          );
        })}</tbody>
      </table></div>
      <div className="ty-section app-phone-card">{where.rows.map((r) => {
        const s = subs.get(r.subsectionId);
        const cells = r.cells.map((c) => {
          const p = where.pockets.find((x) => x.id === c.pocketId);
          return `${formatMinor(c.amountMinor)}${p && p.currency !== where.currency ? ` ${p.currency}` : ''} in ${p?.name}`;
        }).join(' · ');
        return (
          <div key={r.subsectionId} className="ty-brow">
            <div className="ty-brow__name">
              <span className="ty-tag"><span className={dot(s?.slot ?? 0)} /><SubEmoji emoji={s?.emoji} /><b>{s?.name}</b></span>
              {cells && <span className="ty-cap">{cells}</span>}
            </div>
            <div className="ty-num ty-right">{formatMinor(r.totalMinor)}</div>
          </div>
        );
      })}</div>
    </section>
  );
}

export default function PocketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<{ pocket?: Pocket; transfer?: boolean } | null>(null);
  const close = () => setDialog(null);
  useAutoSync();
  useT212Sync();
  const state = useLoad(async () => {
    const [p, n, s, src, w, h, banks, t212] = await Promise.all([
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
      api<NetWorth>('GET', '/networth'),
      api<{ sections: Section[] }>('GET', '/sections'),
      api<{ sources: Source[] }>('GET', '/sources'),
      api<Where>('GET', '/where'),
      api<{ holdings: Holding[] }>('GET', '/holdings'),
      loadConnections(),
      loadT212Pocket(),
    ]);
    const names = bankByPocket(banks);
    if (t212 !== null) names.set(t212, 'Trading212');
    return { pockets: p.pockets, net: n, sections: s.sections, sources: src.sources, where: w, held: h.holdings.filter((x) => !x.soldDate), banks: names };
  }, []);

  useRescueFocus(state.data ? state.data.pockets.length === 0 : undefined);

  return (
    <>
      <Topbar title="Pockets" add={{ label: 'Add pocket', onClick: () => setDialog({}) }} />
      <h1 className="app-sr-only ty-wide" tabIndex={-1}>Pockets</h1>
      <header className="ty-month">
      <div className="ty-month__top">
        <div>
          <div className="ty-label">Net worth</div>
          <div className="num-hero">{state.data ? formatMinor(state.data.net.totalMinor) : '–'}<span className="ty-cur">{baseCurrency(user)}</span></div>
          {state.data && netLine(state.data.net) && <div className="ty-cap">{netLine(state.data.net)}</div>}
        </div>
        <span className="ty-grow" />
        <button className="ty-btn ty-wide" onClick={() => setDialog({ transfer: true })}>Transfer</button>
        <button className="ty-btn ty-btn--primary ty-wide" onClick={() => setDialog({})}>Add pocket</button>
      </div>
        <button className="ty-btn ty-month__add" onClick={() => setDialog({ transfer: true })}>Transfer</button>
        <button className="ty-btn ty-month__add" onClick={() => navigate("/investments")}>Investments</button>
      </header>
      <Load state={state}>
        {({ pockets, sections, sources, where, held, banks }) => (
          <>
            {pockets.length === 0 ? (
              <EmptyCard text="No pockets yet. A pocket is where money sits: a bank account, cash, a fund." action="Add pocket" onAction={() => setDialog({})} />
            ) : (
              <section className="ty-section" aria-label="Pockets">
                {pockets.map((p) => {
                  const paid = held.filter((x) => x.pocketId === p.id).reduce((t, x) => t + x.paidMinor, 0);
                  const converted = p.currency === baseCurrency(user) ? '' : p.baseValueMinor === null ? `No exchange rate for ${p.currency} yet.` : `≈ ${formatMinor(p.baseValueMinor)} ${baseCurrency(user)}`;
                  const broker = banks.get(p.id) === 'Trading212'; // its figure is synced cash plus holdings, which the server already adds
                  const shown = p.syncedAt && !broker ? p.syncedBalanceMinor ?? p.valueMinor : p.valueMinor;
                  const sub = [converted, held.some((x) => x.pocketId === p.id) && `paid ${formatMinor(paid)} ${p.currency}`].filter(Boolean).join(' · ');
                  const where = [syncedLine(p, banks.get(p.id)), !broker && countsLine(p)].filter(Boolean).join(' · ');
                  return (
                    <div key={p.id} className="ty-prow app-pick" {...pick(() => setDialog({ pocket: p }))}>
                      <div className="ty-prow__who">
                        <span className="ty-prow__name"><span className="ty-emoji">{p.emoji}</span><b>{p.name}</b><span className="ty-cap">{KIND_WORDS[p.kind]}</span></span>
                        {where && <span className="ty-cap">{where}</span>}
                      </div>
                      <div className="ty-prow__bal">
                        <span className={shown < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(shown)}<span className="ty-cur">{p.currency}</span></span>
                        {sub && <span className="ty-cap">{sub}</span>}
                      </div>
                    </div>
                  );
                })}
              </section>
            )}
            <WhereTable where={where} sections={sections} />
            {dialog?.transfer && <TransactionDialog kind="transfer" pockets={pockets} sections={sections} sources={sources} currency={baseCurrency(user)} onClose={close} />}
            {dialog && !dialog.transfer && <PocketDialog pocket={dialog.pocket} currency={baseCurrency(user)} onClose={close} />}
          </>
        )}
      </Load>
    </>
  );
}
