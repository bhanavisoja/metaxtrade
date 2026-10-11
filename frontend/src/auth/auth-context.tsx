// Simple auth context backed by secure storage.
// Shared key: AUTH_USER (secure).

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { api, type LoginResponse } from "@/src/api/client";
import { storage } from "@/src/utils/storage";

const AUTH_KEY = "apexfx_auth_user";

export type AuthUser = {
  user_id: string;
  name?: string | null;
  email?: string | null;
  balance: number;
  equity?: number;
  floating_pnl?: number;
  max_lots: number;
  account_type?: string | null;
  blocked?: boolean;
  social_trading_url?: string | null;
  support_url?: string | null;
};

type AuthContextValue = {
  user: AuthUser | null;
  loading: boolean;
  login: (userId: string, password: string) => Promise<LoginResponse>;
  logout: () => Promise<void>;
  refreshAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const stored = await storage.secureGet<AuthUser | null>(AUTH_KEY, null);
      if (stored) {
        // Migrate legacy caches that still had Demo + auto-generated name/email.
        const migrated: AuthUser = {
          ...stored,
          account_type: stored.account_type === "Demo" ? "Live" : stored.account_type || "Live",
          email: stored.email && /@demo$/i.test(stored.email) ? null : stored.email,
          name:
            stored.name && /^Trader\s/i.test(stored.name)
              ? null
              : stored.name,
        };
        setUser(migrated);
        if (migrated !== stored) {
          await storage.secureSet(AUTH_KEY, migrated);
        }
      }
      setLoading(false);
    })();
  }, []);

  const login = useCallback(async (userId: string, password: string) => {
    const res = await api.login({ user_id: userId, password });
    if (!res.success) {
      throw new Error(res.message || "Login failed");
    }
    const authUser: AuthUser = {
      user_id: res.user_id,
      name: res.name,
      email: res.email,
      balance: res.balance,
      max_lots: res.max_lots,
      account_type: res.account_type || "Live",
      social_trading_url: res.social_trading_url ?? null,
      support_url: res.support_url ?? null,
    };
    await storage.secureSet(AUTH_KEY, authUser);
    setUser(authUser);
    return res;
  }, []);

  const logout = useCallback(async () => {
    await storage.secureRemove(AUTH_KEY);
    setUser(null);
  }, []);

  const refreshAccount = useCallback(async () => {
    if (!user) return;
    try {
      const summary = await api.account(user.user_id);
      const next: AuthUser = {
        ...user,
        balance: summary.balance,
        equity: summary.equity,
        floating_pnl: summary.floating_pnl,
        max_lots: summary.max_lots,
        blocked: summary.blocked,
        account_type: user.account_type === "Demo" ? "Live" : user.account_type || "Live",
        name: summary.name ?? (user.name && /^Trader\s/i.test(user.name) ? null : user.name),
        social_trading_url: summary.social_trading_url ?? user.social_trading_url ?? null,
        support_url: summary.support_url ?? user.support_url ?? null,
      };
      await storage.secureSet(AUTH_KEY, next);
      setUser(next);
    } catch {
      // non-fatal
    }
  }, [user]);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshAccount }),
    [user, loading, login, logout, refreshAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
