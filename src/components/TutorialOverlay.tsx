import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { TutorialPlacement, TutorialStepConfig } from '../types/tutorial';
import { PixelArrowLeftIcon, PixelChevronIcon, PixelCloseIcon, PixelHelpIcon } from './PixelIcons';

interface TutorialOverlayProps {
  isOpen: boolean;
  steps: TutorialStepConfig[];
  stepIndex: number;
  isDemoSessionActive?: boolean;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

interface SpotlightRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

interface TooltipLayout {
  top: number;
  left: number;
  placement: TutorialPlacement | 'docked';
  arrowOffset: number;
}

const VIEWPORT_MARGIN = 14;
const TOOLTIP_GAP = 14;
const FALLBACK_TOOLTIP_WIDTH = 360;
const FALLBACK_TOOLTIP_HEIGHT = 228;

function clamp(value: number, min: number, max: number): number {
  if (max <= min) return min;
  return Math.min(Math.max(value, min), max);
}

function getPlacementOrder(preferred: TutorialPlacement): TutorialPlacement[] {
  switch (preferred) {
    case 'top':
      return ['top', 'bottom', 'right', 'left'];
    case 'bottom':
      return ['bottom', 'top', 'right', 'left'];
    case 'left':
      return ['left', 'right', 'bottom', 'top'];
    case 'right':
      return ['right', 'left', 'bottom', 'top'];
  }
}

function computeTooltipLayout(
  spotlight: SpotlightRect | null,
  tooltipWidth: number,
  tooltipHeight: number,
  preferred: TutorialPlacement,
  viewportWidth: number,
  viewportHeight: number,
): TooltipLayout {
  const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - tooltipWidth - VIEWPORT_MARGIN);
  const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - tooltipHeight - VIEWPORT_MARGIN);

  if (!spotlight) {
    return {
      top: clamp((viewportHeight - tooltipHeight) / 2, VIEWPORT_MARGIN, maxTop),
      left: clamp((viewportWidth - tooltipWidth) / 2, VIEWPORT_MARGIN, maxLeft),
      placement: 'docked',
      arrowOffset: tooltipWidth / 2,
    };
  }

  const targetCenterX = spotlight.left + spotlight.width / 2;
  const targetCenterY = spotlight.top + spotlight.height / 2;

  // On compact viewports, prefer vertical placement or clean bottom docking.
  const isCompactViewport = viewportWidth < 640;
  const candidates = isCompactViewport
    ? (['bottom', 'top'] as TutorialPlacement[])
    : getPlacementOrder(preferred);

  for (const placement of candidates) {
    if (placement === 'bottom') {
      const spaceBelow = viewportHeight - (spotlight.top + spotlight.height) - VIEWPORT_MARGIN;
      if (spaceBelow >= tooltipHeight + TOOLTIP_GAP) {
        const top = spotlight.top + spotlight.height + TOOLTIP_GAP;
        const left = clamp(targetCenterX - tooltipWidth / 2, VIEWPORT_MARGIN, maxLeft);
        return {
          top,
          left,
          placement,
          arrowOffset: clamp(targetCenterX - left, 22, tooltipWidth - 22),
        };
      }
    }

    if (placement === 'top') {
      const spaceAbove = spotlight.top - VIEWPORT_MARGIN;
      if (spaceAbove >= tooltipHeight + TOOLTIP_GAP) {
        const top = spotlight.top - TOOLTIP_GAP - tooltipHeight;
        const left = clamp(targetCenterX - tooltipWidth / 2, VIEWPORT_MARGIN, maxLeft);
        return {
          top,
          left,
          placement,
          arrowOffset: clamp(targetCenterX - left, 22, tooltipWidth - 22),
        };
      }
    }

    if (placement === 'left') {
      const spaceLeft = spotlight.left - VIEWPORT_MARGIN;
      if (spaceLeft >= tooltipWidth + TOOLTIP_GAP) {
        const left = spotlight.left - TOOLTIP_GAP - tooltipWidth;
        const top = clamp(targetCenterY - tooltipHeight / 2, VIEWPORT_MARGIN, maxTop);
        return {
          top,
          left,
          placement,
          arrowOffset: clamp(targetCenterY - top, 22, tooltipHeight - 22),
        };
      }
    }

    if (placement === 'right') {
      const spaceRight = viewportWidth - (spotlight.left + spotlight.width) - VIEWPORT_MARGIN;
      if (spaceRight >= tooltipWidth + TOOLTIP_GAP) {
        const left = spotlight.left + spotlight.width + TOOLTIP_GAP;
        const top = clamp(targetCenterY - tooltipHeight / 2, VIEWPORT_MARGIN, maxTop);
        return {
          top,
          left,
          placement,
          arrowOffset: clamp(targetCenterY - top, 22, tooltipHeight - 22),
        };
      }
    }
  }

  // Fallback for tall/full-screen targets: dock cleanly near the bottom inside the viewport.
  const dockedLeft = clamp(targetCenterX - tooltipWidth / 2, VIEWPORT_MARGIN, maxLeft);
  const dockedTop = maxTop;
  return {
    top: dockedTop,
    left: dockedLeft,
    placement: 'docked',
    arrowOffset: tooltipWidth / 2,
  };
}

