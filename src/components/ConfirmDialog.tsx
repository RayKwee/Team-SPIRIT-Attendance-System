import { useEffect, useId, useRef } from 'react';
import { PixelCloseIcon, PixelTrashIcon } from './PixelIcons';

interface ConfirmDialogProps {
  isOpen: boolean;
  badgeLabel?: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Accessible voxel-styled confirmation dialog for destructive actions. */
export function ConfirmDialog({
  isOpen,
  badgeLabel = 'Confirm Delete',
  title,
  message,
  confirmLabel = 'Delete',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      cancelButtonRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCancel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onCancel();
        }
      }}
    >
      <div
        className="modal-dialog modal-dialog-danger"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge modal-badge-danger">
              <PixelTrashIcon />
              <span>{badgeLabel}</span>
            </span>
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onCancel}
            aria-label="Cancel deletion"
            title="Cancel (Esc)"
          >
            <PixelCloseIcon />
          </button>
        </div>

        <div className="confirm-dialog-body">
          <p id={descriptionId} className="confirm-dialog-message">
            {message}
          </p>

          <div className="modal-footer">
            <button
              ref={cancelButtonRef}
              type="button"
              className="btn-secondary"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button type="button" className="btn-danger" onClick={onConfirm}>
              <PixelTrashIcon />
              <span>{confirmLabel}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
