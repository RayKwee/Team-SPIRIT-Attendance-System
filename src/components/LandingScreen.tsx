import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import type { RealtimeStatus, SyncStatus, ThemeAccent } from '../types/attendance';
import { getRouteHref, isUnmodifiedPrimaryClick, type AppPage } from '../utils/router';
import {
  LandingBackgroundCanvas,
  type LandingBackgroundHandle,
} from './LandingBackgroundCanvas';
import {
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelIdeaIcon,
  PixelListIcon,
  PixelLockIcon,
  PixelShieldIcon,
  PixelTerminalIcon,
} from './PixelIcons';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

type WorkspacePage = Exclude<AppPage, 'landing'>;

interface LandingScreenProps {
  themeAccent: ThemeAccent;
  periodLabel: string;
  isCloudConnected: boolean;
  isAdmin?: boolean;
  userEmail?: string;
  isAuthModalOpen?: boolean;
  syncStatus: SyncStatus;
  realtimeStatus: RealtimeStatus;
  onEnterSystem: () => void;
  onNavigateWorkspace: (page: WorkspacePage) => void;
  onOpenLogin: () => void;
  onOpenCreateAccount: () => void;
}

interface WebKitForceMouseEvent extends Event {
  webkitForce?: number;
}

const RETICLE_ARCS = [
  { color: '#ef4444', offset: 0 },
  { color: '#f5b82e', offset: -82 },
  { color: '#22c55e', offset: -164 },
  { color: '#22d3ee', offset: -246 },
];

const QUICK_ROUTES: { page: WorkspacePage; cmd: string; label: string }[] = [
  { page: 'tracker', cmd: './tracker', label: 'Attendance Tracker' },
  { page: 'calendar', cmd: './calendar', label: 'Session Calendar' },
  { page: 'ideas', cmd: './ideas', label: 'Updates & Ideas' },
];

const EXIT_TRANSITION_MS = 160;
const CONSOLE_SURGE_MS = 460;

/**
 * Clean, tech-based, hacker-themed main landing screen for the personal Team SPIRIT
 * Attendance Management System. Features hold-duration & pressure-sensitive grid
 * pulses, layered concurrent ambient effects, official branding, and keyboard entry.
 */
