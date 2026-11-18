import { useEffect, useState } from 'react';
import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

interface PreloaderProps {
  ariaLabel?: string;
  onBeginExit: () => void;
  onComplete: () => void;
}

const MIN_DISPLAY_MS = 950;
const REDUCED_MOTION_MIN_MS = 350;
const MAX_WAIT_MS = 2200;
const READY_HOLD_MS = 160;
const EXIT_DURATION_MS = 380;

const RETICLE_ARCS = [
  { color: '#ef4444', offset: 0 },
  { color: '#f5b82e', offset: -82 },
  { color: '#22c55e', offset: -164 },
  { color: '#22d3ee', offset: -246 },
];

function getStatusMessage(progress: number): string {
  if (progress < 35) {
    return 'INITIALIZING TEAM SPIRIT SYSTEMS...';
  }
  if (progress < 78) {
    return 'SYNCING CLUB ROSTER & SESSIONS...';
  }
  return 'ATTENDANCE DASHBOARD READY';
}

/**
 * Centered Discord-inspired preloader tailored to Team SPIRIT's dark voxel aesthetic.
 * Waits for document load, webfont readiness, and a minimum display window before
 * smoothly fading into the main attendance dashboard.
 */
export function Preloader({
  ariaLabel = 'Loading Team SPIRIT Attendance Dashboard',
  onBeginExit,
  onComplete,
}: PreloaderProps) {
  const [progress, setProgress] = useState(0);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let rafId = 0;
    let holdTimer = 0;
    let exitTimer = 0;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const minDisplayMs = prefersReducedMotion ? REDUCED_MOTION_MIN_MS : MIN_DISPLAY_MS;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const startTime = performance.now();
    let windowLoaded = document.readyState === 'complete';
    let fontsReady = !('fonts' in document);
    let timedOut = false;
    let finishing = false;

    function handleWindowLoad() {
      windowLoaded = true;
    }

    if (!windowLoaded) {
      window.addEventListener('load', handleWindowLoad, { once: true });
    }

    if (!fontsReady && document.fonts?.ready) {
      document.fonts.ready
        .then(() => {
          fontsReady = true;
        })
        .catch(() => {
          fontsReady = true;
        });
    }

    const safetyTimer = window.setTimeout(() => {
      timedOut = true;
    }, MAX_WAIT_MS);

    function finishLoading() {
      if (finishing || cancelled) return;
      finishing = true;
      setProgress(100);

      holdTimer = window.setTimeout(() => {
        if (cancelled) return;
        setIsExiting(true);
        document.body.style.overflow = previousOverflow;
        onBeginExit();

        exitTimer = window.setTimeout(() => {
          if (!cancelled) {
            onComplete();
          }
        }, EXIT_DURATION_MS);
      }, READY_HOLD_MS);
    }

    function tick(now: number) {
      if (cancelled || finishing) return;

      const elapsed = now - startTime;
      const ratio = Math.min(1, elapsed / minDisplayMs);
      // Ease-out progress up to 88% while awaiting readiness, then snap to 100%.
      const easedProgress = Math.round((1 - Math.pow(1 - ratio, 2.4)) * 88);
      setProgress(easedProgress);

      const isReady = (windowLoaded && fontsReady && elapsed >= minDisplayMs) || timedOut;
      if (isReady) {
        finishLoading();
        return;
      }

      rafId = window.requestAnimationFrame(tick);
    }

    rafId = window.requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(safetyTimer);
      window.clearTimeout(holdTimer);
      window.clearTimeout(exitTimer);
      window.removeEventListener('load', handleWindowLoad);
      document.body.style.overflow = previousOverflow;
    };
  }, [onBeginExit, onComplete]);

  return (
    <div
      className={`preloader-overlay ${isExiting ? 'is-exiting' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <div className="preloader-content">
        <div className="preloader-emblem-stage" aria-hidden="true">
          <span className="preloader-corner preloader-corner-tl" />
          <span className="preloader-corner preloader-corner-tr" />
          <span className="preloader-corner preloader-corner-bl" />
          <span className="preloader-corner preloader-corner-br" />

          <svg className="preloader-reticle" viewBox="0 0 112 112" fill="none">
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

          <div className="preloader-emblem-wrap">
            <img
              src={teamSpiritEmblem}
              alt=""
              className="preloader-emblem"
              width={84}
              height={84}
            />
          </div>
        </div>

        <TeamSpiritWordmark className="preloader-wordmark" />

        <div className="preloader-progress-block">
          <div className="preloader-progress-track" aria-hidden="true">
            <div
              className="preloader-progress-fill"
              style={{ transform: `scaleX(${progress / 100})` }}
            />
            <div className="preloader-progress-grid" />
          </div>

          <div className="preloader-status-row">
            <span className="preloader-status-dot" aria-hidden="true" />
            <span className="preloader-status-text">{getStatusMessage(progress)}</span>
          </div>
        </div>

        <p className="preloader-caption">TEAM SPIRIT • ATTENDANCE SYSTEM</p>
      </div>
    </div>
  );
}
