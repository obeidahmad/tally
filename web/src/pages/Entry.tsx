import { useState } from 'react';
import { api, ApiError, useForm, type User } from '../api';
import { CurrencyField, FormError, TextField } from '../ui';

/** First-run set-up and sign-in share a frame. */
function Frame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="app-auth">
      <div className="ty-word">Tally</div>
      <div className="ty-card ty-stack">
        <h1 className="text-title" style={{ margin: 0 }}>{title}</h1>
        {children}
      </div>
    </main>
  );
}

export function SetupPage({ onDone }: { onDone: (u: User) => void }) {
  const f = useForm();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('EUR');
  const submit = f.on(async () => {
    const { user } = await api<{ user: User }>('POST', '/auth/setup', { username, displayName, password, baseCurrency });
    onDone(user);
  });
  return (
    <Frame title="Create the first account">
      <form className="ty-stack" onSubmit={submit} noValidate>
        <FormError message={f.formError} />
        <TextField label="Display name" value={displayName} onChange={setDisplayName} error={f.errors.displayName} autoComplete="name" />
        <TextField label="Username" value={username} onChange={setUsername} error={f.errors.username} autoComplete="username" hint="Letters, numbers, and _ . -" />
        <TextField label="Password" type="password" value={password} onChange={setPassword} error={f.errors.password} autoComplete="new-password" hint="10 to 200 characters." />
        <CurrencyField value={baseCurrency} onChange={setBaseCurrency} error={f.errors.baseCurrency} />
        <div><button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Create account</button></div>
      </form>
    </Frame>
  );
}

export function SignInPage({ onDone }: { onDone: (u: User) => void }) {
  const f = useForm();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);
  const submit = f.on(async () => {
    setMismatch(false);
    try {
      const { user } = await api<{ user: User }>('POST', '/auth/login', { username, password });
      onDone(user);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'invalid_credentials') setMismatch(true);
      else throw e;
    }
  });
  return (
    <Frame title="Sign in">
      <form className="ty-stack" onSubmit={submit} noValidate>
        <TextField label="Username" value={username} onChange={setUsername} error={f.errors.username} autoComplete="username" />
        <TextField label="Password" type="password" value={password} onChange={setPassword} error={f.errors.password} autoComplete="current-password" />
        <div><button type="submit" className="ty-btn ty-btn--primary" disabled={f.busy}>Sign in</button></div>
        {mismatch && <div className="ty-error" role="alert">That username and password don't match.</div>}
        <FormError message={f.formError} />
      </form>
    </Frame>
  );
}