export function LandingScreen({
  themeAccent,
  periodLabel,
  isCloudConnected,
  isAdmin = false,
  userEmail,
  isAuthModalOpen = false,
  syncStatus,
  realtimeStatus,
  onEnterSystem,
  onNavigateWorkspace,
  onOpenLogin,
  onOpenCreateAccount,
}: LandingScreenProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const consoleRef = useRef<HTMLElement | null>(null);
  const bgCanvasRef = useRef<LandingBackgroundHandle | null>(null);
  const activePointerIdsRef = useRef<Set<number>>(new Set());
  const exitTimerRef = useRef<number | null>(null);
  const surgeTimerRef = useRef<number | null>(null);
  const [isExiting, setIsExiting] = useState(false);

  const launchIntoPage = useCallback(
    (target: 'enter' | WorkspacePage) => {
      if (isExiting) return;

      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      const execute = () => {
        if (target === 'enter') {
          onEnterSystem();
        } else {
          onNavigateWorkspace(target);
        }
      };

      if (prefersReducedMotion) {
        execute();
        return;
      }

      setIsExiting(true);
      exitTimerRef.current = window.setTimeout(execute, EXIT_TRANSITION_MS);
    },
    [isExiting, onEnterSystem, onNavigateWorkspace],
  );

  useEffect(() => {
    const activePointers = activePointerIdsRef.current;
    return () => {
      activePointers.clear();
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      if (surgeTimerRef.current !== null) {
        window.clearTimeout(surgeTimerRef.current);
      }
    };
  }, []);

  // Support pressing Enter directly on the landing screen to enter the system.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        isAuthModalOpen ||
        event.key !== 'Enter' ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && target.closest('a, button, input, textarea, select')) {
        return;
      }
      event.preventDefault();
      launchIntoPage('enter');
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAuthModalOpen, launchIntoPage]);

  // Feature-detected macOS Safari Force Touch trackpad listeners (zero overhead in other browsers).
  useEffect(() => {
    const rootEl = rootRef.current;
    if (!rootEl) return;

    function handleForceWillBegin(event: Event) {
      const target = event.target as HTMLElement | null;
      // Prevent Safari's Look Up popup only when Force-Clicking non-interactive background space.
      if (!target || !target.closest('button, a, input, textarea, select')) {
        event.preventDefault();
      }
    }

    function handleForceChanged(event: Event) {
      if (activePointerIdsRef.current.size === 0) return;
      const force = (event as WebKitForceMouseEvent).webkitForce;
      if (typeof force === 'number' && Number.isFinite(force)) {
        bgCanvasRef.current?.updateForce(force);
      }
    }

    rootEl.addEventListener('webkitmouseforcewillbegin', handleForceWillBegin);
    rootEl.addEventListener('webkitmouseforcechanged', handleForceChanged);

    return () => {
      rootEl.removeEventListener('webkitmouseforcewillbegin', handleForceWillBegin);
      rootEl.removeEventListener('webkitmouseforcechanged', handleForceChanged);
    };
  }, []);

  // Track active drags and releases on window so fast cursor movement never drops updates.
  useEffect(() => {
    function handleWindowPointerMove(event: globalThis.PointerEvent) {
      if (!activePointerIdsRef.current.has(event.pointerId)) return;
      bgCanvasRef.current?.updateCharge(
        event.pointerId,
        event.clientX,
        event.clientY,
        event.pressure,
      );
    }

    function handleWindowPointerUp(event: globalThis.PointerEvent) {
      if (!activePointerIdsRef.current.has(event.pointerId)) return;
      activePointerIdsRef.current.delete(event.pointerId);
      const achievedIntensity = bgCanvasRef.current?.releaseCharge(event.pointerId) ?? 0;
      if (achievedIntensity >= 0.45 && consoleRef.current) {
        const el = consoleRef.current;
        el.classList.remove('is-surging');
        // Force a cheap class restart only on strong releases (not per frame).
        void el.offsetWidth;
        el.classList.add('is-surging');
        if (surgeTimerRef.current !== null) {
          window.clearTimeout(surgeTimerRef.current);
        }
        surgeTimerRef.current = window.setTimeout(() => {
          consoleRef.current?.classList.remove('is-surging');
        }, CONSOLE_SURGE_MS);
      }
    }

    function handleWindowPointerCancel(event: globalThis.PointerEvent) {
      if (!activePointerIdsRef.current.has(event.pointerId)) return;
      activePointerIdsRef.current.delete(event.pointerId);
      bgCanvasRef.current?.cancelCharge(event.pointerId);
    }

    window.addEventListener('pointermove', handleWindowPointerMove, { passive: true });
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerCancel);
    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerCancel);
    };
  }, []);

  function handleBackgroundPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 && event.pointerType === 'mouse') return;
    const target = event.target as HTMLElement | null;
    if (target && target.closest('button, a')) return;

    activePointerIdsRef.current.add(event.pointerId);
    bgCanvasRef.current?.beginCharge(
      event.pointerId,
      event.clientX,
      event.clientY,
      event.pressure,
      event.pointerType,
    );
  }

  const modeBadgeLabel = !isCloudConnected
    ? 'LOCAL-ONLY'
    : syncStatus === 'error' || syncStatus === 'conflict'
      ? 'CLOUD • ATTENTION'
      : realtimeStatus === 'connected'
        ? 'CLOUD SYNC • LIVE'
        : 'CLOUD SYNC';

  const modeToneClass = !isCloudConnected
    ? 'is-local'
    : syncStatus === 'error' || syncStatus === 'conflict'
      ? 'is-alert'
      : 'is-cloud';

  return (
    <div
      ref={rootRef}
      className={`landing-screen ${isExiting ? 'is-exiting' : ''}`}
      onPointerDown={handleBackgroundPointerDown}
    >
      <div className="landing-grid-layer" aria-hidden="true" />
      <LandingBackgroundCanvas ref={bgCanvasRef} themeAccent={themeAccent} />

      <header className="landing-topbar">
        <div className="landing-node-tag">
          <span className="landing-status-dot" aria-hidden="true" />
          <span>SYS://TEAM-SPIRIT</span>
        </div>

        <div className="landing-topbar-meta">
          <span className={`landing-mode-pill ${modeToneClass}`}>
            <span className="landing-mode-dot" aria-hidden="true" />
            <span>{modeBadgeLabel}</span>
          </span>
          <span className="landing-date-pill">{periodLabel}</span>
        </div>
      </header>

      <main className="landing-stage">
        <section
          ref={consoleRef}
          className="landing-console"
          aria-labelledby="landing-brand-heading"
        >
          <span className="landing-corner landing-corner-tl" aria-hidden="true" />
          <span className="landing-corner landing-corner-tr" aria-hidden="true" />
          <span className="landing-corner landing-corner-bl" aria-hidden="true" />
          <span className="landing-corner landing-corner-br" aria-hidden="true" />

          <div className="landing-console-header" aria-hidden="true">
            <span className="landing-console-channel">
              <PixelTerminalIcon width={12} height={12} />
              <span>TERM://SPIRIT-ATTENDANCE</span>
            </span>
            <span className="landing-console-status">READY</span>
          </div>

          <div className="landing-console-body">
            <div className="landing-emblem-stage" aria-hidden="true">
              <svg className="landing-reticle" viewBox="0 0 112 112" fill="none">
                {RETICLE_ARCS.map((arc) => (
                  <circle
                    key={arc.color}
                    cx="56"
                    cy="56"
                    r="52"
                    stroke={arc.color}
                    strokeWidth="2"
                    strokeDasharray="44 283"
                    strokeDashoffset={arc.offset}
                    strokeLinecap="square"
                  />
                ))}
              </svg>
              <img
                src={teamSpiritEmblem}
                alt=""
                className="landing-emblem"
                width={84}
                height={84}
              />
            </div>

            <div className="landing-identity">
              <h1 id="landing-brand-heading" className="landing-wordmark-heading">
                <span className="sr-only">Team SPIRIT Attendance Management System</span>
                <TeamSpiritWordmark className="landing-wordmark-svg" />
              </h1>

              <div className="landing-system-tag">
                <PixelChevronIcon width={11} height={11} />
                <span>Attendance Management System</span>
              </div>

              <p className="landing-prompt">
                <span className="landing-prompt-caret" aria-hidden="true">
                  &gt;
                </span>{' '}
                personal club roster &amp; session tracker
                <span className="landing-cursor" aria-hidden="true" />
              </p>
            </div>

            <div className="landing-actions">
              <button
                type="button"
                className="btn-primary landing-enter-btn"
                onClick={() => launchIntoPage('enter')}
              >
                <PixelChevronIcon width={15} height={15} />
                <span>Enter System</span>
                <kbd className="landing-enter-kbd" aria-hidden="true">
                  ENTER
                </kbd>
              </button>

              {!isCloudConnected ? (
                <div className="landing-auth-row" role="group" aria-label="Account access">
                  <button
                    type="button"
                    className="btn-secondary landing-auth-btn"
                    onClick={onOpenLogin}
                  >
                    <PixelLockIcon width={13} height={13} />
                    <span>Login</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary landing-auth-btn is-accent"
                    onClick={onOpenCreateAccount}
                  >
                    <PixelShieldIcon width={13} height={13} />
                    <span>Create Account</span>
                  </button>
                </div>
              ) : (
                userEmail && (
                  <div className="landing-signed-in-chip" role="status">
                    <span className="landing-mode-dot" aria-hidden="true" />
                    <span>{userEmail}</span>
                    <span className={`landing-role-tag ${isAdmin ? 'is-admin' : ''}`}>
                      {isAdmin ? 'ADMIN' : 'MEMBER'}
                    </span>
                  </div>
                )
              )}

              <nav className="landing-quick-nav" aria-label="Direct workspace shortcuts">
                {QUICK_ROUTES.map((route) => (
                  <a
                    key={route.page}
                    href={getRouteHref(route.page)}
                    className="landing-quick-link"
                    title={route.label}
                    onClick={(event) => {
                      if (!isUnmodifiedPrimaryClick(event)) return;
                      event.preventDefault();
                      launchIntoPage(route.page);
                    }}
                  >
                    {route.page === 'tracker' ? (
                      <PixelListIcon width={12} height={12} />
                    ) : route.page === 'calendar' ? (
                      <PixelCalendarIcon width={12} height={12} />
                    ) : (
                      <PixelIdeaIcon width={12} height={12} />
                    )}
                    <span>{route.cmd}</span>
                  </a>
                ))}
              </nav>
            </div>
          </div>
        </section>
      </main>

      <footer className="landing-footer">
        <span className="landing-trademark">TEAM SPIRIT™ • PERSONAL ATTENDANCE SYSTEM</span>
        <span className="landing-grid-hint" aria-hidden="true">
          CLICK OR HOLD GRID TO CHARGE PULSE
        </span>
      </footer>
    </div>
  );
}
