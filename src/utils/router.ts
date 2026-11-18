import { useCallback, useEffect, useState, type MouseEvent } from 'react';

export type AppPage = 'tracker' | 'calendar';

const ROUTE_TITLES: Record<AppPage, string> = {
  tracker: 'Team SPIRIT — Personal Attendance Tracker',
  calendar: 'Team SPIRIT — Session Calendar',
};

const ROUTE_CHANGE_EVENT = 'team-spirit:route-change';

function normalizePathname(pathname: string): string {
  return pathname.replace(/\/+$/, '') || '/';
}

/** Resolves the active SPA page from a URL pathname, supporting clean and `.html` routes. */
export function getPageFromPathname(pathname: string): AppPage {
  const normalized = normalizePathname(pathname).toLowerCase();
  if (normalized.endsWith('/calendar') || normalized.endsWith('/calendar.html')) {
    return 'calendar';
  }
  return 'tracker';
}

/** Builds the canonical href for a given SPA page relative to Vite's configured base URL. */
export function getRouteHref(page: AppPage): string {
  const baseUrl = import.meta.env.BASE_URL || '/';
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return page === 'calendar' ? `${normalizedBase}calendar` : normalizedBase;
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
    typeof window === 'undefined' ? 'tracker' : getPageFromPathname(window.location.pathname),
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
      if (customEvent.detail === 'tracker' || customEvent.detail === 'calendar') {
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
