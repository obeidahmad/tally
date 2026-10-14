import { useEffect, useState, type ReactNode } from 'react';
import { api, useForm, useLoad, type Pocket, type Section } from './api';
import { ago } from './bank';
import { Field, FormError, Load, SubsectionOptions, TextField, useToast } from './ui';

export type T212Connection = { pocketId: number; environment: 'live' | 'demo'; subsectionId: number; keyEnd: string; syncedAt: string | null; error: string | null };

const SYNC_AFTER_MS = 3600_000;
const connection = () => api<{ connection: T212Connection | null }>('GET', '/brokers/trading212').then((r) => r.connection);

/** The connected pocket's id, for "Synced 2 hours ago from Trading212"; a failed load means none. */
export const loadT212Pocket = () => connection().then((c) => c?.pocketId ?? null, () => null);

/** Syncs, once when the page loads, if the last sync is over an hour old. Failures are silent: the page keeps its last figures. */
export function useT212Sync() {
  useEffect(() => {
    connection().then((c) => {
      if (c && (!c.syncedAt || Date.now() - new Date(c.syncedAt).getTime() > SYNC_AFTER_MS)) return api('POST', '/brokers/trading212/sync');
    }).catch(() => {});
  }, []);
}

function ConnectForm({ pockets, sections }: { pockets: Pocket[]; sections: Section[] }) {
  const toast = useToast();
  const f = useForm();
  const [pocketId, setPocketId] = useState(String(pockets[0]?.id ?? ''));
  const [environment, setEnvironment] = useState<'live' | 'demo'>('live');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
  const [subId, setSubId] = useState(String(sections.find((s) => s.subsections.length)?.subsections[0].id ?? ''));
  const submit = f.on(async () => {
    await api('PUT', '/brokers/trading212', { pocketId: Number(pocketId), apiKey, ...(apiSecret ? { apiSecret } : {}), environment, subsectionId: Number(subId) });
    setApiKey(''); setApiSecret('');
    toast('Connected');
  });
  if (pockets.length === 0) return <div className="ty-cap">Add a broker pocket on the Pockets page first.</div>;
  return (
    <form className="ty-stack" onSubmit={submit} noValidate>
      <FormError message={f.formError} />
      <Field label="Pocket" error={f.errors.pocketId}>
        {(p) => <select {...p} value={pocketId} onChange={(e) => setPocketId(e.target.value)}>{pockets.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.currency})</option>)}</select>}
      </Field>
      <fieldset className="ty-fieldset">
        <legend className="ty-label">Environment</legend>
        <div className="ty-segmented">
          <label><input type="radio" name="t212-env" checked={environment === 'live'} onChange={() => setEnvironment('live')} />Live</label>
          <label><input type="radio" name="t212-env" checked={environment === 'demo'} onChange={() => setEnvironment('demo')} />Demo</label>
        </div>
      </fieldset>
      <TextField label="API key" type="password" value={apiKey} onChange={setApiKey} error={f.errors.apiKey} autoComplete="off" />
      <TextField label="API secret (optional)" type="password" value={apiSecret} onChange={setApiSecret} error={f.errors.apiSecret} autoComplete="off" />
      <Field label="Holdings go to" error={f.errors.subsectionId}>
        {(p) => <select {...p} value={subId} onChange={(e) => setSubId(e.target.value)}><SubsectionOptions sections={sections} /></select>}
      </Field>
      <div><button type="submit" className="ty-btn" disabled={f.busy}>Connect</button></div>
    </form>
  );
}

function Connected({ c, pocket }: { c: T212Connection; pocket?: Pocket }) {
  const toast = useToast();
  const f = useForm();
  const sync = f.on(async () => {
    const r = await api<{ holdings: number; dividends: number }>('POST', '/brokers/trading212/sync');
    toast(`Synced. ${r.holdings} ${r.holdings === 1 ? 'holding' : 'holdings'}, ${r.dividends} ${r.dividends === 1 ? 'dividend' : 'dividends'}.`);
  });
  const leave = f.on(async () => {
    await api('DELETE', '/brokers/trading212');
    toast('Disconnected from Trading212');
  });
  return (
    <div className="ty-stack">
      <FormError message={f.formError} />
      <div>Connected to {pocket?.name ?? 'your pocket'} · key ending {c.keyEnd} · {c.syncedAt ? `synced ${ago(c.syncedAt)}` : 'not synced yet'}</div>
      {c.error && <div><span className="ty-cap ty-pill ty-pill--warning">{c.error}</span></div>}
      <div className="app-actions">
        <button className="ty-btn ty-btn--sm" disabled={f.busy} onClick={() => void sync()}>Sync now</button>
        <button className="ty-btn ty-btn--quiet ty-btn--sm" disabled={f.busy} onClick={() => void leave()}>Disconnect</button>
      </div>
    </div>
  );
}

/** `then` renders only once this card's data has loaded, so a failed load shows one failure card. */
export function Trading212({ then }: { then: ReactNode }) {
  const state = useLoad(async () => {
    const [c, p, s] = await Promise.all([
      connection(),
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
      api<{ sections: Section[] }>('GET', '/sections'),
    ]);
    return { c, pockets: p.pockets, sections: s.sections };
  }, []);
  return (
    <Load state={state}>
      {({ c, pockets, sections }) => (<>
        <section className="ty-card ty-stack" aria-labelledby="t212-h">
          <h2 className="text-title" id="t212-h" style={{ margin: 0 }}>Trading212</h2>
          {c ? <Connected c={c} pocket={pockets.find((x) => x.id === c.pocketId)} /> : <ConnectForm pockets={pockets.filter((x) => x.kind === 'broker')} sections={sections} />}
        </section>
        {then}
      </>)}
    </Load>
  );
}
