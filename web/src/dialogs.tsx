import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, DEFAULT_EMOJI, fieldError, useForm, useLoad, type Attachment, type Rates, type BudgetSection, type CloseSummary, type End, type SubsectionRules, type Pipeline, type PipelineBox, type Pocket, type PocketKind, type Section, type Source, type StepBody, type Transaction } from './api';
import { useAuth } from './auth';
import { currentMonth, dayHeading, dayLabel, monthName, monthTitle, shiftMonth, today } from './dates';
import { AMOUNT_ERROR, formatMinor, minorToInput, parseAmount, parsePercent, percentText, PERCENT_ERROR } from './money';
import { AmountField, EmojiPicker, Field, FormError, KindField, Modal, PocketCurrencyField, SubsectionOptions, subLabel, TextField, useToast } from './ui';

const BALANCE_ERROR = 'Enter an amount, with at most two decimals.';

export function Foot({ busy, onCancel, onDelete, onMove, onReconcile, label = 'Save', tone = 'primary' }: { busy: boolean; onCancel: () => void; onDelete?: () => void; onMove?: () => void; onReconcile?: () => void; label?: string; tone?: 'primary' | 'income' | 'spend' }) {
  return (
    <div className="ty-dialog__foot">
      {(onDelete || onMove || onReconcile) && (
        <span className="app-foot-start">
          {onDelete && <button type="button" className="ty-btn ty-btn--danger" disabled={busy} onClick={onDelete}>Delete</button>}
          {onMove && <button type="button" className="ty-btn ty-btn--quiet" disabled={busy} onClick={onMove}>Move money</button>}
          {onReconcile && <button type="button" className="ty-btn ty-btn--quiet" disabled={busy} onClick={onReconcile}>Reconcile</button>}
        </span>
      )}
      <button type="button" className="ty-btn ty-btn--quiet" onClick={onCancel}>Cancel</button>
      <button type="submit" className={`ty-btn ty-btn--primary${tone === 'income' ? ' app-income' : ''}`} disabled={busy}>{label}</button>
    </div>
  );
}

const Blocked = ({ text, to, link, onClose }: { text: string; to: string; link: string; onClose: () => void }) => (
  <div className="ty-stack">
    <div>{text}. <Link className="ty-link" to={to} onClick={onClose}>{link}</Link></div>
  </div>
);

/* ---------- Transaction ---------- */

/** The emoji follows the kind until the person picks one (or the pocket already has one). */
function useEmoji(initial: string | undefined, kind: PocketKind) {
  const [picked, setPicked] = useState(initial);
  return [picked ?? DEFAULT_EMOJI[kind], setPicked] as const;
}

const TRANSFER_ERROR = 'Enter the amount that arrived.';

const sizeText = (n: number) => (n < 1e6 ? `${Math.max(1, Math.round(n / 1000))} KB` : `${(n / 1e6).toFixed(1)} MB`);

