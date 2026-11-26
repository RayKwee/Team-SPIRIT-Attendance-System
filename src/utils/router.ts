import { useCallback, useEffect, useState, type MouseEvent } from 'react';

export type AppPage = 'landing' | 'lounge' | 'games' | 'tracker' | 'calendar' | 'ideas';

/** Returns true when the active page belongs to the isolated Attendance & Ops tools section. */
export function isAttendancePage(page: AppPage): boolean {
  return page === 'tracker' || page === 'calendar';
}

const ROUTE_TITLES: Record<AppPage, string> = {
  landing: 'Team SPIRIT — Club Hub',
  lounge: 'Team SPIRIT — Student Lounge',
  games: 'Team SPIRIT — Arcade Games',
  tracker: 'Team SPIRIT — Attendance Tools',
  calendar: 'Team SPIRIT — Attendance Calendar',
  ideas: 'Team SPIRIT — Project Ideas',
};

const ROUTE_CHANGE_EVENT = 'team-spirit:route-change';

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Resolves the active SPA page from a URL pathname, supporting clean and `.html` routes. */
export function getPageFromPathname(pathname: string): AppPage {
  const normalized = normalizePathname(pathname).toLowerCase();
  if (
    normalized.endsWith('/lounge') ||
    normalized.endsWith('/lounge.html') ||
    normalized.endsWith('/updates') ||
    normalized.endsWith('/updates.html')
  ) {
    return 'lounge';
  }
  if (
    normalized.endsWith('/attendance') ||
    normalized.endsWith('/attendance.html') ||
    normalized.endsWith('/tracker') ||
    normalized.endsWith('/tracker.html')
  ) {
    return 'tracker';
  }
  if (normalized.endsWith('/calendar') || normalized.endsWith('/calendar.html')) {
    return 'calendar';
  }
  if (normalized.endsWith('/ideas') || normalized.endsWith('/ideas.html')) {
    return 'ideas';
  }
  if (normalized.endsWith('/games') || normalized.endsWith('/games.html')) {
    return 'games';
  }
  return 'landing';
}

/** Builds the canonical href for a given SPA page relative to Vite's configured base URL. */
export function getRouteHref(page: AppPage): string {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  if (page === 'lounge') return `${normalizedBase}lounge`;
  if (page === 'games') return `${normalizedBase}games`;
  if (page === 'tracker') return `${normalizedBase}attendance`;
  if (page === 'calendar') return `${normalizedBase}calendar`;
  if (page === 'ideas') return `${normalizedBase}ideas`;
  return normalizedBase;
}

/** Returns true when an anchor click represents a standard unmodified primary-button click. */
export function isUnmodifiedPrimaryClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return (
    event.button === 0 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

/** Performs an instant, blink-free client-side navigation without reloading the document. */
export function navigateToPage(page: AppPage, options?: { replace?: boolean }): void {
  if (typeof window === 'undefined') return;

  const targetHref = getRouteHref(page);
  const currentPath = normalizePathname(window.location.pathname);
  const targetPath = normalizePathname(targetHref);

  if (currentPath !== targetPath || window.location.search || window.location.hash) {
    if (options?.replace) {
      window.history.replaceState({ page }, '', targetHref);
    } else {
      window.history.pushState({ page }, '', targetHref);
    }
  }

  document.title = ROUTE_TITLES[page];
  window.dispatchEvent(new CustomEvent<AppPage>(ROUTE_CHANGE_EVENT, { detail: page }));
}

/** React hook keeping the current SPA page synchronized with History API & browser navigation. */
export function useAppRoute(): [AppPage, (page: AppPage) => void] {
  const [activePage, setActivePage] = useState<AppPage>(() =>
    typeof window === 'undefined' ? 'landing' : getPageFromPathname(window.location.pathname),
  );

  useEffect(() => {
    document.title = ROUTE_TITLES[activePage];
  }, [activePage]);

  useEffect(() => {
    function syncFromLocation() {
      setActivePage(getPageFromPathname(window.location.pathname));
    }

    function handleCustomRoute(event: Event) {
      const customEvent = event as CustomEvent<AppPage>;
      if (
        customEvent.detail === 'landing' ||
        customEvent.detail === 'lounge' ||
        customEvent.detail === 'games' ||
        customEvent.detail === 'tracker' ||
        customEvent.detail === 'calendar' ||
        customEvent.detail === 'ideas'
      ) {
        setActivePage(customEvent.detail);
      } else {
        syncFromLocation();
      }
    }

    window.addEventListener('popstate', syncFromLocation);
    window.addEventListener(ROUTE_CHANGE_EVENT, handleCustomRoute);
    return () => {
      window.removeEventListener('popstate', syncFromLocation);
      window.removeEventListener(ROUTE_CHANGE_EVENT, handleCustomRoute);
    };
  }, []);

  const navigate = useCallback((page: AppPage) => {
    navigateToPage(page);
  }, []);

  return [activePage, navigate];
}
