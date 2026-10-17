import { useEffect, useState } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setUnauthenticatedHandler, type User } from './api';
import { AuthCtx, baseCurrency, useAuth } from './auth';
import BudgetPage from './pages/Budget';
import { SetupPage, SignInPage } from './pages/Entry';
import InvestmentsPage from './pages/Investments';
import PipelinePage from './pages/Pipeline';
import PocketsPage from './pages/Pockets';
import RecurringPage from './pages/Recurring';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';
import TransactionsPage from './pages/Transactions';
import { BudgetSwitcher } from './sharing';
import { Load, ToastProvider } from './ui';

const PAGES = [['/budget', 'Budget'], ['/pipeline', 'Pipeline'], ['/transactions', 'Transactions'], ['/recurring', 'Recurring'], ['/pockets', 'Pockets'], ['/investments', 'Investments'], ['/reports', 'Reports'], ['/settings', 'Settings']] as const;

function Shell() {
  const { user, setUser } = useAuth();
  const signOut = async () => { await api('POST', '/auth/logout').catch(() => {}); setUser(null); };
  const link = ([to, label]: readonly [string, string]) => <NavLink key={to} to={to}>{label}</NavLink>;
  return (
    <div className="ty-shell">
      <aside className="ty-side">
        <div className="ty-word">Tally</div>
        <div className="app-switch"><BudgetSwitcher /></div>
        <nav className="ty-nav" aria-label="Main">{PAGES.map(link)}</nav>
        <div className="ty-side__foot ty-cap">
          Signed in as {user.displayName}{user.viewing && ` · viewing the budget of ${user.viewing.displayName}`}<br />Base currency {baseCurrency(user)}
          <div><button className="ty-btn ty-btn--quiet app-signout" onClick={signOut}>Sign out</button></div>
        </div>
      </aside>
      <main className="ty-main"><Outlet /></main>
      <nav className="ty-tabs" aria-label="Main">{PAGES.filter(([to]) => to !== '/pipeline' && to !== '/investments' && to !== '/reports' && to !== '/recurring').map(link)}</nav>
    </div>
  );
}

type Boot = { needsSetup: boolean; user: User | null };

function Routing({ boot, setBoot }: { boot: Boot; setBoot: (b: Boot) => void }) {
  const navigate = useNavigate();
  const enter = (user: User) => { setBoot({ needsSetup: false, user }); navigate('/budget', { replace: true }); };
  const setUser = (user: User | null) => setBoot({ needsSetup: false, user });

  useEffect(() => { setUnauthenticatedHandler(() => setUser(null)); });

  if (boot.needsSetup) {
    return <Routes><Route path="/setup" element={<SetupPage onDone={enter} />} /><Route path="*" element={<Navigate to="/setup" replace />} /></Routes>;
  }
  if (!boot.user) {
    return <Routes><Route path="/sign-in" element={<SignInPage onDone={enter} />} /><Route path="*" element={<Navigate to="/sign-in" replace />} /></Routes>;
  }
  return (
    <AuthCtx.Provider value={{ user: boot.user, setUser }}>
      <Routes>
        <Route element={<Shell />}>
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/pockets" element={<PocketsPage />} />
          <Route path="/investments" element={<InvestmentsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/budget" replace />} />
      </Routes>
    </AuthCtx.Provider>
  );
}

export default function App() {
  const [boot, setBoot] = useState<Boot | undefined>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setFailed(false);
    api<Boot>('GET', '/auth/state').then(setBoot, () => setFailed(true));
  }, [attempt]);

  return (
    <ToastProvider>
      <BrowserRouter>
        {boot ? (
          <Routing boot={boot} setBoot={setBoot} />
        ) : (
          <main className="app-auth">
            <Load state={{ failed, retry: () => setAttempt((n) => n + 1) }}>{() => null}</Load>
          </main>
        )}
      </BrowserRouter>
    </ToastProvider>
  );
}
