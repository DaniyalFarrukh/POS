import React, { createContext, useContext, useState, useEffect } from 'react';
import type { UserContext } from '../types';
import { apiFetch } from '../lib/api';

interface AuthContextType {
  user: UserContext | null;
  token: string | null;
  isLoading: boolean;
  login: (name: string, pin: string) => Promise<void>;
  logout: () => void;
  isAuthenticated: boolean;
  isOwner: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<UserContext | null>(() => {
    const saved = localStorage.getItem('pos_user_context');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('pos_auth_token');
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
          localStorage.setItem('pos_user_context', JSON.stringify(res.user));
        })
        .catch(() => {
          setUser(null);
          setToken(null);
          localStorage.removeItem('pos_auth_token');
          localStorage.removeItem('pos_user_context');
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }

    return () => {
      window.removeEventListener('auth:unauthorized', handleUnauthorized);
    };
  }, [token]);

  const login = async (name: string, pin: string) => {
    const res = await apiFetch<{ token: string; user: UserContext }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ name, pin }),
    });

    setToken(res.token);
    setUser(res.user);
    localStorage.setItem('pos_auth_token', res.token);
    localStorage.setItem('pos_user_context', JSON.stringify(res.user));
  };

  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('pos_auth_token');
    localStorage.removeItem('pos_user_context');
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
