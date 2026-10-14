import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, DEFAULT_EMOJI, fieldError, useForm, type CloseSummary, type SubsectionRules, type Pipeline, type PipelineBox, type Pocket, type PocketKind, type Section, type Source, type StepBody, type Transaction } from './api';
import { monthName, monthTitle, shiftMonth, today } from './dates';
import { AMOUNT_ERROR, formatMinor, minorToInput, parseAmount, parsePercent, percentText, PERCENT_ERROR } from './money';
import { AmountField, EmojiPicker, Field, FormError, KindField, Modal, SubsectionOptions, TextField, useToast } from './ui';

const BALANCE_ERROR = 'Enter an amount, with at most two decimals.';

function Foot({ busy, onCancel, onDelete, label = 'Save', tone = 'primary' }: { busy: boolean; onCancel: () => void; onDelete?: () => void; label?: string; tone?: 'primary' | 'income' | 'spend' }) {
  return (
    <div className="ty-dialog__foot">
      {onDelete && <button type="button" className="ty-btn ty-btn--danger app-foot-start" disabled={busy} onClick={onDelete}>Delete</button>}
      <button type="button" className="ty-btn ty-btn--quiet" onClick={onCancel}>Cancel</button>
      <button type="submit" className={`ty-btn ty-btn--${tone}`} disabled={busy}>{label}</button>
    </div>
  );
}

const Blocked = ({ text, to, link, onClose }: { text: string; to: string; link: string; onClose: () => void }) => (
  <div className="ty-stack">
    <div>{text}. <Link className="app-link" to={to} onClick={onClose}>{link}</Link></div>
  </div>
);

/* ---------- Transaction ---------- */

/** The emoji follows the kind until the person picks one (or the pocket already has one). */
function useEmoji(initial: string | undefined, kind: PocketKind) {
  const [picked, setPicked] = useState(initial);
  return [picked ?? DEFAULT_EMOJI[kind], setPicked] as const;
}

