import { useEffect, useId, useRef } from 'react';
import type { UserPreferences } from '../types/attendance';
import { PixelCloseIcon, PixelSettingsIcon } from './PixelIcons';

interface SettingsModalProps {
  isOpen: boolean;
  preferences: UserPreferences;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onClose: () => void;
}

/** Accessible voxel-styled settings modal for workspace confirmation preferences. */
export function SettingsModal({
  isOpen,
  preferences,
  onUpdatePreferences,
  onClose,
}: SettingsModalProps) {
  const titleId = useId();
  const directoryToggleId = useId();
  const sessionToggleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog settings-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge">
              <PixelSettingsIcon />
              <span>Preferences</span>
            </span>
            <h2 id={titleId} className="modal-title">
              Workspace Settings
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close settings"
            title="Close (Esc)"
          >
            <PixelCloseIcon />
          </button>
        </div>

        <div className="settings-modal-body">
          <div className="settings-list">
            <label className="settings-toggle-row" htmlFor={directoryToggleId}>
              <div className="settings-toggle-copy">
                <span className="settings-toggle-title">
                  Confirm before deleting from Member Manager
                </span>
                <span className="settings-toggle-desc">
                  Ask for confirmation before permanently deleting a member and all of their
                  saved session records.
                </span>
              </div>

              <span className="voxel-switch">
                <input
                  id={directoryToggleId}
                  type="checkbox"
                  checked={preferences.confirmDirectoryMemberDeletion}
                  onChange={(event) =>
                    onUpdatePreferences({
                      confirmDirectoryMemberDeletion: event.target.checked,
                    })
                  }
                />
                <span className="voxel-switch-track" aria-hidden="true">
                  <span className="voxel-switch-thumb" />
                </span>
              </span>
            </label>

            <label className="settings-toggle-row" htmlFor={sessionToggleId}>
              <div className="settings-toggle-copy">
                <span className="settings-toggle-title">
                  Confirm before removing from session checklist
                </span>
                <span className="settings-toggle-desc">
                  Ask for confirmation before removing a member from an individual session&apos;s
                  attendance list.
                </span>
              </div>

              <span className="voxel-switch">
                <input
                  id={sessionToggleId}
                  type="checkbox"
                  checked={preferences.confirmSessionMemberRemoval}
                  onChange={(event) =>
                    onUpdatePreferences({
                      confirmSessionMemberRemoval: event.target.checked,
                    })
                  }
                />
                <span className="voxel-switch-track" aria-hidden="true">
                  <span className="voxel-switch-thumb" />
                </span>
              </span>
            </label>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
