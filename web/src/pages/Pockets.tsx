import { Fragment, useState } from 'react';
import { useNavigate } from "react-router-dom";
import { api, KIND_WORDS, loadPlan, useLoad, type Holding, type NetWorth, type Pocket, type Plan, type Section, type Source } from '../api';
import { bankByPocket, countsLine, loadConnections, syncedLine, useAutoSync } from '../bank';
import { loadT212Pocket, useT212Sync } from '../trading212';
import { PocketDialog, ReconcileDialog, TransactionDialog } from '../dialogs';
import { dayLabel, monthName } from '../dates';
import { formatMinor } from '../money';
import { baseCurrency, useAuth } from '../auth';
import { pick } from '../pick';
import { AreaChart, EmptyCard, Load, SubEmoji, TopButton, Topbar, useRescueFocus } from '../ui';

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

const GROUPS: [Pocket['group'], string][] = [['cash', 'Cash'], ['investments', 'Investments'], ['property', 'Property'], ['debts', 'Debts']];
/** Each group keeps a section colour, in the avatars and the summary bars. */
const SLOT: Record<Pocket['group'], number> = { cash: 5, investments: 1, property: 4, debts: 6 };
const DEBT_SLOTS = [6, 3, 2, 4, 7, 8, 5, 1];
const RANGES = [3, 6, 12, 24];

const groupTotal = (list: Pocket[]) => list.reduce((t, p) => t + (p.baseValueMinor ?? 0), 0);

/** Assets or Debts: the total, a stacked bar of the shares and a legend of amounts. */
function Summary({ title, total, parts }: { title: string; total: number; parts: { name: string; slot: number; minor: number }[] }) {
  const sum = parts.reduce((t, x) => t + Math.abs(x.minor), 0);
  if (parts.length === 0 || sum === 0) return null;
  return (
    <section className="ty-summary" aria-label={title}>
      <div className="ty-summary__head"><h2 className="text-title">{title}</h2><span className={total < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(total)}</span></div>
      <div className="ty-stackbar" role="img" aria-label={parts.map((x) => `${x.name} ${Math.round((Math.abs(x.minor) * 100) / sum)}%`).join(', ')}>
        {parts.map((x) => <span key={x.name} className={`ty-seg--${x.slot}`} style={{ flex: Math.abs(x.minor) }} />)}
      </div>
      <ul className="ty-keys">{parts.map((x) => <li key={x.name}><span className={`ty-dot ty-dot--${x.slot}`} /><span>{x.name}</span><span className={x.minor < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(x.minor)}</span></li>)}</ul>
    </section>
  );
}

/** The net worth card: the figure, its change over the range, the area chart. */
function NetWorthCard({ net, currency }: { net?: NetWorth; currency: string }) {
  const [months, setMonths] = useState(6);
  const state = useLoad(() => api<{ networth: { month: string; minor: number }[] }>('GET', `/reports?months=${months}`), [months]);
  const series = state.data?.networth ?? [];
  const first = series[0];
  const last = series.at(-1);
  const change = first && last && series.length > 1 ? last.minor - first.minor : undefined;
  return (
    <section className="ty-card ty-stack" style={{ gap: '1rem' }} aria-label="Net worth">
      <div className="ty-card__head">
        <div className="ty-areahead">
          <span className="ty-label">Net worth</span>
          <span className="num-hero">{net ? formatMinor(net.totalMinor) : '–'}<span className="ty-cur">{currency}</span></span>
          {net && netLine(net) && <span className="ty-cap">{netLine(net)}</span>}
          {change !== undefined && first && (
            <span className={change < 0 ? 'ty-delta ty-delta--neg' : 'ty-delta'}>
              {change < 0 ? '↓' : '↑'} {formatMinor(Math.abs(change))} ({first.minor === 0 ? '—' : `${((Math.abs(change) * 100) / Math.abs(first.minor)).toFixed(1)}%`}) <span>since {monthName(first.month)}</span>
            </span>
          )}
        </div>
        <span className="ty-grow" />
        <fieldset className="ty-fieldset">
          <legend className="app-sr-only">Range</legend>
          <div className="ty-segmented">{RANGES.map((m) => <label key={m}><input type="radio" name="nw-range" checked={months === m} onChange={() => setMonths(m)} />{m}M</label>)}</div>
        </fieldset>
      </div>
      {series.length > 0 ? <AreaChart series={series} /> : <div className="ty-cap">{state.failed ? "Couldn't load the chart." : state.data ? 'Nothing to show yet.' : 'Loading…'}</div>}
    </section>
  );
}
const short = (date: string) => dayLabel(date).slice(4); // "16 Oct"

