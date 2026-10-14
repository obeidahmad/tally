import { useEffect, useState, type ReactNode } from 'react';
import { api, useForm, useLoad, type Pocket } from './api';
import { dayHeading } from './dates';
import { formatMinor } from './money';
import { FormError, Field, Load, Modal, TextField, useToast } from './ui';

export type BankAccount = { uid: string; name: string; iban: string; currency: string; pocketId: number | null };
export type Connection = { id: number; bank: string; country: string; syncedAt: string | null; validUntil: string; accounts: BankAccount[] };

const SYNC_AFTER_MS = 6 * 3600_000;
const REMIND_DAYS = 14;
/** "12 March 2027" */
export const longDate = (iso: string) => `${dayHeading(iso.slice(0, 10))} ${iso.slice(0, 4)}`;

export function ago(iso: string, now = Date.now()) {
  const m = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (m < 1) return 'just now';
  const [n, unit] = m < 60 ? [m, 'minute'] : m < 1440 ? [Math.floor(m / 60), 'hour'] : [Math.floor(m / 1440), 'day'];
  return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
}

/** The bank behind each linked pocket, for "Synced 2 hours ago from {bank}". */
export function bankByPocket(connections: Connection[]) {
  return new Map(connections.flatMap((c) => c.accounts.filter((a) => a.pocketId !== null).map((a) => [a.pocketId!, c.bank] as const)));
}

/** Syncs, once when the page loads, each connection with a linked account that was last synced over 6 hours ago. Failures are silent: the card keeps its last figure. */
export function useAutoSync() {
  useEffect(() => {
    (async () => {
      const { connections } = await api<{ connections: Connection[] }>('GET', '/banks/connections');
      const stale = (c: Connection) => new Date(c.validUntil).getTime() > Date.now() && c.accounts.some((x) => x.pocketId !== null) && (!c.syncedAt || Date.now() - new Date(c.syncedAt).getTime() > SYNC_AFTER_MS);
      for (const c of connections.filter(stale)) await api('POST', `/banks/connections/${c.id}/sync`).catch(() => {});
    })().catch(() => {});
  }, []);
}

/** Connections for pages that only read them; a failed load means none. */
export const loadConnections = () => api<{ connections: Connection[] }>('GET', '/banks/connections').then((r) => r.connections, () => [] as Connection[]);

/** Budget notice for a connection ending within two weeks, or already ended. */
export function EndingNotice({ connection }: { connection: Connection }) {
  const f = useForm();
  const left = new Date(connection.validUntil).getTime() - Date.now();
  if (left > REMIND_DAYS * 86400_000) return null;
  const go = f.on(async () => {
    const { url } = await api<{ url: string }>('POST', '/banks/connect', { name: connection.bank, country: connection.country });
    window.location.href = url;
  });
  return (
    <div className="ty-inset">
      <span>{left > 0 ? `Your connection to ${connection.bank} ends on ${dayHeading(connection.validUntil.slice(0, 10))}. Reconnect it to keep importing.` : `Your connection to ${connection.bank} has ended.`}</span>
      <div>
        <button className="ty-btn ty-btn--sm" disabled={f.busy} onClick={go}>Reconnect</button>
        <FormError message={f.formError} />
      </div>
    </div>
  );
}

// Countries Enable Banking serves in Europe, Cyprus first.
const COUNTRIES = (() => {
  const names = new Intl.DisplayNames('en', { type: 'region' });
  const codes = 'AT BE BG HR CZ DK EE FI FR DE GR HU IS IE IT LV LT LU MT NL NO PL PT RO SK SI ES SE GB'.split(' ');
  return [['CY', names.of('CY')!], ...codes.map((c) => [c, names.of(c)!] as const).sort((a, b) => a[1].localeCompare(b[1]))];
})();

function ConnectDialog({ onClose }: { onClose: () => void }) {
  const f = useForm();
  const [country, setCountry] = useState('CY');
  const [banks, setBanks] = useState<{ name: string; country: string }[] | null>(null);
  const [bank, setBank] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setBanks(null); setBank(''); setFailed(false);
    api<{ banks: { name: string; country: string }[] }>('GET', `/banks?country=${country}`).then(
      (r) => { if (live) { setBanks(r.banks); setBank(r.banks[0]?.name ?? ''); } },
      () => live && setFailed(true),
    );
    return () => { live = false; };
  }, [country]);
  const submit = f.on(async () => {
    const { url } = await api<{ url: string }>('POST', '/banks/connect', { name: bank, country });
    window.location.href = url;
  });
  return (
    <Modal title="Connect a bank" onClose={onClose}>
      <form className="ty-stack" onSubmit={submit} noValidate>
        <FormError message={f.formError} />
        <Field label="Country">
          {(p) => <select {...p} value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map(([c, n]) => <option key={c} value={c}>{n}</option>)}</select>}
        </Field>
        <Field label="Bank" error={failed ? "Couldn't load the banks. Check your registration and try again." : banks?.length === 0 ? 'No banks listed for this country.' : undefined}>
          {(p) => (
            <select {...p} value={bank} disabled={!banks?.length} onChange={(e) => setBank(e.target.value)}>
              {banks === null && !failed && <option>Loading…</option>}
              {banks?.map((b) => <option key={b.name}>{b.name}</option>)}
            </select>
          )}
        </Field>
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy || !bank}>Continue</button>
        </div>
      </form>
    </Modal>
  );
}

