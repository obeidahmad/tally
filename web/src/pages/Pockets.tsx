import { useState } from 'react';
import { api, KIND_WORDS, useLoad, type NetWorth, type Pocket, type Section, type Source } from '../api';
import { PocketDialog, TransactionDialog } from '../dialogs';
import { formatMinor } from '../money';
import { useAuth } from '../auth';
import { pick } from '../pick';
import { EmptyCard, Load, Topbar, useRescueFocus } from '../ui';

/** "8,942.55 in EUR · 3,550.00 USD, worth 3,268.85 EUR at 0.9208" */
function netLine(n: NetWorth) {
  return n.byCurrency.map((c) => {
    if (n.missingRates.includes(c.currency)) return `No exchange rate for ${c.currency} yet.`;
    if (c.currency === n.currency) return `${formatMinor(c.amountMinor)} in ${c.currency}`;
    return `${formatMinor(c.amountMinor)} ${c.currency}, worth ${formatMinor(c.baseMinor)} ${n.currency} at ${c.rate}`;
  }).join(' · ');
}

export default function PocketsPage() {
  const { user } = useAuth();
  const [dialog, setDialog] = useState<{ pocket?: Pocket; transfer?: boolean } | null>(null);
  const close = () => setDialog(null);
  const state = useLoad(async () => {
    const [p, n, s, src] = await Promise.all([
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
      api<NetWorth>('GET', '/networth'),
      api<{ sections: Section[] }>('GET', '/sections'),
      api<{ sources: Source[] }>('GET', '/sources'),
    ]);
    return { pockets: p.pockets, net: n, sections: s.sections, sources: src.sources };
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
          <div className="num-hero">{state.data ? formatMinor(state.data.net.totalMinor) : '–'}<span className="ty-cur">{user.baseCurrency}</span></div>
          {state.data && <div className="ty-cap">{netLine(state.data.net)}</div>}
        </div>
        <span className="ty-grow" />
        <button className="ty-btn ty-wide" onClick={() => setDialog({ transfer: true })}>Transfer</button>
        <button className="ty-btn ty-btn--primary ty-wide" onClick={() => setDialog({})}>Add pocket</button>
      </div>
        <button className="ty-btn ty-month__add" onClick={() => setDialog({ transfer: true })}>Transfer</button>
      </header>
      <Load state={state}>
        {({ pockets, sections, sources }) => (
          <>
            {pockets.length === 0 ? (
              <EmptyCard text="No pockets yet. A pocket is where money sits: a bank account, cash, a fund." action="Add pocket" onAction={() => setDialog({})} />
            ) : (
              <div className="ty-grid">
                {pockets.map((p) => (
                  <article key={p.id} className="ty-card ty-pocket app-pick" {...pick(() => setDialog({ pocket: p }))}>
                    <div className="ty-pocket__top">
                      <div className="ty-grow"><b><span className="ty-emoji">{p.emoji}</span> {p.name}</b><span className="ty-cap">{KIND_WORDS[p.kind]}</span></div>
                      <span className="ty-pill">{p.currency}</span>
                    </div>
                    <div>
                      <div className={p.balanceMinor < 0 ? 'num-lg ty-num--neg' : 'num-lg'}>{formatMinor(p.balanceMinor)}<span className="ty-cur">{p.currency}</span></div>
                      <div className="ty-cap">{p.currency === user.baseCurrency ? ' ' : p.baseBalanceMinor === null ? `No exchange rate for ${p.currency} yet.` : `≈ ${formatMinor(p.baseBalanceMinor)} ${user.baseCurrency}`}</div>
                    </div>
                    <div className="ty-cap">Entered by hand</div>
                  </article>
                ))}
              </div>
            )}
            {dialog?.transfer && <TransactionDialog kind="transfer" pockets={pockets} sections={sections} sources={sources} currency={user.baseCurrency} onClose={close} />}
            {dialog && !dialog.transfer && <PocketDialog pocket={dialog.pocket} currency={user.baseCurrency} onClose={close} />}
          </>
        )}
      </Load>
    </>
  );
}
