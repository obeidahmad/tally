import { useEffect, useRef, useState } from 'react';
import { api, fieldError, useForm, useLoad, type Holding, type Pocket, type Rates, type Section, type Source } from '../api';
import { baseCurrency, useAuth } from '../auth';
import { today } from '../dates';
import { Foot } from '../dialogs';
import { formatMinor, minorToInput, parseAmount } from '../money';
import { pick } from '../pick';
import { loadT212Pocket, useT212Sync } from '../trading212';
import { syncedLine } from '../bank';
import { AmountField, Field, FormError, Load, Modal, PocketCurrencyField, SubEmoji, SubsectionOptions, TextField, Topbar, useToast } from '../ui';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "2026-10-03" -> "3 Oct" */
const short = (d: string) => `${Number(d.slice(8))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');
const ZERO_ERROR = 'Enter an amount, 0 or more.';

function HoldingDialog({ holding, focusWorth, pockets, sections, base, onClose }: {
  holding?: Holding; focusWorth?: boolean; pockets: Pocket[]; sections: Section[]; base: string; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const first = pockets[0];
  const [name, setName] = useState(holding?.name ?? '');
  const [pocketId, setPocketId] = useState(holding?.pocketId ?? first?.id);
  const [subId, setSubId] = useState(String(holding?.subsectionId ?? sections.find((s) => s.subsections.length)?.subsections[0].id ?? ''));
  const [paid, setPaid] = useState(holding ? minorToInput(holding.paidMinor) : '');
  const [worth, setWorth] = useState(holding ? minorToInput(holding.worthMinor) : '');
  const pocket = pockets.find((p) => p.id === pocketId);
  const [curr, setCurr] = useState(holding?.worthCurrency ?? pocket?.currency ?? base);
  const [touched, setTouched] = useState(false); // the worth currency follows the pocket until the person picks one
  const offered = useLoad(() => api<Rates>('GET', '/rates'), []).data?.currencies.map((c) => c.currency) ?? [];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focusWorth) ref.current?.querySelector('input')?.focus(); }, []);

  const broker = holding?.source === 'trading212';
  const save = f.on(async () => {
    if (broker) { // only the name and subsection are ours to change
      await api('PATCH', `/holdings/${holding.id}`, { name, subsectionId: Number(subId) });
      onClose();
      toast('Saved');
      return;
    }
    const paidMinor = parseAmount(paid, { allowZero: true });
    if (paidMinor === null) throw fieldError('paidMinor', ZERO_ERROR);
    const worthMinor = worth.trim() === '' && !holding ? undefined : parseAmount(worth, { allowZero: true });
    if (worthMinor === null) throw fieldError('worthMinor', ZERO_ERROR);
    if (holding) {
      const changed = worthMinor !== holding.worthMinor || curr !== holding.worthCurrency; // a new worth is dated today, so send it only when it changed
      await api('PATCH', `/holdings/${holding.id}`, { name, subsectionId: Number(subId), paidMinor, ...(changed ? { worthMinor, worthCurrency: curr } : {}) });
    } else {
      await api('POST', '/holdings', { name, pocketId, subsectionId: Number(subId), paidMinor, ...(worthMinor === undefined ? {} : { worthMinor, worthCurrency: curr }) });
    }
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/holdings/${holding!.id}`);
    const { name, pocketId, subsectionId, paidMinor, worthMinor, worthCurrency } = holding!;
    onClose();
    toast('Holding deleted', () => void api('POST', '/holdings', { name, pocketId, subsectionId, paidMinor, worthMinor, worthCurrency }).catch(() => {}));
  });

  return (
    <Modal title={holding ? 'Edit holding' : 'Add holding'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <fieldset className="ty-fieldset" disabled={!!holding}>
          <legend className="ty-label">Pocket</legend>
          <div className="ty-chips">
            {pockets.map((p) => (
              <label key={p.id} className="ty-chip">
                <input type="radio" name="pocket" checked={pocketId === p.id} onChange={() => { setPocketId(p.id); if (!touched) setCurr(p.currency); }} />
                <span className="ty-emoji">{p.emoji}</span> {p.name}
              </label>
            ))}
          </div>
          {f.errors.pocketId && <span className="ty-error">{f.errors.pocketId}</span>}
        </fieldset>
        <Field label="Subsection" error={f.errors.subsectionId}>
          {(p) => <select {...p} value={subId} onChange={(e) => setSubId(e.target.value)}><SubsectionOptions sections={sections} /></select>}
        </Field>
        <AmountField label="Paid" value={paid} onChange={setPaid} error={f.errors.paidMinor} currency={pocket?.currency ?? base} disabled={broker} hint={broker ? "This holding's figures come from Trading212." : undefined} />
        <div className="ty-stack" ref={ref}>
          <AmountField label="Worth now" value={worth} onChange={setWorth} error={f.errors.worthMinor} currency={curr} disabled={broker} hint={holding ? undefined : 'Leave empty to start at what was paid.'} />
        </div>
        <PocketCurrencyField value={curr} onChange={(c) => { setCurr(c); setTouched(true); }} error={f.errors.worthCurrency} offered={offered} base={base} locked={broker} />
        <Foot busy={f.busy} onCancel={onClose} onDelete={holding && !holding.soldDate && !broker ? remove : undefined} label={holding ? 'Save' : 'Add holding'} />
      </form>
    </Modal>
  );
}

