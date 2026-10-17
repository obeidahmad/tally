import { createContext, useContext } from 'react';
import type { User } from './api';

type Auth = { user: User; setUser: (u: User | null) => void };
export const AuthCtx = createContext<Auth | null>(null);

/** The signed-in person. Only used below the sign-in gate. */
export function useAuth(): Auth {
  const a = useContext(AuthCtx);
  if (!a) throw new Error('useAuth outside the signed-in app');
  return a;
}

/** The budget's base currency: the owner's while viewing a shared budget. */
export const baseCurrency = (u: User) => u.viewing?.baseCurrency ?? u.baseCurrency;
