import { useEffect, useState } from 'react';
import {
  PixelAlertIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelRefreshIcon,
  PixelTerminalIcon,
} from './PixelIcons';

export type ToastTone = 'success' | 'info' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  tone: ToastTone;
  tag: string;
  message: string;
  undoToken?: string;
}

interface ToastCardProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
  onUndo: (id: string, undoToken: string) => void;
}

const TOAST_AUTO_DISMISS_MS = 5200;

function ToastCard({ toast, onDismiss, onUndo }: ToastCardProps) {
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const timer = window.setTimeout(() => {
      onDismiss(toast.id);
    }, TOAST_AUTO_DISMISS_MS);

    return () => window.clearTimeout(timer);
  }, [isPaused, onDismiss, toast.id]);

  return (
    <div
      className={`toast-card is-${toast.tone}`}
      role={toast.tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onFocus={() => setIsPaused(true)}
      onBlur={() => setIsPaused(false)}
    >
      <div className="toast-icon-wrap" aria-hidden="true">
        {toast.tone === 'success' ? (
          <PixelCheckIcon width={14} height={14} />
        ) : toast.tone === 'warning' || toast.tone === 'error' ? (
          <PixelAlertIcon width={14} height={14} />
        ) : (
          <PixelTerminalIcon width={14} height={14} />
        )}
      </div>

      <div className="toast-copy">
        <span className="toast-tag">{toast.tag}</span>
        <p className="toast-message">{toast.message}</p>
      </div>

      <div className="toast-actions">
        {toast.undoToken && (
          <button
            type="button"
            className="toast-undo-btn"
            onClick={() => onUndo(toast.id, toast.undoToken!)}
          >
            <PixelRefreshIcon width={11} height={11} />
            <span>Undo</span>
          </button>
        )}

        <button
          type="button"
          className="toast-close-btn"
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss notification"
          title="Dismiss"
        >
          <PixelCloseIcon width={11} height={11} />
        </button>
      </div>
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  onUndo: (id: string, undoToken: string) => void;
}

/** Bottom-right tech-styled toast stack for action confirmations, cloud sync status, and quick Undo. */
export function ToastContainer({ toasts, onDismiss, onUndo }: ToastContainerProps) {
  if (toasts.length === 0) {
    return null;
  }

  return (
    <aside
      className="toast-viewport"
      aria-label="Workspace notifications"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} onUndo={onUndo} />
      ))}
    </aside>
  );
}
