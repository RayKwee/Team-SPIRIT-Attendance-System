import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AdminAccountProvisionError,
  type AdminCreateAccountResult,
  type AdminProvisionErrorCode,
  type AdminRemoveAccountResult,
} from '../lib/adminApi';
import type { ClubMember, UserProfileRecord } from '../types/attendance';
import { formatClubLoginEmail, generateInitialPassword } from '../utils/attendance';
import { formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelCheckIcon,
  PixelCopyIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelKeyIcon,
  PixelLinkIcon,
  PixelLockIcon,
  PixelRefreshIcon,
  PixelStarIcon,
  PixelTrashIcon,
} from './PixelIcons';

interface MemberAccountCardProps {
  member: ClubMember;
  members: ClubMember[];
  currentUserId?: string | null;
  adminProfiles: UserProfileRecord[];
  isProfilesLoading: boolean;
  onEnsureMemberSynced?: () => Promise<boolean>;
  onSyncAdminProfiles?: () => Promise<UserProfileRecord[]>;
  onCreateAndLinkAccount: (params: {
    memberId: string;
    memberName: string;
    email: string;
    password: string;
  }) => Promise<AdminCreateAccountResult>;
  onSyncAndLinkAccount: (params: {
    memberId: string;
    email?: string;
    userId?: string;
  }) => Promise<UserProfileRecord>;
  onLinkUserToMember: (
    targetUserId: string,
    targetMemberId: string | null,
  ) => Promise<UserProfileRecord>;
  onResetMemberPassword?: (targetUserId: string, newPassword: string) => Promise<void>;
  onRemoveAccount?: (targetUserId: string) => Promise<AdminRemoveAccountResult>;
  onSyncMemberEmailToRoster: (member: ClubMember, email: string) => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

type AccountPanelMode = 'collapsed' | 'create' | 'link';
type ConfirmActionType = 'unlink' | 'delete' | null;

interface AccountFeedbackState {
  tone: 'success' | 'warning' | 'error';
  message: string;
  code?: AdminProvisionErrorCode;
}

interface CreatedCredentialsNotice {
  email: string;
  password: string;
}

const EMAIL_BASIC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-only Club Login Account panel rendered directly on a member's profile
 * inside the right-hand MemberManagerSidebar. Supports auto-verified account creation,
 * linking existing accounts, unlinking, and safe account deletion.
 */
export function MemberAccountCard({
  member,
  members,
  currentUserId = null,
  adminProfiles,
  isProfilesLoading,
  onEnsureMemberSynced,
  onSyncAdminProfiles,
  onCreateAndLinkAccount,
  onSyncAndLinkAccount,
  onLinkUserToMember,
  onResetMemberPassword,
  onRemoveAccount,
  onSyncMemberEmailToRoster,
  onNotify,
}: MemberAccountCardProps) {
  const createEmailInputId = useId();
  const createPasswordInputId = useId();
  const linkEmailInputId = useId();
  const linkSelectInputId = useId();
  const saveEmailCreateId = useId();
  const saveEmailLinkId = useId();

  const defaultLoginEmail = useMemo(
    () => member.email?.trim().toLowerCase() || formatClubLoginEmail(member.name),
    [member.email, member.name],
  );

  const linkedProfile = useMemo(
    () => adminProfiles.find((profile) => profile.linkedMemberId === member.id) ?? null,
    [adminProfiles, member.id],
  );

  const activeAdminCount = useMemo(
    () => adminProfiles.filter((profile) => !profile.isDisabled && profile.role === 'admin').length,
    [adminProfiles],
  );

  const isLinkedSelf = Boolean(
    linkedProfile && currentUserId && linkedProfile.userId === currentUserId,
  );
  const isLinkedLastAdmin = Boolean(
    linkedProfile &&
      !linkedProfile.isDisabled &&
      linkedProfile.role === 'admin' &&
      activeAdminCount <= 1,
  );

  const memberById = useMemo(
    () => new Map(members.map((item) => [item.id, item])),
    [members],
  );

  const matchingExistingProfile = useMemo(() => {
    if (linkedProfile) return null;
    const candidates = [
      defaultLoginEmail,
      formatClubLoginEmail(member.name),
      member.email?.trim().toLowerCase() ?? '',
    ].filter((value) => value.length > 0);
    if (candidates.length === 0) return null;
    return (
      adminProfiles.find((profile) =>
        candidates.includes(profile.email.trim().toLowerCase()),
      ) ?? null
    );
  }, [adminProfiles, defaultLoginEmail, linkedProfile, member.email, member.name]);

  const matchingProfileOwner = useMemo(() => {
    if (!matchingExistingProfile?.linkedMemberId) return null;
    return memberById.get(matchingExistingProfile.linkedMemberId) ?? null;
  }, [matchingExistingProfile, memberById]);

  const sortedProfilesForPicker = useMemo(() => {
    return [...adminProfiles].sort((a, b) => {
      const aMatch =
        defaultLoginEmail.length > 0 && a.email.trim().toLowerCase() === defaultLoginEmail ? 0 : 1;
      const bMatch =
        defaultLoginEmail.length > 0 && b.email.trim().toLowerCase() === defaultLoginEmail ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;

      const aUnlinked = a.linkedMemberId ? 1 : 0;
      const bUnlinked = b.linkedMemberId ? 1 : 0;
      if (aUnlinked !== bUnlinked) return aUnlinked - bUnlinked;

      return a.email.localeCompare(b.email);
    });
  }, [adminProfiles, defaultLoginEmail]);

  const [panelMode, setPanelMode] = useState<AccountPanelMode>('collapsed');
  const [accountEmail, setAccountEmail] = useState<string>(defaultLoginEmail);
  const [hasEditedEmail, setHasEditedEmail] = useState(false);
  const [initialPassword, setInitialPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveEmailToRoster, setSaveEmailToRoster] = useState<boolean>(() => !member.email?.trim());
  const [selectedExistingUserId, setSelectedExistingUserId] = useState('');
  const [isBusy, setIsBusy] = useState(false);
  const [isSyncingList, setIsSyncingList] = useState(false);
  const [feedback, setFeedback] = useState<AccountFeedbackState | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentialsNotice | null>(
    null,
  );
  const [copiedLabel, setCopiedLabel] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<ConfirmActionType>(null);
  const [isResetFormOpen, setIsResetFormOpen] = useState(false);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);

