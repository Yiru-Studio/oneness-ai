'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { User } from '@/types';
import { getCurrentUser, login as apiLogin, logout as apiLogout } from '@/lib/api';
import { setAuthToken } from '@/lib/api-client';

interface AuthContextType {
  isLoggedIn: boolean;
  user: User | null;
  isLoading: boolean;
  login: (email: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);
const AUTO_AUTH_TOKEN = 'mock_token_auto_login';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      // Current backend auth is mock-token based: any bearer token resolves to
      // the seeded user. For the online preview, skip the email/code gate and
      // enter the workspace directly.
      setAuthToken(AUTO_AUTH_TOKEN);
      try {
        const u = await getCurrentUser();
        if (!cancelled) setUser(u);
      } catch {
        setAuthToken(null);
        if (!cancelled) setUser(null);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadUser();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, code: string) => {
    await apiLogin(email, code);
    const u = await getCurrentUser();
    setUser(u);
  }, []);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      isLoggedIn: !!user,
      user,
      isLoading,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuthContext must be used within AuthProvider');
  return ctx;
}
