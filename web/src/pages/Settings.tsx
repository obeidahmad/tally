import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BankConnections } from '../bank';
import { TabPanel, Tabs, useTab } from '../tabs';
import { setTheme, useTheme, type Theme } from '../theme';
import { api, fieldError, useForm, useLoad, type Pocket, type Rule, type Section, type Source, type User } from '../api';
import { useAuth } from '../auth';
import { BudgetSwitcher, OwnerOnly, SharingCard } from '../sharing';
import { Trading212 } from '../trading212';
import { Field, Load, CurrencyField, FormError, Modal, SubsectionOptions, subLabel, TextField, Topbar, useToast } from '../ui';

const TABS = [{ value: 'account', label: 'Account' }, { value: 'people', label: 'People and sharing' }, { value: 'connections', label: 'Connections' }, { value: 'appearance', label: 'Appearance' }] as const;
const THEMES: [Theme, string][] = [['light', 'Light'], ['dark', 'Dark'], ['system', 'Match system']];

function Appearance() {
  const theme = useTheme();
  return (
    <section className="ty-card ty-stack" aria-label="Appearance">
      <fieldset className="ty-fieldset">
        <legend className="ty-label">Appearance</legend>
        <div className="ty-segmented">
          {THEMES.map(([v, name]) => <label key={v}><input type="radio" name="theme" checked={theme === v} onChange={() => setTheme(v)} />{name}</label>)}
        </div>
      </fieldset>
    </section>
  );
}

function ChangePassword() {
  const toast = useToast();
  const f = useForm();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const submit = f.on(async () => {
    await api('POST', '/me/password', { currentPassword: current, newPassword: next });
    setCurrent(''); setNext('');
    toast('Saved');
  });
  return (
    <section className="ty-card ty-stack" aria-labelledby="pw-h">
      <h2 className="text-title" id="pw-h" style={{ margin: 0 }}>Change password</h2>
      <form className="ty-stack" onSubmit={submit} noValidate>
        <FormError message={f.formError} />
        <TextField label="Current password" type="password" autoComplete="current-password" value={current} onChange={setCurrent} error={f.errors.currentPassword} />
        <TextField label="New password" type="password" autoComplete="new-password" value={next} onChange={setNext} error={f.errors.newPassword} hint="10 to 200 characters." />
        <div><button type="submit" className="ty-btn" disabled={f.busy}>Change password</button></div>
      </form>
    </section>
  );
}

