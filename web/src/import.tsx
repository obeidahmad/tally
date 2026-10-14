import { useState } from 'react';
import { api, fieldError, useForm, type Pocket } from './api';
import { Field, FormError, Modal } from './ui';

type Guess = Partial<Record<'date' | 'amount' | 'debit' | 'credit' | 'payee' | 'note', number | null>> & {
  dateFormat?: string | null; decimal?: string | null;
};
type Preview = { delimiter: string; headers: string[]; rows: string[][]; guess: Guess | null };
type Result = { added: number; duplicates: number; closed: number; unsorted: number };

const DATE_FORMATS = ['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD.MM.YYYY'];
const SPLIT = 'split';
const MAPPING_ERROR = 'Choose a column for Date, Payee and Amount (or Debit and Credit).';

const col = (n: number | null | undefined) => (n === null || n === undefined ? '' : String(n));
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function ImportDialog({ pockets, onClose }: { pockets: Pocket[]; onClose: () => void }) {
  const f = useForm();
  const [pocketId, setPocketId] = useState(String(pockets[0]?.id ?? ''));
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview>();
  const [result, setResult] = useState<Result>();
  const [m, setM] = useState({ date: '', dateFormat: DATE_FORMATS[0], amount: '', debit: '', credit: '', payee: '', note: '', decimal: '.' });
  const set = (k: keyof typeof m) => (v: string) => setM((x) => ({ ...x, [k]: v }));

  const next = f.on(async () => {
    if (!pocketId) throw fieldError('pocketId', 'Choose a pocket.');
    if (!file) throw fieldError('text', 'Choose a CSV file.');
    const content = await file.text();
    const p = await api<Preview>('POST', '/imports/preview', { pocketId: Number(pocketId), text: content });
    const g = p.guess ?? {};
    setText(content);
    setPreview(p);
    setM({
      date: col(g.date), dateFormat: g.dateFormat ?? DATE_FORMATS[0],
      amount: g.amount != null ? col(g.amount) : g.debit != null && g.credit != null ? SPLIT : '',
      debit: col(g.debit), credit: col(g.credit), payee: col(g.payee), note: col(g.note), decimal: g.decimal ?? '.',
    });
  });

  const run = f.on(async () => {
    const split = m.amount === SPLIT;
    if (!m.date || !m.payee || (split ? !m.debit || !m.credit : !m.amount)) throw fieldError('mapping', MAPPING_ERROR);
    const mapping = {
      date: Number(m.date), dateFormat: m.dateFormat, payee: Number(m.payee), decimal: m.decimal,
      ...(split ? { debit: Number(m.debit), credit: Number(m.credit) } : { amount: Number(m.amount) }),
      ...(m.note ? { note: Number(m.note) } : {}),
    };
    setResult(await api<Result>('POST', '/imports', { pocketId: Number(pocketId), text, mapping }));
  });

  const select = (label: string, key: keyof typeof m, options: [string, string][], error?: string) => (
    <Field label={label} error={error}>
      {(p) => (
        <select {...p} value={m[key]} onChange={(e) => set(key)(e.target.value)}>
          {options.map(([v, t]) => <option key={v} value={v} disabled={v === '' && key !== 'note'}>{t}</option>)}
        </select>
      )}
    </Field>
  );

  if (result) {
    const lines = [
      result.added > 0 && `Added ${plural(result.added, 'transaction', 'transactions')}.`,
      result.duplicates > 0 && `${result.duplicates} ${result.duplicates === 1 ? 'was' : 'were'} already here.`,
      result.unsorted > 0 && `${result.unsorted} ${result.unsorted === 1 ? 'needs' : 'need'} a subsection or source.`,
      result.closed > 0 && `${result.closed} ${result.closed === 1 ? 'was' : 'were'} in a closed month.`,
    ].filter(Boolean);
    return (
      <Modal title="Import a statement" onClose={onClose}>
        <div className="ty-stack" role="status">
          {lines.length ? lines.map((l) => <div key={String(l)}>{l}</div>) : <div>Nothing new to add.</div>}
        </div>
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--primary" onClick={onClose}>Done</button>
        </div>
      </Modal>
    );
  }

  if (!preview) {
    return (
      <Modal title="Import a statement" onClose={onClose}>
        <form className="ty-stack" onSubmit={next} noValidate>
          <FormError message={f.formError} />
          <fieldset className="ty-fieldset">
            <legend className="ty-label">Pocket</legend>
            <div className="ty-chips">
              {pockets.map((x) => (
                <label key={x.id} className="ty-chip">
                  <input type="radio" name="import-pocket" checked={pocketId === String(x.id)} onChange={() => setPocketId(String(x.id))} />
                  <span className="ty-emoji">{x.emoji}</span> {x.name}
                </label>
              ))}
            </div>
            {f.errors.pocketId && <span className="ty-error">{f.errors.pocketId}</span>}
          </fieldset>
          <Field label="File" error={f.errors.text}>
            {(p) => <input {...p} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
          </Field>
          <div className="ty-dialog__foot">
            <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
            <button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Next</button>
          </div>
        </form>
      </Modal>
    );
  }

  const cols: [string, string][] = preview.headers.map((h, i) => [String(i), h || `Column ${i + 1}`]);
  const choose: [string, string] = ['', 'Choose a column'];
  return (
    <Modal title="Import a statement" onClose={onClose}>
      <form className="ty-stack" onSubmit={run} noValidate>
        <FormError message={f.formError} />
        <div className="app-scroll">
          <table className="ty-table">
            <thead><tr>{preview.headers.map((h, i) => <th key={i}>{h || `Column ${i + 1}`}</th>)}</tr></thead>
            <tbody>{preview.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
          </table>
        </div>
        {select('Date', 'date', [choose, ...cols])}
        {select('Date format', 'dateFormat', DATE_FORMATS.map((d) => [d, d]))}
        {select('Amount', 'amount', [choose, ...cols, [SPLIT, 'Separate debit and credit columns']])}
        {m.amount === SPLIT && <>
          {select('Debit', 'debit', [choose, ...cols])}
          {select('Credit', 'credit', [choose, ...cols])}
        </>}
        {select('Payee', 'payee', [choose, ...cols])}
        {select('Note (optional)', 'note', [['', 'None'], ...cols])}
        {select('Decimal mark', 'decimal', [['.', '.'], [',', ',']])}
        {f.errors.mapping && <span className="ty-error" role="alert">{f.errors.mapping}</span>}
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Import</button>
        </div>
      </form>
    </Modal>
  );
}
