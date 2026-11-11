'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Screen Wake Lock Hook
 * Prevents mobile screens from dimming or locking during active acoustic transmission/reception.
 */
export function useWakeLock(isActive: boolean) {
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const requestLock = useCallback(async () => {
    if (typeof window === 'undefined' || !('wakeLock' in navigator)) return;
    try {
      if (!wakeLockRef.current || wakeLockRef.current.released) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      }
    } catch (err) {
      // Browser may reject wake lock if battery is low or page is hidden
      console.warn('Wake Lock request rejected:', err);
    }
  }, []);

  const releaseLock = useCallback(async () => {
    if (wakeLockRef.current && !wakeLockRef.current.released) {
      try {
        await wakeLockRef.current.release();
      } catch {
        // Ignore
      }
      wakeLockRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isActive) {
      requestLock();
    } else {
      releaseLock();
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isActive) {
        requestLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      releaseLock();
    };
  }, [isActive, requestLock, releaseLock]);

  return { isSupported: typeof window !== 'undefined' && 'wakeLock' in navigator };
}
