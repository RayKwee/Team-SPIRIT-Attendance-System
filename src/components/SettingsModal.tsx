import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react';
import type {
  DefaultAssignmentStatus,
  RosterDensity,
  SyncStatus,
  ThemeAccent,
  UserPreferences,
  ViewMode,
} from '../types/attendance';
import {
  PixelAlertIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelDownloadIcon,
  PixelLockIcon,
  PixelLogOutIcon,
  PixelRefreshIcon,
  PixelSettingsIcon,
  PixelUploadIcon,
  PixelUserIcon,
} from './PixelIcons';

interface SettingsModalProps {
  isOpen: boolean;
  preferences: UserPreferences;
  isCloudConnected: boolean;
  userEmail?: string;
  syncStatus: SyncStatus;
  pendingSyncCount: number;
  syncError?: string | null;
  memberCount: number;
  sessionCount: number;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onResetPreferences: () => void;
  onOpenCloudSync: () => void;
  onSignOut: () => Promise<void>;
  onExportBackup: () => void;
  onImportBackupFile: (
    file: File,
  ) => Promise<{ importedMembers: number; importedSessions: number }>;
  onClose: () => void;
}

const ACCENT_OPTIONS: { value: ThemeAccent; label: string; hex: string }[] = [
  { value: 'cyan', label: 'Cyan', hex: '#22d3ee' },
  { value: 'gold', label: 'Gold', hex: '#f5b82e' },
  { value: 'green', label: 'Green', hex: '#22c55e' },
  { value: 'red', label: 'Red', hex: '#ef4444' },
];

const DENSITY_OPTIONS: { value: RosterDensity; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

const DEFAULT_ASSIGNMENT_OPTIONS: { value: DefaultAssignmentStatus; label: string }[] = [
  { value: 'unmarked', label: 'Unmarked' },
  { value: 'present', label: 'Present' },
];

const CHECKLIST_VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: 'list', label: 'List' },
  { value: 'grid', label: 'Grid' },
];

function getSyncSummaryLabel(
  syncStatus: SyncStatus,
  pendingSyncCount: number,
  syncError?: string | null,
): string {
  if (syncStatus === 'loading' || syncStatus === 'syncing') {
    return 'Syncing changes with Supabase...';
  }
  if (syncStatus === 'pending') {
    return pendingSyncCount > 0
      ? `${pendingSyncCount} pending ${pendingSyncCount === 1 ? 'change' : 'changes'} queued`
      : 'Pending local changes queued for sync';
  }
  if (syncStatus === 'error') {
    return syncError || 'Sync error — check connection and retry';
  }
  return 'All records synced with Supabase';
}