function Registration({ publicUrl }: { publicUrl: string | null }) {
  const toast = useToast();
  const f = useForm();
  const [applicationId, setApplicationId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const submit = f.on(async () => {
    await api('PUT', '/banks/registration', { applicationId, privateKey });
    setPrivateKey('');
    toast('Saved');
  });
  return (
    <form className="ty-stack" onSubmit={submit} noValidate>
      <FormError message={f.formError} />
      <TextField label="Application ID" value={applicationId} onChange={setApplicationId} error={f.errors.applicationId} autoComplete="off" />
      <Field label="Private key" error={f.errors.privateKey} hint={`From your own registration at enablebanking.com. Its redirect URL must be ${publicUrl ?? '{TALLY_PUBLIC_URL}'}/api/banks/callback.`}>
        {(p) => <textarea {...p} className={`${p.className} app-textarea`} rows={5} spellCheck={false} autoComplete="off" value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} />}
      </Field>
      <div><button type="submit" className="ty-btn" disabled={f.busy}>Save</button></div>
    </form>
  );
}

function Disconnect({ connection, onClose }: { connection: Connection; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const submit = f.on(async () => {
    await api('DELETE', `/banks/connections/${connection.id}`);
    onClose();
    toast(`Disconnected from ${connection.bank}`);
  });
  return (
    <Modal title={`Disconnect ${connection.bank}?`} sub="Tally forgets the connection and stops importing. Transactions already imported stay." onClose={onClose}>
      <form className="ty-stack" onSubmit={submit}>
        <FormError message={f.formError} />
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Disconnect</button>
        </div>
      </form>
    </Modal>
  );
}

function ConnectionRow({ c, pockets }: { c: Connection; pockets: Pocket[] }) {
  const toast = useToast();
  const [leaving, setLeaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const link = (uid: string, value: string) =>
    api('PATCH', `/banks/accounts/${uid}`, { pocketId: value === '' ? null : Number(value) }).catch((e: Error) => toast(e.message));
  const sync = async () => {
    setSyncing(true);
    try {
      const r = await api<{ added: number; duplicates: number; unsorted: number }>('POST', `/banks/connections/${c.id}/sync`);
      toast(`Synced. ${r.added} added${r.unsorted ? `, ${r.unsorted} need sorting` : ''}.`);
    } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong. Try again.'); }
    setSyncing(false);
  };
  return (
    <div className="ty-stack app-bank">
      <div className="ty-month__top">
        <div className="ty-trow__who"><b>{c.bank}</b><span className="ty-cap">until {longDate(c.validUntil)}</span></div>
        <span className="ty-grow" />
        <div className="app-actions">
          <button className="ty-btn ty-btn--sm" disabled={syncing} onClick={() => void sync()}>Sync now</button>
          <button className="ty-btn ty-btn--quiet ty-btn--sm" onClick={() => setLeaving(true)}>Disconnect</button>
        </div>
      </div>
      {c.accounts.map((a) => (
        <Field key={a.uid} label={`Pocket for ${a.name}`} hint={`${a.iban} · ${a.currency}`}>
          {(p) => (
            <select {...p} value={a.pocketId ?? ''} onChange={(e) => void link(a.uid, e.target.value)}>
              <option value="">Not linked</option>
              {pockets.filter((x) => x.currency === a.currency).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          )}
        </Field>
      ))}
      {leaving && <Disconnect connection={c} onClose={() => setLeaving(false)} />}
    </div>
  );
}

/** `then` renders only once this card's data has loaded, so a failed load shows one failure card. */
export function BankConnections({ then }: { then: ReactNode }) {
  const [connecting, setConnecting] = useState(false);
  const state = useLoad(async () => {
    const [reg, conn, p] = await Promise.all([
      api<{ configured: boolean; applicationId?: string; publicUrl: string | null }>('GET', '/banks/registration'),
      api<{ connections: Connection[] }>('GET', '/banks/connections'),
      api<{ pockets: Pocket[] }>('GET', '/pockets'),
    ]);
    return { reg, connections: conn.connections, pockets: p.pockets };
  }, []);
  return (
    <Load state={state}>
      {({ reg, connections, pockets }) => (<>
        <section className="ty-card ty-stack" aria-labelledby="bank-h">
          <div className="ty-month__top">
            <h2 className="text-title" id="bank-h" style={{ margin: 0 }}>Bank connections</h2>
            <span className="ty-grow" />
            {reg.configured && <button className="ty-btn" disabled={!reg.publicUrl} onClick={() => setConnecting(true)}>Connect a bank</button>}
          </div>
          {!reg.configured ? <Registration publicUrl={reg.publicUrl} /> : (
          <>
            {!reg.publicUrl && <div className="ty-cap">Set TALLY_PUBLIC_URL to this server's HTTPS address to connect a bank.</div>}
            <dl className="app-facts"><dt className="ty-label">Application ID</dt><dd>{reg.applicationId}</dd></dl>
            {connections.length === 0
              ? <div className="ty-cap">No bank connected yet.</div>
              : connections.map((c) => <ConnectionRow key={c.id} c={c} pockets={pockets} />)}
            {connecting && <ConnectDialog onClose={() => setConnecting(false)} />}
          </>
          )}
        </section>
        {then}
      </>)}
    </Load>
  );
}

/** "Synced 2 hours ago from Revolut", or "Entered by hand". */
export const syncedLine = (p: Pocket, bank: string | undefined) => p.syncedAt ? `Synced ${ago(p.syncedAt)} from ${bank ?? 'your bank'}` : 'Entered by hand';
/** "Tally counts 1,200.00." when Tally's own figure differs from the bank's. */
export const countsLine = (p: Pocket) => p.syncedBalanceMinor !== null && p.syncedBalanceMinor !== p.balanceMinor ? `Tally counts ${formatMinor(p.balanceMinor)}.` : null;