function PlanTable({ plan, pockets, sections, base }: { plan: Plan | string; pockets: Pocket[]; sections: Section[]; base: string }) {
  const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, emoji: x.emoji, slot: s.colorSlot }] as const)));
  const byId = new Map(pockets.map((p) => [p.id, p]));
  if (typeof plan === 'string') return <section className="ty-stack"><h2 className="text-title" style={{ margin: 0 }}>Where your money should be</h2><div className="ty-cap">{plan}</div></section>;
  if (plan.pockets.length === 0) return null;
  const code = (c: string) => c !== base && <span className="ty-cur">{c}</span>;
  return (
    <section className="ty-stack" aria-labelledby="plan-h">
      <h2 className="text-title" id="plan-h" style={{ margin: 0 }}>Where your money should be</h2>
      <div className="ty-section"><table className="ty-table app-plan">
        <thead><tr><th>Pocket</th><th>Should hold</th><th>Holds</th><th>Difference</th></tr></thead>
        <tbody>{plan.pockets.map((pp) => {
          const p = byId.get(pp.id);
          if (!p) return null;
          const diff = pp.holdsMinor - pp.shouldMinor;
          return (
            <Fragment key={pp.id}>
              <tr className="ty-plan__pocket">
                <td><span className="ty-tag"><span className="ty-emoji">{p.emoji}</span>{p.name}</span></td>
                <td className="ty-num">{formatMinor(pp.shouldMinor)}{code(p.currency)}</td>
                <td className="ty-num">{formatMinor(pp.holdsMinor)}{code(p.currency)}</td>
                {diff === 0 ? <td className="ty-muted">–</td> : <td className={diff < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{diff > 0 ? '+' : ''}{formatMinor(diff)}{code(p.currency)}</td>}
              </tr>
              {pp.subsections.map((x) => {
                const s = subs.get(x.id);
                return (
                  <tr key={x.id} className="ty-plan__sub ty-wide">
                    <td><span className="ty-tag"><span className={dot(s?.slot ?? 0)} /><SubEmoji emoji={s?.emoji} />{s?.name}</span></td>
                    <td className={x.availableMinor < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(x.availableMinor)}{code(plan.currency)}</td><td /><td />
                  </tr>
                );
              })}
              {plan.nextMonth.pocketId === pp.id && (
                <tr className="ty-plan__sub ty-wide">
                  <td>Next month's money</td>
                  <td className={plan.nextMonth.amountMinor < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(plan.nextMonth.amountMinor)}{code(plan.currency)}</td><td /><td />
                </tr>
              )}
              {p.openingBalanceMinor !== 0 && (
                <tr className="ty-plan__sub ty-wide">
                  <td>Opening balance</td>
                  <td className={p.openingBalanceMinor < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(p.openingBalanceMinor)}{code(p.currency)}</td><td /><td />
                </tr>
              )}
            </Fragment>
          );
        })}</tbody>
      </table></div>
    </section>
  );
}