export function TransactionDialog({ tx, kind: startKind, pockets: allPockets, sections, sources: allSources, tags: known = [], currency, onClose }: {
  tx?: Transaction; kind?: Transaction['kind']; pockets: Pocket[]; sections: Section[]; sources: Source[]; tags?: string[]; currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const pockets = allPockets.filter((p) => p.kind !== 'property'); // a property holds a value, not transactions
  const adjustment = tx?.source === 'adjustment';
  const sources = allSources.filter((x) => !x.isLeftovers); // money carried from last month is not entered by hand
  const f = useForm();
  const [kind, setKind] = useState<Transaction['kind']>(tx?.kind ?? startKind ?? 'expense');
  const [toId, setToId] = useState(tx?.toPocketId?.toString() ?? '');
  const [received, setReceived] = useState(tx?.toAmountMinor ? minorToInput(tx.toAmountMinor) : '');
  const [date, setDate] = useState(tx?.date ?? today());
  const [amount, setAmount] = useState(tx ? minorToInput(tx.amountMinor) : '');
  const [payee, setPayee] = useState(tx?.payee ?? '');
  // 'new' is the "+ Add source" chip
  const imported = !!tx && tx.source !== 'manual';
  const [always, setAlways] = useState(false);
  const [sourceId, setSourceId] = useState(tx?.sourceId?.toString() ?? (imported ? '' : sources[0]?.id.toString() ?? 'new'));
  const [newSource, setNewSource] = useState('');
  const [subsectionId, setSubsectionId] = useState(tx?.subsectionId?.toString() ?? '');
  // 'new' is the "+ Add pocket" chip
  const [pocketId, setPocketId] = useState(tx?.pocketId?.toString() ?? pockets[0]?.id.toString() ?? 'new');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<PocketKind>('bank');
  const [newEmoji, setNewEmoji] = useEmoji(undefined, newKind);
  const [note, setNote] = useState(tx?.note ?? '');
  const [parts, setParts] = useState<{ subsectionId: string; amount: string }[] | null>(tx?.splits?.map((s) => ({ subsectionId: String(s.subsectionId), amount: minorToInput(s.amountMinor) })) ?? null);
  const [tagList, setTagList] = useState<string[]>(tx?.tags ?? []);
  const [tagText, setTagText] = useState('');
  const [files, setFiles] = useState<Attachment[]>(tx?.attachments ?? []);
  const [fileError, setFileError] = useState('');
  const noSubsections = !sections.some((s) => s.subsections.length);
  const title = adjustment ? 'Edit adjustment' : `${tx ? 'Edit' : 'Add'} ${kind}`;
  const withTags = (list: string[], text: string) => {
    const out = [...list];
    for (const raw of text.split(',')) {
      const name = raw.trim();
      if (name && !out.some((x) => x.toLowerCase() === name.toLowerCase())) out.push(known.find((x) => x.toLowerCase() === name.toLowerCase()) ?? name);
    }
    return out;
  };
  const typeTag = (v: string) => {
    const bits = v.split(',');
    if (bits.length > 1) setTagList(withTags(tagList, bits.slice(0, -1).join(',')));
    setTagText(bits.at(-1)!);
  };
  const suggestions = tagText.trim() ? known.filter((x) => x.toLowerCase().includes(tagText.trim().toLowerCase()) && !tagList.some((y) => y.toLowerCase() === x.toLowerCase())) : [];
  const partSum = (parts ?? []).reduce((a, x) => a + (parseAmount(x.amount) ?? 0), 0);
  const left = (parseAmount(amount) ?? 0) - partSum;
  const attach = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setFileError('');
    try {
      const { attachment } = await api<{ attachment: Attachment }>('POST', `/transactions/${tx!.id}/attachments`, file);
      setFiles((x) => [...x, attachment]);
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };
  const detach = async (id: number) => {
    setFileError('');
    try {
      await api('DELETE', `/attachments/${id}`);
      setFiles((x) => x.filter((a) => a.id !== id));
    } catch (e) {
      setFileError(e instanceof Error ? e.message : 'Something went wrong. Try again.');
    }
  };
  const codeOf = (id: string) => pockets.find((p) => String(p.id) === id)?.currency ?? currency;
  const fromCode = codeOf(pocketId);
  const toCode = codeOf(toId);
  const crossing = kind === 'transfer' && !!toId && toCode !== fromCode;
  const rates = useLoad(
    () => (kind === 'transfer' && /^\d{4}-\d\d-\d\d$/.test(date) ? api<Rates>('GET', `/rates?date=${date}`) : Promise.reject()),
    [kind, date],
  ).data;
  const perBase = (code: string) => (code === currency ? 1 : Number(rates?.currencies.find((c) => c.currency === code)?.rate));
  const reference = rates && perBase(toCode) / perBase(fromCode);
  const sent = parseAmount(amount);
  const got = parseAmount(received);
  const rateHint = crossing
    ? [
        sent && got ? `Rate ${(got / sent).toFixed(4)}.` : '',
        reference && Number.isFinite(reference) ? `Today's reference rate is ${reference.toFixed(4)}.` : '',
      ].filter(Boolean).join(' ') || undefined
    : undefined;

  const save = f.on(async () => {
    const tags = withTags(tagList, tagText);
    if (adjustment) {
      await api('PATCH', `/transactions/${tx!.id}`, { note, tags });
      onClose();
      toast('Saved');
      return;
    }
    // each part's amount is read here; the server checks that they add up to the transaction
    const splits = kind === 'expense' && parts ? parts.map((x) => {
      const amountMinor = parseAmount(x.amount);
      if (amountMinor === null) throw fieldError('splits', AMOUNT_ERROR);
      if (!x.subsectionId) throw fieldError('splits', 'Choose a subsection.');
      return { subsectionId: Number(x.subsectionId), amountMinor };
    }) : undefined;
    const splitBody = splits ? { splits, subsectionId: null } : tx?.splits ? { splits: null, subsectionId: subsectionId ? Number(subsectionId) : null } : {};
    if (imported) {
      const chosen = kind === 'income' ? sourceId : subsectionId;
      let sorted = 0;
      // the rule goes first: if it is refused, nothing is saved
      if (always && chosen) {
        const match = payee.trim();
        try {
          sorted = (await api<{ sorted: number }>('POST', '/rules', { match, ...(kind === 'income' ? { sourceId: Number(chosen) } : { subsectionId: Number(chosen) }) })).sorted;
        } catch (e) {
          if (e instanceof ApiError && e.fields?.match) throw new ApiError(e.status, e.code, e.message, { rule: e.fields.match });
          throw e;
        }
        // the rule also sorted this transaction when it was waiting and matched: it is not "more"
        const waiting = kind === 'income' ? tx.sourceId === null : tx.subsectionId === null;
        if (waiting && tx.payee.toLowerCase().includes(match.toLowerCase())) sorted = Math.max(0, sorted - 1);
      }
      await api('PATCH', `/transactions/${tx.id}`, {
        payee, note, tags, ...(kind === 'income' ? { sourceId: sourceId ? Number(sourceId) : null } : { subsectionId: subsectionId ? Number(subsectionId) : null, ...splitBody }),
      });
      onClose();
      toast(sorted > 0 ? `Saved. ${sorted} more sorted.` : 'Saved');
      return;
    }
    const amountMinor = parseAmount(amount); // checked before a pocket is created for nothing
    if (amountMinor === null) throw fieldError('amountMinor', AMOUNT_ERROR);
    if (kind === 'transfer') {
      const toAmountMinor = parseAmount(received);
      if (crossing && toAmountMinor === null) throw fieldError('toAmountMinor', TRANSFER_ERROR);
      const b = {
        date, kind, amountMinor, note, pocketId: pocketId && pocketId !== 'new' ? Number(pocketId) : null, toPocketId: toId ? Number(toId) : null,
        ...(crossing ? { toAmountMinor } : {}), subsectionId: subsectionId ? Number(subsectionId) : null, tags,
      };
      if (tx) await api('PATCH', `/transactions/${tx.id}`, b);
      else await api('POST', '/transactions', b);
      onClose();
      toast('Saved');
      return;
    }
    let source = sourceId && sourceId !== 'new' ? Number(sourceId) : null;
    if (kind === 'income' && sourceId === 'new') {
      try {
        source = (await api<{ source: Source }>('POST', '/sources', { name: newSource })).source.id;
      } catch (e) {
        if (e instanceof ApiError && e.fields?.name) throw new ApiError(e.status, e.code, e.message, { sourceName: e.fields.name });
        throw e;
      }
      setSourceId(String(source)); // like the pocket below: it stays chosen if a later request fails
    }
    let pocket = pocketId ? Number(pocketId) : null;
    if (pocketId === 'new') {
      const made = await api<{ pocket: Pocket }>('POST', '/pockets', { name: newName, kind: newKind, emoji: newEmoji, openingBalanceMinor: 0 });
      pocket = made.pocket.id;
      setPocketId(String(pocket)); // if the transaction fails below, the new pocket stays chosen and the panel closes
    }
    const b = {
      date, kind, amountMinor, note,
      payee: kind === 'expense' ? payee : '',
      pocketId: pocket,
      subsectionId: kind === 'expense' && subsectionId ? Number(subsectionId) : null,
      sourceId: kind === 'income' ? source : null,
      tags, ...(kind === 'expense' ? splitBody : {}),
    };
    if (tx) await api('PATCH', `/transactions/${tx.id}`, b);
    else await api('POST', '/transactions', b);
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/transactions/${tx!.id}`);
    if (adjustment) { onClose(); toast('Transaction deleted'); return; } // shortcut: undoing a deleted adjustment is another reconcile, so no Undo here
    const { id: _id, source: _source, baseAmountMinor: _base, attachments: _files, toPocketId, toAmountMinor, ...rest } = tx!;
    const again = tx!.kind === 'transfer' ? { ...rest, toPocketId, toAmountMinor } : rest;
    onClose();
    toast('Transaction deleted', () => void api('POST', '/transactions', again).catch(() => {}));
  });

  const blocked = !adjustment && kind === 'expense' && noSubsections;

  const tagField = (
    <div className="ty-field">
      <label className="ty-label" htmlFor="tx-tags">Tags</label>
      {tagList.length > 0 && (
        <div className="ty-taglist">
          {tagList.map((x) => (
            <span key={x} className="ty-pill ty-tagpill"><span>{x}</span><button type="button" aria-label={`Remove tag ${x}`} onClick={() => setTagList(tagList.filter((y) => y !== x))}>×</button></span>
          ))}
        </div>
      )}
      <input
        id="tx-tags" className={f.errors.tags ? 'ty-input ty-input--error' : 'ty-input'} value={tagText} autoComplete="off"
        onChange={(e) => typeTag(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setTagList(withTags(tagList, tagText)); setTagText(''); } }}
      />
      {suggestions.length > 0 && (
        <div className="ty-chips">
          {suggestions.map((x) => <button key={x} type="button" className="ty-chip" onClick={() => { setTagList(withTags(tagList, x)); setTagText(''); }}>{x}</button>)}
        </div>
      )}
      {f.errors.tags && <span className="ty-error">{f.errors.tags}</span>}
    </div>
  );

  const receiptField = tx && (
    <div className="ty-field">
      <span className="ty-label">Receipts</span>
      {files.length > 0 && (
        <ul className="ty-files">
          {files.map((a) => (
            <li key={a.id}>
              <a className="ty-link" href={`/api/attachments/${a.id}`} target="_blank" rel="noopener">{a.name}</a>
              <span className="ty-cap">{sizeText(a.size)}</span>
              <button type="button" className="ty-btn ty-btn--quiet" aria-label={`Remove ${a.name}`} onClick={() => void detach(a.id)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <label className="ty-btn ty-attach">
          Attach receipt
          <input type="file" className="app-sr-only" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => void attach(e.target)} />
        </label>
      </div>
      {fileError && <span className="ty-error" role="alert">{fileError}</span>}
    </div>
  );

  const splitUi = parts && (
    <fieldset className="ty-fieldset">
      <legend className="ty-label">Parts</legend>
      <div className="ty-parts">
        {parts.map((x, i) => (
          <div key={i} className="ty-part">
            <select className="ty-input" aria-label="Subsection" value={x.subsectionId} onChange={(e) => setParts(parts.map((y, j) => (j === i ? { ...y, subsectionId: e.target.value } : y)))}>
              <option value="" disabled>Choose a subsection</option>
              <SubsectionOptions sections={sections} />
            </select>
            <input className="ty-input ty-input--amount" aria-label="Amount" inputMode="decimal" autoComplete="off" value={x.amount} onChange={(e) => setParts(parts.map((y, j) => (j === i ? { ...y, amount: e.target.value } : y)))} />
            <button type="button" className="ty-btn ty-btn--quiet" aria-label={`Remove part ${i + 1}`} disabled={parts.length <= 2} onClick={() => setParts(parts.filter((_, j) => j !== i))}>Remove</button>
          </div>
        ))}
      </div>
      <div className="ty-partfoot">
        <button type="button" className="ty-btn ty-btn--quiet" disabled={parts.length >= 20} onClick={() => setParts([...parts, { subsectionId: '', amount: '' }])}>+ Add part</button>
        <span className={left < 0 ? 'ty-cap ty-num--neg' : 'ty-cap'}>Left to split {formatMinor(left)}</span>
        <button type="button" className="ty-btn ty-btn--quiet" onClick={() => { setSubsectionId(parts[0]?.subsectionId ?? ''); setParts(null); }}>Remove split</button>
      </div>
      {f.errors.splits && <span className="ty-error">{f.errors.splits}</span>}
    </fieldset>
  );

  return (
    <Modal title={title} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        {!adjustment && <fieldset className="ty-fieldset">
          <legend className="ty-label">Type</legend>
          <div className="ty-segmented">
            <label><input type="radio" name="type" disabled={imported} checked={kind === 'expense'} onChange={() => setKind('expense')} />Expense</label>
            <label><input type="radio" name="type" disabled={imported} checked={kind === 'income'} onChange={() => setKind('income')} />Income</label>
            <label><input type="radio" name="type" disabled={imported} checked={kind === 'transfer'} onChange={() => setKind('transfer')} />Transfer</label>
          </div>
        </fieldset>}
        {adjustment ? (
          <>
            <TextField label="Note (optional)" value={note} onChange={setNote} error={f.errors.note} />
            {tagField}
          </>
        ) : blocked ? (
          <Blocked text="Add a subsection first" to="/budget" link="Go to Budget" onClose={onClose} />
        ) : kind === 'transfer' ? (
          <>
            <TextField label="Date" type="date" value={date} onChange={setDate} error={f.errors.date} />
            <fieldset className="ty-fieldset">
              <legend className="ty-label">From</legend>
              <div className="ty-chips">
                {pockets.map((x) => (
                  <label key={x.id} className="ty-chip">
                    <input type="radio" name="from" checked={pocketId === String(x.id)} onChange={() => { setPocketId(String(x.id)); if (toId === String(x.id)) setToId(''); }} />
                    <span className="ty-emoji">{x.emoji}</span> {x.name}
                  </label>
                ))}
              </div>
              {f.errors.pocketId && <span className="ty-error">{f.errors.pocketId}</span>}
            </fieldset>
            <fieldset className="ty-fieldset">
              <legend className="ty-label">To</legend>
              <div className="ty-chips">
                {pockets.filter((x) => String(x.id) !== pocketId).map((x) => (
                  <label key={x.id} className="ty-chip">
                    <input type="radio" name="to" checked={toId === String(x.id)} onChange={() => setToId(String(x.id))} />
                    <span className="ty-emoji">{x.emoji}</span> {x.name}
                  </label>
                ))}
              </div>
              {f.errors.toPocketId && <span className="ty-error">{f.errors.toPocketId}</span>}
            </fieldset>
            <AmountField label="Amount" value={amount} onChange={setAmount} error={f.errors.amountMinor} currency={fromCode} />
            {crossing && <AmountField label="Amount received" value={received} onChange={setReceived} error={f.errors.toAmountMinor} currency={toCode} hint={rateHint} />}
            <Field label="Subsection (optional)" error={f.errors.subsectionId}>
              {(p) => (
                <select {...p} value={subsectionId} onChange={(e) => setSubsectionId(e.target.value)}>
                  <option value="">None</option>
                  <SubsectionOptions sections={sections} />
                </select>
              )}
            </Field>
            <TextField label="Note (optional)" value={note} onChange={setNote} error={f.errors.note} />
            {tagField}
            {receiptField}
          </>
        ) : (
          <>
            <TextField label="Date" type="date" value={date} onChange={setDate} error={f.errors.date} disabled={imported} />
            <AmountField label="Amount" value={amount} onChange={setAmount} error={f.errors.amountMinor} currency={fromCode} disabled={imported} />
            {(kind === 'expense' || imported) && <TextField label="Payee" value={payee} onChange={setPayee} error={f.errors.payee} />}
            {kind === 'income' && (
              <fieldset className="ty-fieldset">
                <legend className="ty-label">Source</legend>
                <div className="ty-chips">
                  {sources.map((x) => (
                    <label key={x.id} className="ty-chip">
                      <input type="radio" name="source" checked={sourceId === String(x.id)} onChange={() => setSourceId(String(x.id))} />{x.name}
                    </label>
                  ))}
                  {!imported && (
                    <label className="ty-chip ty-chip--add">
                      <input type="radio" name="source" checked={sourceId === 'new'} onChange={() => setSourceId('new')} />+ Add source
                    </label>
                  )}
                </div>
                {f.errors.sourceId && <span className="ty-error">{f.errors.sourceId}</span>}
                {sourceId === 'new' && (
                  <div className="ty-inset">
                    <TextField label="Source name" value={newSource} onChange={setNewSource} error={f.errors.sourceName} />
                  </div>
                )}
              </fieldset>
            )}
            {kind === 'expense' && (parts ? splitUi : (
              <>
                <Field label="Subsection" error={f.errors.subsectionId}>
                  {(p) => (
                    <select {...p} value={subsectionId} onChange={(e) => setSubsectionId(e.target.value)}>
                      <option value="" disabled>Choose a subsection</option>
                      <SubsectionOptions sections={sections} />
                    </select>
                  )}
                </Field>
                <div><button type="button" className="ty-btn ty-btn--quiet" onClick={() => setParts([{ subsectionId, amount }, { subsectionId: '', amount: '' }])}>Split</button></div>
              </>
            ))}
            <fieldset className="ty-fieldset">
              <legend className="ty-label">Pocket</legend>
              <div className="ty-chips">
                {pockets.map((x) => (
                  <label key={x.id} className="ty-chip">
                    <input type="radio" name="pocket" disabled={imported} checked={pocketId === String(x.id)} onChange={() => setPocketId(String(x.id))} />
                    <span className="ty-emoji">{x.emoji}</span> {x.name}
                  </label>
                ))}
                {!imported && (
                  <label className="ty-chip ty-chip--add">
                    <input type="radio" name="pocket" checked={pocketId === 'new'} onChange={() => setPocketId('new')} />+ Add pocket
                  </label>
                )}
              </div>
              {f.errors.pocketId && <span className="ty-error">{f.errors.pocketId}</span>}
              {pocketId === 'new' && (
                <div className="ty-inset">
                  <TextField label="Pocket name" value={newName} onChange={setNewName} error={f.errors.name} />
                  <EmojiPicker value={newEmoji} onChange={setNewEmoji} error={f.errors.emoji} />
                  <KindField value={newKind} onChange={setNewKind} error={f.errors.kind} omit="property" />
                </div>
              )}
            </fieldset>
            {imported && <span className="ty-cap">Imported from a statement: only its subsection or source, payee and note can change.</span>}
            <TextField label="Note (optional)" value={note} onChange={setNote} error={f.errors.note} />
            {tagField}
            {receiptField}
            {imported && (kind === 'income' ? sourceId : subsectionId) && payee.trim() && (
              <div className="ty-field">
                <label><input type="checkbox" checked={always} onChange={(e) => setAlways(e.target.checked)} /> Always use this for {payee.trim()}</label>
                {f.errors.rule && <span className="ty-error">{f.errors.rule}</span>}
              </div>
            )}
          </>
        )}
        {blocked ? (
          <div className="ty-dialog__foot">
            {tx && <button type="button" className="ty-btn ty-btn--danger app-foot-start" onClick={remove}>Delete</button>}
            <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          </div>
        ) : (
          <Foot busy={f.busy} onCancel={onClose} onDelete={tx && remove} label={tx ? 'Save' : title} tone={tx || kind === 'transfer' ? 'primary' : kind === 'income' ? 'income' : 'spend'} />
        )}
      </form>
    </Modal>
  );
}

/* ---------- Pocket ---------- */

export function PocketDialog({ pocket, pockets = [], currency, onReconcile, onClose }: { pocket?: Pocket; pockets?: Pocket[]; currency: string; onReconcile?: () => void; onClose: () => void }) {
  const toast = useToast();
  const { user } = useAuth();
  const f = useForm();
  const g = useForm(); // the "Update value" row has its own errors
  const [name, setName] = useState(pocket?.name ?? '');
  const [kind, setKind] = useState<PocketKind>(pocket?.kind ?? 'bank');
  const [emoji, setEmoji] = useEmoji(pocket?.emoji, kind);
  const debt = kind === 'credit' || kind === 'loan';
  const property = kind === 'property';
  const [opening, setOpening] = useState(minorToInput(pocket?.kind === 'credit' || pocket?.kind === 'loan' ? Math.abs(pocket.openingBalanceMinor) : pocket?.openingBalanceMinor ?? 0));
  const [value, setValue] = useState('');
  const [valueDate, setValueDate] = useState(today());
  const [picked, setPicked] = useState(pocket?.currency);
  const curr = picked ?? (property ? pockets.find((p) => p.id === user.homePocketId)?.currency : undefined) ?? currency;
  const locked = !!pocket?.hasTransactions;
  const offered = useLoad(() => api<Rates>('GET', '/rates'), []).data?.currencies.map((c) => c.currency) ?? [];
  const values = useLoad(() => (pocket?.kind === 'property' ? api<{ values: { id: number; valueMinor: number; date: string }[] }>('GET', `/pockets/${pocket.id}/values`) : Promise.reject()), [pocket?.id]).data?.values;

  const save = f.on(async () => {
    const body = { name, kind, emoji };
    if (property) {
      const valueMinor = parseAmount(value, { allowZero: true });
      if (!pocket && valueMinor === null) throw fieldError('valueMinor', VALUE_ERROR);
      if (pocket) await api('PATCH', `/pockets/${pocket.id}`, curr === pocket.currency ? body : { ...body, currency: curr });
      else await api('POST', '/pockets', { ...body, currency: curr, valueMinor });
    } else {
      const openingBalanceMinor = parseAmount(opening, { allowZero: true, allowNegative: true });
      if (openingBalanceMinor === null) throw fieldError('openingBalanceMinor', BALANCE_ERROR);
      const b = { ...body, openingBalanceMinor };
      if (pocket) await api('PATCH', `/pockets/${pocket.id}`, curr === pocket.currency ? b : { ...b, currency: curr });
      else await api('POST', '/pockets', { ...b, currency: curr });
    }
    onClose();
    toast('Saved');
  });

  const update = g.on(async () => {
    const valueMinor = parseAmount(value, { allowZero: true });
    if (valueMinor === null) throw fieldError('valueMinor', VALUE_ERROR);
    await api('POST', `/pockets/${pocket!.id}/values`, { valueMinor, date: valueDate });
    setValue('');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/pockets/${pocket!.id}`);
    const { name, kind, emoji, openingBalanceMinor, currency } = pocket!;
    onClose();
    toast('Pocket deleted', () => void api('POST', '/pockets', { name, kind, emoji, openingBalanceMinor, currency, ...(kind === 'property' ? { valueMinor: pocket!.valueMinor } : {}) }).catch(() => {}));
  });

  const canReconcile = pocket && onReconcile && ['bank', 'cash', 'credit', 'loan'].includes(pocket.kind) && pocket.syncedBalanceMinor === null;

  return (
    <Modal title={pocket ? 'Edit pocket' : 'Add pocket'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <EmojiPicker value={emoji} onChange={setEmoji} error={f.errors.emoji} />
        <KindField value={kind} onChange={setKind} error={f.errors.kind} />
        <PocketCurrencyField value={curr} onChange={setPicked} error={f.errors.currency} offered={offered} base={currency} locked={locked} />
        {property ? (
          !pocket && <AmountField label="Value" value={value} onChange={setValue} error={f.errors.valueMinor} currency={curr} />
        ) : (
          <AmountField label={debt ? 'Owed now' : 'Opening balance'} value={opening} onChange={setOpening} error={f.errors.openingBalanceMinor} currency={curr} />
        )}
        {property && pocket && (
          <div className="ty-inset">
            <div className="ty-value">
              <span className="ty-label">Current value</span>
              <span className="ty-num">{formatMinor(values ? values.find((v) => v.date <= today())?.valueMinor ?? 0 : pocket.valueMinor)}<span className="ty-cur">{pocket.currency}</span></span>
            </div>
            <FormError message={g.formError} />
            <div className="ty-valuerow">
              <AmountField label="Value" value={value} onChange={setValue} error={g.errors.valueMinor} currency={pocket.currency} />
              <TextField label="Date" type="date" max={today()} value={valueDate} onChange={setValueDate} error={g.errors.date} />
              <button type="button" className="ty-btn" disabled={g.busy} onClick={update}>Update value</button>
            </div>
            {values && values.length > 0 && (
              <ul className="ty-files">
                {values.map((v) => (
                  <li key={v.id}>
                    <span>{dayHeading(v.date)}</span>
                    <span className="ty-num">{formatMinor(v.valueMinor)}</span>
                    <button type="button" className="ty-btn ty-btn--quiet" aria-label={`Remove the value of ${dayHeading(v.date)}`} onClick={() => void api('DELETE', `/pocket-values/${v.id}`).catch(() => {})}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <Foot busy={f.busy} onCancel={onClose} onDelete={pocket && remove} onReconcile={canReconcile ? onReconcile : undefined} label={pocket ? 'Save' : 'Add pocket'} />
      </form>
    </Modal>
  );
}

const VALUE_ERROR = 'Enter an amount, 0 or more, with at most two decimals.';

/** Tell Tally what the bank shows; if it differs, Tally adds an adjustment. A debt is asked as what is owed and sent negative. */
export function ReconcileDialog({ pocket, onClose }: { pocket: Pocket; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const debt = pocket.kind === 'credit' || pocket.kind === 'loan';
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const save = f.on(async () => {
    const shown = parseAmount(amount, { allowZero: true, allowNegative: true });
    if (shown === null) throw fieldError('balanceMinor', BALANCE_ERROR);
    const { adjustment } = await api<{ adjustment: Transaction | null }>('POST', `/pockets/${pocket.id}/reconcile`, { balanceMinor: debt ? -shown : shown, date });
    onClose();
    if (!adjustment) toast(date === today() ? 'Matches. Reconciled today.' : `Matches. Reconciled ${dayLabel(date).slice(4)}.`);
    else toast(`Added an adjustment of ${adjustment.kind === 'income' ? '+' : '−'}${formatMinor(adjustment.amountMinor)}.`, () => void api('DELETE', `/transactions/${adjustment.id}`).catch(() => {}));
  });
  return (
    <Modal title={debt ? `How much does ${pocket.name} say you owe?` : `What does ${pocket.name} show today?`} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError || f.errors.pocketId || ''} />
        <AmountField label={debt ? 'Owed' : 'Balance'} value={amount} onChange={setAmount} error={f.errors.balanceMinor} currency={pocket.currency} hint={debt ? 'Enter a negative amount if it is in credit.' : undefined} />
        <TextField label="Date" type="date" value={date} onChange={setDate} error={f.errors.date} />
        <Foot busy={f.busy} onCancel={onClose} label="Reconcile" />
      </form>
    </Modal>
  );
}

/* ---------- Section and subsection ---------- */

export function SectionDialog({ section, onMove, onClose }: {
  section?: { id: number; name: string; subsections: SubRules[] }; onMove?: () => void; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [name, setName] = useState(section?.name ?? '');

  const save = f.on(async () => {
    if (section) await api('PATCH', `/sections/${section.id}`, { name });
    else await api('POST', '/sections', { name });
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/sections/${section!.id}`);
    const { name, subsections } = section!;
    onClose();
    toast('Section deleted', () => void (async () => {
      const { section: again } = await api<{ section: Section }>('POST', '/sections', { name });
      for (const [i, s] of subsections.entries()) await api('POST', `/sections/${again.id}/subsections`, subBody(s, i + 1));
    })().catch(() => {}));
  });

  return (
    <Modal title={section ? 'Edit section' : 'Add section'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <Foot busy={f.busy} onCancel={onClose} onDelete={section && remove} onMove={section && onMove} label={section ? 'Save' : 'Add section'} />
      </form>
    </Modal>
  );
}

type SubRules = SubsectionRules & { name: string; budgetMinor: number | null; emoji?: string | null; targetMonth?: string | null };

/** The body that recreates a subsection: only the budget and cap fields that apply. */
const subBody = (x: SubRules, position?: number) => ({
  name: x.name, kind: x.kind, budgetKind: x.budgetKind, keep: x.keep, emoji: x.emoji ?? null,
  ...(x.kind === 'goal' && x.targetMonth && x.targetMonth >= currentMonth() ? { targetMonth: x.targetMonth } : {}),
  ...(x.budgetKind === 'percent' ? { budgetBasisPoints: x.budgetBasisPoints } : { budgetMinor: x.budgetMinor }),
  ...(x.keep === 'cap' ? { capMinor: x.capMinor } : {}),
  ...(position ? { position } : {}),
});

const Seg = ({ legend, name, value, options, onChange }: { legend: string; name: string; value: string; options: [string, string][]; onChange: (v: string) => void }) => (
  <fieldset className="ty-fieldset">
    <legend className="ty-label">{legend}</legend>
    <div className="ty-segmented">
      {options.map(([v, label]) => <label key={v}><input type="radio" name={name} checked={value === v} onChange={() => onChange(v)} />{label}</label>)}
    </div>
  </fieldset>
);

export function SubsectionDialog({ sectionId, sub, position, count, held, currency, onMove, onClose }: {
  sectionId: number; sub?: SubRules & { id: number }; position?: number; count: number; held?: string; currency: string; onMove?: () => void; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [name, setName] = useState(sub?.name ?? '');
  const [kind, setKind] = useState(sub?.kind ?? 'spending');
  const [budgetKind, setBudgetKind] = useState(sub?.budgetKind ?? 'amount');
  const [budget, setBudget] = useState(minorToInput(sub?.budgetKind === 'percent' ? 0 : sub?.budgetMinor ?? 0));
  const [percent, setPercent] = useState(sub?.budgetBasisPoints ? percentText(sub.budgetBasisPoints) : '');
  const [keep, setKeep] = useState(sub?.keep ?? 'all');
  const [cap, setCap] = useState(sub?.capMinor ? minorToInput(sub.capMinor) : '');
  const [pos, setPos] = useState(String(position ?? count + 1));
  const [emoji, setEmoji] = useState(sub?.emoji ?? '');
  const [by, setBy] = useState(sub?.targetMonth ?? '');

  const save = f.on(async () => {
    const goal = kind === 'goal';
    const b: Record<string, unknown> = { name, kind, budgetKind, keep: goal ? 'cap' : keep, emoji: emoji || null };
    if (goal) b.targetMonth = by || null;
    if (budgetKind === 'amount') {
      const budgetMinor = parseAmount(budget, { allowZero: true });
      if (budgetMinor === null) throw fieldError('budgetMinor', 'Enter an amount of zero or more, with at most two decimals.');
      b.budgetMinor = budgetMinor;
    } else {
      const bp = parsePercent(percent);
      if (bp === null) throw fieldError('budgetBasisPoints', PERCENT_ERROR);
      b.budgetBasisPoints = bp;
    }
    if (goal || keep === 'cap') {
      const capMinor = parseAmount(cap, { allowZero: !goal });
      if (capMinor === null) throw fieldError('capMinor', goal ? AMOUNT_ERROR : 'Enter an amount of zero or more, with at most two decimals.');
      b.capMinor = capMinor;
    }
    if (sub) await api('PATCH', `/subsections/${sub.id}`, count > 1 ? { ...b, position: Number(pos) } : b);
    else await api('POST', `/sections/${sectionId}/subsections`, b);
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/subsections/${sub!.id}`);
    const again = subBody(sub!, position);
    onClose();
    toast('Subsection deleted', () => void api('POST', `/sections/${sectionId}/subsections`, again).catch(() => {}));
  });

  return (
    <Modal title={sub ? 'Edit subsection' : 'Add subsection'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <EmojiPicker value={emoji} onChange={setEmoji} onClear={() => setEmoji('')} error={f.errors.emoji} />
        {held && <div className="ty-cap">Held investments: {held}</div>}
        <Seg legend="Kind" name="kind" value={kind} onChange={(v) => setKind(v as typeof kind)} options={[['spending', 'Spending'], ['goal', 'Savings goal']]} />
        {f.errors.kind && <span className="ty-error">{f.errors.kind}</span>}
        <Seg legend="Budget" name="budgetKind" value={budgetKind} onChange={(v) => setBudgetKind(v as typeof budgetKind)} options={[['amount', 'Amount'], ['percent', 'Percentage']]} />
        {f.errors.budgetKind && <span className="ty-error">{f.errors.budgetKind}</span>}
        {budgetKind === 'amount' ? (
          <AmountField label="Monthly budget" value={budget} onChange={setBudget} error={f.errors.budgetMinor} currency={currency} />
        ) : (
          <Field label="Percentage" error={f.errors.budgetBasisPoints} hint="Of what is left in the section after the fixed amounts.">
            {(p) => (
              <div className="ty-affix">
                <input {...p} className={`${p.className} ty-input--amount`} inputMode="decimal" autoComplete="off" value={percent} onChange={(e) => setPercent(e.target.value)} />
                <span className="ty-muted">%</span>
              </div>
            )}
          </Field>
        )}
        {kind === 'goal' ? (
          <>
            <AmountField label="Target" value={cap} onChange={setCap} error={f.errors.capMinor} currency={currency} hint="It keeps its money until it reaches the target." />
            <Field label="Reach it by (optional)" error={f.errors.targetMonth}>
              {(p) => <input {...p} type="month" value={by} min={currentMonth()} onChange={(e) => setBy(e.target.value)} />}
            </Field>
          </>
        ) : (<>
          <Seg legend="At month end, keep" name="keep" value={keep} onChange={(v) => setKeep(v as typeof keep)} options={[['all', 'Everything'], ['cap', 'Up to'], ['none', 'Nothing']]} />
          {f.errors.keep && <span className="ty-error">{f.errors.keep}</span>}
          <span className="ty-cap">What is not kept joins the section's rest.</span>
          {keep === 'cap' && <AmountField label="Keep up to" value={cap} onChange={setCap} error={f.errors.capMinor} currency={currency} />}
        </>)}
        {sub && count > 1 && (
          <Field label="Position" error={f.errors.position}>
            {(p) => (
              <select {...p} value={pos} onChange={(e) => setPos(e.target.value)}>
                {Array.from({ length: count }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            )}
          </Field>
        )}
        <Foot busy={f.busy} onCancel={onClose} onDelete={sub && remove} onMove={sub && onMove} label={sub ? 'Save' : 'Add subsection'} />
      </form>
    </Modal>
  );
}

/* ---------- Source ---------- */

export function SourceDialog({ source, boxes, onClose }: {
  source?: { id: number; name: string; boxId: number; isLeftovers?: boolean }; boxes: PipelineBox[]; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const here = source && boxes.find((b) => b.id === source.boxId);
  const alone = !!here && here.sources.length === 1;
  // "" is a box of its own; a source that is alone already has one
  const initial = source && !alone ? String(source.boxId) : '';
  const [name, setName] = useState(source?.name ?? '');
  const [boxId, setBoxId] = useState(initial);
  const others = boxes.filter((b) => !(alone && b.id === source!.boxId));
  const names = (b: PipelineBox) => b.sources.filter((x) => x.id !== source?.id).map((x) => x.name).join(' and ');
  const losesSteps = alone && here!.steps.length > 0 && boxId !== '';

  const save = f.on(async () => {
    const body: { name?: string; boxId?: number | null } = source?.isLeftovers ? {} : { name };
    if (boxId !== initial) body.boxId = boxId ? Number(boxId) : null;
    if (source) await api('PATCH', `/sources/${source.id}`, body);
    else await api('POST', '/sources', body.boxId ? { name, boxId: body.boxId } : { name });
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/sources/${source!.id}`);
    const { name } = source!;
    onClose();
    toast('Source deleted', () => void api('POST', '/sources', { name }).catch(() => {}));
  });

  return (
    <Modal title={source ? 'Edit income source' : 'Add income source'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} disabled={source?.isLeftovers} />
        <Field label="Box" error={f.errors.boxId} hint={losesSteps ? "Its box will have no source left, so that box's steps will be removed." : undefined}>
          {(p) => (
            <select {...p} value={boxId} onChange={(e) => setBoxId(e.target.value)}>
              <option value="">A box of its own</option>
              {others.map((b) => <option key={b.id} value={b.id}>With {names(b)}</option>)}
            </select>
          )}
        </Field>
        <Foot busy={f.busy} onCancel={onClose} onDelete={source && !source.isLeftovers ? remove : undefined} label={source ? 'Save' : 'Add income source'} />
      </form>
    </Modal>
  );
}

/* ---------- Step ---------- */

type Row = { sectionId: string; percent: string };
const MAX_ROWS = 8;
type SelectProps = { id?: string; className?: string; 'aria-label'?: string; 'aria-invalid'?: true; 'aria-describedby'?: string };

const stepBody = (s: PipelineBox['steps'][number]): StepBody =>
  s.kind === 'amount'
    ? { kind: 'amount', sectionId: s.sectionId, amountMinor: s.amountMinor }
    : { kind: 'percent', shares: s.shares.map(({ sectionId, basisPoints }) => ({ sectionId, basisPoints })) };

export function StepDialog({ box, step, sections, currency, onClose }: {
  box: PipelineBox; step?: PipelineBox['steps'][number]; sections: Pipeline['sections']; currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [kind, setKind] = useState<'percent' | 'amount'>(step?.kind ?? 'percent');
  const [rows, setRows] = useState<Row[]>(
    step?.kind === 'percent' ? step.shares.map((x) => ({ sectionId: String(x.sectionId), percent: percentText(x.basisPoints) })) : [{ sectionId: '', percent: '' }],
  );
  const [sectionId, setSectionId] = useState(step?.kind === 'amount' ? String(step.sectionId) : '');
  const [amount, setAmount] = useState(step?.kind === 'amount' ? minorToInput(step.amountMinor) : '');
  const [position, setPosition] = useState(String(step?.position ?? ''));
  // controls that failed the check in the page; null means a server error on `shares`, which marks every row
  const [bad, setBad] = useState<string[] | null>(null);
  const setRow = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = f.on(async () => {
    let body: StepBody;
    setBad(null);
    if (kind === 'amount') {
      if (!sectionId) throw fieldError('sectionId', 'Choose a section.');
      const amountMinor = parseAmount(amount);
      if (amountMinor === null) throw fieldError('amountMinor', AMOUNT_ERROR);
      body = { kind, sectionId: Number(sectionId), amountMinor };
    } else {
      const noSection = rows.flatMap((r, i) => (r.sectionId ? [] : [`s${i}`]));
      if (noSection.length) { setBad(noSection); throw fieldError('shares', 'Choose a section in every row.'); }
      const basisPoints = rows.map((r) => parsePercent(r.percent));
      if (basisPoints.includes(null)) { setBad(basisPoints.flatMap((b, i) => (b === null ? [`p${i}`] : []))); throw fieldError('shares', PERCENT_ERROR); }
      body = { kind, shares: rows.map((r, i) => ({ sectionId: Number(r.sectionId), basisPoints: basisPoints[i]! })) };
    }
    if (step) await api('PUT', `/steps/${step.id}`, { ...body, position: Number(position) });
    else await api('POST', `/boxes/${box.id}/steps`, body);
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/steps/${step!.id}`);
    const again = { ...stepBody(step!), position: step!.position };
    onClose();
    toast('Step deleted', () => void api('POST', `/boxes/${box.id}/steps`, again).catch(() => {}));
  });

  const inError = (key: string) => !!f.errors.shares && (bad === null || bad.includes(key));
  const sectionSelect = (p: SelectProps, value: string, set: (v: string) => void) => (
    <select {...p} value={value} onChange={(e) => set(e.target.value)}>
      <option value="" disabled>Choose a section</option>
      {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
  );

  return (
    <Modal title={step ? 'Edit step' : 'Add step'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        {sections.length === 0 ? (
          <div>Add a section first</div>
        ) : (<>
          <fieldset className="ty-fieldset">
            <legend className="ty-label">Takes</legend>
            <div className="ty-segmented">
              <label><input type="radio" name="takes" checked={kind === 'percent'} onChange={() => setKind('percent')} />Percentage</label>
              <label><input type="radio" name="takes" checked={kind === 'amount'} onChange={() => setKind('amount')} />Amount</label>
            </div>
          </fieldset>
          {kind === 'percent' ? (
            <div className="ty-field">
              <div className="ty-shares">
                <span className="ty-label">Section</span><span className="ty-label">Percentage</span><span />
                {rows.map((r, i) => {
                  const flag = (key: string) => (inError(key) ? { 'aria-invalid': true as const, 'aria-describedby': 'shares-error' } : {});
                  const cls = (key: string, extra = '') => `ty-input${extra}${inError(key) ? ' ty-input--error' : ''}`;
                  return (
                    <Fragment key={i}>
                      {sectionSelect({ className: cls(`s${i}`), 'aria-label': `Section ${i + 1}`, ...flag(`s${i}`) }, r.sectionId, (v) => setRow(i, { sectionId: v }))}
                      <div className="ty-affix">
                        <input className={cls(`p${i}`, ' ty-input--amount')} aria-label={`Percentage ${i + 1}`} inputMode="decimal" autoComplete="off" value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} {...flag(`p${i}`)} />
                        <span className="ty-muted">%</span>
                      </div>
                      {rows.length > 1
                        ? <button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" aria-label={`Remove destination ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
                        : <span />}
                    </Fragment>
                  );
                })}
              </div>
              {f.errors.shares && <span className="ty-error" id="shares-error">{f.errors.shares}</span>}
              {rows.length < MAX_ROWS && (
                <div><button type="button" className="ty-btn ty-btn--sm" onClick={() => setRows([...rows, { sectionId: '', percent: '' }])}>+ Add destination</button></div>
              )}
              <span className="ty-cap">Each destination takes its percentage from what reaches this step. Together they can be at most 100%.</span>
            </div>
          ) : (<>
            <Field label="Section" error={f.errors.sectionId}>{(p) => sectionSelect(p, sectionId, setSectionId)}</Field>
            <AmountField label="Amount" value={amount} onChange={setAmount} error={f.errors.amountMinor} currency={currency} hint="For the whole month, however many payments come in." />
          </>)}
          {step && box.steps.length > 1 && (
            <Field label="Position" error={f.errors.position}>
              {(p) => (
                <select {...p} value={position} onChange={(e) => setPosition(e.target.value)}>
                  {box.steps.map((_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
              )}
            </Field>
          )}
        </>)}
        {sections.length === 0 ? (
          <div className="ty-dialog__foot">
            {step && <button type="button" className="ty-btn ty-btn--danger app-foot-start" onClick={remove}>Delete</button>}
            <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          </div>
        ) : (
          <Foot busy={f.busy} onCancel={onClose} onDelete={step && remove} label={step ? 'Save' : 'Add step'} />
        )}
      </form>
    </Modal>
  );
}

const dot = (slot: number) => (slot >= 1 && slot <= 8 ? `ty-dot ty-dot--${slot}` : 'ty-dot');

/* ---------- Close a month ---------- */

export function CloseDialog({ month, sections, onClose }: { month: string; sections: { id: number; name: string; colorSlot: number }[]; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const [summary, setSummary] = useState<CloseSummary>();
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    api<CloseSummary>('GET', `/months/${month}/close`).then(setSummary, (e) => setLoadError(e instanceof Error ? e.message : 'Something went wrong. Try again.'));
  }, [month]);

  const save = f.on(async () => {
    await api('POST', `/months/${month}/close`);
    onClose();
    toast(`${monthTitle(month)} closed`);
  });

  const name = monthName(month);
  const next = monthName(summary?.nextMonth ?? shiftMonth(month, 1));
  const section = (id: number | null) => sections.find((x) => x.id === id);
  const row = (r: CloseSummary['rows'][number], i: number) => {
    const from = section(r.fromSectionId);
    const to = section(r.toSectionId);
    const income = `${next}'s income`;
    const dest = to ? <span className="ty-tag"><span className={dot(to.colorSlot)} />{to.name}</span> : income;
    const words = !from ? `Left over to ${income}`
      : r.amountMinor < 0 ? <>Overspent in {from.name}, {to ? 'kept in ' : 'taken from '}{dest}</>
      : r.basisPoints < 10000 ? <>Rest of {from.name}, {percentText(r.basisPoints)}% to {dest}</>
      : <>Rest of {from.name} to {dest}</>;
    return (
      <div className="ty-restrow" key={i}>
        <span>{words}</span>
        <span className="ty-num ty-right">{formatMinor(r.amountMinor)}</span>
      </div>
    );
  };

  return (
    <Modal title={`Close ${monthTitle(month)}`} sub={`This carries what is left into ${next}. You can reopen ${name} while ${next} is still open.`} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError || loadError} />
        {summary && (
          <div className="ty-stack">
            {summary.rows.map(row)}
            <div className="ty-sum"><span>Last month's leftovers in {next}</span><span className="ty-num">{formatMinor(summary.incomeMinor)}</span></div>
            {summary.keptMinor > 0 && <p className="ty-cap" style={{ margin: 0 }}>Subsections keep what they did not spend: {formatMinor(summary.keptMinor)}.</p>}
          </div>
        )}
        <Foot busy={f.busy || !summary} onCancel={onClose} label={`Close ${name}`} />
      </form>
    </Modal>
  );
}

/* ---------- Rest rule ---------- */

type RestRow = { to: string; percent: string }; // to: '' none chosen, 'income', or a section id

export function RestDialog({ section, sections, onClose }: {
  section: Pipeline['sections'][number]; sections: Pipeline['sections']; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [rows, setRows] = useState<RestRow[]>(section.rest.shares.map((x) => ({ to: x.sectionId === null ? 'income' : String(x.sectionId), percent: percentText(x.basisPoints) })));
  const [overspent, setOverspent] = useState(section.rest.overspent);
  const [bad, setBad] = useState<string[] | null>(null); // as in StepDialog: null means every row
  const setRow = (i: number, patch: Partial<RestRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = f.on(async () => {
    setBad(null);
    const none = rows.flatMap((r, i) => (r.to ? [] : [`s${i}`]));
    if (none.length) { setBad(none); throw fieldError('shares', 'Choose where every row goes.'); }
    const basisPoints = rows.map((r) => parsePercent(r.percent));
    if (basisPoints.includes(null)) { setBad(basisPoints.flatMap((b, i) => (b === null ? [`p${i}`] : []))); throw fieldError('shares', PERCENT_ERROR); }
    await api('PUT', `/sections/${section.id}/rest`, {
      shares: rows.map((r, i) => ({ sectionId: r.to === 'income' ? null : Number(r.to), basisPoints: basisPoints[i]! })),
      overspent,
    });
    onClose();
    toast('Saved');
  });

  const inError = (key: string) => !!f.errors.shares && (bad === null || bad.includes(key));

  return (
    <Modal title={`Rest of ${section.name}`} sub={`Where the rest of ${section.name} goes when a month closes: what no subsection claimed, less what subsections overspent.`} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <div className="ty-field">
          <div className="ty-shares">
            <span className="ty-label">Goes to</span><span className="ty-label">Percentage</span><span />
            {rows.map((r, i) => {
              const flag = (key: string) => (inError(key) ? { 'aria-invalid': true as const, 'aria-describedby': 'shares-error' } : {});
              const cls = (key: string, extra = '') => `ty-input${extra}${inError(key) ? ' ty-input--error' : ''}`;
              return (
                <Fragment key={i}>
                  <select className={cls(`s${i}`)} aria-label={`Goes to ${i + 1}`} value={r.to} onChange={(e) => setRow(i, { to: e.target.value })} {...flag(`s${i}`)}>
                    <option value="" disabled>Choose where it goes</option>
                    <option value="income">Next month's income</option>
                    {sections.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                  <div className="ty-affix">
                    <input className={cls(`p${i}`, ' ty-input--amount')} aria-label={`Percentage ${i + 1}`} inputMode="decimal" autoComplete="off" value={r.percent} onChange={(e) => setRow(i, { percent: e.target.value })} {...flag(`p${i}`)} />
                    <span className="ty-muted">%</span>
                  </div>
                  {rows.length > 1
                    ? <button type="button" className="ty-btn ty-btn--quiet ty-btn--sm" aria-label={`Remove destination ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
                    : <span />}
                </Fragment>
              );
            })}
          </div>
          {f.errors.shares && <span className="ty-error" id="shares-error">{f.errors.shares}</span>}
          {rows.length < MAX_ROWS && (
            <div><button type="button" className="ty-btn ty-btn--sm" onClick={() => setRows([...rows, { to: '', percent: '' }])}>+ Add destination</button></div>
          )}
          <span className="ty-cap">Together the percentages make 100%.</span>
        </div>
        <fieldset className="ty-fieldset">
          <legend className="ty-label">When overspent, take it from</legend>
          <div className="ty-segmented">
            <label><input type="radio" name="overspent" checked={overspent === 'income'} onChange={() => setOverspent('income')} />Next month's income</label>
            <label><input type="radio" name="overspent" checked={overspent === 'section'} onChange={() => setOverspent('section')} />{section.name} next month</label>
          </div>
          {f.errors.overspent && <span className="ty-error">{f.errors.overspent}</span>}
        </fieldset>
        <Foot busy={f.busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

/* ---------- Move money ---------- */

/** One place money can move from or to: a subsection, or a section's rest. */
type MoveEnd = { key: string; label: string; end: End; availableMinor: number };

const moveEnds = (sections: BudgetSection[]): MoveEnd[] => sections.flatMap((s) => [
  { key: `r${s.id}`, label: `Rest of ${s.name}`, end: { sectionId: s.id }, availableMinor: s.restMinor },
  ...s.subsections.map((x) => ({ key: `s${x.id}`, label: subLabel(x), end: { subsectionId: x.id }, availableMinor: x.availableMinor })),
]);

export const endKey = (e: End) => ('sectionId' in e ? `r${e.sectionId}` : `s${e.subsectionId}`);

export function MoveDialog({ month, sections, from: start, currency, onClose }: {
  month: string; sections: BudgetSection[]; from: End; currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const ends = moveEnds(sections);
  const [from, setFrom] = useState(endKey(start));
  const [to, setTo] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const src = ends.find((e) => e.key === from)!;
  const minor = parseAmount(amount);
  const hint = minor !== null && minor <= src.availableMinor ? `${src.label} has ${formatMinor(src.availableMinor)}. After the move: ${formatMinor(src.availableMinor - minor)}.` : `${src.label} has ${formatMinor(src.availableMinor)}.`;
  const options = (
    <>{sections.map((s) => (
      <optgroup key={s.id} label={s.name}>
        {ends.filter((e) => e.key === `r${s.id}` || s.subsections.some((x) => `s${x.id}` === e.key)).map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
      </optgroup>
    ))}</>
  );

  const save = f.on(async () => {
    const dest = ends.find((e) => e.key === to);
    if (!dest) throw fieldError('to', 'Choose where the money goes.');
    if (dest.key === src.key) throw fieldError('to', 'Choose a different place.');
    if (minor === null) throw fieldError('amountMinor', 'Enter an amount above zero.');
    if (src.availableMinor <= 0) throw fieldError('amountMinor', `${src.label} has nothing to move.`);
    if (minor > src.availableMinor) throw fieldError('amountMinor', `${src.label} has only ${formatMinor(src.availableMinor)} to move.`);
    if (!reason.trim()) throw fieldError('reason', 'Say why you are moving this money.');
    await api('POST', '/moves', { month, from: src.end, to: dest.end, amountMinor: minor, reason: reason.trim() });
    onClose();
    toast(`Moved ${formatMinor(minor)}`);
  });

  return (
    <Modal title={`Move money in ${monthTitle(month)}`} sub="Moving money changes your plan for the month. Do it when you have to, and say why." onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <Field label="From" error={f.errors.from}>{(p) => <select {...p} value={from} onChange={(e) => setFrom(e.target.value)}>{options}</select>}</Field>
        <Field label="To" error={f.errors.to}>{(p) => <select {...p} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose a place</option>{options}</select>}</Field>
        <AmountField label="Amount" value={amount} onChange={setAmount} error={f.errors.amountMinor} currency={currency} hint={hint} />
        <TextField label="Why" value={reason} onChange={setReason} error={f.errors.reason} />
        <Foot busy={f.busy} onCancel={onClose} label={minor === null ? 'Move' : `Move ${formatMinor(minor)}`} />
      </form>
    </Modal>
  );
}
