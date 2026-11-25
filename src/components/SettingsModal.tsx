import { useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import type { PasswordChangeError } from '../hooks/useSupabaseAuth';
import { DEFAULT_MEMBER_VISIBILITY_PERMISSIONS } from '../lib/clubPostsApi';
import type {
  AccessScope,
  AccountRole,
  ClubMember,
  DefaultAssignmentStatus,
  RosterDensity,
  SyncStatus,
  ThemeAccent,
  UserPreferences,
  UserProfileRecord,
  ViewMode,
} from '../types/attendance';
import {
  CONTENT_DELETION_MODE_DESCRIPTIONS,
  CONTENT_DELETION_MODE_LABELS,
  DEFAULT_CONTENT_DELETION_MODE,
  type ContentDeletionMode,
  type MemberVisibilityPermissions,
} from '../types/projectIdeas';
import type { TutorialStatus } from '../types/tutorial';
import { formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelDownloadIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelHelpIcon,
  PixelKeyIcon,
  PixelLockIcon,
  PixelLogOutIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelSettingsIcon,
  PixelStarIcon,
  PixelUploadIcon,
  PixelUserIcon,
} from './PixelIcons';

interface SettingsModalProps {
  isOpen: boolean;
  preferences: UserPreferences;
  tutorialStatus: TutorialStatus;
  isCloudConnected: boolean;
  currentUserId?: string | null;
  userEmail?: string;
  userRole?: AccountRole | null;
  isAdmin: boolean;
  accessScope?: AccessScope;
  linkedMember?: ClubMember | null;
  canViewAllAttendance?: boolean;
  members?: ClubMember[];
  isRoleLoading?: boolean;
  roleError?: string | null;
  adminProfiles?: UserProfileRecord[];
  isProfilesLoading?: boolean;
  profilesError?: string | null;
  canManageClubRecords: boolean;
  syncStatus: SyncStatus;
  pendingSyncCount: number;
  syncError?: string | null;
  memberCount: number;
  sessionCount: number;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
  onResetPreferences: () => void;
  onStartTutorial: () => void;
  onOpenCloudSync: () => void;
  onChangePassword?: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ error: PasswordChangeError | null }>;
  onSignOut: () => Promise<void>;
  onRefreshAdminProfiles?: () => Promise<void>;
  onUpdateUserAdminRole?: (targetUserId: string, makeAdmin: boolean) => Promise<UserProfileRecord>;
  onLinkUserToMember?: (
    targetUserId: string,
    targetMemberId: string | null,
  ) => Promise<UserProfileRecord>;
  onUpdateUserVisibilityScope?: (
    targetUserId: string,
    allowBroadView: boolean,
  ) => Promise<UserProfileRecord>;
  memberVisibilityPermissions?: MemberVisibilityPermissions;
  isUpdatingSharedIdeaVisibility?: boolean;
  onUpdateMemberVisibilityPermissions?: (
    patch: Partial<MemberVisibilityPermissions>,
  ) => Promise<MemberVisibilityPermissions>;
  contentDeletionMode?: ContentDeletionMode;
  isUpdatingContentDeletionMode?: boolean;
  onSetContentDeletionMode?: (mode: ContentDeletionMode) => Promise<ContentDeletionMode>;
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

const CONTENT_DELETION_MODE_OPTIONS: { value: ContentDeletionMode; label: string }[] = [
  { value: 'own_only', label: CONTENT_DELETION_MODE_LABELS.own_only },
  { value: 'any', label: CONTENT_DELETION_MODE_LABELS.any },
  { value: 'disabled', label: CONTENT_DELETION_MODE_LABELS.disabled },
];

const MEMBER_PERMISSION_TOGGLES: {
  key: keyof MemberVisibilityPermissions;
  title: string;
  description: string;
}[] = [
  {
    key: 'memberCanViewRoster',
    title: "Full Club Roster & Other Members' Profiles",
    description:
      'Allow standard members to open the full Member Manager directory and inspect peer profiles (read-only).',
  },
  {
    key: 'memberCanViewAttendanceRates',
    title: "Other Members' Attendance Rates & Leaderboard",
    description:
      'Allow standard members to view club-wide attendance totals, peer percentages, streaks, and the Attendance Leaderboard.',
  },
  {
    key: 'memberCanViewCalendarDetails',
    title: 'Club-Wide Calendar Details',
    description:
      'Allow standard members to view all scheduled club meetings, dates, times, and locations on the Calendar.',
  },
  {
    key: 'sharedIdeaVisibility',
    title: "Other Members' Submitted Project Ideas",
    description:
      'Allow standard members to browse all club project proposals (personal admin feedback stays private).',
  },
  {
    key: 'memberCanCommentOnPosts',
    title: 'Comment/Reply Permissions on Posts',
    description:
      'Allow logged-in standard members to post comments and replies under official club updates.',
  },
];

function getSyncSummaryLabel(
  syncStatus: SyncStatus,
  pendingSyncCount: number,
  syncError?: string | null,
): string {
  if (syncStatus === 'conflict') {
    return 'Concurrent edit conflict detected — review from the header Conflict pill';
  }
  if (syncStatus === 'reconnecting') {
    return 'Reconnecting live sync channel — background sync active';
  }
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
  tutorialStatus,
  isCloudConnected,
  currentUserId,
  userEmail,
  userRole,
  isAdmin,
  accessScope = 'local',
  linkedMember = null,
  canViewAllAttendance = false,
  members = [],
  isRoleLoading = false,
  roleError,
  adminProfiles = [],
  isProfilesLoading = false,
  profilesError,
  canManageClubRecords,
  syncStatus,
  pendingSyncCount,
  syncError,
  memberCount,
  sessionCount,
  onUpdatePreferences,
  onResetPreferences,
  onStartTutorial,
  onOpenCloudSync,
  onChangePassword,
  onSignOut,
  onRefreshAdminProfiles,
  onUpdateUserAdminRole,
  onLinkUserToMember,
  onUpdateUserVisibilityScope,
  memberVisibilityPermissions = DEFAULT_MEMBER_VISIBILITY_PERMISSIONS,
  isUpdatingSharedIdeaVisibility = false,
  onUpdateMemberVisibilityPermissions,
  contentDeletionMode = DEFAULT_CONTENT_DELETION_MODE,
  isUpdatingContentDeletionMode = false,
  onSetContentDeletionMode,
  onExportBackup,
  onImportBackupFile,
  onClose,
}: SettingsModalProps) {
  const titleId = useId();
  const directoryToggleId = useId();
  const sessionToggleId = useId();
  const currentPasswordInputId = useId();
  const newPasswordInputId = useId();
  const confirmPasswordInputId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const currentPasswordRef = useRef<HTMLInputElement | null>(null);
  const newPasswordRef = useRef<HTMLInputElement | null>(null);
  const confirmPasswordRef = useRef<HTMLInputElement | null>(null);

  const [isSigningOut, setIsSigningOut] = useState(false);
  const [isPasswordFormOpen, setIsPasswordFormOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);
  const [passwordNotice, setPasswordNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
    field?: 'current' | 'new' | 'confirm' | 'general';
  } | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [adminSearchQuery, setAdminSearchQuery] = useState('');
  const [adminRoleFilter, setAdminRoleFilter] = useState<'all' | 'admin' | 'member'>('all');
  const [busyRoleUserId, setBusyRoleUserId] = useState<string | null>(null);
  const [permissionsNotice, setPermissionsNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [deletionPolicyNotice, setDeletionPolicyNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [adminNotice, setAdminNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    profile: UserProfileRecord;
    makeAdmin: boolean;
  } | null>(null);
  const [backupNotice, setBackupNotice] = useState<{
    tone: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    setIsSigningOut(false);
    setIsPasswordFormOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setIsUpdatingPassword(false);
    setPasswordNotice(null);
    setIsImporting(false);
    setAdminSearchQuery('');
    setAdminRoleFilter('all');
    setBusyRoleUserId(null);
    setAdminNotice(null);
    setPermissionsNotice(null);
    setDeletionPolicyNotice(null);
    setPendingRoleChange(null);
    setBackupNotice(null);

    const focusTimer = window.setTimeout(() => {
      closeButtonRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isCloudConnected) return;
    setIsPasswordFormOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setIsUpdatingPassword(false);
    setPasswordNotice(null);
  }, [isCloudConnected]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (
        event.key === 'Escape' &&
        !isSigningOut &&
        !isUpdatingPassword &&
        !isImporting &&
        !busyRoleUserId &&
        !pendingRoleChange
      ) {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    isOpen,
    isSigningOut,
    isUpdatingPassword,
    isImporting,
    busyRoleUserId,
    pendingRoleChange,
    onClose,
  ]);

  if (!isOpen) {
    return null;
  }

  async function handleSignOutClick() {
    if (isSigningOut || isUpdatingPassword) return;
    setIsSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setIsSigningOut(false);
    }
  }

  function clearPasswordFields() {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
  }

  function focusPasswordField(field?: 'current' | 'new' | 'confirm' | 'general') {
    window.setTimeout(() => {
      if (field === 'current') {
        currentPasswordRef.current?.focus();
      } else if (field === 'new') {
        newPasswordRef.current?.focus();
      } else if (field === 'confirm') {
        confirmPasswordRef.current?.focus();
      }
    }, 0);
  }

  function handleTogglePasswordForm() {
    if (isUpdatingPassword) return;
    if (isPasswordFormOpen) {
      setIsPasswordFormOpen(false);
      clearPasswordFields();
      setPasswordNotice(null);
      return;
    }
    clearPasswordFields();
    setPasswordNotice(null);
    setIsPasswordFormOpen(true);
    focusPasswordField('current');
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onChangePassword || isUpdatingPassword) return;

    if (!currentPassword) {
      setPasswordNotice({
        tone: 'error',
        message: 'Enter your current password to verify your identity.',
        field: 'current',
      });
      focusPasswordField('current');
      return;
    }

    if (!newPassword) {
      setPasswordNotice({
        tone: 'error',
        message: 'Enter a new password.',
        field: 'new',
      });
      focusPasswordField('new');
      return;
    }

    if (newPassword.length < 6) {
      setPasswordNotice({
        tone: 'error',
        message: 'New password must be at least 6 characters.',
        field: 'new',
      });
      focusPasswordField('new');
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordNotice({
        tone: 'error',
        message: 'New password must be different from your current password.',
        field: 'new',
      });
      focusPasswordField('new');
      return;
    }

    if (!confirmPassword) {
      setPasswordNotice({
        tone: 'error',
        message: 'Confirm your new password.',
        field: 'confirm',
      });
      focusPasswordField('confirm');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordNotice({
        tone: 'error',
        message: 'New passwords do not match.',
        field: 'confirm',
      });
      focusPasswordField('confirm');
      return;
    }

    setIsUpdatingPassword(true);
    setPasswordNotice(null);
    try {
      const result = await onChangePassword(currentPassword, newPassword);
      if (result.error) {
        setPasswordNotice({
          tone: 'error',
          message: result.error.message,
          field: result.error.field,
        });
        focusPasswordField(result.error.field);
        return;
      }

      clearPasswordFields();
      setIsPasswordFormOpen(false);
      setPasswordNotice({
        tone: 'success',
        message: 'Password updated successfully.',
      });
    } catch (error) {
      setPasswordNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to update password.',
        field: 'general',
      });
    } finally {
      setIsUpdatingPassword(false);
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

  async function handleConfirmRoleChange() {
    if (!pendingRoleChange || !onUpdateUserAdminRole || busyRoleUserId) return;
    const { profile, makeAdmin } = pendingRoleChange;
    setBusyRoleUserId(profile.userId);
    setAdminNotice(null);
    try {
      await onUpdateUserAdminRole(profile.userId, makeAdmin);
      setAdminNotice({
        tone: 'success',
        message: makeAdmin
          ? `Promoted ${profile.email || 'user'} to Administrator.`
          : `Removed admin privileges from ${profile.email || 'user'}.`,
      });
      setPendingRoleChange(null);
    } catch (error) {
      setAdminNotice({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to update administrator role.',
      });
      setPendingRoleChange(null);
    } finally {
      setBusyRoleUserId(null);
    }
  }

  async function handleLinkMemberChange(profile: UserProfileRecord, targetMemberId: string) {
    if (!onLinkUserToMember || busyRoleUserId) return;
    const nextMemberId = targetMemberId.trim() || null;
    setBusyRoleUserId(profile.userId);
    setAdminNotice(null);
    try {
      await onLinkUserToMember(profile.userId, nextMemberId);
      const linkedName = nextMemberId
        ? members.find((member) => member.id === nextMemberId)?.name ?? 'roster profile'
        : null;
      setAdminNotice({
        tone: 'success',
        message: linkedName
          ? `Linked ${profile.email || 'account'} to ${linkedName}.`
          : `Unlinked ${profile.email || 'account'} from its roster profile.`,
      });
    } catch (error) {
      setAdminNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to update linked roster profile.',
      });
    } finally {
      setBusyRoleUserId(null);
    }
  }

  async function handleToggleBroadVisibility(profile: UserProfileRecord) {
    if (!onUpdateUserVisibilityScope || busyRoleUserId) return;
    const nextBroadView = !profile.canViewAllAttendance;
    setBusyRoleUserId(profile.userId);
    setAdminNotice(null);
    try {
      await onUpdateUserVisibilityScope(profile.userId, nextBroadView);
      setAdminNotice({
        tone: 'success',
        message: nextBroadView
          ? `Granted broad club-wide attendance visibility to ${profile.email || 'user'}.`
          : `Restricted ${profile.email || 'user'} back to personal-only attendance visibility.`,
      });
    } catch (error) {
      setAdminNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to update attendance visibility scope.',
      });
    } finally {
      setBusyRoleUserId(null);
    }
  }

  async function handleTogglePermission(
    key: keyof MemberVisibilityPermissions,
    label: string,
  ) {
    if (!onUpdateMemberVisibilityPermissions || isUpdatingSharedIdeaVisibility) return;
    const nextValue = !memberVisibilityPermissions[key];
    setPermissionsNotice(null);
    try {
      await onUpdateMemberVisibilityPermissions({ [key]: nextValue });
      setPermissionsNotice({
        tone: 'success',
        message: `${nextValue ? 'Enabled' : 'Restricted'} "${label}" for all logged-in standard members.`,
      });
    } catch (error) {
      setPermissionsNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to save member visibility permissions.',
      });
    }
  }

  async function handleRestrictAllPermissions() {
    if (!onUpdateMemberVisibilityPermissions || isUpdatingSharedIdeaVisibility) return;
    setPermissionsNotice(null);
    try {
      await onUpdateMemberVisibilityPermissions(DEFAULT_MEMBER_VISIBILITY_PERMISSIONS);
      setPermissionsNotice({
        tone: 'success',
        message: 'Reset all 5 global member visibility permissions to Restricted (Strict Privacy).',
      });
    } catch (error) {
      setPermissionsNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to reset member visibility permissions.',
      });
    }
  }

  async function handleSelectContentDeletionMode(nextMode: ContentDeletionMode) {
    if (!onSetContentDeletionMode || isUpdatingContentDeletionMode || nextMode === contentDeletionMode) {
      return;
    }
    setDeletionPolicyNotice(null);
    try {
      const savedMode = await onSetContentDeletionMode(nextMode);
      setDeletionPolicyNotice({
        tone: 'success',
        message: `Updated user content deletion policy to "${CONTENT_DELETION_MODE_LABELS[savedMode]}".`,
      });
    } catch (error) {
      setDeletionPolicyNotice({
        tone: 'error',
        message:
          error instanceof Error ? error.message : 'Unable to update content deletion policy.',
      });
    }
  }

  const adminCount = adminProfiles.filter(
    (profile) => !profile.isDisabled && profile.role === 'admin',
  ).length;
  const standardMemberCount = adminProfiles.length - adminCount;
  const enabledPermissionsCount = Object.values(memberVisibilityPermissions).filter(Boolean).length;
  const memberNameById = new Map(members.map((member) => [member.id, member]));
  const sortedMembersForLinking = [...members].sort((a, b) => a.name.localeCompare(b.name));
  const filteredAdminProfiles = adminProfiles.filter((profile) => {
    if (adminRoleFilter === 'admin' && profile.role !== 'admin') return false;
    if (adminRoleFilter === 'member' && profile.role !== 'member') return false;
    const q = adminSearchQuery.trim().toLowerCase();
    if (!q) return true;
    const linkedName = profile.linkedMemberId
      ? memberNameById.get(profile.linkedMemberId)?.name.toLowerCase() ?? ''
      : '';
    return (
      profile.email.toLowerCase().includes(q) ||
      profile.role.toLowerCase().includes(q) ||
      linkedName.includes(q)
    );
  });

  const isModalBusy = isSigningOut || isUpdatingPassword || isImporting || Boolean(busyRoleUserId);
  const isRoleVerifying = isRoleLoading || userRole === null;
  const isCurrentPasswordInvalid =
    passwordNotice?.tone === 'error' && passwordNotice.field === 'current';
  const isNewPasswordInvalid =
    passwordNotice?.tone === 'error' && passwordNotice.field === 'new';
  const isConfirmPasswordInvalid =
    passwordNotice?.tone === 'error' && passwordNotice.field === 'confirm';

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !isModalBusy && !pendingRoleChange) {
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
            disabled={isModalBusy || pendingRoleChange !== null}
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
              <>
                <div className="settings-account-card is-connected">
                  <div className="settings-account-info">
                    <div className="settings-account-avatar" aria-hidden="true">
                      <PixelUserIcon />
                    </div>
                    <div className="settings-account-copy">
                      <div className="settings-account-role-row">
                        <span className="settings-account-label">Signed in as</span>
                        <span
                          className={`admin-role-pill ${
                            isRoleVerifying
                              ? 'is-loading'
                              : isAdmin
                                ? 'is-admin'
                                : canViewAllAttendance
                                  ? 'is-viewer'
                                  : 'is-member'
                          }`}
                        >
                          {isRoleVerifying
                            ? 'Verifying Role...'
                            : userRole === 'admin'
                              ? 'Administrator'
                              : canViewAllAttendance
                                ? 'Broad Viewer'
                                : 'Standard Member'}
                        </span>
                      </div>
                      <strong className="settings-account-email" title={userEmail}>
                        {userEmail || 'Authenticated Supabase Account'}
                      </strong>
                      {linkedMember && (
                        <span className="settings-account-sync-meta">
                          Linked Profile: <strong>{linkedMember.name}</strong>
                          {linkedMember.className ? ` (${linkedMember.className})` : ''}
                        </span>
                      )}
                      {!isRoleVerifying && !isAdmin && !linkedMember && !canViewAllAttendance && (
                        <span className="settings-account-sync-meta">
                          Roster link pending — ask an admin to link your login to your club
                          profile.
                        </span>
                      )}
                      <span className="settings-account-sync-meta">
                        {getSyncSummaryLabel(syncStatus, pendingSyncCount, syncError)}
                      </span>
                    </div>
                  </div>

                  <div className="settings-account-actions">
                    {onChangePassword && userEmail && (
                      <button
                        type="button"
                        className={`btn-secondary btn-compact settings-password-toggle-btn ${
                          isPasswordFormOpen ? 'is-active' : ''
                        }`}
                        onClick={handleTogglePasswordForm}
                        disabled={isSigningOut || isUpdatingPassword}
                        aria-expanded={isPasswordFormOpen}
                      >
                        <PixelKeyIcon />
                        <span>{isPasswordFormOpen ? 'Cancel' : 'Change Password'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="settings-signout-btn"
                      onClick={() => void handleSignOutClick()}
                      disabled={isSigningOut || isUpdatingPassword}
                    >
                      <PixelLogOutIcon />
                      <span>{isSigningOut ? 'Signing Out...' : 'Sign Out'}</span>
                    </button>
                  </div>
                </div>

                {isPasswordFormOpen && onChangePassword && userEmail && (
                  <form
                    className="settings-password-form"
                    onSubmit={(event) => void handlePasswordSubmit(event)}
                    noValidate
                  >
                    <div className="settings-password-grid">
                      <div className="settings-password-field is-full">
                        <label className="settings-password-label" htmlFor={currentPasswordInputId}>
                          Current Password
                        </label>
                        <div className="auth-password-wrap">
                          <input
                            ref={currentPasswordRef}
                            id={currentPasswordInputId}
                            type={showCurrentPassword ? 'text' : 'password'}
                            className={`auth-input auth-input-password settings-password-input ${
                              isCurrentPasswordInvalid ? 'is-invalid' : ''
                            }`}
                            placeholder="Verify current password"
                            value={currentPassword}
                            onChange={(event) => {
                              setCurrentPassword(event.target.value);
                              if (passwordNotice?.tone === 'error') {
                                setPasswordNotice(null);
                              }
                            }}
                            autoComplete="current-password"
                            aria-invalid={isCurrentPasswordInvalid || undefined}
                            disabled={isUpdatingPassword}
                            required
                          />
                          <button
                            type="button"
                            className="auth-visibility-btn"
                            onClick={() => setShowCurrentPassword((prev) => !prev)}
                            aria-label={
                              showCurrentPassword
                                ? 'Hide current password'
                                : 'Show current password'
                            }
                            title={
                              showCurrentPassword
                                ? 'Hide current password'
                                : 'Show current password'
                            }
                            disabled={isUpdatingPassword}
                          >
                            {showCurrentPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                          </button>
                        </div>
                      </div>

                      <div className="settings-password-field">
                        <label className="settings-password-label" htmlFor={newPasswordInputId}>
                          New Password
                        </label>
                        <div className="auth-password-wrap">
                          <input
                            ref={newPasswordRef}
                            id={newPasswordInputId}
                            type={showNewPassword ? 'text' : 'password'}
                            className={`auth-input auth-input-password settings-password-input ${
                              isNewPasswordInvalid ? 'is-invalid' : ''
                            }`}
                            placeholder="At least 6 characters"
                            value={newPassword}
                            onChange={(event) => {
                              setNewPassword(event.target.value);
                              if (passwordNotice?.tone === 'error') {
                                setPasswordNotice(null);
                              }
                            }}
                            autoComplete="new-password"
                            aria-invalid={isNewPasswordInvalid || undefined}
                            disabled={isUpdatingPassword}
                            required
                          />
                          <button
                            type="button"
                            className="auth-visibility-btn"
                            onClick={() => setShowNewPassword((prev) => !prev)}
                            aria-label={showNewPassword ? 'Hide new password' : 'Show new password'}
                            title={showNewPassword ? 'Hide new password' : 'Show new password'}
                            disabled={isUpdatingPassword}
                          >
                            {showNewPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                          </button>
                        </div>
                      </div>

                      <div className="settings-password-field">
                        <label className="settings-password-label" htmlFor={confirmPasswordInputId}>
                          Confirm New Password
                        </label>
                        <div className="auth-password-wrap">
                          <input
                            ref={confirmPasswordRef}
                            id={confirmPasswordInputId}
                            type={showConfirmPassword ? 'text' : 'password'}
                            className={`auth-input auth-input-password settings-password-input ${
                              isConfirmPasswordInvalid ? 'is-invalid' : ''
                            }`}
                            placeholder="Re-enter new password"
                            value={confirmPassword}
                            onChange={(event) => {
                              setConfirmPassword(event.target.value);
                              if (passwordNotice?.tone === 'error') {
                                setPasswordNotice(null);
                              }
                            }}
                            autoComplete="new-password"
                            aria-invalid={isConfirmPasswordInvalid || undefined}
                            disabled={isUpdatingPassword}
                            required
                          />
                          <button
                            type="button"
                            className="auth-visibility-btn"
                            onClick={() => setShowConfirmPassword((prev) => !prev)}
                            aria-label={
                              showConfirmPassword
                                ? 'Hide confirm password'
                                : 'Show confirm password'
                            }
                            title={
                              showConfirmPassword
                                ? 'Hide confirm password'
                                : 'Show confirm password'
                            }
                            disabled={isUpdatingPassword}
                          >
                            {showConfirmPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {passwordNotice?.tone === 'error' && (
                      <div className="settings-backup-notice is-error" role="alert">
                        <PixelAlertIcon width={13} height={13} />
                        <span>{passwordNotice.message}</span>
                      </div>
                    )}

                    <div className="settings-password-actions">
                      <button
                        type="submit"
                        className="btn-primary btn-compact"
                        disabled={isUpdatingPassword}
                      >
                        <PixelKeyIcon />
                        <span>{isUpdatingPassword ? 'Updating...' : 'Update Password'}</span>
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={handleTogglePasswordForm}
                        disabled={isUpdatingPassword}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}

                {!isPasswordFormOpen && passwordNotice?.tone === 'success' && (
                  <div className="settings-backup-notice is-success" role="status">
                    <PixelCheckIcon width={13} height={13} />
                    <span>{passwordNotice.message}</span>
                  </div>
                )}

                {roleError && (
                  <div className="settings-backup-notice is-error" role="alert">
                    <PixelAlertIcon width={13} height={13} />
                    <span>{roleError}</span>
                  </div>
                )}

                {!isRoleVerifying && !isAdmin && !roleError && (
                  <p className="settings-role-note">
                    {accessScope === 'broad_viewer'
                      ? 'Your account has read-only broad visibility across all club sessions and attendance stats, granted by an administrator.'
                      : accessScope === 'member_self'
                        ? 'Your account is restricted to viewing only your own attendance records, attendance rate, and sessions you participated in.'
                        : 'Your account is signed in, but waiting for an administrator to link it to a club roster profile (or grant broader visibility).'}
                  </p>
                )}
              </>
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

          {/* Section 1b: Admin Management (Visible exclusively to verified Admins) */}
          {isCloudConnected && isAdmin && (
            <section className="settings-section" aria-label="Admin Management">
              <div className="settings-section-header">
                <h3 className="settings-section-title">Admin Management</h3>
                <span className="settings-mode-tag is-cloud">
                  {adminCount} {adminCount === 1 ? 'Admin' : 'Admins'} • {adminProfiles.length}{' '}
                  {adminProfiles.length === 1 ? 'Account' : 'Accounts'}
                </span>
              </div>

              <div className="admin-management-panel">
                <div className="admin-search-row">
                  <div className="session-hub-search-wrap admin-search-wrap">
                    <span className="session-suggest-icon" aria-hidden="true">
                      <PixelSearchIcon />
                    </span>
                    <input
                      type="text"
                      className="form-control session-hub-search-input"
                      placeholder="Filter accounts by email, role, or linked member..."
                      value={adminSearchQuery}
                      onChange={(event) => setAdminSearchQuery(event.target.value)}
                      aria-label="Filter registered accounts"
                    />
                  </div>

                  {onRefreshAdminProfiles && (
                    <button
                      type="button"
                      className="btn-secondary btn-compact"
                      onClick={() => void onRefreshAdminProfiles()}
                      disabled={isProfilesLoading || Boolean(busyRoleUserId)}
                      title="Refresh registered accounts"
                    >
                      <PixelRefreshIcon />
                      <span>{isProfilesLoading ? 'Loading...' : 'Refresh'}</span>
                    </button>
                  )}
                </div>

                <div className="filter-pills admin-role-filter-pills" role="tablist" aria-label="Filter accounts by role">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={adminRoleFilter === 'all'}
                    className={`filter-pill ${adminRoleFilter === 'all' ? 'is-active' : ''}`}
                    onClick={() => setAdminRoleFilter('all')}
                  >
                    All Accounts ({adminProfiles.length})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={adminRoleFilter === 'admin'}
                    className={`filter-pill ${adminRoleFilter === 'admin' ? 'is-active' : ''}`}
                    onClick={() => setAdminRoleFilter('admin')}
                  >
                    Admins ({adminCount})
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={adminRoleFilter === 'member'}
                    className={`filter-pill ${adminRoleFilter === 'member' ? 'is-active' : ''}`}
                    onClick={() => setAdminRoleFilter('member')}
                  >
                    Members ({standardMemberCount})
                  </button>
                </div>

                {profilesError && (
                  <div className="settings-backup-notice is-error" role="alert">
                    <PixelAlertIcon width={13} height={13} />
                    <span>{profilesError}</span>
                  </div>
                )}

                {adminNotice && (
                  <div
                    className={`settings-backup-notice is-${adminNotice.tone}`}
                    role={adminNotice.tone === 'error' ? 'alert' : 'status'}
                  >
                    {adminNotice.tone === 'error' ? (
                      <PixelAlertIcon width={13} height={13} />
                    ) : (
                      <PixelCheckIcon width={13} height={13} />
                    )}
                    <span>{adminNotice.message}</span>
                  </div>
                )}

                {isProfilesLoading && adminProfiles.length === 0 ? (
                  <p className="settings-toggle-desc">Loading registered Supabase accounts...</p>
                ) : filteredAdminProfiles.length === 0 ? (
                  <p className="settings-toggle-desc">
                    {adminProfiles.length === 0
                      ? 'No registered accounts found in user_profiles.'
                      : 'No accounts match your filter.'}
                  </p>
                ) : (
                  <div className="admin-management-list" role="list" aria-label="Registered accounts">
                    {filteredAdminProfiles.map((profile) => {
                      const isTargetDisabled = Boolean(profile.isDisabled);
                      const isTargetAdmin = !isTargetDisabled && profile.role === 'admin';
                      const isSelf = Boolean(currentUserId && profile.userId === currentUserId);
                      const isLastRemainingAdmin = isTargetAdmin && adminCount <= 1;
                      const isBusy = busyRoleUserId === profile.userId;
                      const isAnyAccountBusy = Boolean(busyRoleUserId);
                      const linkedProfileMember = profile.linkedMemberId
                        ? memberNameById.get(profile.linkedMemberId) ?? null
                        : null;
                      const hasUnavailableLinkedMember = Boolean(
                        profile.linkedMemberId && !linkedProfileMember,
                      );

                      return (
                        <div key={profile.userId} role="listitem" className="admin-account-row">
                          <div className="admin-account-info">
                            <div className="admin-account-title-row">
                              <strong className="admin-account-email" title={profile.email}>
                                {profile.email || profile.userId}
                              </strong>
                              {isSelf && <span className="admin-self-tag">You</span>}
                              <span
                                className={`admin-role-pill ${
                                  isTargetDisabled
                                    ? 'is-member'
                                    : isTargetAdmin
                                      ? 'is-admin'
                                      : profile.canViewAllAttendance
                                        ? 'is-viewer'
                                        : 'is-member'
                                }`}
                              >
                                {isTargetAdmin && <PixelStarIcon width={10} height={10} />}
                                <span>
                                  {isTargetDisabled
                                    ? 'Disabled'
                                    : isTargetAdmin
                                      ? 'Admin'
                                      : profile.canViewAllAttendance
                                        ? 'Broad Viewer'
                                        : 'Normal Member'}
                                </span>
                              </span>
                            </div>
                            <span className="admin-account-meta">
                              {isTargetAdmin && profile.promotedAt
                                ? `Admin since ${formatTimestamp(profile.promotedAt)}`
                                : `Registered ${formatTimestamp(profile.createdAt)}`}
                              {linkedProfileMember
                                ? ` • Linked: ${linkedProfileMember.name}`
                                : hasUnavailableLinkedMember
                                  ? ' • Linked profile unavailable'
                                  : ' • Unlinked'}
                            </span>

                            <div className="admin-link-controls">
                              <label className="admin-link-field">
                                <span className="admin-link-label">Roster Profile</span>
                                <select
                                  className="form-control admin-link-select"
                                  value={profile.linkedMemberId ?? ''}
                                  disabled={isAnyAccountBusy || isTargetDisabled || !onLinkUserToMember}
                                  onChange={(event) =>
                                    void handleLinkMemberChange(profile, event.target.value)
                                  }
                                  aria-label={`Link ${profile.email || profile.userId} to club member`}
                                >
                                  <option value="">Unlinked (No roster profile)</option>
                                  {hasUnavailableLinkedMember && profile.linkedMemberId && (
                                    <option value={profile.linkedMemberId}>
                                      Unavailable / deleted member ({profile.linkedMemberId})
                                    </option>
                                  )}
                                  {sortedMembersForLinking.map((member) => {
                                    const claimedByOther = adminProfiles.find(
                                      (other) =>
                                        other.userId !== profile.userId &&
                                        other.linkedMemberId === member.id,
                                    );
                                    const classSuffix = member.className
                                      ? ` (${member.className})`
                                      : '';
                                    const claimedSuffix = claimedByOther
                                      ? ` — linked to ${claimedByOther.email}`
                                      : '';
                                    return (
                                      <option
                                        key={member.id}
                                        value={member.id}
                                        disabled={Boolean(claimedByOther)}
                                      >
                                        {member.name}
                                        {classSuffix}
                                        {claimedSuffix}
                                      </option>
                                    );
                                  })}
                                </select>
                              </label>
                            </div>
                          </div>

                          <div className="admin-account-actions">
                            {!isTargetAdmin && (
                              <button
                                type="button"
                                className={`btn-secondary btn-compact admin-visibility-btn ${
                                  profile.canViewAllAttendance ? 'is-broad' : ''
                                }`}
                                disabled={isAnyAccountBusy || !onUpdateUserVisibilityScope}
                                title={
                                  profile.canViewAllAttendance
                                    ? 'Currently sees all club members & sessions (read-only). Click to restrict to personal attendance only.'
                                    : 'Currently restricted to personal attendance only. Click to allow broad read-only visibility across all club stats.'
                                }
                                onClick={() => void handleToggleBroadVisibility(profile)}
                              >
                                <span>
                                  {profile.canViewAllAttendance ? 'Broad View: ON' : 'Self-Only View'}
                                </span>
                              </button>
                            )}

                            {isTargetAdmin ? (
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                disabled={
                                  isAnyAccountBusy || isLastRemainingAdmin || !onUpdateUserAdminRole
                                }
                                title={
                                  isLastRemainingAdmin
                                    ? 'You are the last remaining admin and cannot remove yourself'
                                    : isSelf
                                      ? 'Step down from Admin to Standard Member'
                                      : `Demote ${profile.email} back to Standard Member`
                                }
                                onClick={() =>
                                  setPendingRoleChange({ profile, makeAdmin: false })
                                }
                              >
                                <span>{isBusy ? 'Updating...' : 'Demote to Member'}</span>
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary btn-compact"
                                disabled={isAnyAccountBusy || isTargetDisabled || !onUpdateUserAdminRole}
                                title={
                                  isTargetDisabled
                                    ? 'Re-enable this account in the left Accounts panel first'
                                    : `Elevate ${profile.email} to Administrator`
                                }
                                onClick={() =>
                                  setPendingRoleChange({ profile, makeAdmin: true })
                                }
                              >
                                <PixelStarIcon width={11} height={11} />
                                <span>{isBusy ? 'Updating...' : 'Elevate to Admin'}</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {onUpdateMemberVisibilityPermissions && (
                <div className="admin-permissions-panel" aria-label="Member Visibility Permissions">
                  <div className="settings-section-header">
                    <div className="admin-permissions-heading">
                      <h4 className="admin-permissions-title">Member Visibility Permissions</h4>
                      <span className="settings-toggle-desc">
                        Global switches controlling what standard Member accounts can view &amp;
                        interact with across Team SPIRIT (synced live via Supabase).
                      </span>
                    </div>
                    <div className="admin-permissions-header-right">
                      <span className="settings-mode-tag is-cloud">
                        {enabledPermissionsCount} / {MEMBER_PERMISSION_TOGGLES.length} Enabled
                      </span>
                      {enabledPermissionsCount > 0 && (
                        <button
                          type="button"
                          className="btn-secondary btn-compact"
                          disabled={isUpdatingSharedIdeaVisibility}
                          onClick={() => void handleRestrictAllPermissions()}
                        >
                          <span>Restrict All</span>
                        </button>
                      )}
                    </div>
                  </div>

                  {permissionsNotice && (
                    <div
                      className={`settings-backup-notice is-${permissionsNotice.tone}`}
                      role={permissionsNotice.tone === 'error' ? 'alert' : 'status'}
                    >
                      {permissionsNotice.tone === 'error' ? (
                        <PixelAlertIcon width={13} height={13} />
                      ) : (
                        <PixelCheckIcon width={13} height={13} />
                      )}
                      <span>{permissionsNotice.message}</span>
                    </div>
                  )}

                  <div className="settings-list">
                    {MEMBER_PERMISSION_TOGGLES.map((perm) => {
                      const isChecked = memberVisibilityPermissions[perm.key];
                      const switchId = `perm-switch-${perm.key}`;
                      return (
                        <label key={perm.key} htmlFor={switchId} className="settings-toggle-row">
                          <div className="settings-toggle-copy">
                            <span className="settings-toggle-title">{perm.title}</span>
                            <span className="settings-toggle-desc">{perm.description}</span>
                          </div>
                          <span className="voxel-switch">
                            <input
                              id={switchId}
                              type="checkbox"
                              role="switch"
                              checked={isChecked}
                              disabled={isUpdatingSharedIdeaVisibility}
                              onChange={() => void handleTogglePermission(perm.key, perm.title)}
                            />
                            <span className="voxel-switch-track" aria-hidden="true">
                              <span className="voxel-switch-thumb" />
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {onSetContentDeletionMode && (
                <div className="admin-permissions-panel" aria-label="User Content Deletion Policy">
                  <div className="settings-section-header">
                    <div className="admin-permissions-heading">
                      <h4 className="admin-permissions-title">Content Deletion Policy</h4>
                      <span className="settings-toggle-desc">
                        Global rule controlling which posted content regular users can delete across
                        Project Ideas, Posts &amp; Updates, and Comments. Admins always retain full
                        moderation access.
                      </span>
                    </div>
                    <span className="settings-mode-tag is-cloud">
                      {isUpdatingContentDeletionMode
                        ? 'Saving...'
                        : CONTENT_DELETION_MODE_LABELS[contentDeletionMode]}
                    </span>
                  </div>

                  {deletionPolicyNotice && (
                    <div
                      className={`settings-backup-notice is-${deletionPolicyNotice.tone}`}
                      role={deletionPolicyNotice.tone === 'error' ? 'alert' : 'status'}
                    >
                      {deletionPolicyNotice.tone === 'error' ? (
                        <PixelAlertIcon width={13} height={13} />
                      ) : (
                        <PixelCheckIcon width={13} height={13} />
                      )}
                      <span>{deletionPolicyNotice.message}</span>
                    </div>
                  )}

                  <div className="admin-deletion-mode-control">
                    <div
                      className="settings-segmented admin-deletion-segmented"
                      role="radiogroup"
                      aria-label="User content deletion permission mode"
                    >
                      {CONTENT_DELETION_MODE_OPTIONS.map((option) => {
                        const isActive = contentDeletionMode === option.value;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={isActive}
                            className={`settings-segmented-btn ${isActive ? 'is-active' : ''}`}
                            disabled={isUpdatingContentDeletionMode}
                            onClick={() => void handleSelectContentDeletionMode(option.value)}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>

                    <p className="settings-toggle-desc admin-deletion-mode-desc">
                      {CONTENT_DELETION_MODE_DESCRIPTIONS[contentDeletionMode]}
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

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

          {/* Section 4: Interactive Tutorial Mode */}
          <section className="settings-section" aria-label="Interactive Tutorial Mode">
            <div className="settings-section-header">
              <h3 className="settings-section-title">Interactive Tutorial</h3>
              <span
                className={`settings-mode-tag ${
                  tutorialStatus === 'completed' ? 'is-cloud' : 'is-local'
                }`}
              >
                {tutorialStatus === 'completed'
                  ? 'Completed'
                  : tutorialStatus === 'dismissed'
                    ? 'Dismissed'
                    : 'Not Completed'}
              </span>
            </div>

            <div className="settings-account-card is-local">
              <div className="settings-account-copy">
                <span className="settings-toggle-title">Guided Feature Walkthrough</span>
                <span className="settings-toggle-desc">
                  Step through the Session Hub, recording attendance, Calendar views, Member
                  Manager sidebar, and Project Ideas board with interactive spotlight tips.
                </span>
              </div>

              <button
                type="button"
                className="btn-secondary settings-tutorial-btn"
                onClick={() => {
                  onClose();
                  onStartTutorial();
                }}
                disabled={isModalBusy}
              >
                <PixelHelpIcon />
                <span>{tutorialStatus === 'unseen' ? 'Start Tutorial' : 'Replay Tutorial'}</span>
              </button>
            </div>
          </section>

          {/* Section 5: Local Data Backups */}
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
                  disabled={isImporting || !canManageClubRecords}
                  title={
                    canManageClubRecords
                      ? 'Merge members and sessions from a JSON backup file'
                      : 'Admin privileges required to import backup snapshots into Cloud Sync'
                  }
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
              disabled={isModalBusy || pendingRoleChange !== null}
            >
              Done
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={pendingRoleChange !== null}
        badgeLabel={pendingRoleChange?.makeAdmin ? 'Promote Admin' : 'Remove Admin'}
        title={
          pendingRoleChange
            ? pendingRoleChange.makeAdmin
              ? `Promote "${pendingRoleChange.profile.email}" to Administrator?`
              : `Remove admin privileges from "${pendingRoleChange.profile.email}"?`
            : 'Update role?'
        }
        message={
          pendingRoleChange
            ? pendingRoleChange.makeAdmin
              ? 'Administrators can manage other admins, moderate the public Project Ideas board, and delete or bulk-update synced club records.'
              : 'This account will become a Standard Member and lose access to Admin Management, Project Ideas moderation, and club-wide delete/bulk controls.'
            : ''
        }
        confirmLabel={pendingRoleChange?.makeAdmin ? 'Promote to Admin' : 'Remove Admin'}
        onConfirm={() => void handleConfirmRoleChange()}
        onCancel={() => {
          if (!busyRoleUserId) {
            setPendingRoleChange(null);
          }
        }}
      />
    </div>
  );
}
