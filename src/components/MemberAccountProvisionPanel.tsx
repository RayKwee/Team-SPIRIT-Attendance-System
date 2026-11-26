import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import {
  AdminAccountProvisionError,
  type AdminCreateAccountResult,
  type AdminRemoveAccountResult,
} from '../lib/adminApi';
import type { ClubMember, UserProfileRecord } from '../types/attendance';
import {
  formatClubLoginEmail,
  generateInitialPassword,
  isLegacyMember,
} from '../utils/attendance';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelArrowLeftIcon,
  PixelCheckIcon,
  PixelCopyIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelKeyIcon,
  PixelLockIcon,
  PixelStarIcon,
  PixelTrashIcon,
  PixelUserIcon,
} from './PixelIcons';

interface MemberAccountProvisionPanelProps {
  members: ClubMember[];
  currentUserId?: string | null;
  adminProfiles: UserProfileRecord[];
  onEnsureMemberSynced?: () => Promise<boolean>;
  onCreateAndLinkAccount: (params: {
    memberId: string;
    memberName: string;
    email: string;
    password: string;
  }) => Promise<AdminCreateAccountResult>;
  onRemoveAccount?: (targetUserId: string) => Promise<AdminRemoveAccountResult>;
  onSyncMemberEmailToRoster: (member: ClubMember, email: string) => void;
  onOpenMemberProfile: (memberId: string) => void;
  onBackToRoster: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

const EMAIL_BASIC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Right-sidebar admin workspace for creating auto-verified login accounts for existing
 * club members (linked automatically to their roster profile) and safely deleting user accounts.
 */
export function MemberAccountProvisionPanel({
  members,
  currentUserId = null,
  adminProfiles,
  onEnsureMemberSynced,
  onCreateAndLinkAccount,
  onRemoveAccount,
  onSyncMemberEmailToRoster,
  onOpenMemberProfile,
  onBackToRoster,
  onNotify,
}: MemberAccountProvisionPanelProps) {
  const memberSelectId = useId();
  const emailInputId = useId();
  const passwordInputId = useId();
  const saveEmailId = useId();

  const linkedProfileByMemberId = useMemo(() => {
    const map = new Map<string, UserProfileRecord>();
    for (const profile of adminProfiles) {
      if (profile.linkedMemberId) {
        map.set(profile.linkedMemberId, profile);
      }
    }
    return map;
  }, [adminProfiles]);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const aLinked = linkedProfileByMemberId.has(a.id) ? 1 : 0;
      const bLinked = linkedProfileByMemberId.has(b.id) ? 1 : 0;
      if (aLinked !== bLinked) return aLinked - bLinked;

      const aLegacy = isLegacyMember(a) ? 1 : 0;
      const bLegacy = isLegacyMember(b) ? 1 : 0;
      if (aLegacy !== bLegacy) return aLegacy - bLegacy;

      return a.name.localeCompare(b.name);
    });
  }, [linkedProfileByMemberId, members]);

  const unlinkedMembers = useMemo(
    () => sortedMembers.filter((member) => !linkedProfileByMemberId.has(member.id)),
    [linkedProfileByMemberId, sortedMembers],
  );

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const activeAdminCount = useMemo(
    () => adminProfiles.filter((profile) => !profile.isDisabled && profile.role === 'admin').length,
    [adminProfiles],
  );

  const [selectedMemberId, setSelectedMemberId] = useState<string>(
    () => unlinkedMembers[0]?.id ?? '',
  );
  const [email, setEmail] = useState('');
  const [hasEditedEmail, setHasEditedEmail] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saveEmailToRoster, setSaveEmailToRoster] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [deletingUserId, setDeletingUserId] = useState<string | null>(null);
  const [pendingDeleteProfile, setPendingDeleteProfile] = useState<UserProfileRecord | null>(null);
  const [feedback, setFeedback] = useState<{
    tone: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);
  const [createdNotice, setCreatedNotice] = useState<{
    memberId: string;
    memberName: string;
    email: string;
    password: string;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  const selectedMember = useMemo(
    () => (selectedMemberId ? memberById.get(selectedMemberId) ?? null : null),
    [memberById, selectedMemberId],
  );

  const suggestedEmail = useMemo(() => {
    if (!selectedMember) return '';
    return selectedMember.email?.trim().toLowerCase() || formatClubLoginEmail(selectedMember.name);
  }, [selectedMember]);

  // Keep selectedMemberId valid if the selected member becomes linked or removed.
  useEffect(() => {
    if (selectedMemberId && !linkedProfileByMemberId.has(selectedMemberId) && memberById.has(selectedMemberId)) {
      return;
    }
    const nextId = unlinkedMembers[0]?.id ?? '';
    setSelectedMemberId(nextId);
    setHasEditedEmail(false);
  }, [linkedProfileByMemberId, memberById, selectedMemberId, unlinkedMembers]);

  // Auto-populate suggested email when member selection changes.
  useEffect(() => {
    if (!hasEditedEmail) {
      setEmail(suggestedEmail);
    }
  }, [hasEditedEmail, suggestedEmail]);

  useEffect(() => {
    if (selectedMember) {
      setSaveEmailToRoster(!selectedMember.email?.trim());
    }
  }, [selectedMember?.id]);

  async function handleCopyCredentials(targetEmail: string, targetPassword: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(
          `Team SPIRIT Login\nEmail: ${targetEmail}\nPassword: ${targetPassword}`,
        );
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
        onNotify?.({
          tone: 'info',
          tag: 'Copied',
          message: 'Login credentials copied to clipboard.',
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

  function handleGeneratePassword() {
    setPassword(generateInitialPassword(10));
    setShowPassword(true);
    setFeedback(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy || !selectedMember) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !EMAIL_BASIC_RE.test(normalizedEmail)) {
      setFeedback({
        tone: 'error',
        message: 'Enter a valid login email address (for example: jun.yuen@teamspirit.club).',
      });
      return;
    }

    if (password.length < 6) {
      setFeedback({
        tone: 'error',
        message: 'Password must be at least 6 characters long.',
      });
      return;
    }

    const existingDuplicate = adminProfiles.find(
      (profile) => profile.email.trim().toLowerCase() === normalizedEmail,
    );
    if (existingDuplicate) {
      setFeedback({
        tone: 'error',
        message: `An account for "${normalizedEmail}" already exists. Open ${selectedMember.name}'s profile and use Link Account instead.`,
      });
      return;
    }

    setIsBusy(true);
    setFeedback(null);

    try {
      if (onEnsureMemberSynced) {
        const synced = await onEnsureMemberSynced();
        if (!synced) {
          setFeedback({
            tone: 'error',
            message: 'Unable to sync roster changes to Supabase Cloud first. Check your connection and retry.',
          });
          return;
        }
      }

      const result = await onCreateAndLinkAccount({
        memberId: selectedMember.id,
        memberName: selectedMember.name,
        email: normalizedEmail,
        password,
      });

      if (
        saveEmailToRoster &&
        selectedMember.email?.trim().toLowerCase() !== result.email.toLowerCase()
      ) {
        onSyncMemberEmailToRoster(selectedMember, result.email);
      }

      setCreatedNotice({
        memberId: selectedMember.id,
        memberName: selectedMember.name,
        email: result.email,
        password,
      });
      setPassword('');
      setShowPassword(false);
      setHasEditedEmail(false);
      setFeedback({
        tone: 'success',
        message: `Created, verified, and linked "${result.email}" to ${selectedMember.name}.`,
      });
      onNotify?.({
        tone: 'success',
        tag: 'Account Created',
        message: `Created & linked ${result.email} for ${selectedMember.name}.`,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message:
          err instanceof AdminAccountProvisionError || err instanceof Error
            ? err.message
            : 'Unable to create member account.',
      });
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmDeleteAccount() {
    if (!pendingDeleteProfile || !onRemoveAccount || deletingUserId) return;
    const target = pendingDeleteProfile;
    setDeletingUserId(target.userId);
    setPendingDeleteProfile(null);
    setFeedback(null);

    try {
      const result = await onRemoveAccount(target.userId);
      const msg =
        result.mode === 'deleted'
          ? `Deleted account "${target.email}". Roster records and attendance history remain preserved.`
          : `Revoked and disabled access for "${target.email}".`;
      setFeedback({ tone: 'warning', message: msg });
      onNotify?.({
        tone: 'warning',
        tag: result.mode === 'deleted' ? 'Account Deleted' : 'Access Revoked',
        message: msg,
      });
    } catch (err) {
      setFeedback({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Unable to delete user account.',
      });
    } finally {
      setDeletingUserId(null);
    }
  }

  const managedAccounts = useMemo(() => {
    return [...adminProfiles].sort((a, b) => {
      const aDisabled = a.isDisabled ? 1 : 0;
      const bDisabled = b.isDisabled ? 1 : 0;
      if (aDisabled !== bDisabled) return aDisabled - bDisabled;
      const aAdmin = a.role === 'admin' ? 0 : 1;
      const bAdmin = b.role === 'admin' ? 0 : 1;
      if (aAdmin !== bAdmin) return aAdmin - bAdmin;
      return a.email.localeCompare(b.email);
    });
  }, [adminProfiles]);

  return (
    <>
      <div className="member-provision-view">
        <div className="member-profile-topbar">
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={onBackToRoster}
          >
            <PixelArrowLeftIcon />
            <span>Back to Roster</span>
          </button>
          <span className="settings-mode-tag is-cloud">
            {unlinkedMembers.length} Unlinked
          </span>
        </div>

        <section className="member-account-panel" aria-label="Create Member Account">
          <div className="member-account-header">
            <div className="member-account-title-wrap">
              <span className="member-section-label member-account-heading">
                <PixelKeyIcon width={12} height={12} />
                <span>Create Member Account</span>
              </span>
              <span className="member-account-status-pill is-linked">Auto-Verified</span>
            </div>
          </div>

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
            </div>
          )}

          {createdNotice && (
            <div className="member-account-creds-box" role="status">
              <div className="member-account-creds-header">
                <strong>Linked to {createdNotice.memberName}</strong>
                <div className="member-provision-creds-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() =>
                      void handleCopyCredentials(createdNotice.email, createdNotice.password)
                    }
                  >
                    {copied ? <PixelCheckIcon width={11} height={11} /> : <PixelCopyIcon width={11} height={11} />}
                    <span>{copied ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => onOpenMemberProfile(createdNotice.memberId)}
                  >
                    <span>Profile</span>
                  </button>
                </div>
              </div>
              <div className="member-account-creds-grid">
                <span>
                  Email: <code>{createdNotice.email}</code>
                </span>
                <span>
                  Password: <code>{createdNotice.password}</code>
                </span>
              </div>
            </div>
          )}

          {unlinkedMembers.length === 0 ? (
            <div className="member-provision-empty" role="status">
              Every existing club member already has a linked login account.
            </div>
          ) : (
            <form className="member-account-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
              <div className="member-account-field">
                <label htmlFor={memberSelectId}>Existing Club Member</label>
                <select
                  id={memberSelectId}
                  className="form-control member-account-select"
                  value={selectedMemberId}
                  disabled={isBusy}
                  onChange={(event) => {
                    setSelectedMemberId(event.target.value);
                    setHasEditedEmail(false);
                    setFeedback(null);
                  }}
                >
                  {sortedMembers.map((member) => {
                    const existing = linkedProfileByMemberId.get(member.id);
                    const classPart = member.className ? ` (${member.className})` : '';
                    const legacyPart = isLegacyMember(member) ? ' [Legacy]' : '';
                    const suffix = existing ? ` — Linked (${existing.email})` : '';
                    return (
                      <option key={member.id} value={member.id} disabled={Boolean(existing)}>
                        {member.name}
                        {classPart}
                        {legacyPart}
                        {suffix}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="member-account-field">
                <div className="member-account-label-row">
                  <label htmlFor={emailInputId}>Login Email</label>
                  {hasEditedEmail && suggestedEmail && email.trim().toLowerCase() !== suggestedEmail && (
                    <button
                      type="button"
                      className="ring-reset-btn"
                      onClick={() => {
                        setEmail(suggestedEmail);
                        setHasEditedEmail(false);
                      }}
                    >
                      Reset
                    </button>
                  )}
                </div>
                <input
                  id={emailInputId}
                  type="email"
                  className="form-control member-account-input"
                  placeholder="name@teamspirit.club"
                  value={email}
                  disabled={isBusy}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    setHasEditedEmail(true);
                    if (feedback?.tone === 'error') setFeedback(null);
                  }}
                  required
                />
              </div>

              <div className="member-account-field">
                <div className="member-account-label-row">
                  <label htmlFor={passwordInputId}>Password</label>
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
                    id={passwordInputId}
                    type={showPassword ? 'text' : 'password'}
                    className="form-control member-account-input"
                    placeholder="Min. 6 characters"
                    value={password}
                    disabled={isBusy}
                    autoComplete="new-password"
                    onChange={(event) => {
                      setPassword(event.target.value);
                      if (feedback?.tone === 'error') setFeedback(null);
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

              <label className="member-account-checkbox-row" htmlFor={saveEmailId}>
                <input
                  id={saveEmailId}
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
                  type="submit"
                  className="btn-primary btn-compact-primary member-provision-submit"
                  disabled={isBusy || !selectedMember}
                >
                  <PixelLockIcon width={12} height={12} />
                  <span>{isBusy ? 'Creating & Linking...' : 'Create & Link Member Account'}</span>
                </button>
              </div>
            </form>
          )}
        </section>

        {/* Manage & Safely Delete Existing User Accounts */}
        {onRemoveAccount && (
          <section className="member-account-panel" aria-label="Registered User Accounts">
            <div className="member-account-header">
              <div className="member-account-title-wrap">
                <span className="member-section-label member-account-heading">
                  <PixelUserIcon width={12} height={12} />
                  <span>User Accounts</span>
                </span>
                <span className="panel-count">{managedAccounts.length}</span>
              </div>
            </div>

            {managedAccounts.length === 0 ? (
              <div className="member-provision-empty">No registered user accounts yet.</div>
            ) : (
              <ul className="member-provision-account-list">
                {managedAccounts.map((profile) => {
                  const linkedMember = profile.linkedMemberId
                    ? memberById.get(profile.linkedMemberId) ?? null
                    : null;
                  const isDisabled = Boolean(profile.isDisabled);
                  const isProfileAdmin = !isDisabled && profile.role === 'admin';
                  const isSelf = Boolean(currentUserId && profile.userId === currentUserId);
                  const isLastAdmin = isProfileAdmin && activeAdminCount <= 1;
                  const isRowBusy = deletingUserId === profile.userId;

                  return (
                    <li key={profile.userId} className="member-provision-account-row">
                      <div className="member-provision-account-info">
                        <div className="member-provision-account-top">
                          {linkedMember ? (
                            <button
                              type="button"
                              className="accounts-linked-name-btn"
                              onClick={() => onOpenMemberProfile(linkedMember.id)}
                              title={`Open ${linkedMember.name}'s profile`}
                            >
                              {linkedMember.name}
                            </button>
                          ) : (
                            <span className="accounts-unlinked-name">Unlinked</span>
                          )}
                          {isSelf && <span className="admin-self-tag">You</span>}
                          <span
                            className={`admin-role-pill ${
                              isDisabled ? 'is-member' : isProfileAdmin ? 'is-admin' : 'is-member'
                            }`}
                          >
                            {isProfileAdmin && <PixelStarIcon width={9} height={9} />}
                            <span>
                              {isDisabled ? 'Disabled' : isProfileAdmin ? 'Admin' : 'Member'}
                            </span>
                          </span>
                        </div>
                        <span className="member-provision-account-email" title={profile.email}>
                          {profile.email || profile.userId}
                        </span>
                      </div>

                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        disabled={isBusy || Boolean(deletingUserId) || isSelf || isLastAdmin}
                        aria-label={`Delete account ${profile.email}`}
                        title={
                          isSelf
                            ? 'You cannot delete your own signed-in account'
                            : isLastAdmin
                              ? 'Cannot delete the last remaining Admin'
                              : `Delete user account ${profile.email}`
                        }
                        onClick={() => setPendingDeleteProfile(profile)}
                      >
                        <PixelTrashIcon width={12} height={12} />
                        <span>{isRowBusy ? '...' : 'Delete'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

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
              isOpen={pendingDeleteProfile !== null}
              badgeLabel="Delete Account"
              title={
                pendingDeleteProfile
                  ? `Delete "${pendingDeleteProfile.email || pendingDeleteProfile.userId}"?`
                  : ''
              }
              message="This permanently removes the user account, revokes active sessions immediately, and unlinks any connected roster member. Club member profiles, attendance history, and submitted project ideas remain safely preserved."
              confirmLabel="Delete Account"
              onConfirm={() => void handleConfirmDeleteAccount()}
              onCancel={() => setPendingDeleteProfile(null)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
