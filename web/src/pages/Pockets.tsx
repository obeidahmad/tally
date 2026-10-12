import { useState } from 'react';
import { api, KIND_WORDS, useLoad, type Pocket } from '../api';
import { PocketDialog } from '../dialogs';
import { formatMinor } from '../money';
import { useAuth } from '../auth';
import { pick } from '../pick';
import { EmptyCard, Load, Topbar, useRescueFocus } from '../ui';

export default function PocketsPage() {
  const { user } = useAuth();
  const [dialog, setDialog] = useState<{ pocket?: Pocket } | null>(null);
  const close = () => setDialog(null);
  const state = useLoad(() => api<{ pockets: Pocket[] }>('GET', '/pockets').then((r) => r.pockets), []);
  const total = state.data?.reduce((sum, p) => sum + p.balanceMinor, 0) ?? 0;

  useRescueFocus(state.data ? state.data.length === 0 : undefined);

  return (
    <>
      <Topbar title="Pockets" add={{ label: 'Add pocket', onClick: () => setDialog({}) }} />
      <h1 className="app-sr-only ty-wide" tabIndex={-1}>Pockets</h1>
      <header className="ty-month__top">
        <div>
          <div className="ty-label">Total in pockets</div>
          <div className="num-hero">{state.data ? formatMinor(total) : '–'}<span className="ty-cur">{user.baseCurrency}</span></div>
        </div>
        <span className="ty-grow" />
        <button className="ty-btn ty-btn--primary ty-wide" onClick={() => setDialog({})}>Add pocket</button>
      </header>
      <Load state={state}>
        {(pockets) => (
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
                    <div className={p.balanceMinor < 0 ? 'num-lg ty-num--neg' : 'num-lg'}>{formatMinor(p.balanceMinor)}<span className="ty-cur">{p.currency}</span></div>
                    <div className="ty-cap">Entered by hand</div>
                  </article>
                ))}
              </div>
            )}
            {dialog && <PocketDialog pocket={dialog.pocket} currency={user.baseCurrency} onClose={close} />}
          </>
        )}
      </Load>
    </>
  );
}
