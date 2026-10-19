import { useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'tally.theme';

/** The saved choice; light when nothing is saved or storage is unreadable. */
export function getTheme(): Theme {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'dark' || v === 'system' ? v : 'light';
  } catch { return 'light'; }
}

/** Saves the choice and applies it: `data-theme` on <html>, removed for 'system'. */
export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* storage blocked: the choice lasts until reload */ }
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
  listeners.forEach((cb) => cb());
}

const listeners = new Set<() => void>();
/** The saved choice as React state: follows setTheme from anywhere, such as the sidebar button. */
export function useTheme(): Theme {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, getTheme);
}
