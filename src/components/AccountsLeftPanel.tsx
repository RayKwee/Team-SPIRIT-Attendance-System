import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
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
  getMemberInitials,
  isLegacyMember,
} from '../utils/attendance';
import { formatTimestamp } from '../utils/date';
import {
  buildMemberCredentialsClipboardText,
  exportMemberCredentialsCsv,
  exportMemberCredentialsText,
  type MemberCredentialExportRow,
} from '../utils/export';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelBanIcon,
  PixelCheckIcon,
  PixelChevronIcon,
  PixelCloseIcon,
  PixelCopyIcon,
  PixelDownloadIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelKeyIcon,
  PixelLinkIcon,
  PixelLockIcon,
  PixelPlusIcon,
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
  memberCredentials?: Record<string, string>;
  members: ClubMember[];
  isProfilesLoading: boolean;
  profilesError?: string | null;
  onClose: () => void;
  onSyncProfiles: () => Promise<UserProfileRecord[]>;
  onEnsureMemberSynced?: () => Promise<boolean>;
  onCreateAndLinkMemberAccount?: (params: {
    memberId?: string | null;
    memberName?: string;
    email: string;
    password: string;
  }) => Promise<AdminCreateAccountResult>;
  onResetMemberPassword?: (targetUserId: string, newPassword: string) => Promise<void>;
  onSyncMemberEmailToRoster?: (member: ClubMember, email: string) => void;
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

const EMAIL_BASIC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-only dockable left-hand Accounts panel displaying every registered account,
 * direct member account creation, strictly member-only password viewing & quick export,
 * and quick row-level Admin Actions.
 */
