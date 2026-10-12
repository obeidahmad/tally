import { useState } from 'react';
import { api, useForm, useLoad, type User } from '../api';
import { useAuth } from '../auth';
import { Load, CurrencyField, FormError, Modal, TextField, Topbar, useToast } from '../ui';

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
      <div className="ty-month__top">
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
  const signOut = async () => { await api('POST', '/auth/logout').catch(() => {}); setUser(null); };
  return (
    <>
      <Topbar title="Settings" />
      <header className="ty-month__top ty-wide">
        <h1 className="text-display" style={{ margin: 0 }}>Settings</h1>
      </header>
      <section className="ty-card ty-stack" aria-labelledby="acct-h">
        <h2 className="text-title" id="acct-h" style={{ margin: 0 }}>Your account</h2>
        <dl className="app-facts">
          <dt className="ty-label">Display name</dt><dd>{user.displayName}</dd>
          <dt className="ty-label">Username</dt><dd>{user.username}</dd>
          <dt className="ty-label">Base currency</dt><dd>{user.baseCurrency}</dd>
        </dl>
      </section>
      <ChangePassword />
      <div><button className="ty-btn app-phone-only" onClick={signOut}>Sign out</button></div>
      {user.isOwner && <People currency={user.baseCurrency} />}
    </>
  );
}