export default function PocketsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<{ pocket?: Pocket; transfer?: boolean; reconcile?: boolean } | null>(null);
  const close = () => setDialog(null);
  useAutoSync();
  useT212Sync();
  const state = useLoad(async () => {
    const [p, n, s, src, w, h, banks, t212] = await Promise.all([
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
      api<NetWorth>('GET', '/networth'),
      api<{ sections: Section[] }>('GET', '/sections'),
      api<{ sources: Source[] }>('GET', '/sources'),
      loadPlan(),
      api<{ holdings: Holding[] }>('GET', '/holdings'),
      loadConnections(),
      loadT212Pocket(),
    ]);
    const names = bankByPocket(banks);
    if (t212 !== null) names.set(t212, 'Trading212');
    return { pockets: p.pockets, net: n, sections: s.sections, sources: src.sources, plan: w, held: h.holdings.filter((x) => !x.soldDate), banks: names };
  }, []);

  useRescueFocus(state.data ? state.data.pockets.length === 0 : undefined);

  const [folded, setFolded] = useState<Pocket['group'][]>([]);
  const fold = (g: Pocket['group']) => setFolded((f) => (f.includes(g) ? f.filter((x) => x !== g) : [...f, g]));
  const cur = baseCurrency(user);

  return (
    <>
      <Topbar title="Pockets" actions={<>
        <TopButton label="Transfer" wide onClick={() => setDialog({ transfer: true })} />
        <TopButton label="Add pocket" primary onClick={() => setDialog({})} />
      </>} />
      <div className="app-phone-block ty-inline">
        <button className="ty-btn" onClick={() => setDialog({ transfer: true })}>Transfer</button>
        <button className="ty-btn" onClick={() => navigate('/investments')}>Investments</button>
      </div>
      <NetWorthCard net={state.data?.net} currency={cur} />
      <Load state={state}>
        {({ pockets, sections, sources, plan, held, banks, net }) => {
          const groups = GROUPS.map(([group, title]) => ({ group, title, list: pockets.filter((p) => p.group === group) })).filter((g) => g.list.length > 0);
          const assets = groups.filter((g) => g.group !== 'debts').map((g) => ({ name: g.title, slot: SLOT[g.group], minor: groupTotal(g.list) })).filter((x) => x.minor > 0);
          const debts = pockets.filter((p) => p.group === 'debts' && (p.baseValueMinor ?? 0) !== 0).map((p, i) => ({ name: p.name, slot: DEBT_SLOTS[i % 8]!, minor: p.baseValueMinor ?? 0 }));
          return (
            <>
              {pockets.length === 0 ? (
                <EmptyCard text="No pockets yet. A pocket is where money sits: a bank account, cash, a fund." action="Add pocket" onAction={() => setDialog({})} />
              ) : (
                <div className="ty-accounts">
                  <div className="ty-accounts__main">
                    {groups.map(({ group, title, list }) => {
                      const open = !folded.includes(group);
                      const total = groupTotal(list);
                      return (
                        <section key={group} className="ty-section" aria-label={title}>
                          <div className="ty-agroup__head">
                            <button className="ty-chev" aria-expanded={open} aria-label={`${title} pockets`} onClick={() => fold(group)} />
                            <h2 className="text-title">{title}</h2>
                            <span className={total < 0 ? 'ty-agroup__total ty-num--neg' : 'ty-agroup__total'}>{formatMinor(total)}</span>
                          </div>
                          {open && list.map((p) => {
                            const paid = held.filter((x) => x.pocketId === p.id).reduce((t, x) => t + x.paidMinor, 0);
                            const converted = p.currency === cur ? '' : p.baseValueMinor === null ? `No exchange rate for ${p.currency} yet.` : `≈ ${formatMinor(p.baseValueMinor)} ${cur}`;
                            const broker = banks.get(p.id) === 'Trading212'; // its figure is synced cash plus holdings, which the server already adds
                            const shown = p.syncedAt && !broker ? p.syncedBalanceMinor ?? p.valueMinor : p.valueMinor;
                            const note = [converted, held.some((x) => x.pocketId === p.id) && `paid ${formatMinor(paid)} ${p.currency}`, syncedLine(p, banks.get(p.id)), !broker && countsLine(p), p.reconciledAt && `Reconciled ${short(p.reconciledAt)}`].filter(Boolean).join(' · ');
                            return (
                              <div key={p.id} className="ty-arow app-pick" {...pick(() => setDialog({ pocket: p }))}>
                                <span className={`ty-avatar ty-avatar--${SLOT[p.group]}`}><span className="ty-emoji">{p.emoji}</span></span>
                                <div className="ty-arow__who"><b>{p.name}</b><span className="ty-cap">{KIND_WORDS[p.kind]}</span></div>
                                <div className="ty-arow__bal">
                                  <span className={shown < 0 ? 'ty-num ty-num--neg' : 'ty-num'}>{formatMinor(shown)}<span className="ty-cur">{p.currency}</span></span>
                                  {note && <span className="ty-cap">{note}</span>}
                                </div>
                              </div>
                            );
                          })}
                        </section>
                      );
                    })}
                  </div>
                  <div className="ty-accounts__side">
                    <Summary title="Assets" total={net.assetsMinor} parts={assets} />
                    <Summary title="Debts" total={-Math.abs(net.debtsMinor)} parts={debts} />
                  </div>
                </div>
              )}
              <PlanTable plan={plan} pockets={pockets} sections={sections} base={cur} />
              {dialog?.transfer && <TransactionDialog kind="transfer" pockets={pockets} sections={sections} sources={sources} currency={cur} onClose={close} />}
              {dialog && !dialog.transfer && !dialog.reconcile && <PocketDialog pocket={dialog.pocket} currency={cur} onReconcile={() => setDialog({ pocket: dialog.pocket, reconcile: true })} onClose={close} />}
              {dialog?.reconcile && dialog.pocket && <ReconcileDialog pocket={dialog.pocket} onClose={close} />}
            </>
          );
        }}
      </Load>
    </>
  );
}
