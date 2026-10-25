import { useEffect, useRef, useCallback } from 'react';

interface UseIdleTimerOptions {
  timeoutMinutes: number;
  onIdle: () => void;
  enabled?: boolean;
}

export function useIdleTimer({
  timeoutMinutes,
  onIdle,
  enabled = true,
}: UseIdleTimerOptions): void {
  const timeoutMs = timeoutMinutes * 60 * 1000;
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const lastActiveRef = useRef<number>(Date.now());

  const resetTimer = useCallback(() => {
    lastActiveRef.current = Date.now();
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    if (enabled) {
      timerRef.current = setTimeout(() => {
        onIdle();
      }, timeoutMs);
    }
  }, [enabled, onIdle, timeoutMs]);

  useEffect(() => {
    if (!enabled) {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      return;
    }

    // Activity event handler with throttling
    let throttleTimeout: NodeJS.Timeout | null = null;
    const handleActivity = () => {
      if (!throttleTimeout) {
        throttleTimeout = setTimeout(() => {
          throttleTimeout = null;
          resetTimer();
        }, 1000); // Throttle activity updates to once per second
      }
    };

    const events = ['keydown', 'pointerdown', 'mousemove', 'touchstart'];
    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Start initial timer
    resetTimer();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      if (throttleTimeout) {
        clearTimeout(throttleTimeout);
      }
    };
  }, [enabled, resetTimer]);
}