/** Accessible voxel-styled settings modal for account management, appearance, attendance defaults, and backups. */
export function SettingsModal({
  isOpen,
  preferences,
  isCloudConnected,
  userEmail,
  syncStatus,
  pendingSyncCount,
  syncError,
  memberCount,
  sessionCount,
  onUpdatePreferences,
  onResetPreferences,
  onOpenCloudSync,
  onSignOut,
  onExportBackup,
  onImportBackupFile,
  onClose,
}: SettingsModalProps) {
  const titleId = useId();
  const directoryToggleId = useId();
  const sessionToggleId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [backupNotice, setBackupNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setIsSigningOut(false);
    setIsImporting(false);
    setBackupNotice(null);

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSigningOut && !isImporting) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, isSigningOut, isImporting, onClose]);

  if (!isOpen) {
    return null;
  }

  async function handleSignOutClick() {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setIsSigningOut(false);
    }
  }

  function handleExportClick() {
    onExportBackup();
    setBackupNotice({
      tone: 'success',
      message: `Exported backup (${memberCount} ${memberCount === 1 ? 'member' : 'members'}, ${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'}).`,
    });
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsImporting(true);
    setBackupNotice(null);
    try {
      const result = await onImportBackupFile(file);
      setBackupNotice({
        tone: 'success',
        message: `Backup restored: ${result.importedMembers} ${result.importedMembers === 1 ? 'member' : 'members'} and ${result.importedSessions} ${result.importedSessions === 1 ? 'session' : 'sessions'} merged.`,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unable to import the selected backup file.';
      setBackupNotice({ tone: 'error', message });
    } finally {
      setIsImporting(false);
    }
  }

  function handleResetPreferencesClick() {
    onResetPreferences();
    setBackupNotice({
      tone: 'success',
      message: 'Workspace UI preferences reset to defaults.',
    });
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isSigningOut && !isImporting) {
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
            disabled={isSigningOut || isImporting}
            aria-label="Close settings"
            title="Close (Esc)"
          >
            <PixelCloseIcon />
          </button>
        </div>

        <div className="settings-modal-body">
          {/* Section 1: Account & Cloud Sync */}
          <section className="settings-section" aria-label="Account and Cloud Sync">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Account &amp; Cloud Sync</h3>
              <span className={`settings-mode-tag ${isCloudConnected ? 'is-cloud' : 'is-local'}`}>
                {isCloudConnected ? 'Supabase Connected' : 'Local-Only Mode'}
              </span>
            </div>

            {isCloudConnected ? (
              <div className="settings-account-card is-connected">
                <div className="settings-account-info">
                  <div className="settings-account-avatar" aria-hidden="true">
                    <PixelUserIcon />
                  </div>
                  <div className="settings-account-copy">
                    <span className="settings-account-label">Signed in as</span>
                    <strong className="settings-account-email" title={userEmail}>
                      {userEmail || 'Authenticated Supabase Account'}
                    </strong>
                    <span className="settings-account-sync-meta">
                      {getSyncSummaryLabel(syncStatus, pendingSyncCount, syncError)}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  className="settings-signout-btn"
                  onClick={() => void handleSignOutClick()}
                  disabled={isSigningOut}
                >
                  <PixelLogOutIcon />
                  <span>{isSigningOut ? 'Signing Out...' : 'Sign Out'}</span>
                </button>
              </div>
            ) : (
              <div className="settings-account-card is-local">
                <div className="settings-account-copy">
                  <span className="settings-toggle-title">Not signed in to Supabase</span>
                  <span className="settings-toggle-desc">
                    Records are saved only in this browser. Sign in to sync members and sessions
                    across devices.
                  </span>
                </div>

                <button
                  type="button"
                  className="btn-primary settings-signin-btn"
                  onClick={() => {
                    onClose();
                    onOpenCloudSync();
                  }}
                >
                  <PixelLockIcon />
                  <span>Sign In</span>
                </button>
              </div>
            )}
          </section>

          {/* Section 2: Appearance & Layout */}
          <section className="settings-section" aria-label="Appearance and Layout">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Appearance &amp; Layout</h3>
              <span className="settings-autosave-hint">Auto-saved</span>
            </div>

            <div className="settings-list">
              <div className="settings-control-row">
                <div className="settings-toggle-copy">
                  <span className="settings-toggle-title">Theme Accent Color</span>
                  <span className="settings-toggle-desc">
                    Choose the highlight accent used across navigation, controls, and focus rings.
                  </span>
                </div>

                <div className="settings-accent-picker" role="group" aria-label="Theme accent color">
                  {ACCENT_OPTIONS.map((option) => {
                    const isActive = preferences.themeAccent === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        className={`settings-accent-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() => onUpdatePreferences({ themeAccent: option.value })}
                        title={`Use ${option.label} accent`}
                      >
                        <span
                          className="settings-accent-swatch"
                          style={{ backgroundColor: option.hex }}
                          aria-hidden="true"
                        />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settings-control-row">
                <div className="settings-toggle-copy">
                  <span className="settings-toggle-title">Roster Row Spacing</span>
                  <span className="settings-toggle-desc">
                    Switch between spacious rows or a denser layout to view more members at once.
                  </span>
                </div>

                <div className="settings-segmented" role="group" aria-label="Roster row spacing">
                  {DENSITY_OPTIONS.map((option) => {
                    const isActive = preferences.rosterDensity === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        className={`settings-segmented-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() => onUpdatePreferences({ rosterDensity: option.value })}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Default Attendance Behavior */}
          <section className="settings-section" aria-label="Default Attendance Behavior">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Default Attendance Behavior</h3>
            </div>

            <div className="settings-list">
              <div className="settings-control-row">
                <div className="settings-toggle-copy">
                  <span className="settings-toggle-title">Default Status When Adding Member</span>
                  <span className="settings-toggle-desc">
                    Initial attendance status assigned when adding a member to a session checklist.
                  </span>
                </div>

                <div
                  className="settings-segmented"
                  role="group"
                  aria-label="Default status when adding member to session"
                >
                  {DEFAULT_ASSIGNMENT_OPTIONS.map((option) => {
                    const isActive = preferences.defaultAssignmentStatus === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        className={`settings-segmented-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() =>
                          onUpdatePreferences({ defaultAssignmentStatus: option.value })
                        }
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="settings-control-row">
                <div className="settings-toggle-copy">
                  <span className="settings-toggle-title">Checklist Layout</span>
                  <span className="settings-toggle-desc">
                    Choose whether session attendance opens in line-by-line list or card grid view.
                  </span>
                </div>

                <div className="settings-segmented" role="group" aria-label="Checklist layout">
                  {CHECKLIST_VIEW_OPTIONS.map((option) => {
                    const isActive = preferences.viewMode === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        aria-pressed={isActive}
                        className={`settings-segmented-btn ${isActive ? 'is-active' : ''}`}
                        onClick={() => onUpdatePreferences({ viewMode: option.value })}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

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
          </section>

          {/* Section 4: Local Data Backups */}
          <section className="settings-section" aria-label="Local Data Backups">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Local Data Backups</h3>
              <span className="settings-autosave-hint">
                {memberCount} {memberCount === 1 ? 'member' : 'members'} • {sessionCount}{' '}
                {sessionCount === 1 ? 'session' : 'sessions'}
              </span>
            </div>

            <div className="settings-backup-card">
              <p className="settings-toggle-desc">
                Export a portable JSON snapshot of your roster, sessions, and preferences, or
                merge records from a previous backup file.
              </p>

              <div className="settings-backup-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={handleExportClick}
                  disabled={isImporting}
                >
                  <PixelDownloadIcon />
                  <span>Export JSON Backup</span>
                </button>

                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                >
                  <PixelUploadIcon />
                  <span>{isImporting ? 'Importing...' : 'Import Backup'}</span>
                </button>

                <button
                  type="button"
                  className="btn-secondary settings-reset-btn"
                  onClick={handleResetPreferencesClick}
                  disabled={isImporting}
                  title="Reset visual and attendance UI preferences to defaults"
                >
                  <PixelRefreshIcon />
                  <span>Reset Preferences</span>
                </button>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="sr-only"
                onChange={(event) => void handleFileChange(event)}
                aria-label="Import Team SPIRIT JSON backup file"
              />

              {backupNotice && (
                <div
                  className={`settings-backup-notice is-${backupNotice.tone}`}
                  role={backupNotice.tone === 'error' ? 'alert' : 'status'}
                >
                  {backupNotice.tone === 'error' ? (
                    <PixelAlertIcon width={13} height={13} />
                  ) : (
                    <PixelCheckIcon width={13} height={13} />
                  )}
                  <span>{backupNotice.message}</span>
                </div>
              )}
            </div>
          </section>

          <div className="modal-footer">
            <button
              type="button"
              className="btn-secondary"
              onClick={onClose}
              disabled={isSigningOut || isImporting}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