  // Reset form state whenever the admin switches to a different member profile.
  useEffect(() => {
    setPanelMode('collapsed');
    setAccountEmail(member.email?.trim().toLowerCase() || formatClubLoginEmail(member.name));
    setHasEditedEmail(false);
    setInitialPassword('');
    setShowPassword(false);
    setSaveEmailToRoster(!member.email?.trim());
    setSelectedExistingUserId('');
    setFeedback(null);
    setCreatedCredentials(null);
    setCopiedLabel(null);
    setConfirmAction(null);
    setIsResetFormOpen(false);
    setResetPasswordValue('');
    setShowResetPassword(false);
  }, [member.id]);

  // Keep the suggested email updated if the member's name or email changes before manual edit.
  useEffect(() => {
    if (!hasEditedEmail) {
      setAccountEmail(defaultLoginEmail);
    }
  }, [defaultLoginEmail, hasEditedEmail]);

  async function copyToClipboard(text: string, label: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        setCopiedLabel(label);
        window.setTimeout(() => {
          setCopiedLabel((current) => (current === label ? null : current));
        }, 2000);
        onNotify?.({
          tone: 'info',
          tag: 'Copied',
          message: `${label} copied to clipboard.`,
        });
      }
    } catch {
      onNotify?.({
        tone: 'warning',
        tag: 'Copy Failed',
        message: 'Clipboard access was blocked by the browser.',
      });
    }
  }

  async function ensureMemberExistsInCloud(): Promise<boolean> {
    if (!onEnsureMemberSynced) return true;
    try {
      return await onEnsureMemberSynced();
    } catch {
      return false;
    }
  }

  function handleOpenMode(nextMode: 'create' | 'link') {
    setFeedback(null);
    if (panelMode === nextMode) {
      setPanelMode('collapsed');
      return;
    }
    if (!hasEditedEmail) {
      setAccountEmail(defaultLoginEmail);
    }
    setPanelMode(nextMode);
  }

  function handleGeneratePassword() {
    const generated = generateInitialPassword(10);
    setInitialPassword(generated);
    setShowPassword(true);
    if (feedback?.code === 'weak_password') {
      setFeedback(null);
    }
  }

  async function handleRefreshAccountsList() {
    if (!onSyncAdminProfiles || isSyncingList || isBusy) return;
    setIsSyncingList(true);
    setFeedback(null);
    try {
      const list = await onSyncAdminProfiles();
      onNotify?.({
        tone: 'info',
        tag: 'Accounts Synced',
        message: `Loaded ${list.length} registered ${list.length === 1 ? 'account' : 'accounts'}.`,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message:
          err instanceof Error ? err.message : 'Unable to sync accounts from Supabase right now.',
      });
    } finally {
      setIsSyncingList(false);
    }
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy) return;

    const normalizedEmail = accountEmail.trim().toLowerCase();
    if (!normalizedEmail || !EMAIL_BASIC_RE.test(normalizedEmail)) {
      setFeedback({
        tone: 'error',
        code: 'invalid_email',
        message: 'Enter a valid login email address (for example: jun.yuen@teamspirit.club).',
      });
      return;
    }

    if (initialPassword.length < 6) {
      setFeedback({
        tone: 'error',
        code: 'weak_password',
        message: 'Password must be at least 6 characters long.',
      });
      return;
    }

    // Pre-flight duplicate check against known accounts before issuing auth signUp.
    const duplicateProfile = adminProfiles.find(
      (profile) => profile.email.trim().toLowerCase() === normalizedEmail,
    );
    if (duplicateProfile) {
      setFeedback({
        tone: 'error',
        code: 'already_exists',
        message: `An account for "${normalizedEmail}" already exists. Switch to "Link Account" to connect it to ${member.name}.`,
      });
      return;
    }

    setIsBusy(true);
    setFeedback(null);

    try {
      const synced = await ensureMemberExistsInCloud();
      if (!synced) {
        setFeedback({
          tone: 'error',
          code: 'member_not_synced',
          message:
            'Could not sync this member record to Supabase Cloud first. Check your connection and retry.',
        });
        return;
      }

      const result = await onCreateAndLinkAccount({
        memberId: member.id,
        memberName: member.name,
        email: normalizedEmail,
        password: initialPassword,
      });

      if (saveEmailToRoster && member.email?.trim().toLowerCase() !== result.email.toLowerCase()) {
        onSyncMemberEmailToRoster(member, result.email);
      }

      setCreatedCredentials({
        email: result.email,
        password: initialPassword,
      });
      setInitialPassword('');
      setShowPassword(false);
      setPanelMode('collapsed');

      setFeedback({
        tone: 'success',
        message: `Created, verified, and linked "${result.email}" to ${member.name}. Ready for immediate sign-in.`,
      });
      onNotify?.({
        tone: 'success',
        tag: 'Account Created',
        message: `Created & linked ${result.email} for ${member.name}.`,
      });
    } catch (err) {
      if (err instanceof AdminAccountProvisionError) {
        setFeedback({
          tone: 'error',
          code: err.code,
          message: err.message,
        });
        if (err.code === 'already_exists' && onSyncAdminProfiles) {
          void onSyncAdminProfiles().catch(() => {});
        }
      } else {
        setFeedback({
          tone: 'error',
          message: err instanceof Error ? err.message : 'Unable to create member login account.',
        });
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function executeSyncAndLink(params: { email?: string; userId?: string }) {
    if (isBusy) return;
    setIsBusy(true);
    setFeedback(null);

    try {
      const synced = await ensureMemberExistsInCloud();
      if (!synced) {
        setFeedback({
          tone: 'error',
          code: 'member_not_synced',
          message:
            'Could not sync this member record to Supabase Cloud first. Check your connection and retry.',
        });
        return;
      }

      const linked = await onSyncAndLinkAccount({
        memberId: member.id,
        email: params.email,
        userId: params.userId,
      });

      if (
        saveEmailToRoster &&
        linked.email &&
        member.email?.trim().toLowerCase() !== linked.email.trim().toLowerCase()
      ) {
        onSyncMemberEmailToRoster(member, linked.email);
      }

      setCreatedCredentials(null);
      setSelectedExistingUserId('');
      setPanelMode('collapsed');
      setFeedback({
        tone: 'success',
        message: `Linked "${linked.email}" to ${member.name}. Personal attendance and project ideas are now connected.`,
      });
      onNotify?.({
        tone: 'success',
        tag: 'Account Linked',
        message: `Linked ${linked.email} to ${member.name}.`,
      });
    } catch (err) {
      if (err instanceof AdminAccountProvisionError) {
        setFeedback({
          tone: 'error',
          code: err.code,
          message: err.message,
        });
      } else {
        setFeedback({
          tone: 'error',
          message:
            err instanceof Error ? err.message : 'Unable to sync and link the selected account.',
        });
      }
    } finally {
      setIsBusy(false);
    }
  }

  async function handleLinkByEmailSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = accountEmail.trim().toLowerCase();
    if (!normalizedEmail) {
      setFeedback({
        tone: 'error',
        code: 'invalid_email',
        message: 'Enter the account email address to sync and link.',
      });
      return;
    }
    await executeSyncAndLink({ email: normalizedEmail });
  }

  async function handleLinkSelectedAccount() {
    if (!selectedExistingUserId) {
      setFeedback({
        tone: 'error',
        message: 'Select a registered account from the list first.',
      });
      return;
    }
    await executeSyncAndLink({ userId: selectedExistingUserId });
  }

  async function handleResetPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !linkedProfile ||
      !onResetMemberPassword ||
      isBusy ||
      linkedProfile.role !== 'member' ||
      linkedProfile.isDisabled
    ) {
      return;
    }

    if (resetPasswordValue.length < 6) {
      setFeedback({
        tone: 'error',
        code: 'weak_password',
        message: 'New password must be at least 6 characters long.',
      });
      return;
    }

    setIsBusy(true);
    setFeedback(null);
    try {
      await onResetMemberPassword(linkedProfile.userId, resetPasswordValue);
      setCreatedCredentials({
        email: linkedProfile.email,
        password: resetPasswordValue,
      });
      setResetPasswordValue('');
      setShowResetPassword(false);
      setIsResetFormOpen(false);
      setFeedback({
        tone: 'success',
        message: `Updated password for "${linkedProfile.email}". ${member.name} can sign in with the new password immediately.`,
      });
      onNotify?.({
        tone: 'success',
        tag: 'Password Reset',
        message: `Updated login password for ${member.name}.`,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Unable to update member password.',
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmModalAction() {
    if (!linkedProfile || !confirmAction || isBusy) return;
    const action = confirmAction;
    setIsBusy(true);
    setFeedback(null);
    setConfirmAction(null);

    try {
      if (action === 'unlink') {
        await onLinkUserToMember(linkedProfile.userId, null);
        setCreatedCredentials(null);
        setFeedback({
          tone: 'success',
          message: `Unlinked "${linkedProfile.email}" from ${member.name}.`,
        });
        onNotify?.({
          tone: 'info',
          tag: 'Account Unlinked',
          message: `Unlinked ${linkedProfile.email} from ${member.name}.`,
        });
      } else if (action === 'delete' && onRemoveAccount) {
        const result = await onRemoveAccount(linkedProfile.userId);
        setCreatedCredentials(null);
        if (result.mode === 'deleted') {
          const msg = `Deleted user account "${linkedProfile.email}". ${member.name}'s roster profile and attendance history remain preserved.`;
          setFeedback({ tone: 'warning', message: msg });
          onNotify?.({ tone: 'warning', tag: 'Account Deleted', message: msg });
        } else {
          const msg = `Revoked and disabled access for "${linkedProfile.email}" and unlinked it from ${member.name}.`;
          setFeedback({ tone: 'warning', message: msg });
          onNotify?.({ tone: 'warning', tag: 'Access Revoked', message: msg });
        }
      }
    } catch (err) {
      setFeedback({
        tone: 'error',
        message:
          err instanceof Error
            ? err.message
            : action === 'delete'
              ? 'Unable to delete user account.'
              : 'Unable to unlink account.',
      });
    } finally {
      setIsBusy(false);
    }
  }

  const isEmailCustomized =
    defaultLoginEmail.length > 0 && accountEmail.trim().toLowerCase() !== defaultLoginEmail;

  return (
    <>
      <section
        className="member-account-panel"
        aria-label="Admin Club Login Account Management"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && confirmAction) {
            event.stopPropagation();
            setConfirmAction(null);
          } else if (event.key === 'Escape' && panelMode !== 'collapsed' && !isBusy) {
            event.stopPropagation();
            setPanelMode('collapsed');
            setFeedback(null);
          }
        }}
      >
        <div className="member-account-header">
          <div className="member-account-title-wrap">
            <span className="member-section-label member-account-heading">
              <PixelKeyIcon width={12} height={12} />
              <span>Club Login Account</span>
            </span>
            <span className={`member-account-status-pill ${linkedProfile ? 'is-linked' : 'is-unlinked'}`}>
              {linkedProfile ? 'Linked' : 'Not Linked'}
            </span>
          </div>

          {!linkedProfile ? (
            <div className="member-account-header-actions">
              <button
                type="button"
                className={`btn-primary btn-compact-primary member-account-action-btn ${
                  panelMode === 'create' ? 'is-active' : ''
                }`}
                onClick={() => handleOpenMode('create')}
                disabled={isBusy}
              >
                <PixelKeyIcon width={12} height={12} />
                <span>Create Account</span>
              </button>
              <button
                type="button"
                className={`btn-secondary btn-compact member-account-action-btn ${
                  panelMode === 'link' ? 'is-active' : ''
                }`}
                onClick={() => handleOpenMode('link')}
                disabled={isBusy}
              >
                <PixelLinkIcon width={12} height={12} />
                <span>Link Account</span>
              </button>
            </div>
          ) : (
            <div className="member-account-header-actions">
              <button
                type="button"
                className="btn-secondary btn-compact member-account-action-btn"
                onClick={() => void copyToClipboard(linkedProfile.email, 'Login email')}
                disabled={isBusy}
                title={`Copy ${linkedProfile.email}`}
              >
                {copiedLabel === 'Login email' ? (
                  <PixelCheckIcon width={12} height={12} />
                ) : (
                  <PixelCopyIcon width={12} height={12} />
                )}
                <span>{copiedLabel === 'Login email' ? 'Copied' : 'Copy'}</span>
              </button>
              <button
                type="button"
                className="btn-secondary btn-compact member-account-action-btn"
                onClick={() => setConfirmAction('unlink')}
                disabled={isBusy}
                title={`Unlink ${linkedProfile.email} from ${member.name}`}
              >
                <span>Unlink</span>
              </button>
              {onRemoveAccount && (
                <button
                  type="button"
                  className="icon-btn icon-btn-danger member-account-delete-btn"
                  onClick={() => setConfirmAction('delete')}
                  disabled={isBusy || isLinkedSelf || isLinkedLastAdmin}
                  aria-label={`Delete user account ${linkedProfile.email}`}
                  title={
                    isLinkedSelf
                      ? 'You cannot delete your own signed-in account'
                      : isLinkedLastAdmin
                        ? 'Cannot delete the last remaining Admin account'
                        : `Delete account ${linkedProfile.email}`
                  }
                >
                  <PixelTrashIcon width={12} height={12} />
                  <span>Delete</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Linked Account Summary */}
        {linkedProfile && (
          <div className="member-account-linked-box">
            <div className="member-account-linked-row">
              <strong className="member-account-linked-email" title={linkedProfile.email}>
                {linkedProfile.email}
              </strong>
              <span
                className={`admin-role-pill ${
                  linkedProfile.role === 'admin'
                    ? 'is-admin'
                    : linkedProfile.canViewAllAttendance
                      ? 'is-viewer'
                      : 'is-member'
                }`}
              >
                {linkedProfile.role === 'admin' && <PixelStarIcon width={10} height={10} />}
                <span>
                  {linkedProfile.role === 'admin'
                    ? 'Admin'
                    : linkedProfile.canViewAllAttendance
                      ? 'Broad Viewer'
                      : 'Member'}
                </span>
              </span>
            </div>
            <p className="member-account-linked-meta">
              Auto-verified &amp; synced to this profile • Registered{' '}
              {formatTimestamp(linkedProfile.createdAt)}
            </p>

            {/* Admin Reset Password for Linked Normal Members ONLY (strictly hidden for Admin accounts) */}
            {linkedProfile.role === 'member' && !linkedProfile.isDisabled && onResetMemberPassword && (
              <div className="member-account-reset-wrap">
                {!isResetFormOpen ? (
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    disabled={isBusy}
                    onClick={() => {
                      setIsResetFormOpen(true);
                      setResetPasswordValue('');
                      setShowResetPassword(true);
                      setFeedback(null);
                    }}
                  >
                    <PixelKeyIcon width={12} height={12} />
                    <span>Reset Member Password</span>
                  </button>
                ) : (
                  <form
                    className="accounts-reset-form"
                    onSubmit={(event) => void handleResetPasswordSubmit(event)}
                    noValidate
                  >
                    <div className="accounts-reset-top">
                      <span className="accounts-reset-label">Set New Password for {member.name}</span>
                      <button
                        type="button"
                        className="ring-reset-btn"
                        disabled={isBusy}
                        onClick={() => {
                          setResetPasswordValue(generateInitialPassword(10));
                          setShowResetPassword(true);
                        }}
                      >
                        Generate
                      </button>
                    </div>
                    <div className="member-account-password-wrap">
                      <input
                        type={showResetPassword ? 'text' : 'password'}
                        className="form-control member-account-input"
                        placeholder="New password (min. 6 chars)"
                        value={resetPasswordValue}
                        disabled={isBusy}
                        autoComplete="new-password"
                        onChange={(event) => setResetPasswordValue(event.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="icon-btn member-account-eye-btn"
                        onClick={() => setShowResetPassword((prev) => !prev)}
                        aria-label={showResetPassword ? 'Hide password' : 'Show password'}
                        title={showResetPassword ? 'Hide password' : 'Show password'}
                      >
                        {showResetPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                      </button>
                    </div>
                    <div className="accounts-reset-actions">
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        disabled={isBusy}
                        onClick={() => {
                          setIsResetFormOpen(false);
                          setResetPasswordValue('');
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="btn-primary btn-compact-primary"
                        disabled={isBusy || resetPasswordValue.length < 6}
                      >
                        <span>{isBusy ? 'Saving...' : 'Save Password'}</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {createdCredentials && createdCredentials.email === linkedProfile.email && (
              <div className="member-account-creds-box" role="status">
                <div className="member-account-creds-header">
                  <strong>New Login Ready (Auto-Verified)</strong>
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() =>
                      void copyToClipboard(
                        `Team SPIRIT Login\nEmail: ${createdCredentials.email}\nPassword: ${createdCredentials.password}`,
                        'Login credentials',
                      )
                    }
                  >
                    {copiedLabel === 'Login credentials' ? (
                      <PixelCheckIcon width={11} height={11} />
                    ) : (
                      <PixelCopyIcon width={11} height={11} />
                    )}
                    <span>{copiedLabel === 'Login credentials' ? 'Copied!' : 'Copy Login'}</span>
                  </button>
                </div>
                <div className="member-account-creds-grid">
                  <span>
                    Email: <code>{createdCredentials.email}</code>
                  </span>
                  <span>
                    Password: <code>{createdCredentials.password}</code>
                  </span>
                </div>
                <p className="member-account-creds-note">
                  {member.name} can log in immediately without email confirmation. Copy these
                  credentials now — the password is not stored locally after closing.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Unlinked Preview & Smart Existing-Account Match */}
        {!linkedProfile && panelMode === 'collapsed' && (
          <div className="member-account-preview-wrap">
            <div className="member-account-email-preview">
              <span className="member-account-preview-label">Suggested Login Email</span>
              <code className="member-account-preview-code">
                {defaultLoginEmail || 'Enter email in Create / Link'}
              </code>
            </div>

            {matchingExistingProfile && !matchingExistingProfile.linkedMemberId && (
              <div className="member-account-match-banner" role="status">
                <div className="member-account-match-copy">
                  <strong>Existing Unlinked Account Found</strong>
                  <span>
                    <code>{matchingExistingProfile.email}</code> is already registered and unlinked.
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-primary btn-compact-primary"
                  disabled={isBusy}
                  onClick={() =>
                    void executeSyncAndLink({
                      userId: matchingExistingProfile.userId,
                      email: matchingExistingProfile.email,
                    })
                  }
                >
                  <PixelLinkIcon width={12} height={12} />
                  <span>{isBusy ? 'Linking...' : 'Link Now'}</span>
                </button>
              </div>
            )}

            {matchingExistingProfile && matchingExistingProfile.linkedMemberId && (
              <div className="member-account-match-banner is-warning" role="status">
                <div className="member-account-match-copy">
                  <strong>Email Already Linked Elsewhere</strong>
                  <span>
                    <code>{matchingExistingProfile.email}</code> is linked to{' '}
                    <strong>{matchingProfileOwner?.name ?? 'another roster profile'}</strong>. Use a
                    unique email or unlink it there first.
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status / Error Feedback */}
        {feedback && (
          <div
            className={`member-account-feedback is-${feedback.tone}`}
            role={feedback.tone === 'error' ? 'alert' : 'status'}
          >
            <div className="member-account-feedback-row">
              {feedback.tone === 'success' ? (
                <PixelCheckIcon width={13} height={13} />
              ) : (
                <PixelAlertIcon width={13} height={13} />
              )}
              <span>{feedback.message}</span>
            </div>
            {feedback.code === 'already_exists' && !linkedProfile && (
              <button
                type="button"
                className="btn-secondary btn-compact member-account-switch-btn"
                onClick={() => {
                  setPanelMode('link');
                  setFeedback(null);
                }}
              >
                <PixelLinkIcon width={12} height={12} />
                <span>Switch to Link Account</span>
              </button>
            )}
          </div>
        )}

        {/* Expanded Mode: Create New Auto-Verified Member Account */}
        {!linkedProfile && panelMode === 'create' && (
          <form className="member-account-form" onSubmit={(e) => void handleCreateSubmit(e)} noValidate>
            <div className="member-account-field">
              <div className="member-account-label-row">
                <label htmlFor={createEmailInputId}>Member Login Email</label>
                {isEmailCustomized && (
                  <button
                    type="button"
                    className="ring-reset-btn"
                    onClick={() => {
                      setAccountEmail(defaultLoginEmail);
                      setHasEditedEmail(false);
                    }}
                  >
                    Reset
                  </button>
                )}
              </div>
              <input
                id={createEmailInputId}
                type="email"
                className="form-control member-account-input"
                placeholder="name@teamspirit.club"
                value={accountEmail}
                disabled={isBusy}
                onChange={(event) => {
                  setAccountEmail(event.target.value);
                  setHasEditedEmail(true);
                  if (feedback?.code === 'invalid_email' || feedback?.code === 'already_exists') {
                    setFeedback(null);
                  }
                }}
                required
              />
              <span className="member-account-helper">
                Auto-verified immediately &amp; linked as a <strong>Member</strong> account for{' '}
                <strong>{member.name}</strong>.
              </span>
            </div>

            <div className="member-account-field">
              <div className="member-account-label-row">
                <label htmlFor={createPasswordInputId}>Password</label>
                <button
                  type="button"
                  className="ring-reset-btn"
                  disabled={isBusy}
                  onClick={handleGeneratePassword}
                >
                  Generate
                </button>
              </div>
              <div className="member-account-password-wrap">
                <input
                  id={createPasswordInputId}
                  type={showPassword ? 'text' : 'password'}
                  className="form-control member-account-input"
                  placeholder="Min. 6 characters"
                  value={initialPassword}
                  disabled={isBusy}
                  autoComplete="new-password"
                  onChange={(event) => {
                    setInitialPassword(event.target.value);
                    if (feedback?.code === 'weak_password') {
                      setFeedback(null);
                    }
                  }}
                  required
                />
                <button
                  type="button"
                  className="icon-btn member-account-eye-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                </button>
              </div>
            </div>

            <label className="member-account-checkbox-row" htmlFor={saveEmailCreateId}>
              <input
                id={saveEmailCreateId}
                type="checkbox"
                className="selection-checkbox"
                checked={saveEmailToRoster}
                disabled={isBusy}
                onChange={(event) => setSaveEmailToRoster(event.target.checked)}
              />
              <span>Save login email to this member&apos;s roster profile</span>
            </label>

            <div className="member-account-form-footer">
              <button
                type="button"
                className="btn-secondary btn-compact"
                disabled={isBusy}
                onClick={() => {
                  setPanelMode('collapsed');
                  setFeedback(null);
                }}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary btn-compact-primary" disabled={isBusy}>
                <PixelLockIcon width={12} height={12} />
                <span>{isBusy ? 'Creating & Linking...' : 'Create & Link Account'}</span>
              </button>
            </div>
          </form>
        )}

        {/* Expanded Mode: Link Existing Account */}
        {!linkedProfile && panelMode === 'link' && (
          <div className="member-account-form">
            <form
              className="member-account-subform"
              onSubmit={(e) => void handleLinkByEmailSubmit(e)}
              noValidate
            >
              <div className="member-account-field">
                <div className="member-account-label-row">
                  <label htmlFor={linkEmailInputId}>Link Existing Account by Email</label>
                  {isEmailCustomized && (
                    <button
                      type="button"
                      className="ring-reset-btn"
                      onClick={() => {
                        setAccountEmail(defaultLoginEmail);
                        setHasEditedEmail(false);
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <div className="member-account-inline-row">
                  <input
                    id={linkEmailInputId}
                    type="email"
                    className="form-control member-account-input"
                    placeholder="name@teamspirit.club"
                    value={accountEmail}
                    disabled={isBusy}
                    onChange={(event) => {
                      setAccountEmail(event.target.value);
                      setHasEditedEmail(true);
                    }}
                  />
                  <button
                    type="submit"
                    className="btn-primary btn-compact-primary"
                    disabled={isBusy || !accountEmail.trim()}
                  >
                    <PixelLinkIcon width={12} height={12} />
                    <span>{isBusy ? 'Linking...' : 'Link'}</span>
                  </button>
                </div>
              </div>
            </form>

            <div className="member-account-divider" aria-hidden="true">
              <span>OR PICK A REGISTERED ACCOUNT</span>
            </div>

            <div className="member-account-field">
              <div className="member-account-label-row">
                <label htmlFor={linkSelectInputId}>
                  Registered Accounts ({adminProfiles.length})
                </label>
                {onSyncAdminProfiles && (
                  <button
                    type="button"
                    className="ring-reset-btn member-account-refresh-btn"
                    disabled={isSyncingList || isProfilesLoading || isBusy}
                    onClick={() => void handleRefreshAccountsList()}
                  >
                    <PixelRefreshIcon width={11} height={11} />
                    <span>{isSyncingList || isProfilesLoading ? 'Syncing...' : 'Sync List'}</span>
                  </button>
                )}
              </div>

              <div className="member-account-inline-row">
                <select
                  id={linkSelectInputId}
                  className="form-control member-account-select"
                  value={selectedExistingUserId}
                  disabled={isBusy || sortedProfilesForPicker.length === 0}
                  onChange={(event) => setSelectedExistingUserId(event.target.value)}
                >
                  <option value="">
                    {sortedProfilesForPicker.length === 0
                      ? 'No accounts synced yet...'
                      : 'Choose an account...'}
                  </option>
                  {sortedProfilesForPicker.map((profile) => {
                    const otherOwner = profile.linkedMemberId
                      ? memberById.get(profile.linkedMemberId)
                      : null;
                    const isTaken = Boolean(profile.linkedMemberId && profile.linkedMemberId !== member.id);
                    const suffix = isTaken
                      ? ` — Linked to ${otherOwner?.name ?? 'another member'}`
                      : profile.role === 'admin'
                        ? ' (Admin • Unlinked)'
                        : ' (Unlinked)';
                    return (
                      <option key={profile.userId} value={profile.userId} disabled={isTaken}>
                        {profile.email || profile.userId}
                        {suffix}
                      </option>
                    );
                  })}
                </select>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  disabled={isBusy || !selectedExistingUserId}
                  onClick={() => void handleLinkSelectedAccount()}
                >
                  Link
                </button>
              </div>
            </div>

            <label className="member-account-checkbox-row" htmlFor={saveEmailLinkId}>
              <input
                id={saveEmailLinkId}
                type="checkbox"
                className="selection-checkbox"
                checked={saveEmailToRoster}
                disabled={isBusy}
                onChange={(event) => setSaveEmailToRoster(event.target.checked)}
              />
              <span>Save linked email to this member&apos;s roster profile</span>
            </label>

            <div className="member-account-form-footer">
              <button
                type="button"
                className="btn-secondary btn-compact"
                disabled={isBusy}
                onClick={() => {
                  setPanelMode('collapsed');
                  setFeedback(null);
                }}
              >
                Close
              </button>
            </div>
          </div>
        )}
      </section>

      {typeof document !== 'undefined' &&
        createPortal(
          <div
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
              }
            }}
          >
            <ConfirmDialog
              isOpen={confirmAction !== null && linkedProfile !== null}
              badgeLabel={confirmAction === 'delete' ? 'Delete Account' : 'Unlink Login'}
              title={
                linkedProfile
                  ? confirmAction === 'delete'
                    ? `Delete account "${linkedProfile.email}"?`
                    : `Unlink "${linkedProfile.email}"?`
                  : ''
              }
              message={
                linkedProfile
                  ? confirmAction === 'delete'
                    ? `Permanently delete user account "${linkedProfile.email}" from Team SPIRIT? Any active sessions will be revoked immediately. "${member.name}"'s roster profile, attendance history, and submitted project ideas will remain safely preserved.`
                    : `Unlinking "${linkedProfile.email}" from "${member.name}" will remove their access to this personal roster profile until linked again. Attendance history and submitted project ideas will NOT be deleted.`
                  : ''
              }
              confirmLabel={confirmAction === 'delete' ? 'Delete Account' : 'Unlink Account'}
              onConfirm={() => void handleConfirmModalAction()}
              onCancel={() => setConfirmAction(null)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