function HomePocket({ pockets }: { pockets: Pocket[] }) {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const f = useForm();
  if (pockets.length === 0) return null;
  const change = (id: string) => f.on(async () => {
    const r = await api<{ user: User }>('PATCH', '/me', { homePocketId: Number(id) });
    setUser(r.user);
    toast('Saved');
  })();
  return (
    <Field label="Home pocket" error={f.errors.homePocketId ?? f.formError} hint="Money sits here unless you move it with a transfer.">
      {(p) => (
        <select {...p} value={user.homePocketId ?? pockets[0].id} disabled={f.busy} onChange={(e) => change(e.target.value)}>
          {pockets.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
      )}
    </Field>
  );
}

function AddRule({ sections, sources, onClose }: { sections: Section[]; sources: Source[]; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const [match, setMatch] = useState('');
  const [kind, setKind] = useState<'subsection' | 'source'>('subsection');
  const [target, setTarget] = useState('');
  const submit = f.on(async () => {
    if (!target) throw fieldError(kind === 'source' ? 'sourceId' : 'subsectionId', 'Choose a subsection or a source.');
    const { sorted } = await api<{ sorted: number }>('POST', '/rules', { match, [kind === 'source' ? 'sourceId' : 'subsectionId']: Number(target) });
    onClose();
    toast(sorted > 0 ? `Saved. ${sorted} sorted.` : 'Saved');
  });
  return (
    <Modal title="Add rule" onClose={onClose}>
      <form className="ty-stack" onSubmit={submit} noValidate>
        <FormError message={f.formError} />
        <TextField label="Payee contains" value={match} onChange={setMatch} error={f.errors.match} autoComplete="off" />
        <fieldset className="ty-fieldset">
          <legend className="ty-label">Put in</legend>
          <div className="ty-segmented">
            <label><input type="radio" name="put-in" checked={kind === 'subsection'} onChange={() => { setKind('subsection'); setTarget(''); }} />Subsection</label>
            <label><input type="radio" name="put-in" checked={kind === 'source'} onChange={() => { setKind('source'); setTarget(''); }} />Source</label>
          </div>
        </fieldset>
        <Field label={kind === 'source' ? 'Source' : 'Subsection'} error={f.errors.subsectionId ?? f.errors.sourceId}>
          {(p) => (
            <select {...p} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="" disabled>{kind === 'source' ? 'Choose a source' : 'Choose a subsection'}</option>
              {kind === 'source' ? sources.filter((x) => !x.isLeftovers).map((x) => <option key={x.id} value={x.id}>{x.name}</option>) : <SubsectionOptions sections={sections} />}
            </select>
          )}
        </Field>
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Add rule</button>
        </div>
      </form>
    </Modal>
  );
}

function Rules() {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const state = useLoad(async () => {
    const [r, s, src] = await Promise.all([
      api<{ rules: Rule[] }>('GET', '/rules'),
      api<{ sections: Section[] }>('GET', '/sections'),
      api<{ sources: Source[] }>('GET', '/sources'),
    ]);
    return { rules: r.rules, sections: s.sections, sources: src.sources };
  }, []);
  const remove = async (r: Rule) => {
    await api('DELETE', `/rules/${r.id}`).catch(() => {});
    toast('Rule deleted', () => void api('POST', '/rules', { match: r.match, ...(r.sourceId === null ? { subsectionId: r.subsectionId } : { sourceId: r.sourceId }) }).catch(() => {}));
  };
  return (
    <Load state={state}>
      {({ rules, sections, sources }) => {
        const names = new Map([...sections.flatMap((s) => s.subsections.map((x) => ['s' + x.id, subLabel(x)] as const)), ...sources.map((x) => ['i' + x.id, x.name] as const)]);
        return (
    <section className="ty-card ty-stack" aria-labelledby="rules-h">
      <div className="ty-card__head">
        <h2 className="text-title" id="rules-h" style={{ margin: 0 }}>Rules</h2>
        <span className="ty-grow" />
        <button className="ty-btn" onClick={() => setAdding(true)}>Add rule</button>
      </div>
              {rules.length === 0 ? (
                <div className="ty-cap">No rules yet. A rule puts imported transactions in a subsection or source by payee.</div>
              ) : (
                <div className="ty-stack">
                  {rules.map((r) => (
                    <div key={r.id} className="app-person">
                      <span>Payee contains '{r.match}' → {names.get(r.subsectionId !== null ? 's' + r.subsectionId : 'i' + r.sourceId)}</span>
                      <button className="ty-btn ty-btn--quiet ty-btn--sm" aria-label={`Delete rule ${r.match}`} onClick={() => void remove(r)}>Delete</button>
                    </div>
                  ))}
                </div>
              )}
              {adding && <AddRule sections={sections} sources={sources} onClose={() => setAdding(false)} />}
    </section>
        );
      }}
    </Load>
  );
}

function AddPerson({ currency, onClose }: { currency: string; onClose: () => void }) {
  const toast = useToast();
  const f = useForm();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [baseCurrency, setBaseCurrency] = useState(currency);
  const submit = f.on(async () => {
    await api('POST', '/users', { displayName, username, password, baseCurrency });
    onClose();
    toast('Saved');
  });
  return (
    <Modal title="Add a person" onClose={onClose}>
      <form className="ty-stack" onSubmit={submit} noValidate>
        <FormError message={f.formError} />
        <TextField label="Display name" value={displayName} onChange={setDisplayName} error={f.errors.displayName} autoComplete="off" />
        <TextField label="Username" value={username} onChange={setUsername} error={f.errors.username} autoComplete="off" />
        <TextField label="Temporary password" type="password" value={password} onChange={setPassword} error={f.errors.password} autoComplete="new-password" hint="10 to 200 characters." />
        <CurrencyField value={baseCurrency} onChange={setBaseCurrency} error={f.errors.baseCurrency} />
        <div className="ty-dialog__foot">
          <button type="button" className="ty-btn ty-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Add person</button>
        </div>
      </form>
    </Modal>
  );
}

function People({ currency }: { currency: string }) {
  const [adding, setAdding] = useState(false);
  const state = useLoad(() => api<{ users: User[] }>('GET', '/users').then((r) => r.users), []);
  return (
    <section className="ty-stack" aria-labelledby="people-h">
      <div className="ty-card__head">
        <h2 className="text-title" id="people-h" style={{ margin: 0 }}>People</h2>
        <span className="ty-grow" />
        <button className="ty-btn" onClick={() => setAdding(true)}>Add a person</button>
      </div>
      <Load state={state}>
        {(users) => (
          <div className="ty-section">
            {users.map((u, i) => (
              <div key={u.id} className="app-person" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                <div className="ty-trow__who"><b>{u.displayName}</b><span className="ty-cap">{u.username}</span></div>
                {u.isOwner && <span className="ty-pill">Owner</span>}
              </div>
            ))}
          </div>
        )}
      </Load>
      {adding && <AddPerson currency={currency} onClose={() => setAdding(false)} />}
    </section>
  );
}

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const bank = params.get('bank');
  useEffect(() => {
    if (!bank) return;
    toast(bank === 'connected' ? 'Bank connected.' : 'The bank did not connect. Try again.');
    setParams({ tab: 'connections' }, { replace: true });
  }, [bank]);
  const signOut = async () => { await api('POST', '/auth/logout').catch(() => {}); setUser(null); };
  const [tab, setTab] = useTab(TABS.map((t) => t.value));
  const pockets = useLoad(() => api<{ pockets: Pocket[] }>('GET', '/pockets').then((r) => r.pockets), []);
  return (
    <>
      <Topbar title="Settings" tabs={<Tabs label="Settings" tabs={TABS} value={tab} onChange={setTab} />} />
      <TabPanel tab={tab}>
      <div className="app-phone-block"><BudgetSwitcher /></div>
      {tab === 'account' && <Load state={pockets}>{(list) => <>
      <section className="ty-card ty-stack" aria-labelledby="acct-h">
        <h2 className="text-title" id="acct-h" style={{ margin: 0 }}>Your account</h2>
        <dl className="app-facts">
          <dt className="ty-label">Display name</dt><dd>{user.displayName}</dd>
          <dt className="ty-label">Username</dt><dd>{user.username}</dd>
          <dt className="ty-label">Base currency</dt><dd>{user.baseCurrency}</dd>
        </dl>
        {!user.viewing && <HomePocket pockets={list} />}
      </section>
      <ChangePassword />
      <div><button className="ty-btn app-phone-only" onClick={signOut}>Sign out</button></div>
      </>}</Load>}
      {tab === 'people' && <>
        {user.isOwner && <People currency={user.baseCurrency} />}
        {user.viewing ? <OwnerOnly title="Sharing" id="share-h" /> : <SharingCard />}
      </>}
      {tab === 'connections' && <>
        {user.viewing ? <><OwnerOnly title="Bank connections" id="bank-h" /><OwnerOnly title="Trading212" id="t212-h" /></> : <><BankConnections /><Trading212 /></>}
        <Rules />
      </>}
      {tab === 'appearance' && <Appearance />}
      </TabPanel>
    </>
  );
}
