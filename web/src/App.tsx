import { useEffect, useState, useSyncExternalStore } from 'react';
import { BrowserRouter, Navigate, NavLink, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { api, setUnauthenticatedHandler, type User } from './api';
import { AuthCtx, baseCurrency, useAuth } from './auth';
import BudgetPage from './pages/Budget';
import { SetupPage, SignInPage } from './pages/Entry';
import HomePage from './pages/Home';
import InvestmentsPage from './pages/Investments';
import PipelinePage from './pages/Pipeline';
import PocketsPage from './pages/Pockets';
import RecurringPage from './pages/Recurring';
import ReportsPage from './pages/Reports';
import SettingsPage from './pages/Settings';
import TransactionsPage from './pages/Transactions';
import { BudgetSwitcher } from './sharing';
import { setTheme } from './theme';
import { Load, Logo, ToastProvider, TopSlotCtx } from './ui';

const PAGES = [['/home', 'Home'], ['/budget', 'Budget'], ['/pipeline', 'Pipeline'], ['/transactions', 'Transactions'], ['/recurring', 'Recurring'], ['/pockets', 'Pockets'], ['/investments', 'Investments'], ['/reports', 'Reports'], ['/settings', 'Settings']] as const;

const ICONS: Record<string, React.ReactNode> = {
  '/home': <><path d="M4 11l8-6.5 8 6.5" /><path d="M6 10v9h12v-9" /></>,
  '/budget': <><rect x="4" y="5" width="16" height="4" rx="1" /><rect x="4" y="11" width="11" height="4" rx="1" /><rect x="4" y="17" width="7" height="3" rx="1" /></>,
  '/pipeline': <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 6h3c3 0 3 6 7 6M8 18h3c3 0 3-6 7-6" /></>,
  '/transactions': <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18M7 15h3" /></>,
  '/recurring': <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M8 3v4M16 3v4" /></>,
  '/pockets': <><path d="M4 8a2 2 0 0 1 2-2h11v2" /><rect x="4" y="8" width="16" height="11" rx="2" /><circle cx="16" cy="13.5" r="1" /></>,
  '/investments': <><path d="M4 17l5-5 4 3 7-8" /><path d="M15 7h5v5" /></>,
  '/reports': <><path d="M12 4a8 8 0 1 0 8 8h-8z" /><path d="M15 3.5A8 8 0 0 1 20.5 9H15z" /></>,
  '/settings': <><path d="M4 8h9M17 8h3M4 16h3M11 16h9" /><circle cx="15" cy="8" r="2" /><circle cx="9" cy="16" r="2" /></>,
};
const Icon = ({ to }: { to: string }) => <svg className="ty-icon" viewBox="0 0 24 24" aria-hidden="true">{ICONS[to]}</svg>;
const PHONE = ['/home', '/budget', '/transactions', '/pockets', '/settings'];

/** The theme in force: the saved choice, or the system's when it is "Match system". */
const html = document.documentElement;
const effectiveTheme = () => html.getAttribute('data-theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const useEffectiveTheme = () => useSyncExternalStore(
  (cb) => { const o = new MutationObserver(cb); o.observe(html, { attributes: true, attributeFilter: ['data-theme'] }); return () => o.disconnect(); },
  effectiveTheme,
);

function Shell() {
  const { user, setUser } = useAuth();
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const dark = useEffectiveTheme() === 'dark';
  const signOut = async () => { await api('POST', '/auth/logout').catch(() => {}); setUser(null); };
  const link = ([to, label]: readonly [string, string]) => <NavLink key={to} to={to}><Icon to={to} />{label}</NavLink>;
  return (
    <div className="ty-shell">
      <aside className="ty-side">
        <Logo />
        <div className="app-switch"><BudgetSwitcher /></div>
        <nav className="ty-nav" aria-label="Main">{PAGES.map(link)}</nav>
        <div className="ty-side__foot">
          <div className="ty-side__who">
            <b>{user.displayName}</b>
            <span className="ty-cap">{user.viewing ? `viewing the budget of ${user.viewing.displayName} · ` : ''}{baseCurrency(user)}</span>
            <button type="button" className="ty-link ty-cap app-linkbtn" onClick={signOut}>Sign out</button>
          </div>
          <button type="button" className="ty-btn ty-btn--quiet ty-btn--icon" aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={() => setTheme(dark ? 'light' : 'dark')}>
            <svg className="ty-icon" viewBox="0 0 24 24" aria-hidden="true">
              {dark ? <><circle cx="12" cy="12" r="4" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" /></> : <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" />}
            </svg>
          </button>
        </div>
      </aside>
      <div className="ty-page">
        <div ref={setSlot} className="app-slot" />
        <TopSlotCtx.Provider value={slot}><main className="ty-main"><Outlet /></main></TopSlotCtx.Provider>
      </div>
      <nav className="ty-tabbar" aria-label="Main">{PAGES.filter(([to]) => PHONE.includes(to)).map(link)}</nav>
    </div>
  );
}

type Boot = { needsSetup: boolean; user: User | null };

function Routing({ boot, setBoot }: { boot: Boot; setBoot: (b: Boot) => void }) {
  const navigate = useNavigate();
  const enter = (user: User) => { setBoot({ needsSetup: false, user }); navigate('/home', { replace: true }); };
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
          <Route path="/home" element={<HomePage />} />
          <Route path="/budget" element={<BudgetPage />} />
          <Route path="/pipeline" element={<PipelinePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/recurring" element={<RecurringPage />} />
          <Route path="/pockets" element={<PocketsPage />} />
          <Route path="/investments" element={<InvestmentsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/home" replace />} />
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
