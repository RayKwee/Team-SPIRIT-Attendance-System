import { useCallback, useState } from 'react';

const SESSION_BOOTED_STORAGE_KEY = 'team-spirit:session-booted:v1';

export type PreloaderPhase = 'active' | 'exiting' | 'done';

type BootNavigationType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown';

let cachedBootPreloaderDecision: boolean | null = null;

function getNavigationType(): BootNavigationType {
  if (typeof performance === 'undefined') {
    return 'unknown';
  }

  if (typeof performance.getEntriesByType === 'function') {
    const entries = performance.getEntriesByType('navigation');
    const navEntry = entries[0] as PerformanceNavigationTiming | undefined;
    if (navEntry && typeof navEntry.type === 'string') {
      return navEntry.type;
    }
  }

  const legacyNav = (performance as Performance & { navigation?: { type?: number } }).navigation;
  if (legacyNav && typeof legacyNav.type === 'number') {
    if (legacyNav.type === 1) return 'reload';
    if (legacyNav.type === 2) return 'back_forward';
    if (legacyNav.type === 0) return 'navigate';
  }

  return 'unknown';
}

/**
 * Determines once per document load whether the splash preloader should play.
 * Plays on initial load or manual browser refresh; skips on bfcache history restores
 * and never re-runs during client-side SPA page transitions.
 */
export function shouldShowPreloaderOnBoot(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }

  if (cachedBootPreloaderDecision !== null) {
    return cachedBootPreloaderDecision;
  }

  const navType = getNavigationType();

  let wasSessionBooted = false;
  try {
    wasSessionBooted = window.sessionStorage.getItem(SESSION_BOOTED_STORAGE_KEY) === '1';
    window.sessionStorage.setItem(SESSION_BOOTED_STORAGE_KEY, '1');
  } catch {
    // Proceed safely without sessionStorage persistence.
  }

  let shouldShow = true;
  if (navType === 'reload') {
    shouldShow = true;
  } else if (navType === 'back_forward' && wasSessionBooted) {
    shouldShow = false;
  }

  cachedBootPreloaderDecision = shouldShow;
  return shouldShow;
}

/** Shared preloader lifecycle hook for the unified SPA shell. */
export function usePreloaderPhase() {
  const [preloaderPhase, setPreloaderPhase] = useState<PreloaderPhase>(() =>
    shouldShowPreloaderOnBoot() ? 'active' : 'done',
  );

  const handlePreloaderBeginExit = useCallback(() => {
    setPreloaderPhase('exiting');
  }, []);

  const handlePreloaderComplete = useCallback(() => {
    setPreloaderPhase('done');
  }, []);

  const containerRevealClass =
    preloaderPhase === 'active' ? 'is-preloading' : 'is-ready';

  return {
    preloaderPhase,
    containerRevealClass,
    handlePreloaderBeginExit,
    handlePreloaderComplete,
  };
}
