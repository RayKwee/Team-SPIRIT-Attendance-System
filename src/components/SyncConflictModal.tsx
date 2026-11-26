import { useEffect, useId, useRef, useState } from 'react';
import type {
  SyncConflictItem,
  SyncConflictResolution,
  SyncedAttendanceRecord,
  SyncedMemberRecord,
  SyncedSessionRecord,
} from '../types/attendance';
import {
  MEETING_VISIBILITY_LABELS,
  STATUS_LABELS,
  normalizeMeetingVisibility,
} from '../utils/attendance';
import { formatTimestamp } from '../utils/date';
import { PixelAlertIcon, PixelCheckIcon, PixelCloseIcon, PixelRefreshIcon } from './PixelIcons';

interface SyncConflictModalProps {
  isOpen: boolean;
  conflicts: SyncConflictItem[];
  onResolveConflict: (conflictId: string, resolution: SyncConflictResolution) => Promise<void>;
  onResolveAll: (resolution: SyncConflictResolution) => Promise<void>;
  onClose: () => void;
}

function summarizeRecord(item: SyncConflictItem, side: 'local' | 'remote'): string[] {
  const record = side === 'local' ? item.localRecord : item.remoteRecord;
  if (record.deletedAt) {
    return [`Deleted (${formatTimestamp(record.deletedAt)})`];
  }

  if (item.entityType === 'member') {
    const m = record as SyncedMemberRecord;
    return [
      `Name: ${m.name}`,
      m.className ? `Class: ${m.className}` : null,
      m.role ? `Role: ${m.role}` : null,
      m.isLegacy ? 'Status: Legacy / Retired' : 'Status: Active',
      m.email ? `Email: ${m.email}` : null,
      m.phone ? `Phone: ${m.phone}` : null,
      m.notes ? `Notes: ${m.notes}` : null,
    ].filter((line): line is string => Boolean(line));
  }

  if (item.entityType === 'session') {
    const s = record as SyncedSessionRecord;
    const visLabel = MEETING_VISIBILITY_LABELS[normalizeMeetingVisibility(s.visibility)];
    return [
      `Name: ${s.name}`,
      `When: ${s.date} ${s.time}`,
      s.location ? `Location: ${s.location}` : null,
      s.eventType ? `Type: ${s.eventType}` : null,
      `Visibility: ${visLabel}`,
      s.description ? `Notes: ${s.description}` : null,
    ].filter((line): line is string => Boolean(line));
  }

  const a = record as SyncedAttendanceRecord;
  return [
    `Status: ${STATUS_LABELS[a.status]}`,
    a.status === 'absent_with_reason' ? `Reason: ${a.reason || '(blank)'}` : null,
  ].filter((line): line is string => Boolean(line));
}

/**
 * Interactive side-by-side resolution dialog for true concurrent sync conflicts
 * (same-field edits or edit-vs-delete collisions) so neither device's changes are silently lost.
 */
export function SyncConflictModal({
  isOpen,
  conflicts,
  onResolveConflict,
  onResolveAll,
  onClose,
}: SyncConflictModalProps) {
  const titleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setBusyId(null);
    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busyId) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, busyId, onClose]);

  if (!isOpen) {
    return null;
  }

  async function handleSingle(conflictId: string, resolution: SyncConflictResolution) {
    if (busyId) return;
    setBusyId(conflictId);
    try {
      await onResolveConflict(conflictId, resolution);
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulk(resolution: SyncConflictResolution) {
    if (busyId) return;
    setBusyId('__all__');
    try {
      await onResolveAll(resolution);
      onClose();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="modal-backdrop cloud-sync-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyId) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog sync-conflict-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge">
              <PixelAlertIcon />
              <span>Concurrent Sync Conflict</span>
            </span>
            <h2 id={titleId} className="modal-title">
              Resolve Conflicting Edits ({conflicts.length})
            </h2>
          </div>

          <button
            ref={closeButtonRef}
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            disabled={Boolean(busyId)}
            aria-label="Close conflict resolution dialog"
            title="Close (Esc)"
          >
            <PixelCloseIcon />
          </button>
        </div>

        <div className="sync-conflict-modal-body">
          <p className="sync-conflict-intro">
            Another tab or device updated the same fields while your changes were offline or pending.
            Non-overlapping edits were merged automatically; choose which version to keep for each
            remaining conflict.
          </p>

          {conflicts.length === 0 ? (
            <div className="sync-conflict-empty">
              <PixelCheckIcon />
              <span>All sync conflicts have been resolved.</span>
            </div>
          ) : (
            <div className="sync-conflict-list">
              {conflicts.map((conflict) => {
                const localLines = summarizeRecord(conflict, 'local');
                const remoteLines = summarizeRecord(conflict, 'remote');
                const isItemBusy = Boolean(busyId);

                return (
                  <article key={conflict.id} className="sync-conflict-card">
                    <div className="sync-conflict-card-header">
                      <div>
                        <h3 className="sync-conflict-item-title">{conflict.label}</h3>
                        {conflict.sublabel && (
                          <span className="sync-conflict-item-sub">{conflict.sublabel}</span>
                        )}
                      </div>
                      <span className="sync-conflict-fields-pill">
                        {conflict.conflictingFields.join(', ')}
                      </span>
                    </div>

                    <div className="sync-conflict-diff-grid">
                      <div className="sync-conflict-pane is-local">
                        <div className="sync-conflict-pane-header">
                          <strong>This Device</strong>
                          <span>{formatTimestamp(conflict.localRecord.updatedAt)}</span>
                        </div>
                        <ul className="sync-conflict-pane-lines">
                          {localLines.map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="btn-secondary btn-compact"
                          disabled={isItemBusy}
                          onClick={() => void handleSingle(conflict.id, 'keep_local')}
                        >
                          <PixelRefreshIcon width={12} height={12} />
                          <span>Keep Mine</span>
                        </button>
                      </div>

                      <div className="sync-conflict-pane is-remote">
                        <div className="sync-conflict-pane-header">
                          <strong>Cloud Record</strong>
                          <span>{formatTimestamp(conflict.remoteRecord.updatedAt)}</span>
                        </div>
                        <ul className="sync-conflict-pane-lines">
                          {remoteLines.map((line, index) => (
                            <li key={index}>{line}</li>
                          ))}
                        </ul>
                        <button
                          type="button"
                          className="btn-primary btn-compact"
                          disabled={isItemBusy}
                          onClick={() => void handleSingle(conflict.id, 'use_remote')}
                        >
                          <PixelCheckIcon width={12} height={12} />
                          <span>Use Cloud</span>
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="modal-footer sync-conflict-footer">
            {conflicts.length > 1 && (
              <div className="sync-conflict-bulk-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={Boolean(busyId)}
                  onClick={() => void handleBulk('keep_local')}
                >
                  Keep All Mine
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={Boolean(busyId)}
                  onClick={() => void handleBulk('use_remote')}
                >
                  Use All Cloud
                </button>
              </div>
            )}

            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={Boolean(busyId)}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
