import { useEffect, useState, useCallback } from 'react';
import type { AuthSession } from '@pos/shared';
import type { DbMetadata } from '../preload/index.d';
import { SetupScreen } from './components/SetupScreen';
import { LoginScreen } from './components/LoginScreen';
import { LayoutShell } from './components/LayoutShell';
import { LockOverlay } from './components/LockOverlay';
import { useIdleTimer } from './hooks/useIdleTimer';

export function App() {
  const [dbInfo, setDbInfo] = useState<DbMetadata | null>(null);
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Check setup status and existing session on startup
  const initApp = useCallback(async () => {
    if (!window.api || !window.api.auth) {
      setLoading(false);
      return;
    }

    try {
      // 1. Fetch DB Metadata
      const meta = await window.api.getDbInfo();
      setDbInfo(meta);

      // 2. Check setup status
      const status = await window.api.auth.getSetupStatus();
      setNeedsSetup(status.needsSetup);

      if (!status.needsSetup) {
        // 3. Check for existing session
        const currentSession = await window.api.auth.getSession();
        setSession(currentSession);
      }
    } catch (err: unknown) {
      console.error('[App] Failed to initialize state:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    initApp();
  }, [initApp]);

  const handleLock = useCallback(async () => {
    if (session && !session.isLocked) {
      try {
        await window.api.auth.lockSession();
        setSession((prev) => (prev ? { ...prev, isLocked: true } : null));
      } catch (err: unknown) {
        console.error('[App] Lock failed:', err);
      }
    }
  }, [session]);

  const handleLogout = useCallback(async () => {
    try {
      await window.api.auth.logout();
      setSession(null);
    } catch (err: unknown) {
      console.error('[App] Logout failed:', err);
    }
  }, []);

  // Idle timer auto-lock hook (configurable minutes from session)
  useIdleTimer({
    timeoutMinutes: session?.idleTimeoutMinutes ?? 5,
    onIdle: handleLock,
    enabled: Boolean(session && !session.isLocked),
  });

  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#ffffff',
          fontFamily: 'system-ui, sans-serif',
          color: '#64748b',
          fontSize: '15px',
        }}
      >
        Initializing POS Terminal Engine...
      </div>
    );
  }

  // 1. First-run Setup Screen
  if (needsSetup) {
    return (
      <SetupScreen
        onSetupComplete={(newSession) => {
          setNeedsSetup(false);
          setSession(newSession);
        }}
      />
    );
  }

  // 2. Login Screen
  if (!session) {
    return (
      <LoginScreen
        onLoginSuccess={(newSession) => {
          setSession(newSession);
        }}
      />
    );
  }

  // 3. Authenticated Layout Shell + Auto-lock overlay
  return (
    <>
      <LayoutShell
        session={session}
        dbInfo={dbInfo}
        onLock={handleLock}
        onLogout={handleLogout}
      />

      {session.isLocked && (
        <LockOverlay
          session={session}
          onUnlocked={(unlockedSession) => setSession(unlockedSession)}
          onSwitchUser={handleLogout}
        />
      )}
    </>
  );
}