export function AccountsLeftPanel({
  id,
  isOpen,
  currentUserId,
  profiles,
  memberCredentials = {},
  members,
  isProfilesLoading,
  profilesError,
  onClose,
  onSyncProfiles,
  onEnsureMemberSynced,
  onCreateAndLinkMemberAccount,
  onResetMemberPassword,
  onSyncMemberEmailToRoster,
  onUpdateUserAdminRole,
  onLinkUserToMember,
  onSetAccountDisabled,
  onRemoveAccount,
  onOpenMemberProfile,
  onNotify,
}: AccountsLeftPanelProps) {
  const titleId = useId();
  const createMemberSelectId = useId();
  const createEmailInputId = useId();
  const createPasswordInputId = useId();
  const saveRosterEmailId = useId();
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

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

  // Direct inline Member Account creation state
  const [isCreateFormOpen, setIsCreateFormOpen] = useState(false);
  const [selectedCreateMemberId, setSelectedCreateMemberId] = useState('');
  const [createEmail, setCreateEmail] = useState('');
  const [hasEditedCreateEmail, setHasEditedCreateEmail] = useState(false);
  const [createPassword, setCreatePassword] = useState('');
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [saveEmailToRoster, setSaveEmailToRoster] = useState(true);
  const [isCreatingMember, setIsCreatingMember] = useState(false);
  const [createFormError, setCreateFormError] = useState<string | null>(null);

  // Member-only password visibility, inline reset & quick copy/export state
  const [revealAllPasswords, setRevealAllPasswords] = useState(false);
  const [revealedPasswordIds, setRevealedPasswordIds] = useState<Set<string>>(() => new Set());
  const [copiedPasswordUserId, setCopiedPasswordUserId] = useState<string | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [resettingUserId, setResettingUserId] = useState<string | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetFormError, setResetFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setReassigningUserId(null);
      setPendingAction(null);
      setIsExportMenuOpen(false);
      setRevealAllPasswords(false);
      setRevealedPasswordIds(new Set());
      setResettingUserId(null);
      setResetPasswordValue('');
      setShowResetPassword(false);
      setResetFormError(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isExportMenuOpen) return;
    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        exportMenuRef.current &&
        event.target instanceof Node &&
        !exportMenuRef.current.contains(event.target)
      ) {
        setIsExportMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isExportMenuOpen]);

  const memberById = useMemo(
    () => new Map(members.map((member) => [member.id, member])),
    [members],
  );

  const linkedProfileByMemberId = useMemo(() => {
    const map = new Map<string, UserProfileRecord>();
    for (const profile of profiles) {
      if (profile.linkedMemberId) {
        map.set(profile.linkedMemberId, profile);
      }
    }
    return map;
  }, [profiles]);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => a.name.localeCompare(b.name)),
    [members],
  );

  const membersForCreation = useMemo(() => {
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
    () => membersForCreation.filter((member) => !linkedProfileByMemberId.has(member.id)),
    [linkedProfileByMemberId, membersForCreation],
  );

  const selectedCreateMember = useMemo(
    () => (selectedCreateMemberId ? memberById.get(selectedCreateMemberId) ?? null : null),
    [memberById, selectedCreateMemberId],
  );

  const suggestedCreateEmail = useMemo(() => {
    if (!selectedCreateMember) return '';
    return (
      selectedCreateMember.email?.trim().toLowerCase() ||
      formatClubLoginEmail(selectedCreateMember.name)
    );
  }, [selectedCreateMember]);

  // If a previously selected member becomes linked or deleted, revert cleanly to standalone mode.
  useEffect(() => {
    if (!selectedCreateMemberId) return;
    if (!linkedProfileByMemberId.has(selectedCreateMemberId) && memberById.has(selectedCreateMemberId)) {
      return;
    }
    setSelectedCreateMemberId('');
    setHasEditedCreateEmail(false);
  }, [linkedProfileByMemberId, memberById, selectedCreateMemberId]);

  useEffect(() => {
    if (!hasEditedCreateEmail) {
      setCreateEmail(suggestedCreateEmail);
    }
  }, [hasEditedCreateEmail, suggestedCreateEmail]);

  useEffect(() => {
    if (selectedCreateMember) {
      setSaveEmailToRoster(!selectedCreateMember.email?.trim());
    }
  }, [selectedCreateMember?.id]);

  // Strictly member-only export rows (Admin accounts are NEVER included).
  const memberExportRows = useMemo<MemberCredentialExportRow[]>(() => {
    return profiles
      .filter((profile) => profile.role === 'member' && !profile.isDisabled)
      .map((profile) => {
        const linked = profile.linkedMemberId ? memberById.get(profile.linkedMemberId) ?? null : null;
        return {
          memberName: linked?.name || 'Unlinked Member',
          className: linked?.className || '',
          clubRole: linked?.role || '',
          email: profile.email || profile.userId,
          password: memberCredentials[profile.userId] || '',
          status: linked ? 'Linked' : 'Unlinked',
        };
      })
      .sort((a, b) => a.memberName.localeCompare(b.memberName) || a.email.localeCompare(b.email));
  }, [memberById, memberCredentials, profiles]);

  const recordedMemberPasswordCount = useMemo(
    () => memberExportRows.filter((row) => row.password.length > 0).length,
    [memberExportRows],
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
    if (event.key === 'Escape' && isExportMenuOpen) {
      event.stopPropagation();
      setIsExportMenuOpen(false);
      return;
    }
    if (event.key === 'Escape' && pendingAction) {
      event.stopPropagation();
      setPendingAction(null);
      return;
    }
    if (event.key === 'Escape' && resettingUserId && !busyUserId) {
      event.stopPropagation();
      setResettingUserId(null);
      setResetPasswordValue('');
      setShowResetPassword(false);
      setResetFormError(null);
      return;
    }
    if (event.key === 'Escape' && reassigningUserId) {
      event.stopPropagation();
      setReassigningUserId(null);
      return;
    }
    if (event.key === 'Escape' && isCreateFormOpen && !isCreatingMember) {
      event.stopPropagation();
      setIsCreateFormOpen(false);
      setCreateFormError(null);
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation();
      onClose();
    }
  }

  function toggleCardPasswordVisibility(targetUserId: string) {
    setRevealedPasswordIds((prev) => {
      const next = new Set(prev);
      if (next.has(targetUserId)) {
        next.delete(targetUserId);
      } else {
        next.add(targetUserId);
      }
      return next;
    });
  }

  function handleToggleRevealAll() {
    if (revealAllPasswords) {
      setRevealAllPasswords(false);
      setRevealedPasswordIds(new Set());
    } else {
      setRevealAllPasswords(true);
    }
  }

  async function handleCopySinglePassword(userId: string, password: string, label: string) {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(password);
        setCopiedPasswordUserId(userId);
        window.setTimeout(() => {
          setCopiedPasswordUserId((current) => (current === userId ? null : current));
        }, 1800);
        onNotify?.({
          tone: 'info',
          tag: 'Copied',
          message: `Copied member password for ${label}.`,
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

  async function handleCopyAllMemberCredentials() {
    setIsExportMenuOpen(false);
    if (memberExportRows.length === 0) {
      setPanelNotice({ tone: 'warning', message: 'No active member accounts to export.' });
      return;
    }
    try {
      const text = buildMemberCredentialsClipboardText(memberExportRows);
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        const msg = `Copied ${memberExportRows.length} member ${
          memberExportRows.length === 1 ? 'account' : 'accounts'
        } (member-only; admins excluded).`;
        setPanelNotice({ tone: 'success', message: msg });
        onNotify?.({ tone: 'success', tag: 'Credentials Copied', message: msg });
      }
    } catch {
      setPanelNotice({ tone: 'error', message: 'Clipboard access was blocked by the browser.' });
    }
  }

  function handleExportCsv() {
    setIsExportMenuOpen(false);
    if (memberExportRows.length === 0) {
      setPanelNotice({ tone: 'warning', message: 'No active member accounts to export.' });
      return;
    }
    exportMemberCredentialsCsv(memberExportRows);
    const msg = `Exported CSV for ${memberExportRows.length} member ${
      memberExportRows.length === 1 ? 'account' : 'accounts'
    } (admins excluded).`;
    setPanelNotice({ tone: 'success', message: msg });
    onNotify?.({ tone: 'info', tag: 'CSV Exported', message: msg });
  }

  function handleExportText() {
    setIsExportMenuOpen(false);
    if (memberExportRows.length === 0) {
      setPanelNotice({ tone: 'warning', message: 'No active member accounts to export.' });
      return;
    }
    exportMemberCredentialsText(memberExportRows);
    const msg = `Downloaded TXT sheet for ${memberExportRows.length} member ${
      memberExportRows.length === 1 ? 'account' : 'accounts'
    } (admins excluded).`;
    setPanelNotice({ tone: 'success', message: msg });
    onNotify?.({ tone: 'info', tag: 'TXT Exported', message: msg });
  }

  async function handleCreateMemberAccountSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onCreateAndLinkMemberAccount || isCreatingMember) return;

    const normalizedEmail = createEmail.trim().toLowerCase();
    if (!normalizedEmail || !EMAIL_BASIC_RE.test(normalizedEmail)) {
      setCreateFormError('Enter a valid login email address (e.g. jun.yuen@teamspirit.club).');
      return;
    }

    if (createPassword.length < 6) {
      setCreateFormError('Password must be at least 6 characters long.');
      return;
    }

    const existingDuplicate = profiles.find(
      (profile) => profile.email.trim().toLowerCase() === normalizedEmail,
    );
    if (existingDuplicate) {
      setCreateFormError(
        `An account for "${normalizedEmail}" already exists. Link it below instead.`,
      );
      return;
    }

    setIsCreatingMember(true);
    setCreateFormError(null);
    setPanelNotice(null);

    try {
      if (selectedCreateMember && onEnsureMemberSynced) {
        const synced = await onEnsureMemberSynced();
        if (!synced) {
          setCreateFormError(
            'Could not sync roster changes to Supabase Cloud first. Check your connection and retry.',
          );
          return;
        }
      }

      const result = await onCreateAndLinkMemberAccount({
        memberId: selectedCreateMember?.id ?? null,
        memberName: selectedCreateMember?.name,
        email: normalizedEmail,
        password: createPassword,
      });

      if (
        selectedCreateMember &&
        saveEmailToRoster &&
        onSyncMemberEmailToRoster &&
        selectedCreateMember.email?.trim().toLowerCase() !== result.email.toLowerCase()
      ) {
        onSyncMemberEmailToRoster(selectedCreateMember, result.email);
      }

      setCreatePassword('');
      setCreateEmail('');
      setSelectedCreateMemberId('');
      setShowCreatePassword(false);
      setHasEditedCreateEmail(false);
      setIsCreateFormOpen(false);
      const msg = selectedCreateMember
        ? `Created, auto-verified, and linked "${result.email}" to ${selectedCreateMember.name}.`
        : `Created and auto-verified standalone member account "${result.email}". You can link it to a roster profile anytime.`;
      setPanelNotice({ tone: 'success', message: msg });
      onNotify?.({ tone: 'success', tag: 'Account Created', message: msg });
    } catch (err) {
      setCreateFormError(
        err instanceof AdminAccountProvisionError || err instanceof Error
          ? err.message
          : 'Unable to create member account.',
      );
    } finally {
      setIsCreatingMember(false);
    }
  }

  function handleToggleResetPasswordForm(profile: UserProfileRecord) {
    if (busyUserId || profile.role !== 'member' || profile.isDisabled) return;
    if (resettingUserId === profile.userId) {
      setResettingUserId(null);
      setResetPasswordValue('');
      setShowResetPassword(false);
      setResetFormError(null);
      return;
    }
    setResettingUserId(profile.userId);
    setResetPasswordValue('');
    setShowResetPassword(true);
    setResetFormError(null);
  }

  async function handleResetMemberPasswordSubmit(
    event: FormEvent<HTMLFormElement>,
    profile: UserProfileRecord,
  ) {
    event.preventDefault();
    if (!onResetMemberPassword || busyUserId || profile.role !== 'member' || profile.isDisabled) {
      return;
    }

    if (resetPasswordValue.length < 6) {
      setResetFormError('New password must be at least 6 characters long.');
      return;
    }

    setBusyUserId(profile.userId);
    setResetFormError(null);
    setPanelNotice(null);

    try {
      await onResetMemberPassword(profile.userId, resetPasswordValue);
      setResettingUserId(null);
      setResetPasswordValue('');
      setShowResetPassword(false);
      const msg = `Updated login password for member "${profile.email || profile.userId}".`;
      setPanelNotice({ tone: 'success', message: msg });
      onNotify?.({ tone: 'success', tag: 'Password Reset', message: msg });
    } catch (err) {
      setResetFormError(
        err instanceof Error ? err.message : 'Unable to update member password.',
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleSyncClick() {
    if (isSyncing || busyUserId || isCreatingMember) return;
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
        const msg = `Promoted ${label} to Admin. Stored member password was automatically purged.`;
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
          onNotify?.({ tone: 'warning', tag: 'Account Deleted', message: msg });
        } else {
          const msg = `Revoked and disabled all access for ${label}.`;
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
            'This account will gain full Administrator power and its stored member password will be automatically purged so admin passwords remain strictly private.',
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
          badgeLabel: 'Delete Account',
          title: `Delete "${emailLabel}" permanently?`,
          message:
            'This revokes all permissions, terminates active sessions, unlinks any connected roster member, and deletes the user account from Team SPIRIT. Past club attendance history and submitted project ideas remain safely preserved.',
          confirmLabel: 'Delete Account',
        };
    }
  }

  const dialogMeta = getConfirmDialogMeta(pendingAction);
  const isAnyBusy = Boolean(busyUserId) || isSyncing || isCreatingMember;

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
              title="Sync registered accounts and member credentials from Supabase"
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
          {/* Quick Direct Actions: Create Member Account + Member Credentials Export & Reveal */}
          <div className="accounts-quick-toolbar">
            {onCreateAndLinkMemberAccount && (
              <button
                type="button"
                className={`btn-primary btn-compact-primary accounts-create-trigger ${
                  isCreateFormOpen ? 'is-active' : ''
                }`}
                aria-expanded={isCreateFormOpen}
                disabled={isAnyBusy}
                onClick={() => {
                  setIsCreateFormOpen((prev) => !prev);
                  setCreateFormError(null);
                }}
                title="Create an auto-verified login account for an existing member"
              >
                <PixelPlusIcon width={12} height={12} />
                <span>{isCreateFormOpen ? 'Close Form' : 'Create Member'}</span>
              </button>
            )}

            <div className="accounts-toolbar-right">
              {recordedMemberPasswordCount > 0 && (
                <button
                  type="button"
                  className={`btn-secondary btn-compact accounts-reveal-all-btn ${
                    revealAllPasswords ? 'is-active' : ''
                  }`}
                  onClick={handleToggleRevealAll}
                  title={
                    revealAllPasswords
                      ? 'Hide all member passwords'
                      : 'Reveal all recorded member passwords (admin passwords remain hidden)'
                  }
                >
                  {revealAllPasswords ? (
                    <PixelEyeOffIcon width={12} height={12} />
                  ) : (
                    <PixelEyeIcon width={12} height={12} />
                  )}
                  <span>{revealAllPasswords ? 'Hide' : 'Passwords'}</span>
                </button>
              )}

              <div className="export-menu-wrap" ref={exportMenuRef}>
                <button
                  type="button"
                  className={`btn-secondary btn-compact ${isExportMenuOpen ? 'is-active' : ''}`}
                  aria-expanded={isExportMenuOpen}
                  aria-haspopup="menu"
                  disabled={memberExportRows.length === 0}
                  onClick={() => setIsExportMenuOpen((prev) => !prev)}
                  title={
                    memberExportRows.length === 0
                      ? 'No member accounts available to export'
                      : 'Copy or download standard member login credentials (excludes admins)'
                  }
                >
                  <PixelDownloadIcon width={12} height={12} />
                  <span>Export</span>
                  <PixelChevronIcon width={10} height={10} className="export-chevron-icon" />
                </button>

                {isExportMenuOpen && (
                  <div
                    className="export-menu-dropdown export-menu-dropdown-right"
                    role="menu"
                    aria-label="Export member credentials"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      className="export-menu-item"
                      onClick={() => void handleCopyAllMemberCredentials()}
                    >
                      <PixelCopyIcon width={12} height={12} />
                      <span>Copy All Member Logins</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="export-menu-item"
                      onClick={handleExportCsv}
                    >
                      <PixelDownloadIcon width={12} height={12} />
                      <span>Download CSV (.csv)</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="export-menu-item"
                      onClick={handleExportText}
                    >
                      <PixelKeyIcon width={12} height={12} />
                      <span>Download TXT (.txt)</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Direct Inline Member Account Creation Drawer */}
          {isCreateFormOpen && onCreateAndLinkMemberAccount && (
            <section className="accounts-inline-create-card" aria-label="Create Member Account">
              <div className="accounts-inline-create-header">
                <span className="member-section-label member-account-heading">
                  <PixelKeyIcon width={12} height={12} />
                  <span>New Member Login</span>
                </span>
                <span className="member-account-status-pill is-linked">Auto-Verified</span>
              </div>

              {createFormError && (
                <div className="member-account-feedback is-error" role="alert">
                  <div className="member-account-feedback-row">
                    <PixelAlertIcon width={13} height={13} />
                    <span>{createFormError}</span>
                  </div>
                </div>
              )}

              <form
                className="member-account-form"
                onSubmit={(event) => void handleCreateMemberAccountSubmit(event)}
                noValidate
              >
                <div className="member-account-field">
                  <div className="member-account-label-row">
                    <label htmlFor={createMemberSelectId}>
                      Link to Member <span className="optional-mark">(Optional)</span>
                    </label>
                    {unlinkedMembers.length > 0 && (
                      <span className="accounts-optional-hint">
                        {unlinkedMembers.length} unlinked
                      </span>
                    )}
                  </div>
                  <select
                    id={createMemberSelectId}
                    className="form-control member-account-select"
                    value={selectedCreateMemberId}
                    disabled={isCreatingMember}
                    onChange={(event) => {
                      setSelectedCreateMemberId(event.target.value);
                      setHasEditedCreateEmail(false);
                      setCreateFormError(null);
                    }}
                  >
                    <option value="">No member profile (Standalone account)</option>
                    {membersForCreation.map((member) => {
                      const existing = linkedProfileByMemberId.get(member.id);
                      const classPart = member.className ? ` (${member.className})` : '';
                      const legacyPart = isLegacyMember(member) ? ' [Legacy]' : '';
                      const suffix = existing ? ' — Linked' : '';
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
                    <label htmlFor={createEmailInputId}>Login Email</label>
                    {hasEditedCreateEmail &&
                      suggestedCreateEmail &&
                      createEmail.trim().toLowerCase() !== suggestedCreateEmail && (
                        <button
                          type="button"
                          className="ring-reset-btn"
                          onClick={() => {
                            setCreateEmail(suggestedCreateEmail);
                            setHasEditedCreateEmail(false);
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
                    placeholder="member@teamspirit.club"
                    value={createEmail}
                    disabled={isCreatingMember}
                    onChange={(event) => {
                      setCreateEmail(event.target.value);
                      setHasEditedCreateEmail(true);
                      if (createFormError) setCreateFormError(null);
                    }}
                    required
                  />
                </div>

                <div className="member-account-field">
                  <div className="member-account-label-row">
                    <label htmlFor={createPasswordInputId}>Password</label>
                    <button
                      type="button"
                      className="ring-reset-btn"
                      disabled={isCreatingMember}
                      onClick={() => {
                        setCreatePassword(generateInitialPassword(10));
                        setShowCreatePassword(true);
                        setCreateFormError(null);
                      }}
                    >
                      Generate
                    </button>
                  </div>
                  <div className="member-account-password-wrap">
                    <input
                      id={createPasswordInputId}
                      type={showCreatePassword ? 'text' : 'password'}
                      className="form-control member-account-input"
                      placeholder="Min. 6 characters"
                      value={createPassword}
                      disabled={isCreatingMember}
                      autoComplete="new-password"
                      onChange={(event) => {
                        setCreatePassword(event.target.value);
                        if (createFormError) setCreateFormError(null);
                      }}
                      required
                    />
                    <button
                      type="button"
                      className="icon-btn member-account-eye-btn"
                      onClick={() => setShowCreatePassword((prev) => !prev)}
                      aria-label={showCreatePassword ? 'Hide password' : 'Show password'}
                      title={showCreatePassword ? 'Hide password' : 'Show password'}
                    >
                      {showCreatePassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                    </button>
                  </div>
                </div>

                {selectedCreateMember && onSyncMemberEmailToRoster && (
                  <label className="member-account-checkbox-row" htmlFor={saveRosterEmailId}>
                    <input
                      id={saveRosterEmailId}
                      type="checkbox"
                      className="selection-checkbox"
                      checked={saveEmailToRoster}
                      disabled={isCreatingMember}
                      onChange={(event) => setSaveEmailToRoster(event.target.checked)}
                    />
                    <span>Save email to member&apos;s roster profile</span>
                  </label>
                )}

                <div className="member-account-form-footer">
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    disabled={isCreatingMember}
                    onClick={() => {
                      setIsCreateFormOpen(false);
                      setCreateFormError(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary btn-compact-primary"
                    disabled={isCreatingMember}
                  >
                    <PixelLockIcon width={12} height={12} />
                    <span>
                      {isCreatingMember
                        ? 'Creating...'
                        : selectedCreateMember
                          ? 'Create & Link'
                          : 'Create Account'}
                    </span>
                  </button>
                </div>
              </form>
            </section>
          )}

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
                  ? 'Click Create Member above to add a member login, or click Sync to load existing accounts.'
                  : 'Try clearing your search query or switching the role filter.'}
              </span>
            </div>
          ) : (
            <ul className="accounts-list" aria-label="Registered user accounts">
              {filteredProfiles.map((profile) => {
                const isDisabled = Boolean(profile.isDisabled);
                const isTargetAdmin = !isDisabled && profile.role === 'admin';
                const isStandardMember = !isDisabled && profile.role === 'member';
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

                // Strictly only read passwords for standard 'member' accounts (NEVER for admins).
                const memberPassword = isStandardMember
                  ? memberCredentials[profile.userId] ?? null
                  : null;
                const isPasswordVisible =
                  isStandardMember &&
                  Boolean(memberPassword) &&
                  (revealAllPasswords || revealedPasswordIds.has(profile.userId));

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

                    {/* Member-Only Password Strip & Inline Reset (Strictly omitted for Admin accounts) */}
                    {isStandardMember ? (
                      <div className="accounts-credential-block">
                        <div className="accounts-credential-strip" aria-label="Member login password">
                          <div className="accounts-credential-value-wrap">
                            <span className="accounts-credential-label">
                              <PixelKeyIcon width={10} height={10} />
                              <span>PWD</span>
                            </span>
                            {memberPassword ? (
                              <code
                                className={`accounts-credential-code ${
                                  isPasswordVisible ? 'is-visible' : 'is-masked'
                                }`}
                              >
                                {isPasswordVisible ? memberPassword : '••••••••••'}
                              </code>
                            ) : (
                              <span className="accounts-credential-missing">Not recorded</span>
                            )}
                          </div>

                          <div className="accounts-credential-actions">
                            {memberPassword && (
                              <>
                                <button
                                  type="button"
                                  className="icon-btn accounts-cred-btn"
                                  onClick={() => toggleCardPasswordVisibility(profile.userId)}
                                  aria-label={isPasswordVisible ? 'Hide password' : 'Show password'}
                                  title={isPasswordVisible ? 'Hide password' : 'Show password'}
                                >
                                  {isPasswordVisible ? (
                                    <PixelEyeOffIcon width={12} height={12} />
                                  ) : (
                                    <PixelEyeIcon width={12} height={12} />
                                  )}
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn accounts-cred-btn"
                                  onClick={() =>
                                    void handleCopySinglePassword(
                                      profile.userId,
                                      memberPassword,
                                      linkedMember?.name || profile.email,
                                    )
                                  }
                                  aria-label={`Copy password for ${profile.email}`}
                                  title="Copy password"
                                >
                                  {copiedPasswordUserId === profile.userId ? (
                                    <PixelCheckIcon width={12} height={12} />
                                  ) : (
                                    <PixelCopyIcon width={12} height={12} />
                                  )}
                                </button>
                              </>
                            )}

                            {onResetMemberPassword && (
                              <button
                                type="button"
                                className={`btn-secondary btn-compact accounts-reset-trigger-btn ${
                                  resettingUserId === profile.userId ? 'is-active' : ''
                                }`}
                                disabled={isAnyBusy}
                                onClick={() => handleToggleResetPasswordForm(profile)}
                                title={`Reset or change password for member ${profile.email}`}
                              >
                                <span>{resettingUserId === profile.userId ? 'Close' : 'Reset'}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {resettingUserId === profile.userId && onResetMemberPassword && (
                          <form
                            className="accounts-reset-form"
                            onSubmit={(event) =>
                              void handleResetMemberPasswordSubmit(event, profile)
                            }
                            noValidate
                          >
                            <div className="accounts-reset-top">
                              <span className="accounts-reset-label">Set New Member Password</span>
                              <button
                                type="button"
                                className="ring-reset-btn"
                                disabled={isRowBusy}
                                onClick={() => {
                                  setResetPasswordValue(generateInitialPassword(10));
                                  setShowResetPassword(true);
                                  setResetFormError(null);
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
                                disabled={isRowBusy}
                                autoComplete="new-password"
                                onChange={(event) => {
                                  setResetPasswordValue(event.target.value);
                                  if (resetFormError) setResetFormError(null);
                                }}
                                required
                              />
                              <button
                                type="button"
                                className="icon-btn member-account-eye-btn"
                                onClick={() => setShowResetPassword((prev) => !prev)}
                                aria-label={showResetPassword ? 'Hide new password' : 'Show new password'}
                                title={showResetPassword ? 'Hide new password' : 'Show new password'}
                              >
                                {showResetPassword ? <PixelEyeOffIcon /> : <PixelEyeIcon />}
                              </button>
                            </div>

                            {resetFormError && (
                              <div className="accounts-reset-error" role="alert">
                                {resetFormError}
                              </div>
                            )}

                            <div className="accounts-reset-actions">
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                disabled={isRowBusy}
                                onClick={() => handleToggleResetPasswordForm(profile)}
                              >
                                Cancel
                              </button>
                              <button
                                type="submit"
                                className="btn-primary btn-compact-primary"
                                disabled={isRowBusy || resetPasswordValue.length < 6}
                              >
                                <span>{isRowBusy ? 'Saving...' : 'Save Password'}</span>
                              </button>
                            </div>
                          </form>
                        )}
                      </div>
                    ) : isTargetAdmin ? (
                      <div className="accounts-credential-strip is-private">
                        <span className="accounts-credential-private-note">
                          <PixelLockIcon width={10} height={10} />
                          <span>Admin password private (cannot view or reset)</span>
                        </span>
                      </div>
                    ) : null}

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
                        aria-label={`Delete account ${profile.email}`}
                        title={
                          isSelf
                            ? 'You cannot delete your own signed-in account'
                            : isLastActiveAdmin
                              ? 'Cannot delete the last remaining Admin'
                              : `Delete account ${profile.email}`
                        }
                        onClick={() => setPendingAction({ type: 'remove', profile })}
                      >
                        <PixelTrashIcon width={12} height={12} />
                        <span>Delete</span>
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
