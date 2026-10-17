import { useState, type ReactNode } from 'react';
import { api, useForm, useLoad, type User } from './api';
import { useAuth } from './auth';
import { Field, Load, TextField, useToast } from './ui';

type Sharing = { members: { id: number; displayName: string }[]; sharedWithMe: { ownerId: number; displayName: string }[]; viewing: number | null };
const loadSharing = () => api<Sharing>('GET', '/sharing');

/** The "Budget" select: renders only when a budget is shared with the person. */
export function BudgetSwitcher() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const shared = useLoad(loadSharing, []).data?.sharedWithMe ?? [];
  if (shared.length === 0 && !user.viewing) return null;
  const change = async (value: string) => {
    try {
      await api('POST', '/sharing/view', { ownerId: value === '' ? null : Number(value) });
      setUser((await api<{ user: User }>('GET', '/me')).user);
    } catch (e) { toast(e instanceof Error ? e.message : 'Something went wrong. Try again.'); }
  };
  return (
    <Field label="Budget">
      {(p) => (
        <select {...p} value={user.viewing?.ownerId ?? ''} onChange={(e) => void change(e.target.value)}>
          <option value="">Your budget</option>
          {shared.map((s) => <option key={s.ownerId} value={s.ownerId}>{s.displayName}</option>)}
        </select>
      )}
    </Field>
  );
}

/** A card the owner alone can change, shown to a member viewing that budget. */
export function OwnerOnly({ title, id }: { title: string; id: string }) {
  const { user } = useAuth();
  return (
    <section className="ty-card ty-stack" aria-labelledby={id}>
      <h2 className="text-title" id={id} style={{ margin: 0 }}>{title}</h2>
      <div className="ty-cap">Only {user.viewing?.displayName} can change this.</div>
    </section>
  );
}

/** `then` renders only once sharing has loaded, so a failed load shows one failure card. */
export function SharingCard({ then }: { then: ReactNode }) {
  const toast = useToast();
  const { setUser } = useAuth();
  const f = useForm();
  const [username, setUsername] = useState('');
  const state = useLoad(loadSharing, []);
  const add = f.on(async () => {
    await api('POST', '/sharing/members', { username });
    setUsername('');
    toast('Saved');
  });
  const act = (fn: () => Promise<void>) => () => void fn().catch((e: Error) => toast(e.message));
  return (
    <Load state={state}>
      {({ members, sharedWithMe }) => (<>
        <section className="ty-card ty-stack" aria-labelledby="share-h">
          <h2 className="text-title" id="share-h" style={{ margin: 0 }}>Sharing</h2>
          <form className="ty-stack" onSubmit={add} noValidate>
            <TextField label="Share this budget with" value={username} onChange={setUsername} error={f.errors.username} hint="Their username on this server." autoComplete="off" />
            <div><button type="submit" className="ty-btn" disabled={f.busy}>Add</button></div>
          </form>
          {f.formError && <div className="ty-cap">{f.formError}</div>}
          {members.length > 0 && (
            <div className="ty-section">
              {members.map((m, i) => (
                <div key={m.id} className="app-person" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                  <b>{m.displayName}</b>
                  <button className="ty-btn ty-btn--quiet ty-btn--sm" aria-label={`Remove ${m.displayName}`} onClick={act(() => api('DELETE', `/sharing/members/${m.id}`))}>Remove</button>
                </div>
              ))}
            </div>
          )}
          {sharedWithMe.length > 0 && (<>
            <h3 className="ty-label" style={{ margin: 0 }}>Budgets shared with you</h3>
            <div className="ty-section">
              {sharedWithMe.map((s, i) => (
                <div key={s.ownerId} className="app-person" style={i ? { borderTop: '1px solid var(--line)' } : undefined}>
                  <b>{s.displayName}</b>
                  <button className="ty-btn ty-btn--quiet ty-btn--sm" aria-label={`Leave the budget of ${s.displayName}`} onClick={act(async () => { await api('DELETE', `/sharing/shared/${s.ownerId}`); setUser((await api<{ user: User }>('GET', '/me')).user); })}>Leave</button>
                </div>
              ))}
            </div>
          </>)}
        </section>
        {then}
      </>)}
    </Load>
  );
}