function SellDialog({ holding, pocket, sectionOf, onClose }: { holding: Holding; pocket: Pocket; sectionOf: Map<number, string>; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const [date, setDate] = useState(today());
  const [received, setReceived] = useState('');
  const [sourceId, setSourceId] = useState('');
  const sources = useLoad(() => api<{ sources: Source[] }>('GET', '/sources').then((r) => r.sources.filter((s) => !s.isLeftovers)), []).data ?? [];
  const got = parseAmount(received, { allowZero: true });
  const profit = got !== null && got > holding.paidMinor;
  const loss = got !== null && got < holding.paidMinor;

  const save = f.on(async () => {
    if (got === null) throw fieldError('receivedMinor', ZERO_ERROR);
    await api('POST', `/holdings/${holding.id}/sell`, { date, receivedMinor: got, ...(profit ? { sourceId: sourceId ? Number(sourceId) : undefined } : {}) });
    onClose();
    toast("Saved");
  });

  return (
    <Modal title={`Sell ${holding.name}`} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Date" type="date" value={date} onChange={setDate} error={f.errors.date} />
        <AmountField label="Received" value={received} onChange={setReceived} error={f.errors.receivedMinor} currency={pocket.currency} />
        {profit && (
          <Field label="Source" error={f.errors.sourceId} hint="The profit counts as income from this source.">
            {(p) => (
              <select {...p} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                <option value="">Choose a source</option>
                {sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </Field>
        )}
        {loss && <div className="ty-cap">The loss counts as spending in {sectionOf.get(holding.subsectionId)}.</div>}
        <Foot busy={f.busy} onCancel={onClose} label="Sell" />
      </form>
    </Modal>
  );
}

export default function InvestmentsPage() {
  const { user } = useAuth();
  const [dialog, setDialog] = useState<{ t: 'edit'; holding?: Holding; worth?: boolean } | { t: 'sell'; holding: Holding } | null>(null);
  const close = () => setDialog(null);
  useT212Sync();
  const state = useLoad(async () => {
    const [h, p, s, r, t212] = await Promise.all([
      api<{ holdings: Holding[] }>('GET', '/holdings'),
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
      api<{ sections: Section[] }>('GET', '/sections'),
      api<Rates>('GET', '/rates'),
      loadT212Pocket(),
    ]);
    return { holdings: h.holdings, pockets: p.pockets, sections: s.sections, rates: r, t212 };
  }, []);

  return (
    <>
      <Topbar title="Investments" actions={<button className="ty-btn ty-btn--primary" onClick={() => setDialog({ t: 'edit' })}>Add holding</button>} />
      <Load state={state}>
        {({ holdings, pockets, sections, rates, t212 }) => {
          const subs = new Map(sections.flatMap((s) => s.subsections.map((x) => [x.id, { name: x.name, emoji: x.emoji, slot: s.colorSlot }] as const)));
          const perBase = (c: string) => (c === baseCurrency(user) ? 1 : Number(rates.currencies.find((x) => x.currency === c)?.rate));
          const held = holdings.filter((h) => !h.soldDate);
          const sold = holdings.filter((h) => h.soldDate);
          const row = (h: Holding, pocket: Pocket) => {
            const s = subs.get(h.subsectionId);
            const inPocket = h.worthMinor * perBase(pocket.currency) / perBase(h.worthCurrency); // for the change only
            const pct = h.paidMinor > 0 && Number.isFinite(inPocket) ? ((inPocket - h.paidMinor) * 100) / h.paidMinor : null;
            const shown = pct === null ? null : Number(pct.toFixed(1));
            return (
              <div key={h.id} className="app-hold">
                <div className="app-hold__who app-pick" aria-label={`Edit ${h.name}`} {...pick(() => setDialog({ t: 'edit', holding: h }))}>
                  <b>{h.name}</b>
                  <span className="ty-tag ty-cap"><span className={dot(s?.slot ?? 0)} /><SubEmoji emoji={s?.emoji} />{s?.name}</span>
                </div>
                <div className="app-hold__fig">
                  <span className="ty-cap">paid {formatMinor(h.paidMinor)} {pocket.currency}</span>
                  <span>worth {formatMinor(h.worthMinor)} {h.worthCurrency}</span>
                </div>
                <div className="app-hold__fig">
                  {h.soldDate ? <span className="ty-cap">sold {short(h.soldDate)}</span> : (<>
                    {shown !== null && <span className={shown > 0 ? 'ty-pill ty-pill--positive' : shown < 0 ? 'ty-pill ty-pill--negative' : 'ty-pill'}>{shown > 0 ? '+' : shown < 0 ? '−' : ''}{Math.abs(shown).toFixed(1)}%</span>}
                    <span className="ty-cap">{h.source === 'trading212' ? 'from Trading212' : `updated ${short(h.worthDate)}`}</span>
                  </>)}
                </div>
                {!h.soldDate && h.source !== 'trading212' && (
                  <div className="app-hold__act">
                    <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setDialog({ t: 'edit', holding: h, worth: true })}>Update value</button>
                    <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setDialog({ t: 'sell', holding: h })}>Sell</button>
                  </div>
                )}
              </div>
            );
          };
          const card = (list: Holding[], p: Pocket) => (
            <section key={p.id} className="ty-card ty-stack" aria-label={p.name}>
              <b><span className="ty-emoji">{p.emoji}</span> {p.name}</b>
              {p.id === t212 && p.syncedAt && <span className="ty-cap">{syncedLine(p, 'Trading212')}</span>}
              <div>{list.filter((h) => h.pocketId === p.id).map((h) => row(h, p))}</div>
            </section>
          );
          const withHoldings = (list: Holding[]) => pockets.filter((p) => list.some((h) => h.pocketId === p.id));
          const sectionOf = new Map([...subs].map(([id, s]) => [id, s.name]));
          const dlgHolding = dialog?.t === 'sell' ? dialog.holding : undefined;
          return (
            <>
              {holdings.length === 0 ? (
                <div className="ty-card ty-stack">
                  <div>No holdings yet. Add one to follow what it is worth.</div>
                  <div><button className="ty-btn" onClick={() => setDialog({ t: 'edit' })}>Add holding</button></div>
                </div>
              ) : (
                <div className="ty-stack">
                  {withHoldings(held).map((p) => card(held, p))}
                  {sold.length > 0 && (<>
                    <h2 className="ty-label" style={{ margin: 0 }}>Sold</h2>
                    {withHoldings(sold).map((p) => card(sold, p))}
                  </>)}
                </div>
              )}
              {dialog?.t === 'edit' && <HoldingDialog holding={dialog.holding} focusWorth={dialog.worth} pockets={pockets} sections={sections} base={baseCurrency(user)} onClose={close} />}
              {dlgHolding && <SellDialog holding={dlgHolding} pocket={pockets.find((p) => p.id === dlgHolding.pocketId)!} sectionOf={sectionOf} onClose={close} />}
            </>
          );
        }}
      </Load>
    </>
  );
}
