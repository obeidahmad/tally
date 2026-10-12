import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, DEFAULT_EMOJI, fieldError, useForm, type BudgetKind, type Pocket, type PocketKind, type Section, type Transaction } from './api';
import { today } from './dates';
import { AMOUNT_ERROR, minorToInput, parseAmount, parsePercent, percentText, PERCENT_ERROR } from './money';
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

/** DELETE that turns a 409 in_use into the sentence the dialog shows. */
async function deleteOrExplain(path: string, what: 'pocket' | 'subsection' | 'section') {
  try {
    await api('DELETE', path);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'in_use') throw new Error(`This ${what} has transactions. Delete them first.`);
    throw e;
  }
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

export function TransactionDialog({ tx, kind: startKind, pockets, sections, currency, onClose }: {
  tx?: Transaction; kind?: 'expense' | 'income'; pockets: Pocket[]; sections: Section[]; currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [kind, setKind] = useState<'expense' | 'income'>(tx?.kind ?? startKind ?? 'expense');
  const [date, setDate] = useState(tx?.date ?? today());
  const [amount, setAmount] = useState(tx ? minorToInput(tx.amountMinor) : '');
  const [payee, setPayee] = useState(tx?.payee ?? '');
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
    let pocket = pocketId ? Number(pocketId) : null;
    if (pocketId === 'new') {
      const made = await api<{ pocket: Pocket }>('POST', '/pockets', { name: newName, kind: newKind, emoji: newEmoji, openingBalanceMinor: 0 });
      pocket = made.pocket.id;
      setPocketId(String(pocket)); // if the transaction fails below, the new pocket stays chosen and the panel closes
    }
    const b = {
      date, kind, amountMinor, payee, note,
      pocketId: pocket,
      subsectionId: kind === 'expense' && subsectionId ? Number(subsectionId) : null,
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
            <TextField label="Payee" value={payee} onChange={setPayee} error={f.errors.payee} />
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
    await deleteOrExplain(`/pockets/${pocket!.id}`, 'pocket');
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

const BUDGET_KINDS: [BudgetKind, string][] = [['percent', 'Percentage'], ['fixed', 'Fixed amount'], ['subsections', 'Subsections']];
const MONTHLY_ERROR = 'Enter an amount of zero or more, with at most two decimals.';

export function SectionDialog({ section, currency, onClose }: {
  section?: { id: number; name: string; budgetKind: BudgetKind; budgetMinor: number | null; budgetBasisPoints: number | null; subsections: { name: string; budgetMinor: number }[] };
  currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [name, setName] = useState(section?.name ?? '');
  const [kind, setKind] = useState<BudgetKind>(section?.budgetKind ?? 'percent');
  const [amount, setAmount] = useState(section?.budgetMinor != null ? minorToInput(section.budgetMinor) : '');
  const [percent, setPercent] = useState(section?.budgetBasisPoints != null ? percentText(section.budgetBasisPoints) : '');

  const save = f.on(async () => {
    const budgetMinor = kind === 'fixed' ? parseAmount(amount, { allowZero: true }) : null;
    const budgetBasisPoints = kind === 'percent' ? parsePercent(percent) : null;
    if (kind === 'fixed' && budgetMinor === null) throw fieldError('budgetMinor', MONTHLY_ERROR);
    if (kind === 'percent' && budgetBasisPoints === null) throw fieldError('budgetBasisPoints', PERCENT_ERROR);
    const body = { name, budgetKind: kind, budgetMinor, budgetBasisPoints };
    if (section) await api('PATCH', `/sections/${section.id}`, body);
    else await api('POST', '/sections', body);
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await deleteOrExplain(`/sections/${section!.id}`, 'section');
    const { name, budgetKind, budgetMinor, budgetBasisPoints, subsections } = section!;
    onClose();
    toast('Section deleted', () => void (async () => {
      const { section: again } = await api<{ section: Section }>('POST', '/sections', { name, budgetKind, budgetMinor, budgetBasisPoints });
      for (const s of subsections) await api('POST', `/sections/${again.id}/subsections`, { name: s.name, budgetMinor: s.budgetMinor });
    })().catch(() => {}));
  });

  return (
    <Modal title={section ? 'Edit section' : 'Add section'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <fieldset className="ty-fieldset">
          <legend className="ty-label">Budget</legend>
          <div className="ty-segmented">
            {BUDGET_KINDS.map(([k, label]) => (
              <label key={k}><input type="radio" name="budget" checked={kind === k} onChange={() => setKind(k)} />{label}</label>
            ))}
          </div>
          {f.errors.budgetKind && <span className="ty-error">{f.errors.budgetKind}</span>}
        </fieldset>
        {kind === 'fixed' && <AmountField label="Monthly budget" value={amount} onChange={setAmount} error={f.errors.budgetMinor} currency={currency} />}
        {kind === 'percent' && <AmountField label="Percentage" value={percent} onChange={setPercent} error={f.errors.budgetBasisPoints} currency="%" hint="Of the month's income left after fixed-amount sections." />}
        {kind === 'subsections' && <span className="ty-cap">The total of its subsections' budgets.</span>}
        <Foot busy={f.busy} onCancel={onClose} onDelete={section && remove} label={section ? 'Save' : 'Add section'} />
      </form>
    </Modal>
  );
}

export function SubsectionDialog({ sectionId, sub, currency, onClose }: {
  sectionId: number; sub?: { id: number; name: string; budgetMinor: number }; currency: string; onClose: () => void;
}) {
  const toast = useToast();
  const f = useForm();
  const [name, setName] = useState(sub?.name ?? '');
  const [budget, setBudget] = useState(minorToInput(sub?.budgetMinor ?? 0));

  const save = f.on(async () => {
    const budgetMinor = parseAmount(budget, { allowZero: true });
    if (budgetMinor === null) throw fieldError('budgetMinor', 'Enter an amount of zero or more, with at most two decimals.');
    if (sub) await api('PATCH', `/subsections/${sub.id}`, { name, budgetMinor });
    else await api('POST', `/sections/${sectionId}/subsections`, { name, budgetMinor });
    onClose();
    toast('Saved');
  });

  const remove = f.on(async () => {
    await deleteOrExplain(`/subsections/${sub!.id}`, 'subsection');
    const { name, budgetMinor } = sub!;
    onClose();
    toast('Subsection deleted', () => void api('POST', `/sections/${sectionId}/subsections`, { name, budgetMinor }).catch(() => {}));
  });

  return (
    <Modal title={sub ? 'Edit subsection' : 'Add subsection'} onClose={onClose}>
      <form className="ty-stack" onSubmit={save} noValidate>
        <FormError message={f.formError} />
        <TextField label="Name" value={name} onChange={setName} error={f.errors.name} />
        <AmountField label="Monthly budget" value={budget} onChange={setBudget} error={f.errors.budgetMinor} currency={currency} />
        <Foot busy={f.busy} onCancel={onClose} onDelete={sub && remove} label={sub ? 'Save' : 'Add subsection'} />
      </form>
    </Modal>
  );
}