export function TransactionDialog({ tx, kind: startKind, pockets, sections, sources: allSources, currency, onClose }: {
  tx?: Transaction; kind?: 'expense' | 'income'; pockets: Pocket[]; sections: Section[]; sources: Source[]; currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const sources = allSources.filter((x) => !x.isLeftovers); // money carried from last month is not entered by hand
  const f = useForm();
  const [kind, setKind] = useState<'expense' | 'income'>(tx?.kind ?? startKind ?? 'expense');
  const [date, setDate] = useState(tx?.date ?? today());
  const [amount, setAmount] = useState(tx ? minorToInput(tx.amountMinor) : '');
  const [payee, setPayee] = useState(tx?.payee ?? '');
  // 'new' is the "+ Add source" chip
  const [sourceId, setSourceId] = useState(tx?.sourceId?.toString() ?? sources[0]?.id.toString() ?? 'new');
  const [newSource, setNewSource] = useState('');
  const [subsectionId, setSubsectionId] = useState(tx?.subsectionId?.toString() ?? '');
  // 'new' is the "+ Add pocket" chip
  const [pocketId, setPocketId] = useState(tx?.pocketId?.toString() ?? pockets[0]?.id.toString() ?? 'new');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<PocketKind>('bank');
  const [newEmoji, setNewEmoji] = useEmoji(undefined, newKind);
  const [note, setNote] = useState(tx?.note ?? '');
  const noSubsections = !sections.some((s) => s.subsections.length);
  const title = `${tx ? 'Edit' : 'Add'} ${kind}`;

  const save = f.on(async () => {
    const amountMinor = parseAmount(amount); // checked before a pocket is created for nothing
    if (amountMinor === null) throw fieldError('amountMinor', AMOUNT_ERROR);
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
    };
    if (tx) await api('PATCH', `/transactions/${tx.id}`, b);
    else await api('POST', '/transactions', b);
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/transactions/${tx!.id}`);
    const { id: _id, source: _source, ...again } = tx!;
    onClose();
    toast('Transaction deleted', () => void api('POST', '/transactions', again).catch(() => {}));
  });

  const blocked = kind === 'expense' && noSubsections;

  return (
    <Modal title={title} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <fieldset className="ty-fieldset">
          <legend className="ty-label">Type</legend>
          <div className="ty-segmented">
            <label><input type="radio" name="type" checked={kind === 'expense'} onChange={() => setKind('expense')} />Expense</label>
            <label><input type="radio" name="type" checked={kind === 'income'} onChange={() => setKind('income')} />Income</label>
          </div>
        </fieldset>
        {blocked ? (
          <Blocked text="Add a subsection first" to="/budget" link="Go to Budget" onClose={onClose} />
        ) : (
          <>
            <TextField label="Date" type="date" value={date} onChange={setDate} error={f.errors.date} />
            <AmountField label="Amount" value={amount} onChange={setAmount} error={f.errors.amountMinor} currency={currency} />
            {kind === 'expense' ? (
              <TextField label="Payee" value={payee} onChange={setPayee} error={f.errors.payee} />
            ) : (
              <fieldset className="ty-fieldset">
                <legend className="ty-label">Source</legend>
                <div className="ty-chips">
                  {sources.map((x) => (
                    <label key={x.id} className="ty-chip">
                      <input type="radio" name="source" checked={sourceId === String(x.id)} onChange={() => setSourceId(String(x.id))} />{x.name}
                    </label>
                  ))}
                  <label className="ty-chip ty-chip--add">
                    <input type="radio" name="source" checked={sourceId === 'new'} onChange={() => setSourceId('new')} />+ Add source
                  </label>
                </div>
                {f.errors.sourceId && <span className="ty-error">{f.errors.sourceId}</span>}
                {sourceId === 'new' && (
                  <div className="ty-inset">
                    <TextField label="Source name" value={newSource} onChange={setNewSource} error={f.errors.sourceName} />
                  </div>
                )}
              </fieldset>
            )}
            {kind === 'expense' && (
              <Field label="Subsection" error={f.errors.subsectionId}>
                {(p) => (
                  <select {...p} value={subsectionId} onChange={(e) => setSubsectionId(e.target.value)}>
                    <option value="" disabled>Choose a subsection</option>
                    <SubsectionOptions sections={sections} />
                  </select>
                )}
              </Field>
            )}
            <fieldset className="ty-fieldset">
              <legend className="ty-label">Pocket</legend>
              <div className="ty-chips">
                {pockets.map((x) => (
                  <label key={x.id} className="ty-chip">
                    <input type="radio" name="pocket" checked={pocketId === String(x.id)} onChange={() => setPocketId(String(x.id))} />
                    <span className="ty-emoji">{x.emoji}</span> {x.name}
                  </label>
                ))}
                <label className="ty-chip ty-chip--add">
                  <input type="radio" name="pocket" checked={pocketId === 'new'} onChange={() => setPocketId('new')} />+ Add pocket
                </label>
              </div>
              {f.errors.pocketId && <span className="ty-error">{f.errors.pocketId}</span>}
              {pocketId === 'new' && (
                <div className="ty-inset">
                  <TextField label="Pocket name" value={newName} onChange={setNewName} error={f.errors.name} />
                  <EmojiPicker value={newEmoji} onChange={setNewEmoji} error={f.errors.emoji} />
                  <KindField value={newKind} onChange={setNewKind} error={f.errors.kind} />
                </div>
              )}
            </fieldset>
            <TextField label="Note (optional)" value={note} onChange={setNote} error={f.errors.note} />
          </>
        )}
        {blocked ? (
          <div className="ty-dialog__foot">
            {tx && <button type="button" className="ty-btn ty-btn--danger app-foot-start" onClick={remove}>Delete</button>}
            <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          </div>
        ) : (
          <Foot busy={f.busy} onCancel={onClose} onDelete={tx && remove} label={tx ? 'Save' : title} tone={tx ? 'primary' : kind === 'income' ? 'income' : 'spend'} />
        )}
      </form>
    </Modal>
  );
}

/* ---------- Pocket ---------- */

export function PocketDialog({ pocket, currency, onClose }: { pocket?: Pocket; currency: string; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const [name, setName] = useState(pocket?.name ?? '');
  const [kind, setKind] = useState<PocketKind>(pocket?.kind ?? 'bank');
  const [emoji, setEmoji] = useEmoji(pocket?.emoji, kind);
  const [opening, setOpening] = useState(minorToInput(pocket?.openingBalanceMinor ?? 0));

  const save = f.on(async () => {
    const openingBalanceMinor = parseAmount(opening, { allowZero: true, allowNegative: true });
    if (openingBalanceMinor === null) throw fieldError('openingBalanceMinor', BALANCE_ERROR);
    const b = { name, kind, emoji, openingBalanceMinor };
    if (pocket) await api('PATCH', `/pockets/${pocket.id}`, b);
    else await api('POST', '/pockets', b);
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await api('DELETE', `/pockets/${pocket!.id}`);
    const { name, kind, emoji, openingBalanceMinor } = pocket!;
    onClose();
    toast('Pocket deleted', () => void api('POST', '/pockets', { name, kind, emoji, openingBalanceMinor }).catch(() => {}));
  });

  return (
    <Modal title={pocket ? 'Edit pocket' : 'Add pocket'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <EmojiPicker value={emoji} onChange={setEmoji} error={f.errors.emoji} />
        <KindField value={kind} onChange={setKind} error={f.errors.kind} />
        <AmountField label="Opening balance" value={opening} onChange={setOpening} error={f.errors.openingBalanceMinor} currency={currency} />
        <Foot busy={f.busy} onCancel={onClose} onDelete={pocket && remove} label={pocket ? 'Save' : 'Add pocket'} />
      </form>
    </Modal>
  );
}

/* ---------- Section and subsection ---------- */

export function SectionDialog({ section, onClose }: {
  section?: { id: number; name: string; subsections: SubRules[] }; onClose: () => void;
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
        <Foot busy={f.busy} onCancel={onClose} onDelete={section && remove} label={section ? 'Save' : 'Add section'} />
      </form>
    </Modal>
  );
}

type SubRules = SubsectionRules & { name: string; budgetMinor: number | null };

/** The body that recreates a subsection: only the budget and cap fields that apply. */
const subBody = (x: SubRules, position?: number) => ({
  name: x.name, kind: x.kind, budgetKind: x.budgetKind, keep: x.keep,
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

export function SubsectionDialog({ sectionId, sub, position, count, currency, onClose }: {
  sectionId: number; sub?: SubRules & { id: number }; position?: number; count: number; currency: string; onClose: () => void;
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

  const save = f.on(async () => {
    const goal = kind === 'goal';
    const b: Record<string, unknown> = { name, kind, budgetKind, keep: goal ? 'cap' : keep };
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
          <AmountField label="Target" value={cap} onChange={setCap} error={f.errors.capMinor} currency={currency} hint="It keeps its money until it reaches the target." />
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
        <Foot busy={f.busy} onCancel={onClose} onDelete={sub && remove} label={sub ? 'Save' : 'Add subsection'} />
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
