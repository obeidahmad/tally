import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Plan, Pocket, Section, Source } from './api';
import { baseCurrency, useAuth } from './auth';
import { TransactionDialog } from './dialogs';
import { formatMinor } from './money';

/** The card shows when there is something to move or something short. */
export const planShows = (plan: Plan) => plan.transfers.length > 0 || plan.shortMinor > 0 || plan.unplacedSubsectionIds.length > 0;

type Fill = NonNullable<Parameters<typeof TransactionDialog>[0]['fill']>;

/** "Transfers to make": Done opens the transfer dialog filled in; saving reloads the plan. */
export function TransfersToMake({ plan, pockets, sections, sources }: { plan: Plan; pockets: Pocket[]; sections: Section[]; sources: Source[] }) {
  const { user } = useAuth();
  const [fill, setFill] = useState<Fill | null>(null);
  const cur = baseCurrency(user);
  if (!planShows(plan)) return null;
  const byId = new Map(pockets.map((p) => [p.id, p]));
  return (
    <section className="ty-card ty-stack" aria-labelledby="mv-h">
      <div className="ty-card__head"><h2 className="text-title" id="mv-h">Transfers to make</h2></div>
      {plan.transfers.length > 0 && (
        <ul className="ty-moves">
          {plan.transfers.map((t) => {
            const from = byId.get(t.fromPocketId), to = byId.get(t.toPocketId);
            if (!from || !to) return null;
            const code = from.currency !== cur ? ` ${from.currency}` : '';
            const amount = formatMinor(t.amountMinor);
            return (
              <li key={`${t.fromPocketId}-${t.toPocketId}`} className="ty-move">
                <span className="ty-move__path">
                  <span className="ty-tag"><span className="ty-emoji">{from.emoji}</span>{from.name}</span>
                  <span className="ty-muted" aria-hidden="true">→</span><span className="ty-sr">to</span>
                  <span className="ty-tag"><span className="ty-emoji">{to.emoji}</span>{to.name}</span>
                </span>
                <span className="ty-num">{amount}{code && <span className="ty-cur">{from.currency}</span>}</span>
                <button type="button" className="ty-btn ty-btn--sm" aria-label={`Done: move ${amount}${code} from ${from.name} to ${to.name}`}
                  onClick={() => setFill({ pocketId: from.id, toPocketId: to.id, amountMinor: t.amountMinor, toAmountMinor: from.currency !== to.currency ? t.toAmountMinor : null })}>Done</button>
              </li>
            );
          })}
        </ul>
      )}
      {plan.shortMinor > 0 && <div className="ty-warn">Your pockets hold {formatMinor(plan.shortMinor)} less than your budget plans.</div>}
      {plan.unplacedSubsectionIds.length > 0 && (
        <div className="ty-cap">
          {plan.unplacedSubsectionIds.length === 1 ? '1 subsection has' : `${plan.unplacedSubsectionIds.length} subsections have`} no pocket yet. <Link className="ty-link" to="/budget">Choose</Link>
        </div>
      )}
      {fill && <TransactionDialog kind="transfer" fill={fill} pockets={pockets} sections={sections} sources={sources} currency={cur} onClose={() => setFill(null)} />}
    </section>
  );
}
