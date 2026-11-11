import React, { createContext, useContext, useState, useEffect } from 'react';
import { hasPermission, type AppPermission } from '@pos/shared';
import type { UserContext } from '../types';
import { apiFetch } from '../lib/api';

interface AuthContextType {
  user: UserContext | null;
  token: string | null;
  isLoading: boolean;
  login: (pharmacyCode: string, name: string, pin: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  isOwner: boolean;
  can: (permission: AppPermission) => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const getStoredItem = (key: string): string | null => {
  try {
    return sessionStorage.getItem(key) || localStorage.getItem(key);
  } catch {
    return null;
  }
};

const setStoredItem = (key: string, value: string): void => {
  try {
    sessionStorage.setItem(key, value);
    localStorage.setItem(key, value);
  } catch {
    // Ignore storage quota / access errors
  }
};

const removeStoredItem = (key: string): void => {
  try {
    sessionStorage.removeItem(key);
    localStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserContext | null>(() => {
    const saved = getStoredItem('pos_user_context');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    return getStoredItem('pos_auth_token');
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  useEffect(() => {
    const handleUnauthorized = () => {
      setUser(null);
      setToken(null);
    };

    window.addEventListener('auth:unauthorized', handleUnauthorized);

    // Verify token on mount if present
    if (token) {
      apiFetch<{ user: UserContext }>('/api/auth/me')
        .then((res) => {
          setUser(res.user);
          setStoredItem('pos_user_context', JSON.stringify(res.user));
        })
        .catch(() => {
          setUser(null);
          setToken(null);
          removeStoredItem('pos_auth_token');
          removeStoredItem('pos_user_context');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [token]);

  const login = async (pharmacyCode: string, name: string, pin: string) => {
    const res = await apiFetch<{ token: string; user: UserContext }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ pharmacyCode, name, pin }),
    });

    setToken(res.token);
    setUser(res.user);
    setStoredItem('pos_auth_token', res.token);
    setStoredItem('pos_user_context', JSON.stringify(res.user));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    removeStoredItem('pos_auth_token');
    removeStoredItem('pos_user_context');
  };

  const can = (permission: AppPermission): boolean => {
    if (!user) return false;
    return hasPermission(user.role, permission);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        login,
        logout,
        isAuthenticated: !!token && !!user,
        isOwner: user?.role === 'owner',
        can,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
