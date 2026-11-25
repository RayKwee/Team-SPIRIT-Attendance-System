import {
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { AdminRemoveAccountResult } from '../lib/adminApi';
import type { ClubMember, UserProfileRecord } from '../types/attendance';
import { getMemberInitials } from '../utils/attendance';
import { formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelBanIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelLinkIcon,
  PixelRefreshIcon,
  PixelRestoreIcon,
  PixelSearchIcon,
  PixelShieldIcon,
  PixelStarIcon,
  PixelTrashIcon,
  PixelUserIcon,
} from './PixelIcons';

interface AccountsLeftPanelProps {
  id?: string;
  isOpen: boolean;
  currentUserId: string | null;
  profiles: UserProfileRecord[];
  members: ClubMember[];
  isProfilesLoading: boolean;
  profilesError?: string | null;
  onClose: () => void;
  onSyncProfiles: () => Promise<UserProfileRecord[]>;
  onUpdateUserAdminRole: (targetUserId: string, makeAdmin: boolean) => Promise<UserProfileRecord>;
  onLinkUserToMember: (
    targetUserId: string,
    targetMemberId: string | null,
  ) => Promise<UserProfileRecord>;
  onSetAccountDisabled: (targetUserId: string, disableAccount: boolean) => Promise<UserProfileRecord>;
  onRemoveAccount: (targetUserId: string) => Promise<AdminRemoveAccountResult>;
  onOpenMemberProfile: (memberId: string) => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

type AccountFilterTab = 'all' | 'admin' | 'member' | 'unlinked' | 'disabled';

type PendingAccountAction =
  | { type: 'promote'; profile: UserProfileRecord }
  | { type: 'demote'; profile: UserProfileRecord }
  | { type: 'unlink'; profile: UserProfileRecord; memberName: string }
  | { type: 'disable'; profile: UserProfileRecord }
  | { type: 'enable'; profile: UserProfileRecord }
  | { type: 'remove'; profile: UserProfileRecord };

/**
 * Admin-only dockable left-hand Accounts panel displaying every registered Supabase account,
 * its linked club member name, email, power level badge, and quick row-level Admin Actions.
 */
export function AccountsLeftPanel({
  id,
  isOpen,
  currentUserId,
  profiles,
  members,
  isProfilesLoading,
  profilesError,
  onClose,
  onSyncProfiles,
  onUpdateUserAdminRole,
  onLinkUserToMember,
  onSetAccountDisabled,
  onRemoveAccount,
  onOpenMemberProfile,
  onNotify,
}: AccountsLeftPanelProps) {
  const titleId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterTab, setFilterTab] = useState<AccountFilterTab>('all');
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [reassigningUserId, setReassigningUserId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAccountAction | null>(null);
  const [panelNotice, setPanelNotice] = useState<{
    tone: 'success' | 'warning' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setReassigningUserId(null);
      setPendingAction(null);
    }
  }, [isOpen]);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );

  const counts = useMemo(() => {
    let activeAdmins = 0;
    let activeMembers = 0;
    let unlinked = 0;
    let disabled = 0;
    for (const profile of profiles) {
      if (profile.isDisabled) {
        disabled += 1;
        continue;
      }
      if (profile.role === 'admin') {
        activeAdmins += 1;
      } else {
        activeMembers += 1;
      }
      if (!profile.linkedMemberId) {
        unlinked += 1;
      }
    }
    return {
      total: profiles.length,
      activeAdmins,
      activeMembers,
      unlinked,
      disabled,
    };
  }, [profiles]);

  const effectiveFilterTab: AccountFilterTab =
    filterTab === 'disabled' && counts.disabled === 0 ? 'all' : filterTab;

  const filteredProfiles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    const matched = profiles.filter((profile) => {
      const isDisabled = Boolean(profile.isDisabled);
      if (effectiveFilterTab === 'admin' && (isDisabled || profile.role !== 'admin')) {
        return false;
      }
      if (effectiveFilterTab === 'member' && (isDisabled || profile.role !== 'member')) {
        return false;
      }
      if (effectiveFilterTab === 'unlinked' && (isDisabled || Boolean(profile.linkedMemberId))) {
        return false;
      }
      if (effectiveFilterTab === 'disabled' && !isDisabled) {
        return false;
      }

      if (!q) return true;

      const linkedMember = profile.linkedMemberId ? memberById.get(profile.linkedMemberId) : null;
      const powerLabel = isDisabled
        ? 'disabled revoked'
        : profile.role === 'admin'
          ? 'admin administrator'
          : 'normal member standard';

      return (
        profile.email.toLowerCase().includes(q) ||
        powerLabel.includes(q) ||
        (linkedMember?.name.toLowerCase().includes(q) ?? false) ||
        (linkedMember?.className?.toLowerCase().includes(q) ?? false) ||
        (linkedMember?.role?.toLowerCase().includes(q) ?? false)
      );
    });

    return matched.sort((a, b) => {
      const aDisabled = a.isDisabled ? 1 : 0;
      const bDisabled = b.isDisabled ? 1 : 0;
      if (aDisabled !== bDisabled) return aDisabled - bDisabled;

      const aAdmin = a.role === 'admin' ? 0 : 1;
      const bAdmin = b.role === 'admin' ? 0 : 1;
      if (aAdmin !== bAdmin) return aAdmin - bAdmin;

      const aName = (a.linkedMemberId ? memberById.get(a.linkedMemberId)?.name : '') || a.email;
      const bName = (b.linkedMemberId ? memberById.get(b.linkedMemberId)?.name : '') || b.email;
      return aName.localeCompare(bName);
    });
  }, [effectiveFilterTab, memberById, profiles, searchQuery]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && pendingAction) {
      event.stopPropagation();
      setPendingAction(null);
      return;
    }
    if (event.key === 'Escape' && reassigningUserId) {
      event.stopPropagation();
      setReassigningUserId(null);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation();
      onClose();
    }
  }

  async function handleSyncClick() {
    if (isSyncing || busyUserId) return;
    setIsSyncing(true);
    setPanelNotice(null);
    try {
      const list = await onSyncProfiles();
      setPanelNotice({
        tone: 'success',
        message: `Synced ${list.length} registered Supabase ${list.length === 1 ? 'account' : 'accounts'}.`,
      });
    } catch (err) {
      setPanelNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Unable to sync registered accounts.',
      });
    } finally {
      setIsSyncing(false);
    }
  }

  async function handleQuickLinkChange(profile: UserProfileRecord, nextMemberId: string) {
    if (busyUserId) return;
    const cleanedMemberId = nextMemberId.trim() || null;
    if (cleanedMemberId === (profile.linkedMemberId ?? null)) {
      setReassigningUserId(null);
      return;
    }

    setBusyUserId(profile.userId);
    setPanelNotice(null);
    try {
      await onLinkUserToMember(profile.userId, cleanedMemberId);
      const targetName = cleanedMemberId ? memberById.get(cleanedMemberId)?.name ?? 'member' : null;
      const msg = targetName
        ? `Linked ${profile.email || 'account'} to ${targetName}.`
        : `Unlinked ${profile.email || 'account'} from its roster member.`;
      setPanelNotice({ tone: 'success', message: msg });
      onNotify?.({
        tone: 'success',
        tag: targetName ? 'Account Linked' : 'Account Unlinked',
        message: msg,
      });
      setReassigningUserId(null);
    } catch (err) {
      setPanelNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Unable to update linked roster member.',
      });
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleConfirmPendingAction() {
    if (!pendingAction || busyUserId) return;
    const action = pendingAction;
    const label = action.profile.email || action.profile.userId;

    setBusyUserId(action.profile.userId);
    setPanelNotice(null);
    setPendingAction(null);

    try {
      if (action.type === 'promote') {
        await onUpdateUserAdminRole(action.profile.userId, true);
        const msg = `Promoted ${label} to Admin.`;
        setPanelNotice({ tone: 'success', message: msg });
        onNotify?.({ tone: 'success', tag: 'Promoted', message: msg });
      } else if (action.type === 'demote') {
        await onUpdateUserAdminRole(action.profile.userId, false);
        const msg = `Demoted ${label} back to Normal Member.`;
        setPanelNotice({ tone: 'success', message: msg });
        onNotify?.({ tone: 'info', tag: 'Demoted', message: msg });
      } else if (action.type === 'unlink') {
        await onLinkUserToMember(action.profile.userId, null);
        const msg = `Reset member connection for ${label} (unlinked from ${action.memberName}).`;
        setPanelNotice({ tone: 'success', message: msg });
        onNotify?.({ tone: 'info', tag: 'Unlinked', message: msg });
      } else if (action.type === 'disable') {
        await onSetAccountDisabled(action.profile.userId, true);
        const msg = `Disabled account access for ${label}. All club permissions and roster links were revoked.`;
        setPanelNotice({ tone: 'warning', message: msg });
        onNotify?.({ tone: 'warning', tag: 'Access Disabled', message: msg });
      } else if (action.type === 'enable') {
        await onSetAccountDisabled(action.profile.userId, false);
        const msg = `Re-enabled ${label} as a Normal Member.`;
        setPanelNotice({ tone: 'success', message: msg });
        onNotify?.({ tone: 'success', tag: 'Account Re-enabled', message: msg });
      } else if (action.type === 'remove') {
        const result = await onRemoveAccount(action.profile.userId);
        if (result.mode === 'deleted') {
          const msg = `Permanently removed account ${label}. Historical attendance and project ideas remain preserved.`;
          setPanelNotice({ tone: 'warning', message: msg });
          onNotify?.({ tone: 'warning', tag: 'Account Removed', message: msg });
        } else {
          const msg = `Revoked and disabled all access for ${label}. To also delete the Auth user entry, remove it under Supabase Dashboard → Authentication → Users.`;
          setPanelNotice({ tone: 'warning', message: msg });
          onNotify?.({ tone: 'warning', tag: 'Access Revoked', message: msg });
        }
      }
    } catch (err) {
      setPanelNotice({
        tone: 'error',
        message: err instanceof Error ? err.message : 'Unable to complete admin action.',
      });
    } finally {
      setBusyUserId(null);
    }
  }

  function getConfirmDialogMeta(action: PendingAccountAction | null): {
    badgeLabel: string;
    title: string;
    message: string;
    confirmLabel: string;
  } {
    if (!action) {
      return { badgeLabel: 'Confirm', title: '', message: '', confirmLabel: 'Confirm' };
    }

    const emailLabel = action.profile.email || action.profile.userId;
    const isSelf = Boolean(currentUserId && action.profile.userId === currentUserId);

    switch (action.type) {
      case 'promote':
        return {
          badgeLabel: 'Promote to Admin',
          title: `Promote "${emailLabel}" to Admin?`,
          message:
            'This account will gain full Administrator power: managing club members, sessions, attendance, global visibility permissions, and other user accounts.',
          confirmLabel: 'Promote to Admin',
        };
      case 'demote':
        return {
          badgeLabel: 'Demote to Normal Member',
          title: isSelf
            ? 'Step down from Admin to Normal Member?'
            : `Demote "${emailLabel}" to Normal Member?`,
          message: isSelf
            ? 'You will immediately lose Administrator controls and return to Normal Member access. Another active Admin will be needed to re-promote you.'
            : 'This account will lose Administrator privileges and immediately switch to Normal Member access.',
          confirmLabel: 'Demote to Normal Member',
        };
      case 'unlink':
        return {
          badgeLabel: 'Reset Account Link',
          title: `Unlink "${emailLabel}" from ${action.memberName}?`,
          message: `This resets the connection between "${emailLabel}" and "${action.memberName}" so the roster profile can be linked to another account. Attendance records and submitted project ideas will NOT be deleted.`,
          confirmLabel: 'Reset / Unlink',
        };
      case 'disable':
        return {
          badgeLabel: 'Disable Access',
          title: `Disable access for "${emailLabel}"?`,
          message:
            'This immediately revokes all access to Team SPIRIT attendance, roster, and ideas, signs out any active session, and clears their roster link. You can re-enable the account later from this panel.',
          confirmLabel: 'Disable Access',
        };
      case 'enable':
        return {
          badgeLabel: 'Re-enable Account',
          title: `Re-enable "${emailLabel}"?`,
          message:
            'This restores login access as a Normal Member. You can link them back to a roster profile or promote them afterward.',
          confirmLabel: 'Re-enable Account',
        };
      case 'remove':
        return {
          badgeLabel: 'Remove Account',
          title: `Remove "${emailLabel}" permanently?`,
          message:
            'This revokes all permissions, unlinks any connected roster member, and removes the account from Supabase. Past club attendance history and submitted project ideas remain safely preserved.',
          confirmLabel: 'Remove Account',
        };
    }
  }

  const dialogMeta = getConfirmDialogMeta(pendingAction);
  const isAnyBusy = Boolean(busyUserId) || isSyncing;

  return (
    <>
      <aside
        id={id}
        className={`accounts-drawer ${isOpen ? 'is-open' : 'is-closed'}`}
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        inert={!isOpen || undefined}
        onKeyDown={handleKeyDown}
      >
        <div className="accounts-drawer-header">
          <div className="accounts-drawer-title-group">
            <div className="accounts-drawer-title-row">
              <span className="modal-badge accounts-admin-badge">
                <PixelShieldIcon width={12} height={12} />
                <span>Admin Only</span>
              </span>
              <span className="panel-count" title={`${counts.total} registered accounts`}>
                {counts.total}
              </span>
            </div>
            <h2 id={titleId} className="member-drawer-title">
              Accounts
            </h2>
          </div>

          <div className="member-drawer-header-actions">
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => void handleSyncClick()}
              disabled={isAnyBusy || isProfilesLoading}
              title="Sync registered accounts from Supabase Auth"
            >
              <PixelRefreshIcon />
              <span>{isSyncing || isProfilesLoading ? 'Syncing...' : 'Sync'}</span>
            </button>
            <button
              type="button"
              className="modal-close-btn"
              onClick={onClose}
              aria-label="Close Accounts panel"
              title="Close (Esc)"
            >
              <PixelCloseIcon />
            </button>
          </div>
        </div>

        <div className="accounts-drawer-body">
          {/* Power Level Summary Strip */}
          <div className="accounts-summary-strip" aria-label="Account power level summary">
            <span className="accounts-summary-chip is-admin">
              <PixelStarIcon width={10} height={10} />
              <span>
                {counts.activeAdmins} {counts.activeAdmins === 1 ? 'Admin' : 'Admins'}
              </span>
            </span>
            <span className="accounts-summary-chip is-member">
              <PixelUserIcon width={10} height={10} />
              <span>
                {counts.activeMembers}{' '}
                {counts.activeMembers === 1 ? 'Normal Member' : 'Normal Members'}
              </span>
            </span>
            {counts.disabled > 0 && (
              <span className="accounts-summary-chip is-disabled">
                <PixelBanIcon width={10} height={10} />
                <span>{counts.disabled} Disabled</span>
              </span>
            )}
          </div>

          {/* Search & Filter Controls */}
          <div className="accounts-controls">
            <div className="search-box member-search-box">
              <span className="search-icon">
                <PixelSearchIcon />
              </span>
              <input
                type="search"
                className="search-input member-search-input"
                placeholder="Search member name, email, or role..."
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                aria-label="Search registered accounts"
              />
            </div>

            <div className="filter-pills accounts-filter-pills" role="tablist" aria-label="Filter accounts">
              <button
                type="button"
                role="tab"
                aria-selected={effectiveFilterTab === 'all'}
                className={`filter-pill ${effectiveFilterTab === 'all' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('all')}
              >
                All ({counts.total})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveFilterTab === 'admin'}
                className={`filter-pill ${effectiveFilterTab === 'admin' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('admin')}
              >
                Admins ({counts.activeAdmins})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveFilterTab === 'member'}
                className={`filter-pill ${effectiveFilterTab === 'member' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('member')}
              >
                Normal ({counts.activeMembers})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={effectiveFilterTab === 'unlinked'}
                className={`filter-pill ${effectiveFilterTab === 'unlinked' ? 'is-active' : ''}`}
                onClick={() => setFilterTab('unlinked')}
              >
                Unlinked ({counts.unlinked})
              </button>
              {counts.disabled > 0 && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={effectiveFilterTab === 'disabled'}
                  className={`filter-pill ${effectiveFilterTab === 'disabled' ? 'is-active' : ''}`}
                  onClick={() => setFilterTab('disabled')}
                >
                  Disabled ({counts.disabled})
                </button>
              )}
            </div>
          </div>

          {profilesError && (
            <div className="member-account-feedback is-error" role="alert">
              <div className="member-account-feedback-row">
                <PixelAlertIcon width={13} height={13} />
                <span>{profilesError}</span>
              </div>
            </div>
          )}

          {panelNotice && (
            <div
              className={`member-account-feedback is-${panelNotice.tone}`}
              role={panelNotice.tone === 'error' ? 'alert' : 'status'}
            >
              <div className="member-account-feedback-row">
                {panelNotice.tone === 'success' ? (
                  <PixelCheckIcon width={13} height={13} />
                ) : (
                  <PixelAlertIcon width={13} height={13} />
                )}
                <span>{panelNotice.message}</span>
              </div>
            </div>
          )}

          {isProfilesLoading && profiles.length === 0 ? (
            <div className="member-empty-state" role="status">
              <strong>Loading Registered Accounts</strong>
              <span>Fetching all Supabase user accounts and linked member records...</span>
            </div>
          ) : filteredProfiles.length === 0 ? (
            <div className="member-empty-state" role="status">
              <strong>
                {profiles.length === 0 ? 'No Registered Accounts Found' : 'No Matching Accounts'}
              </strong>
              <span>
                {profiles.length === 0
                  ? 'Click Sync above to pull accounts from Supabase Auth, or create member logins from the Member Manager sidebar.'
                  : 'Try clearing your search query or switching the role filter.'}
              </span>
            </div>
          ) : (
            <ul className="accounts-list" aria-label="Registered user accounts">
              {filteredProfiles.map((profile) => {
                const isDisabled = Boolean(profile.isDisabled);
                const isTargetAdmin = !isDisabled && profile.role === 'admin';
                const isSelf = Boolean(currentUserId && profile.userId === currentUserId);
                const isLastActiveAdmin = isTargetAdmin && counts.activeAdmins <= 1;
                const isRowBusy = busyUserId === profile.userId;
                const linkedMember = profile.linkedMemberId
                  ? memberById.get(profile.linkedMemberId) ?? null
                  : null;
                const isReassignOpen = reassigningUserId === profile.userId;
                const displayInitials = linkedMember
                  ? getMemberInitials(linkedMember.name)
                  : (profile.email.slice(0, 2).toUpperCase() || 'TS');

                return (
                  <li
                    key={profile.userId}
                    className={`accounts-card ${
                      isDisabled ? 'is-disabled' : isTargetAdmin ? 'is-admin' : 'is-member'
                    }`}
                  >
                    <div className="accounts-card-top">
                      <div
                        className={`member-avatar-badge accounts-avatar ${
                          isDisabled ? 'is-disabled' : isTargetAdmin ? 'is-admin' : ''
                        }`}
                        aria-hidden="true"
                      >
                        {displayInitials}
                      </div>

                      <div className="accounts-card-identity">
                        <div className="accounts-card-name-row">
                          {linkedMember ? (
                            <button
                              type="button"
                              className="accounts-linked-name-btn"
                              onClick={() => onOpenMemberProfile(linkedMember.id)}
                              title={`Open ${linkedMember.name}'s profile in Member Manager`}
                            >
                              {linkedMember.name}
                            </button>
                          ) : (
                            <span className="accounts-unlinked-name">
                              {profile.linkedMemberId ? 'Unavailable Member' : 'Unlinked Account'}
                            </span>
                          )}
                          {isSelf && <span className="admin-self-tag">You</span>}
                        </div>

                        <span className="accounts-card-email" title={profile.email}>
                          {profile.email || profile.userId}
                        </span>

                        <div className="accounts-card-badges">
                          {isDisabled ? (
                            <span className="accounts-power-badge is-disabled">
                              <PixelBanIcon width={10} height={10} />
                              <span>Access Disabled</span>
                            </span>
                          ) : isTargetAdmin ? (
                            <span className="accounts-power-badge is-admin">
                              <PixelStarIcon width={10} height={10} />
                              <span>Admin</span>
                            </span>
                          ) : (
                            <span className="accounts-power-badge is-member">
                              <PixelUserIcon width={10} height={10} />
                              <span>Normal Member</span>
                            </span>
                          )}

                          {!isDisabled && !isTargetAdmin && profile.canViewAllAttendance && (
                            <span className="accounts-sub-badge is-viewer">Broad View</span>
                          )}

                          {linkedMember?.className && (
                            <span className="member-class-pill">{linkedMember.className}</span>
                          )}

                          {linkedMember?.role && (
                            <span className="member-role-pill">{linkedMember.role}</span>
                          )}
                        </div>

                        <span className="accounts-card-meta">
                          {isDisabled && profile.disabledAt
                            ? `Disabled ${formatTimestamp(profile.disabledAt)}`
                            : isTargetAdmin && profile.promotedAt
                              ? `Admin since ${formatTimestamp(profile.promotedAt)}`
                              : `Registered ${formatTimestamp(profile.createdAt)}`}
                        </span>
                      </div>
                    </div>

                    {/* Quick Inline Member Link / Reassign Picker */}
                    {!isDisabled && (isReassignOpen || !linkedMember) && (
                      <div className="accounts-link-inline">
                        <select
                          className="form-control accounts-link-select"
                          value={profile.linkedMemberId ?? ''}
                          disabled={isAnyBusy}
                          aria-label={`Link ${profile.email || profile.userId} to a roster member`}
                          onChange={(event) =>
                            void handleQuickLinkChange(profile, event.target.value)
                          }
                        >
                          <option value="">
                            {linkedMember
                              ? 'Unlink from roster member...'
                              : 'Link to a club member...'}
                          </option>
                          {sortedMembers.map((member) => {
                            const takenByOther = profiles.find(
                              (other) =>
                                other.userId !== profile.userId &&
                                other.linkedMemberId === member.id,
                            );
                            const suffix = takenByOther
                              ? ` — linked to ${takenByOther.email}`
                              : member.className
                                ? ` (${member.className})`
                                : '';
                            return (
                              <option
                                key={member.id}
                                value={member.id}
                                disabled={Boolean(takenByOther)}
                              >
                                {member.name}
                                {suffix}
                              </option>
                            );
                          })}
                        </select>
                        {isReassignOpen && (
                          <button
                            type="button"
                            className="ring-reset-btn"
                            onClick={() => setReassigningUserId(null)}
                          >
                            Done
                          </button>
                        )}
                      </div>
                    )}

                    {/* Quick Admin Actions Bar */}
                    <div className="accounts-row-actions" aria-label={`Admin actions for ${profile.email}`}>
                      {!isDisabled ? (
                        <>
                          {isTargetAdmin ? (
                            <button
                              type="button"
                              className="btn-secondary btn-compact accounts-action-btn"
                              disabled={isAnyBusy || isLastActiveAdmin}
                              title={
                                isLastActiveAdmin
                                  ? 'Cannot demote the last remaining Admin'
                                  : isSelf
                                    ? 'Step down from Admin to Normal Member'
                                    : `Demote ${profile.email} to Normal Member`
                              }
                              onClick={() => setPendingAction({ type: 'demote', profile })}
                            >
                              <span>{isRowBusy ? 'Updating...' : 'Demote'}</span>
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-primary btn-compact-primary accounts-action-btn"
                              disabled={isAnyBusy}
                              title={`Promote ${profile.email} to Admin`}
                              onClick={() => setPendingAction({ type: 'promote', profile })}
                            >
                              <PixelStarIcon width={11} height={11} />
                              <span>{isRowBusy ? 'Updating...' : 'Promote to Admin'}</span>
                            </button>
                          )}

                          {linkedMember && (
                            <>
                              <button
                                type="button"
                                className="btn-secondary btn-compact accounts-action-btn"
                                disabled={isAnyBusy}
                                title={`Change linked member for ${profile.email}`}
                                onClick={() =>
                                  setReassigningUserId((prev) =>
                                    prev === profile.userId ? null : profile.userId,
                                  )
                                }
                              >
                                <PixelLinkIcon width={11} height={11} />
                                <span>{isReassignOpen ? 'Close Link' : 'Change Link'}</span>
                              </button>
                              <button
                                type="button"
                                className="btn-secondary btn-compact accounts-action-btn"
                                disabled={isAnyBusy}
                                title={`Reset / unlink ${profile.email} from ${linkedMember.name}`}
                                onClick={() =>
                                  setPendingAction({
                                    type: 'unlink',
                                    profile,
                                    memberName: linkedMember.name,
                                  })
                                }
                              >
                                <span>Unlink</span>
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            className="btn-secondary btn-compact accounts-action-btn accounts-disable-btn"
                            disabled={isAnyBusy || isSelf || isLastActiveAdmin}
                            title={
                              isSelf
                                ? 'You cannot disable your own signed-in account'
                                : isLastActiveAdmin
                                  ? 'Cannot disable the last remaining Admin'
                                  : `Disable access for ${profile.email}`
                            }
                            onClick={() => setPendingAction({ type: 'disable', profile })}
                          >
                            <PixelBanIcon width={11} height={11} />
                            <span>Disable</span>
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary btn-compact accounts-action-btn btn-restore-inline"
                          disabled={isAnyBusy}
                          title={`Re-enable ${profile.email} as Normal Member`}
                          onClick={() => setPendingAction({ type: 'enable', profile })}
                        >
                          <PixelRestoreIcon width={11} height={11} />
                          <span>{isRowBusy ? 'Updating...' : 'Re-enable'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        className="icon-btn icon-btn-danger accounts-remove-btn"
                        disabled={isAnyBusy || isSelf || isLastActiveAdmin}
                        aria-label={`Remove account ${profile.email}`}
                        title={
                          isSelf
                            ? 'You cannot remove your own signed-in account'
                            : isLastActiveAdmin
                              ? 'Cannot remove the last remaining Admin'
                              : `Remove account ${profile.email}`
                        }
                        onClick={() => setPendingAction({ type: 'remove', profile })}
                      >
                        <PixelTrashIcon width={12} height={12} />
                        <span>Remove</span>
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </aside>

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
              isOpen={pendingAction !== null}
              badgeLabel={dialogMeta.badgeLabel}
              title={dialogMeta.title}
              message={dialogMeta.message}
              confirmLabel={dialogMeta.confirmLabel}
              onConfirm={() => void handleConfirmPendingAction()}
              onCancel={() => setPendingAction(null)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