/**
 * Non-destructive interactive tutorial spotlight and tooltip overlay.
 * Highlights live interface elements using an SVG mask cutout and responsive tooltip placement.
 */
export function TutorialOverlay({
  isOpen,
  steps,
  stepIndex,
  isDemoSessionActive = false,
  onNext,
  onBack,
  onSkip,
  onComplete,
}: TutorialOverlayProps) {
  const titleId = useId();
  const descId = useId();
  const maskId = useId();
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const [spotlightRect, setSpotlightRect] = useState<SpotlightRect | null>(null);
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== 'undefined' ? window.innerWidth : 1280,
    height: typeof window !== 'undefined' ? window.innerHeight : 800,
  }));
  const [tooltipSize, setTooltipSize] = useState({
    width: FALLBACK_TOOLTIP_WIDTH,
    height: FALLBACK_TOOLTIP_HEIGHT,
  });

  const currentStep = steps[stepIndex] ?? null;
  const isFirstStep = stepIndex === 0;
  const isLastStep = stepIndex >= steps.length - 1;

  const measureTarget = useCallback(() => {
    if (!isOpen || !currentStep) return;

    setViewport({
      width: window.innerWidth,
      height: window.innerHeight,
    });

    const targetEl = document.querySelector<HTMLElement>(
      `[data-tutorial-target="${currentStep.target}"]`,
    );
    if (!targetEl) {
      setSpotlightRect(null);
      return;
    }

    const rect = targetEl.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSpotlightRect(null);
      return;
    }

    const padding = currentStep.spotlightPadding ?? 8;
    const clampedTop = clamp(rect.top - padding, 4, Math.max(4, window.innerHeight - 8));
    const clampedLeft = clamp(rect.left - padding, 4, Math.max(4, window.innerWidth - 8));
    const clampedRight = clamp(
      rect.right + padding,
      clampedLeft + 12,
      window.innerWidth - 4,
    );
    const clampedBottom = clamp(
      rect.bottom + padding,
      clampedTop + 12,
      window.innerHeight - 4,
    );

    setSpotlightRect({
      top: clampedTop,
      left: clampedLeft,
      width: clampedRight - clampedLeft,
      height: clampedBottom - clampedTop,
    });
  }, [isOpen, currentStep]);

  // Scroll target into view when switching steps and track layout transitions (e.g. drawer slide).
  useEffect(() => {
    if (!isOpen || !currentStep) return;

    let rafId = 0;
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;
    const settleUntil = performance.now() + 380;

    const findAndObserve = () => {
      const targetEl = document.querySelector<HTMLElement>(
        `[data-tutorial-target="${currentStep.target}"]`,
      );
      if (targetEl) {
        const rect = targetEl.getBoundingClientRect();
        const isTallTarget = rect.height > window.innerHeight * 0.72;
        if (isTallTarget) {
          if (rect.top < 0 || rect.top > window.innerHeight * 0.35) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          }
        } else if (rect.top < 12 || rect.bottom > window.innerHeight - 12) {
          targetEl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        }

        if (typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            measureTarget();
          });
          resizeObserver.observe(targetEl);
        }
      }

      const tick = () => {
        if (cancelled) return;
        measureTarget();
        if (performance.now() < settleUntil) {
          rafId = window.requestAnimationFrame(tick);
        }
      };
      rafId = window.requestAnimationFrame(tick);
    };

    // Wait one frame for route/session/drawer state updates to commit to the DOM.
    const initRaf = window.requestAnimationFrame(findAndObserve);

    const handleViewportUpdate = () => measureTarget();
    window.addEventListener('resize', handleViewportUpdate);
    window.addEventListener('scroll', handleViewportUpdate, true);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(initRaf);
      window.cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleViewportUpdate);
      window.removeEventListener('scroll', handleViewportUpdate, true);
    };
  }, [isOpen, currentStep, measureTarget]);

  // Measure tooltip card dimensions whenever step content updates.
  useLayoutEffect(() => {
    if (!isOpen || !tooltipRef.current) return;
    const rect = tooltipRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      setTooltipSize({ width: rect.width, height: rect.height });
    }
  }, [isOpen, stepIndex, isDemoSessionActive]);

  // Focus dialog once on open without stealing focus from interactive buttons on parent re-renders.
  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      tooltipRef.current?.focus({ preventScroll: true });
    }, 20);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  // Enable keyboard shortcuts (Esc to skip, Arrow keys to step, Tab trap inside tooltip).
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        if (isLastStep) {
          onComplete();
        } else {
          onNext();
        }
      } else if (event.key === 'ArrowLeft' && !isFirstStep) {
        event.preventDefault();
        onBack();
      } else if (event.key === 'Tab' && tooltipRef.current) {
        const focusable = Array.from(
          tooltipRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
          ),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey) {
          if (document.activeElement === first || document.activeElement === tooltipRef.current) {
            event.preventDefault();
            last.focus();
          }
        } else if (document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isFirstStep, isLastStep, onBack, onComplete, onNext, onSkip]);

  if (!isOpen || !currentStep) {
    return null;
  }

  const tooltipLayout = computeTooltipLayout(
    spotlightRect,
    tooltipSize.width,
    tooltipSize.height,
    currentStep.preferredPlacement,
    viewport.width,
    viewport.height,
  );

  const stepNumberLabel = String(stepIndex + 1).padStart(2, '0');
  const totalStepsLabel = String(steps.length).padStart(2, '0');

  return (
    <div className="tutorial-layer" role="presentation">
      <svg
        className="tutorial-backdrop-svg"
        width={viewport.width}
        height={viewport.height}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        aria-hidden="true"
      >
        <defs>
          <mask id={maskId}>
            <rect x="0" y="0" width={viewport.width} height={viewport.height} fill="white" />
            {spotlightRect && (
              <rect
                className="tutorial-mask-cutout"
                x={spotlightRect.left}
                y={spotlightRect.top}
                width={spotlightRect.width}
                height={spotlightRect.height}
                rx="4"
                ry="4"
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width={viewport.width}
          height={viewport.height}
          fill="rgba(5, 7, 11, 0.78)"
          mask={`url(#${maskId})`}
        />
      </svg>

      {spotlightRect && (
        <div
          className="tutorial-spotlight-frame"
          aria-hidden="true"
          style={{
            top: `${spotlightRect.top}px`,
            left: `${spotlightRect.left}px`,
            width: `${spotlightRect.width}px`,
            height: `${spotlightRect.height}px`,
          }}
        >
          <span className="tutorial-corner is-tl" />
          <span className="tutorial-corner is-tr" />
          <span className="tutorial-corner is-bl" />
          <span className="tutorial-corner is-br" />
        </div>
      )}

      <div
        ref={tooltipRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        className={`tutorial-tooltip is-placement-${tooltipLayout.placement}`}
        style={{
          top: `${tooltipLayout.top}px`,
          left: `${tooltipLayout.left}px`,
        }}
      >
        {tooltipLayout.placement !== 'docked' && (
          <span
            className={`tutorial-tooltip-arrow is-${tooltipLayout.placement}`}
            aria-hidden="true"
            style={
              tooltipLayout.placement === 'top' || tooltipLayout.placement === 'bottom'
                ? { left: `${tooltipLayout.arrowOffset}px` }
                : { top: `${tooltipLayout.arrowOffset}px` }
            }
          />
        )}

        <div className="tutorial-tooltip-header">
          <div className="tutorial-tooltip-meta">
            <span className="tutorial-step-pill">
              <PixelHelpIcon width={11} height={11} />
              <span>
                STEP {stepNumberLabel} / {totalStepsLabel}
              </span>
            </span>
            <span className="tutorial-feature-tag">{currentStep.badge}</span>
          </div>

          <button
            type="button"
            className="modal-close-btn tutorial-close-btn"
            onClick={onSkip}
            aria-label="Skip tutorial"
            title="Skip Tutorial (Esc)"
          >
            <PixelCloseIcon width={12} height={12} />
          </button>
        </div>

        <div className="tutorial-progress-track" aria-hidden="true">
          {steps.map((step, index) => (
            <span
              key={step.id}
              className={`tutorial-progress-segment ${
                index < stepIndex ? 'is-done' : index === stepIndex ? 'is-current' : ''
              }`}
            />
          ))}
        </div>

        <div className="tutorial-tooltip-body">
          <h3 id={titleId} className="tutorial-tooltip-title">
            {currentStep.title}
          </h3>
          <p id={descId} className="tutorial-tooltip-desc">
            {currentStep.description}
          </p>
          {isDemoSessionActive && (
            <p className="tutorial-demo-note">
              Previewing a temporary sample session because your workspace has no recorded sessions
              yet—nothing here is saved.
            </p>
          )}
        </div>

        <div className="tutorial-tooltip-footer">
          <button type="button" className="tutorial-skip-btn" onClick={onSkip}>
            Skip Tutorial
          </button>

          <div className="tutorial-nav-actions">
            {!isFirstStep && (
              <button type="button" className="btn-secondary btn-compact" onClick={onBack}>
                <PixelArrowLeftIcon width={12} height={12} />
                <span>Back</span>
              </button>
            )}

            {isLastStep ? (
              <button type="button" className="btn-primary btn-compact" onClick={onComplete}>
                <span>Finish Tour</span>
              </button>
            ) : (
              <button type="button" className="btn-primary btn-compact" onClick={onNext}>
                <span>Next</span>
                <PixelChevronIcon width={12} height={12} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
