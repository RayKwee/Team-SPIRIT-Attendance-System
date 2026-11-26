import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { AccountsLeftPanel } from './components/AccountsLeftPanel';
import { AttendanceLeaderboard } from './components/AttendanceLeaderboard';
import { AttendanceToolsSection } from './components/AttendanceToolsSection';
import { AttendanceWorkspace } from './components/AttendanceWorkspace';
import { CloudSyncModal, type AuthModalMode } from './components/CloudSyncModal';
import { CreateSessionModal } from './components/CreateSessionModal';
import { Header } from './components/Header';
import { LandingScreen } from './components/LandingScreen';
import { LoungeWorkspace } from './components/LoungeWorkspace';
import { MeetingSettingsModal } from './components/MeetingSettingsModal';
import { MemberManagerSidebar } from './components/MemberManagerSidebar';
import { Preloader } from './components/Preloader';
import { ProjectIdeasWorkspace } from './components/ProjectIdeasWorkspace';
import { SessionCalendarWorkspace } from './components/SessionCalendarWorkspace';
import { SessionHub } from './components/SessionHub';
import { SettingsModal } from './components/SettingsModal';
import { StatsStrip } from './components/StatsStrip';
import { SyncConflictModal } from './components/SyncConflictModal';
import { ToastContainer, type ToastItem, type ToastTone } from './components/ToastContainer';
import { TutorialOverlay } from './components/TutorialOverlay';
import { useAdminRole } from './hooks/useAdminRole';
import { useClubPosts } from './hooks/useClubPosts';
import { useSupabaseAuth } from './hooks/useSupabaseAuth';
import { useSyncedAttendanceData } from './hooks/useSyncedAttendanceData';
import { syncMyMemberCredential } from './lib/adminApi';
import type {
  AccessScope,
  AttendanceSession,
  AttendanceStatus,
  CalendarViewMode,
  ClassLetter,
  ClassYear,
  ClubMember,
  MemberProfileInput,
  NewSessionInput,
  SessionUpdateInput,
  SyncStatus,
  UserPreferences,
} from './types/attendance';
import type { TutorialStepConfig, TutorialStorageState } from './types/tutorial';
import { canUserDeleteContent } from './types/projectIdeas';
import {
  MEETING_VISIBILITY_LABELS,
  generateId,
  getSessionAssignedMembers,
  isLegacyMember,
  normalizeMeetingVisibility,
  sortSessionsNewestFirst,
  type AnnualProgressionSummary,
} from './utils/attendance';
import { getCurrentPeriodLabel, toIsoDateString } from './utils/date';
import { usePreloaderPhase } from './utils/preloader';
import { isAttendancePage, useAppRoute, type AppPage } from './utils/router';
import {
  DEFAULT_PREFERENCES,
  PREFS_STORAGE_KEY,
  buildWorkspaceBackupPayload,
  loadPreferences,
  parseWorkspaceBackupPayload,
  savePreferences,
} from './utils/storage';
import {
  TUTORIAL_STEPS,
  TUTORIAL_STORAGE_KEY,
  buildTutorialDemoWorkspace,
  loadTutorialState,
  saveTutorialState,
} from './utils/tutorial';

/**
 * Unified Team SPIRIT SPA shell.
 * Opens immediately in local-only mode without login barriers, with an optional
 * header Cloud Sync toggle to connect/disconnect Supabase persistence across devices.
 */
export function App() {
  const memberSidebarId = useId();
  const accountsPanelId = useId();
  const [activePage, navigateTo] = useAppRoute();
  const { authStatus, user, signIn, signUpAdmin, signOut, changePassword } = useSupabaseAuth();
  const isCloudConnected = authStatus === 'authenticated' && Boolean(user?.id);
  const {
    userRole,
    isAdmin,
    isAccountDisabled,
    linkedMemberId,
    canViewAllAttendance,
    isRoleLoading,
    roleError,
    profiles: adminProfiles,
    memberCredentials,
    isProfilesLoading,
    profilesError,
    refreshRoleAndProfiles,
    syncAdminProfiles,
    updateUserAdminRole,
    linkUserToMember,
    createAndLinkMemberAccount,
    resetMemberPassword,
    syncAndLinkMemberAccount,
    updateUserVisibilityScope,
    setAccountDisabled,
    removeAccount,
  } = useAdminRole(isCloudConnected ? (user?.id ?? null) : null);
  const canManageClubRecords = !isCloudConnected || isAdmin;
  const isReadOnlyCloud = isCloudConnected && !isAdmin;
  const isAuthResolving = isCloudConnected && (isRoleLoading || userRole === null);
  const {
    posts: clubPosts,
    comments: clubPostComments,
    permissions: memberVisibilityPermissions,
    contentDeletionMode,
    sharedIdeaVisibility,
    isPostsLoading,
    postsError,
    isLiveConnected: isPostsLiveConnected,
    isPublishing: isPublishingPost,
    isUpdatingVisibility: isUpdatingSharedIdeaVisibility,
    isUpdatingDeletionMode: isUpdatingContentDeletionMode,
    refreshPostsAndSettings,
    publishPost: publishClubPost,
    editPost: editClubPost,
    togglePinPost: togglePinClubPost,
    removePost: removeClubPost,
    addComment: addClubPostComment,
    removeComment: removeClubPostComment,
    setSharedIdeaVisibility,
    setContentDeletionMode,
    updatePermissions: updateMemberVisibilityPermissions,
  } = useClubPosts();

  const hasBroadPerUser = isAdmin || canViewAllAttendance;
  const canBrowseFullRoster =
    !isCloudConnected || hasBroadPerUser || memberVisibilityPermissions.memberCanViewRoster;
  const canViewAttendanceRates =
    !isCloudConnected ||
    hasBroadPerUser ||
    memberVisibilityPermissions.memberCanViewAttendanceRates;
  const canViewCalendarDetails =
    !isCloudConnected ||
    hasBroadPerUser ||
    memberVisibilityPermissions.memberCanViewCalendarDetails;

  const accessScope: AccessScope = !isCloudConnected
    ? 'local'
    : isAdmin
      ? 'admin'
      : canViewAllAttendance
        ? 'broad_viewer'
        : linkedMemberId
          ? 'member_self'
          : 'member_unlinked';
  const scopeVersionKey = `${userRole ?? 'none'}:${linkedMemberId ?? 'none'}:${String(canViewAllAttendance)}:${String(memberVisibilityPermissions.memberCanViewRoster)}:${String(memberVisibilityPermissions.memberCanViewAttendanceRates)}:${String(memberVisibilityPermissions.memberCanViewCalendarDetails)}`;

  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => toIsoDateString(new Date()));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [duplicateSourceSession, setDuplicateSourceSession] =
    useState<AttendanceSession | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [openSettingsToPassword, setOpenSettingsToPassword] = useState(false);
  const [isAccountsPanelOpen, setIsAccountsPanelOpen] = useState(false);
  const [isCloudSyncModalOpen, setIsCloudSyncModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>('login');
  const [isConflictModalOpen, setIsConflictModalOpen] = useState(false);
  const [tutorialState, setTutorialState] = useState<TutorialStorageState>(() =>
    loadTutorialState(),
  );
  const [isTutorialActive, setIsTutorialActive] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const hasAutoTriggeredTutorialRef = useRef(false);
  const lastAppliedTutorialStepIdRef = useRef<string | null>(null);
  const tutorialSnapshotRef = useRef<{
    activePage: AppPage;
    activeSessionId: string | null;
    isMemberSidebarOpen: boolean;
    selectedMemberId: string | null;
    calendarViewMode: CalendarViewMode;
  } | null>(null);

  const pushToast = useCallback(
    (options: { tone: ToastTone; tag: string; message: string; undoToken?: string | null }) => {
      const id = generateId('toast');
      setToasts((prev) => [
        ...prev.slice(-2),
        {
          id,
          tone: options.tone,
          tag: options.tag,
          message: options.message,
          undoToken: options.undoToken ?? undefined,
        },
      ]);
    },
    [],
  );

  const handleAnnualProgression = useCallback(
    (summary: AnnualProgressionSummary) => {
      const parts: string[] = [];
      if (summary.promotedCount > 0) {
        parts.push(
          `${summary.promotedCount} ${summary.promotedCount === 1 ? 'student' : 'students'} advanced`,
        );
      }
      if (summary.graduatedCount > 0) {
        parts.push(
          `${summary.graduatedCount} Year 11 ${
            summary.graduatedCount === 1 ? 'member' : 'members'
          } graduated to Legacy`,
        );
      }
      if (parts.length === 0) return;

      pushToast({
        tone: 'info',
        tag: `Sep 1 (${summary.cycleYear})`,
        message: `Annual progression complete: ${parts.join(', ')}.`,
      });
    },
    [pushToast],
  );

  const {
    members,
    sessions,
    syncStatus,
    realtimeStatus,
    syncError,
    pendingCount,
    conflicts,
    conflictCount,
    isEditingActive,
    beginFieldEdit,
    endFieldEdit,
    resolveConflict,
    resolveAllConflicts,
    createSession,
    updateSession,
    deleteSession,
    addMember,
    addMembersBulk,
    updateMember,
    updateMembersClass,
    setMemberLegacyStatus,
    setMembersLegacyStatus,
    deleteMembers,
    assignMemberToSession,
    assignMembersToSession,
    removeMemberFromSession,
    toggleAttendanceStatus,
    setAbsenceReason,
    resetSessionMarks,
    importBackupData,
    getLastUndoToken,
    undoByToken,
    flushPendingChanges,
    prepareForSignOut,
    setMergeLocalOnNextConnect,
  } = useSyncedAttendanceData(isCloudConnected ? user?.id ?? null : null, {
    onAnnualProgression: handleAnnualProgression,
    isReadOnlyCloud,
    isAuthResolving,
    scopeVersionKey,
  });

  const linkedMember = useMemo(
    () => (linkedMemberId ? members.find((member) => member.id === linkedMemberId) ?? null : null),
    [linkedMemberId, members],
  );

  // Enforce member-linking privacy boundaries and clear stale active/editing session IDs.
  useEffect(() => {
    if (activeSessionId !== null && !sessions.some((session) => session.id === activeSessionId)) {
      setActiveSessionId(null);
    }
    if (
      editingSessionId !== null &&
      (!canManageClubRecords || !sessions.some((session) => session.id === editingSessionId))
    ) {
      setEditingSessionId(null);
    }

    if (
      accessScope === 'member_unlinked' &&
      !canViewCalendarDetails &&
      !canViewAttendanceRates
    ) {
      if (!canBrowseFullRoster && preferences.selectedMemberId !== null) {
        setPreferences((prev) => ({ ...prev, selectedMemberId: null }));
      }
      return;
    }

    if (accessScope === 'member_self' && !canBrowseFullRoster) {
      if (linkedMemberId && preferences.selectedMemberId !== linkedMemberId) {
        setPreferences((prev) => ({ ...prev, selectedMemberId: linkedMemberId }));
      }
    }
  }, [
    accessScope,
    activeSessionId,
    canBrowseFullRoster,
    canManageClubRecords,
    canViewAttendanceRates,
    canViewCalendarDetails,
    editingSessionId,
    linkedMemberId,
    preferences.selectedMemberId,
    sessions,
  ]);

  const prevSyncStatusRef = useRef<SyncStatus>(syncStatus);
  const prevConflictCountRef = useRef<number>(conflictCount);
  const handledDisabledUserRef = useRef<string | null>(null);

  // Immediately close the Admin Accounts panel if the user signs out or loses Admin privileges.
  useEffect(() => {
    if (!isCloudConnected || !isAdmin) {
      setIsAccountsPanelOpen(false);
    }
  }, [isAdmin, isCloudConnected]);

  // Immediately revoke & sign out any session whose account has been disabled by an Admin.
  useEffect(() => {
    if (!isCloudConnected || !user?.id) {
      handledDisabledUserRef.current = null;
      return;
    }
    if (!isAccountDisabled) return;
    if (handledDisabledUserRef.current === user.id) return;
    handledDisabledUserRef.current = user.id;

    setIsAccountsPanelOpen(false);
    setIsSettingsModalOpen(false);
    setIsCreateModalOpen(false);
    setEditingSessionId(null);
    setIsConflictModalOpen(false);
    setActiveSessionId(null);

    void (async () => {
      await prepareForSignOut();
      await signOut();
      pushToast({
        tone: 'error',
        tag: 'Access Revoked',
        message: 'Your Team SPIRIT account access has been disabled or removed by an administrator.',
      });
    })();
  }, [isAccountDisabled, isCloudConnected, prepareForSignOut, pushToast, signOut, user?.id]);
  const {
    preloaderPhase,
    containerRevealClass,
    handlePreloaderBeginExit,
    handlePreloaderComplete,
  } = usePreloaderPhase({ skip: activePage === 'landing' });

  const handleDismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleUndoToast = useCallback(
    (id: string, undoToken: string) => {
      handleDismissToast(id);
      const restored = undoByToken(undoToken);
      if (restored) {
        pushToast({
          tone: 'info',
          tag: 'Undo',
          message: 'Change reverted.',
        });
      }
    },
    [handleDismissToast, pushToast, undoByToken],
  );

  // Surface concise notifications when cloud sync connects, recovers from error, or fails.
  useEffect(() => {
    const prev = prevSyncStatusRef.current;
    prevSyncStatusRef.current = syncStatus;
    if (!isCloudConnected) return;

    if ((prev === 'loading' || prev === 'error') && syncStatus === 'synced') {
      pushToast({
        tone: 'success',
        tag: 'Cloud Sync',
        message: user?.email
          ? `Synced with Supabase (${user.email}).`
          : 'All records synced with Supabase.',
      });
    } else if (prev !== 'error' && syncStatus === 'error' && syncError) {
      pushToast({
        tone: 'error',
        tag: 'Sync Issue',
        message: syncError,
      });
    }
  }, [isCloudConnected, pushToast, syncError, syncStatus, user?.email]);

  useEffect(() => {
    const prevCount = prevConflictCountRef.current;
    prevConflictCountRef.current = conflictCount;
    if (!isCloudConnected) return;

    if (conflictCount > prevCount) {
      pushToast({
        tone: 'warning',
        tag: 'Sync Conflict',
        message: `${conflictCount} concurrent ${
          conflictCount === 1 ? 'conflict needs' : 'conflicts need'
        } review. Click Conflict (${conflictCount}) in the header to resolve.`,
      });
    } else if (conflictCount === 0 && prevCount > 0) {
      setIsConflictModalOpen(false);
    }
  }, [conflictCount, isCloudConnected, pushToast]);

  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;
  const editingSession = editingSessionId
    ? sessions.find((session) => session.id === editingSessionId) ?? null
    : null;

  // Persist workspace UI preferences locally and sync theme/density attributes on root.
  useEffect(() => {
    savePreferences(preferences);
    document.documentElement.dataset.accent = preferences.themeAccent;
    document.documentElement.dataset.density = preferences.rosterDensity;
  }, [preferences]);

  // Keep UI preferences and tutorial state synchronized across open tabs.
  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key === PREFS_STORAGE_KEY) {
        setPreferences(loadPreferences());
      } else if (event.key === TUTORIAL_STORAGE_KEY) {
        setTutorialState(loadTutorialState());
      }
    }

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  function handleCreateSession(
    input: NewSessionInput,
    options?: { includeSourceMembers?: boolean },
  ) {
    if (!canManageClubRecords) {
      notifyAdminRequired('record sessions');
      return;
    }
    const wasDuplicate = Boolean(duplicateSourceSession);
    const initialMemberIds =
      duplicateSourceSession && options?.includeSourceMembers
        ? getSessionAssignedMembers(duplicateSourceSession, members)
            .filter((member) => !isLegacyMember(member))
            .map((member) => member.id)
        : undefined;

    const newSession = createSession(input, {
      initialMemberIds,
      defaultStatus: preferences.defaultAssignmentStatus,
    });
    const undoToken = getLastUndoToken();
    setDuplicateSourceSession(null);
    setSelectedDateKey(newSession.date);
    if (activePage === 'tracker') {
      setActiveSessionId(newSession.id);
      setPreferences((prev) => ({
        ...prev,
        statusFilters: [],
        searchQuery: '',
      }));
    }
    pushToast({
      tone: 'success',
      tag: wasDuplicate ? 'Duplicated' : 'Session Created',
      message: wasDuplicate
        ? `Cloned "${newSession.name}" for ${newSession.date}.`
        : `Created session "${newSession.name}".`,
      undoToken,
    });
  }

  function handleOpenCreateSessionModal() {
    if (!canManageClubRecords) {
      notifyAdminRequired('record sessions');
      return;
    }
    setDuplicateSourceSession(null);
    setIsCreateModalOpen(true);
  }

  function handleOpenEditSession(session: AttendanceSession) {
    if (!canManageClubRecords) {
      notifyAdminRequired('edit meeting settings');
      return;
    }
    setEditingSessionId(session.id);
  }

  function handleUpdateSession(sessionId: string, input: SessionUpdateInput) {
    if (!canManageClubRecords) {
      notifyAdminRequired('edit meeting settings');
      return;
    }
    const previousSession = sessions.find((session) => session.id === sessionId);
    const updated = updateSession(sessionId, {
      ...input,
      visibility: isCloudConnected && isAdmin ? input.visibility : undefined,
    });
    if (!updated) return;

    const undoToken = getLastUndoToken();
    if (activePage === 'calendar' && previousSession && previousSession.date !== updated.date) {
      setSelectedDateKey(updated.date);
    }

    const prevVis = normalizeMeetingVisibility(previousSession?.visibility);
    const nextVis = normalizeMeetingVisibility(updated.visibility);
    const visibilityNote =
      isCloudConnected && isAdmin && prevVis !== nextVis
        ? ` Visibility set to ${MEETING_VISIBILITY_LABELS[nextVis]}.`
        : '';

    pushToast({
      tone: 'success',
      tag: 'Meeting Updated',
      message: `Saved updates to "${updated.name}".${visibilityNote}`,
      undoToken,
    });
  }

  function handleDuplicateSession(session: AttendanceSession) {
    if (!canManageClubRecords) {
      notifyAdminRequired('duplicate sessions');
      return;
    }
    setDuplicateSourceSession(session);
    setIsCreateModalOpen(true);
  }

  function handleSelectSession(sessionId: string) {
    if (!sessions.some((session) => session.id === sessionId)) {
      return;
    }
    setActiveSessionId(sessionId);
    setPreferences((prev) => ({
      ...prev,
      statusFilters: [],
      searchQuery: '',
    }));
  }

  function handleBackToSessionHub() {
    setActiveSessionId(null);
  }

  function notifyAdminRequired(actionLabel: string) {
    pushToast({
      tone: 'warning',
      tag: 'Admin Only',
      message: `Administrator privileges are required to ${actionLabel} in Cloud Sync mode.`,
    });
  }

  function handleDeleteSession(sessionId: string) {
    if (!canManageClubRecords) {
      notifyAdminRequired('delete synced sessions');
      return;
    }
    const targetSession = sessions.find((session) => session.id === sessionId);
    deleteSession(sessionId);
    const undoToken = getLastUndoToken();
    setActiveSessionId((current) => (current === sessionId ? null : current));
    pushToast({
      tone: 'warning',
      tag: 'Deleted',
      message: targetSession
        ? `Deleted session "${targetSession.name}".`
        : 'Session deleted.',
      undoToken,
    });
  }

  function handleAddMember(input: string | MemberProfileInput): ClubMember {
    const created = addMember(input);
    if (!canManageClubRecords) {
      notifyAdminRequired('add club members');
      return created;
    }
    const undoToken = getLastUndoToken();
    pushToast({
      tone: 'success',
      tag: 'Member Added',
      message: `Added "${created.name}" to Member Manager.`,
      undoToken,
    });
    return created;
  }

  function handleAddMembersBulk(inputs: MemberProfileInput[]): ClubMember[] {
    if (!canManageClubRecords) {
      notifyAdminRequired('add club members');
      return [];
    }
    if (inputs.length === 0) return [];
    const created = addMembersBulk(inputs);
    const undoToken = getLastUndoToken();
    const classLabel = created[0]?.className;
    const allShareSameClass =
      Boolean(classLabel) && created.every((member) => member.className === classLabel);

    pushToast({
      tone: 'success',
      tag: 'Bulk Added',
      message: allShareSameClass
        ? `Added ${created.length} ${created.length === 1 ? 'member' : 'members'} to ${classLabel}.`
        : `Added ${created.length} ${created.length === 1 ? 'member' : 'members'} to Member Manager.`,
      undoToken,
    });
    return created;
  }

  function handleUpdateMember(memberId: string, input: MemberProfileInput) {
    if (!canManageClubRecords) {
      notifyAdminRequired('edit member profiles');
      return;
    }
    updateMember(memberId, input);
    const undoToken = getLastUndoToken();
    pushToast({
      tone: 'success',
      tag: 'Updated',
      message: `Saved profile updates for "${input.name.trim()}".`,
      undoToken,
    });
  }

  function handleUpdateMembersClass(
    memberIds: string[],
    patch: { classYear?: ClassYear; classLetter?: ClassLetter },
  ) {
    if (!canManageClubRecords) {
      notifyAdminRequired('bulk-update student classes');
      return;
    }
    const updatedCount = updateMembersClass(memberIds, patch);
    if (updatedCount === 0) return;
    const undoToken = getLastUndoToken();
    const isNaUpdate = patch.classLetter === 'N/A';
    const labelParts: string[] = [];
    if (isNaUpdate) {
      labelParts.push('Class N/A');
    } else {
      if (patch.classYear) labelParts.push(`Year ${patch.classYear}`);
      if (patch.classLetter) labelParts.push(`Class ${patch.classLetter}`);
    }
    const unit = isNaUpdate
      ? updatedCount === 1
        ? 'member'
        : 'members'
      : updatedCount === 1
        ? 'student'
        : 'students';
    pushToast({
      tone: 'success',
      tag: 'Class Updated',
      message: `Updated ${labelParts.join(' ')} for ${updatedCount} ${unit}.`,
      undoToken,
    });
  }

  function handleSetMemberLegacyStatus(memberId: string, isLegacy: boolean) {
    if (!canManageClubRecords) {
      notifyAdminRequired('archive or restore club members');
      return;
    }
    const targetMember = members.find((member) => member.id === memberId);
    setMemberLegacyStatus(memberId, isLegacy);
    const undoToken = getLastUndoToken();
    pushToast({
      tone: isLegacy ? 'warning' : 'success',
      tag: isLegacy ? 'Moved to Legacy' : 'Restored',
      message: targetMember
        ? isLegacy
          ? `Moved "${targetMember.name}" to Legacy / Retired (stats preserved).`
          : `Restored "${targetMember.name}" to the Active Roster.`
        : isLegacy
          ? 'Moved member to Legacy / Retired.'
          : 'Restored member to Active Roster.',
      undoToken,
    });
  }

  function handleSetMembersLegacyStatus(
    memberIds: string[],
    isLegacy: boolean,
    options?: { fallbackClassYear?: ClassYear; fallbackClassLetter?: ClassLetter },
  ) {
    if (!canManageClubRecords) {
      notifyAdminRequired('bulk-archive or restore club members');
      return;
    }
    const updatedCount = setMembersLegacyStatus(memberIds, isLegacy, options);
    if (updatedCount === 0) return;
    const undoToken = getLastUndoToken();
    pushToast({
      tone: isLegacy ? 'warning' : 'success',
      tag: isLegacy ? 'Moved to Legacy' : 'Restored',
      message: isLegacy
        ? `Moved ${updatedCount} ${updatedCount === 1 ? 'member' : 'members'} to Legacy / Retired (stats preserved).`
        : `Restored ${updatedCount} ${updatedCount === 1 ? 'member' : 'members'} to the Active Roster.`,
      undoToken,
    });
  }

  function handleAssignMemberToSession(memberId: string) {
    if (!canManageClubRecords) {
      notifyAdminRequired('assign members to sessions');
      return;
    }
    if (!activeSession) return;
    assignMemberToSession(activeSession.id, memberId, preferences.defaultAssignmentStatus);
  }

  function handleAssignMembersToSession(memberIds: string[]) {
    if (!canManageClubRecords) {
      notifyAdminRequired('assign members to sessions');
      return;
    }
    if (!activeSession || memberIds.length === 0) return;
    const assignedSet = new Set(activeSession.memberIds);
    const addedCount = memberIds.filter((id) => !assignedSet.has(id)).length;
    assignMembersToSession(activeSession.id, memberIds, preferences.defaultAssignmentStatus);
    const undoToken = getLastUndoToken();
    if (addedCount > 0) {
      pushToast({
        tone: 'success',
        tag: 'Roster Updated',
        message: `Added ${addedCount} ${addedCount === 1 ? 'member' : 'members'} to "${activeSession.name}".`,
        undoToken,
      });
    }
  }

  function handleRemoveMemberFromSession(memberId: string) {
    if (!canManageClubRecords) {
      notifyAdminRequired('remove members from sessions');
      return;
    }
    if (!activeSession) return;
    const targetMember = members.find((member) => member.id === memberId);
    removeMemberFromSession(activeSession.id, memberId);
    const undoToken = getLastUndoToken();
    pushToast({
      tone: 'warning',
      tag: 'Removed',
      message: targetMember
        ? `Removed "${targetMember.name}" from this session.`
        : 'Removed member from session.',
      undoToken,
    });
  }

  function handleDeleteMembers(memberIds: string[]) {
    if (!canManageClubRecords) {
      notifyAdminRequired('delete club members');
      return;
    }
    if (memberIds.length === 0) return;
    const idsToDelete = new Set(memberIds);
    const firstDeleted =
      memberIds.length === 1 ? members.find((member) => member.id === memberIds[0]) : undefined;
    deleteMembers(memberIds);
    const undoToken = getLastUndoToken();
    if (preferences.selectedMemberId && idsToDelete.has(preferences.selectedMemberId)) {
      setPreferences((prev) => ({
        ...prev,
        selectedMemberId: null,
      }));
    }
    pushToast({
      tone: 'warning',
      tag: 'Deleted',
      message: firstDeleted
        ? `Deleted "${firstDeleted.name}" from Member Manager.`
        : `Deleted ${memberIds.length} members from Member Manager.`,
      undoToken,
    });
  }

  function handleToggleAccountsPanel() {
    if (!isCloudConnected || !isAdmin) return;
    setIsAccountsPanelOpen((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined' && window.innerWidth < 1440) {
        setPreferences((current) =>
          current.isMemberSidebarOpen ? { ...current, isMemberSidebarOpen: false } : current,
        );
      }
      return next;
    });
  }

  function handleToggleMemberSidebar() {
    setPreferences((prev) => {
      const nextOpen = !prev.isMemberSidebarOpen;
      if (nextOpen && typeof window !== 'undefined' && window.innerWidth < 1440) {
        setIsAccountsPanelOpen(false);
      }
      return {
        ...prev,
        isMemberSidebarOpen: nextOpen,
      };
    });
  }

  function handleOpenMemberProfile(memberId: string) {
    if (typeof window !== 'undefined' && window.innerWidth < 1440) {
      setIsAccountsPanelOpen(false);
    }
    if (!canBrowseFullRoster && accessScope === 'member_unlinked') {
      setPreferences((prev) => ({
        ...prev,
        selectedMemberId: null,
        isMemberSidebarOpen: true,
      }));
      return;
    }
    const targetMemberId =
      !canBrowseFullRoster && accessScope === 'member_self' && linkedMemberId
        ? linkedMemberId
        : memberId;
    setPreferences((prev) => ({
      ...prev,
      selectedMemberId: targetMemberId,
      isMemberSidebarOpen: true,
    }));
  }

  function handleToggleAttendanceStatus(
    memberId: string,
    targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
  ) {
    if (!canManageClubRecords) {
      notifyAdminRequired('mark attendance');
      return;
    }
    if (!activeSession) return;
    toggleAttendanceStatus(activeSession.id, memberId, targetStatus);
  }

  function handleSetAbsenceReason(memberId: string, reason: string) {
    if (!canManageClubRecords) {
      notifyAdminRequired('edit absence reasons');
      return;
    }
    if (!activeSession) return;
    setAbsenceReason(activeSession.id, memberId, reason);
  }

  function handleResetSessionMarks() {
    if (!canManageClubRecords) {
      notifyAdminRequired('reset all session marks');
      return;
    }
    if (!activeSession) return;
    resetSessionMarks(activeSession.id);
    const undoToken = getLastUndoToken();
    if (undoToken) {
      pushToast({
        tone: 'warning',
        tag: 'Marks Reset',
        message: `Reset all attendance marks in "${activeSession.name}" to Unmarked.`,
        undoToken,
      });
    }
  }

  function handleUpdatePreferences(patch: Partial<UserPreferences>) {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }

  function handleResetPreferences() {
    setPreferences((prev) => ({
      ...DEFAULT_PREFERENCES,
      activeSessionId: prev.activeSessionId,
      selectedMemberId: prev.selectedMemberId,
      isMemberSidebarOpen: prev.isMemberSidebarOpen,
    }));
  }

  function handleExportBackup() {
    const payload = buildWorkspaceBackupPayload(
      members,
      sessions,
      preferences,
      isCloudConnected ? 'cloud' : 'local',
    );
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const dateStamp = toIsoDateString(new Date());
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `team-spirit-backup-${dateStamp}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    pushToast({
      tone: 'info',
      tag: 'Backup Exported',
      message: `Saved JSON snapshot (${members.length} members, ${sessions.length} sessions).`,
    });
  }

  async function handleImportBackupFile(
    file: File,
  ): Promise<{ importedMembers: number; importedSessions: number }> {
    if (!canManageClubRecords) {
      throw new Error(
        'Administrator privileges are required to import backup snapshots into Cloud Sync.',
      );
    }
    const text = await file.text();
    const parsed = parseWorkspaceBackupPayload(text);
    const counts = importBackupData(parsed.members, parsed.sessions);
    const undoToken = getLastUndoToken();
    if (Object.keys(parsed.preferencesPatch).length > 0) {
      setPreferences((prev) => ({ ...prev, ...parsed.preferencesPatch }));
    }
    pushToast({
      tone: 'success',
      tag: 'Backup Restored',
      message: `Merged ${counts.importedMembers} ${counts.importedMembers === 1 ? 'member' : 'members'} and ${counts.importedSessions} ${counts.importedSessions === 1 ? 'session' : 'sessions'}.`,
      undoToken,
    });
    return counts;
  }

  function handleNavigate(page: AppPage) {
    if (page === 'landing') {
      setIsTutorialActive(false);
      setIsAccountsPanelOpen(false);
    }
    if (!isAttendancePage(page)) {
      setIsAccountsPanelOpen(false);
      setPreferences((prev) =>
        prev.isMemberSidebarOpen ? { ...prev, isMemberSidebarOpen: false } : prev,
      );
    }
    if (page === 'tracker') {
      setActiveSessionId(null);
    }
    if (page !== activePage) {
      navigateTo(page);
    }
  }

  function handleOpenSessionInTracker(sessionId: string) {
    if (!sessions.some((session) => session.id === sessionId)) {
      navigateTo('tracker');
      return;
    }
    setActiveSessionId(sessionId);
    setPreferences((prev) => ({
      ...prev,
      statusFilters: [],
      searchQuery: '',
    }));
    navigateTo('tracker');
  }

  function handleOpenAuthModal(mode: AuthModalMode) {
    setAuthModalMode(mode);
    setIsCloudSyncModalOpen(true);
  }

  async function handleConnectCloudSync(
    email: string,
    password: string,
    mergeLocalRecords: boolean,
  ) {
    setMergeLocalOnNextConnect(mergeLocalRecords);
    const result = await signIn(email, password);
    if (result.error) {
      setMergeLocalOnNextConnect(false);
    } else if (activePage === 'landing') {
      navigateTo('lounge');
    }
    return result;
  }

  async function handleRegisterAdminAccount(
    email: string,
    password: string,
    mergeLocalRecords: boolean,
  ) {
    setMergeLocalOnNextConnect(mergeLocalRecords);
    const result = await signUpAdmin(email, password);
    if (result.error) {
      setMergeLocalOnNextConnect(false);
    } else {
      pushToast({
        tone: 'success',
        tag: 'Admin Account Ready',
        message: `Created and verified admin account (${email.trim().toLowerCase()}).`,
      });
      if (activePage === 'landing') {
        navigateTo('lounge');
      }
    }
    return result;
  }

  async function handleChangePassword(currentPassword: string, newPassword: string) {
    const result = await changePassword(currentPassword, newPassword);
    if (!result.error) {
      if (!isAdmin) {
        void syncMyMemberCredential(newPassword);
      }
      pushToast({
        tone: 'success',
        tag: 'Password Updated',
        message: 'Your account password has been updated.',
      });
    }
    return result;
  }

  async function handleDeleteClubPost(postId: string) {
    const target = clubPosts.find((post) => post.id === postId);
    if (
      !canUserDeleteContent({
        isAdmin,
        userId: isCloudConnected ? (user?.id ?? null) : null,
        authorUserId: target?.authorUserId,
        mode: contentDeletionMode,
      })
    ) {
      throw new Error('You do not have permission to delete this post under the current policy.');
    }
    await removeClubPost(postId);
  }

  async function handleDeleteClubPostComment(commentId: string) {
    const target = clubPostComments.find((comment) => comment.id === commentId);
    if (
      !canUserDeleteContent({
        isAdmin,
        userId: isCloudConnected ? (user?.id ?? null) : null,
        authorUserId: target?.authorUserId,
        mode: contentDeletionMode,
      })
    ) {
      throw new Error(
        'You do not have permission to delete this comment under the current policy.',
      );
    }
    await removeClubPostComment(commentId);
  }

  async function handleDisconnectCloudSync() {
    setIsCreateModalOpen(false);
    setEditingSessionId(null);
    setIsSettingsModalOpen(false);
    setIsAccountsPanelOpen(false);
    setIsCloudSyncModalOpen(false);
    setIsConflictModalOpen(false);
    setActiveSessionId(null);
    setPreferences((prev) => ({
      ...prev,
      activeSessionId: null,
      selectedMemberId: null,
    }));
    await prepareForSignOut();
    await signOut();
    setToasts([]);
    pushToast({
      tone: 'info',
      tag: 'Signed Out',
      message: 'Cloud Sync disconnected. Switched to Local-Only Mode.',
    });
  }

  const canInspectSessionsInTour =
    sessions.length > 0 ||
    !(
      accessScope === 'member_unlinked' &&
      !canViewCalendarDetails &&
      !canViewAttendanceRates
    );

  const activeTutorialSteps = useMemo(
    () =>
      TUTORIAL_STEPS.filter((step) => {
        if (step.id === 'attendance-assign' && !canManageClubRecords) {
          return false;
        }
        if (step.id === 'attendance-checklist' && !canInspectSessionsInTour) {
          return false;
        }
        return true;
      }),
    [canInspectSessionsInTour, canManageClubRecords],
  );

  const applyTutorialStepState = useCallback(
    (step: TutorialStepConfig) => {
      lastAppliedTutorialStepIdRef.current = step.id;
      if (step.page !== activePage) {
        navigateTo(step.page);
      }

      if (step.requiresSession) {
        if (sessions.length > 0) {
          const snapshotSessionId = tutorialSnapshotRef.current?.activeSessionId;
          const preferredId =
            snapshotSessionId && sessions.some((session) => session.id === snapshotSessionId)
              ? snapshotSessionId
              : sortSessionsNewestFirst(sessions)[0]?.id ?? null;
          setActiveSessionId(preferredId);
        } else {
          setActiveSessionId(null);
        }
      } else {
        setActiveSessionId(null);
      }

      setPreferences((prev) => ({
        ...prev,
        isMemberSidebarOpen: step.memberSidebarOpen,
        calendarViewMode: step.calendarViewMode ?? prev.calendarViewMode,
        ...(step.requiresSession ? { statusFilters: [], searchQuery: '' } : {}),
      }));
    },
    [activePage, navigateTo, sessions],
  );

  const handleStartTutorial = useCallback(() => {
    hasAutoTriggeredTutorialRef.current = true;
    setIsCreateModalOpen(false);
    setDuplicateSourceSession(null);
    setEditingSessionId(null);
    setIsSettingsModalOpen(false);
    setIsAccountsPanelOpen(false);
    setIsCloudSyncModalOpen(false);
    setIsConflictModalOpen(false);

    if (!isTutorialActive) {
      tutorialSnapshotRef.current = {
        activePage,
        activeSessionId,
        isMemberSidebarOpen: preferences.isMemberSidebarOpen,
        selectedMemberId: preferences.selectedMemberId,
        calendarViewMode: preferences.calendarViewMode,
      };
    }

    setTutorialStepIndex(0);
    setIsTutorialActive(true);
    const firstStep = activeTutorialSteps[0];
    if (firstStep) {
      applyTutorialStepState(firstStep);
    }
  }, [
    activePage,
    activeSessionId,
    activeTutorialSteps,
    applyTutorialStepState,
    isTutorialActive,
    preferences.calendarViewMode,
    preferences.isMemberSidebarOpen,
    preferences.selectedMemberId,
  ]);

  const finishTutorial = useCallback(
    (nextStatus: 'completed' | 'dismissed') => {
      lastAppliedTutorialStepIdRef.current = null;
      setIsTutorialActive(false);
      setTutorialState(saveTutorialState(nextStatus));

      const snapshot = tutorialSnapshotRef.current;
      tutorialSnapshotRef.current = null;
      if (snapshot) {
        if (snapshot.activePage !== activePage) {
          navigateTo(snapshot.activePage);
        }
        const restoredSessionId =
          snapshot.activeSessionId &&
          sessions.some((session) => session.id === snapshot.activeSessionId)
            ? snapshot.activeSessionId
            : null;
        setActiveSessionId(restoredSessionId);
        setPreferences((prev) => ({
          ...prev,
          isMemberSidebarOpen: snapshot.isMemberSidebarOpen,
          selectedMemberId: snapshot.selectedMemberId,
          calendarViewMode: snapshot.calendarViewMode,
        }));
      }

      if (nextStatus === 'completed') {
        pushToast({
          tone: 'success',
          tag: 'Tour Complete',
          message: 'Walkthrough finished. Replay it anytime from the Tour button or Settings.',
        });
      }
    },
    [activePage, navigateTo, pushToast, sessions],
  );

  const handleTutorialNext = useCallback(() => {
    const nextIndex = Math.min(tutorialStepIndex + 1, activeTutorialSteps.length - 1);
    setTutorialStepIndex(nextIndex);
    const step = activeTutorialSteps[nextIndex];
    if (step) {
      applyTutorialStepState(step);
    }
  }, [activeTutorialSteps, applyTutorialStepState, tutorialStepIndex]);

  const handleTutorialBack = useCallback(() => {
    const prevIndex = Math.max(tutorialStepIndex - 1, 0);
    setTutorialStepIndex(prevIndex);
    const step = activeTutorialSteps[prevIndex];
    if (step) {
      applyTutorialStepState(step);
    }
  }, [activeTutorialSteps, applyTutorialStepState, tutorialStepIndex]);

  // Keep tutorial index clamped and workspace synchronized if user permissions change mid-tour.
  useEffect(() => {
    if (!isTutorialActive) return;
    if (activeTutorialSteps.length === 0) {
      finishTutorial('dismissed');
      return;
    }

    const clampedIndex = Math.min(tutorialStepIndex, activeTutorialSteps.length - 1);
    const resolvedStep = activeTutorialSteps[clampedIndex];
    if (clampedIndex !== tutorialStepIndex) {
      setTutorialStepIndex(clampedIndex);
    }
    if (resolvedStep && lastAppliedTutorialStepIdRef.current !== resolvedStep.id) {
      applyTutorialStepState(resolvedStep);
    }
  }, [
    activeTutorialSteps,
    applyTutorialStepState,
    finishTutorial,
    isTutorialActive,
    tutorialStepIndex,
  ]);

  // Launch the interactive walkthrough automatically on first visit once inside the workspace.
  useEffect(() => {
    if (activePage === 'landing') return;
    if (preloaderPhase !== 'done') return;
    if (hasAutoTriggeredTutorialRef.current) return;
    if (tutorialState.status !== 'unseen') {
      hasAutoTriggeredTutorialRef.current = true;
      return;
    }
    if (
      isTutorialActive ||
      isCreateModalOpen ||
      editingSessionId !== null ||
      isSettingsModalOpen ||
      isCloudSyncModalOpen ||
      isConflictModalOpen
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      handleStartTutorial();
    }, 120);

    return () => window.clearTimeout(timer);
  }, [
    activePage,
    editingSessionId,
    handleStartTutorial,
    isCloudSyncModalOpen,
    isConflictModalOpen,
    isCreateModalOpen,
    isSettingsModalOpen,
    isTutorialActive,
    preloaderPhase,
    tutorialState.status,
  ]);

  const clampedTutorialStepIndex =
    activeTutorialSteps.length > 0
      ? Math.min(tutorialStepIndex, activeTutorialSteps.length - 1)
      : 0;
  const activeTutorialStep = isTutorialActive
    ? (activeTutorialSteps[clampedTutorialStepIndex] ?? null)
    : null;
  const isTutorialDemoSession = Boolean(
    activeTutorialStep?.requiresSession && sessions.length === 0,
  );
  const tutorialDemoWorkspace = useMemo(() => {
    if (!isTutorialDemoSession) return null;
    const activeDirectoryMembers = members.filter((member) => !isLegacyMember(member));
    return buildTutorialDemoWorkspace(activeDirectoryMembers);
  }, [isTutorialDemoSession, members]);

  const displayedMembers = tutorialDemoWorkspace ? tutorialDemoWorkspace.demoMembers : members;
  const displayedSessions = tutorialDemoWorkspace
    ? [tutorialDemoWorkspace.demoSession]
    : sessions;
  const displayedActiveSession = tutorialDemoWorkspace
    ? tutorialDemoWorkspace.demoSession
    : activeSession;

  const activeMemberCount = members.filter((member) => !isLegacyMember(member)).length;
  const hasLocalRecords = !isCloudConnected && (members.length > 0 || sessions.length > 0);

  if (activePage === 'landing') {
    return (
      <>
        <LandingScreen
          themeAccent={preferences.themeAccent}
          periodLabel={getCurrentPeriodLabel()}
          isCloudConnected={isCloudConnected}
          isAdmin={isAdmin}
          userEmail={user?.email}
          isAuthModalOpen={isCloudSyncModalOpen}
          syncStatus={syncStatus}
          realtimeStatus={realtimeStatus}
          onEnterSystem={() => handleNavigate('lounge')}
          onNavigateWorkspace={(page) => handleNavigate(page)}
          onOpenLogin={() => handleOpenAuthModal('login')}
          onOpenCreateAccount={() => handleOpenAuthModal('register')}
        />
        <CloudSyncModal
          isOpen={isCloudSyncModalOpen}
          initialMode={authModalMode}
          hasLocalRecords={hasLocalRecords}
          localMemberCount={members.length}
          localSessionCount={sessions.length}
          onClose={() => setIsCloudSyncModalOpen(false)}
          onConnect={handleConnectCloudSync}
          onRegisterAdmin={handleRegisterAdminAccount}
        />
        <ToastContainer
          toasts={toasts}
          onDismiss={handleDismissToast}
          onUndo={handleUndoToast}
        />
      </>
    );
  }

  const inAttendanceSection = isAttendancePage(activePage);
  const currentPeriodLabel = getCurrentPeriodLabel();

  return (
    <div
      className={`app-shell ${inAttendanceSection ? 'is-attendance-section' : 'is-hangout-section'} ${
        preferences.isMemberSidebarOpen ? 'is-sidebar-open' : ''
      } ${isCloudConnected && isAdmin && isAccountsPanelOpen ? 'is-accounts-panel-open' : ''}`}
      data-density={preferences.rosterDensity}
    >
      {preloaderPhase !== 'done' && (
        <Preloader
          ariaLabel={
            activePage === 'lounge'
              ? 'Loading Team SPIRIT Student Lounge'
              : activePage === 'calendar'
                ? 'Loading Team SPIRIT Session Calendar'
                : activePage === 'ideas'
                  ? 'Loading Team SPIRIT Project Ideas'
                  : 'Loading Team SPIRIT Attendance Tools'
          }
          onBeginExit={handlePreloaderBeginExit}
          onComplete={handlePreloaderComplete}
        />
      )}

      <div className={`app-container ${containerRevealClass}`}>
        <Header
          activePage={activePage}
          isCloudConnected={isCloudConnected}
          accessScope={accessScope}
          isAdmin={isAdmin}
          isRoleLoading={isAuthResolving}
          userEmail={user?.email}
          linkedMemberName={linkedMember?.name}
          syncStatus={syncStatus}
          conflictCount={conflictCount}
          syncError={syncError}
          onNavigate={handleNavigate}
          onRetrySync={() => void flushPendingChanges()}
          onOpenConflictModal={() => setIsConflictModalOpen(true)}
          onOpenCloudSync={() => handleOpenAuthModal('login')}
          onOpenSettings={() => {
            setOpenSettingsToPassword(false);
            setIsSettingsModalOpen(true);
          }}
        />

        <main className="workspace-main">
          <div key={activePage} className="workspace-view-stage">
            {activePage === 'lounge' ? (
              <LoungeWorkspace
                userId={isCloudConnected ? (user?.id ?? null) : null}
                userEmail={user?.email}
                linkedMember={linkedMember}
                isAdmin={isAdmin}
                periodLabel={currentPeriodLabel}
                posts={clubPosts}
                comments={clubPostComments}
                sessions={sessions}
                memberCanCommentOnPosts={memberVisibilityPermissions.memberCanCommentOnPosts}
                contentDeletionMode={contentDeletionMode}
                isPostsLoading={isPostsLoading}
                postsError={postsError}
                isPostsLiveConnected={isPostsLiveConnected}
                isPublishingPost={isPublishingPost}
                onRefreshPostsAndSettings={refreshPostsAndSettings}
                onPublishPost={publishClubPost}
                onEditPost={editClubPost}
                onTogglePinPost={togglePinClubPost}
                onDeletePost={handleDeleteClubPost}
                onAddComment={addClubPostComment}
                onDeleteComment={handleDeleteClubPostComment}
                onOpenCloudSync={() => handleOpenAuthModal('login')}
                onNavigateIdeas={() => handleNavigate('ideas')}
                onNavigateAttendanceCalendar={() => handleNavigate('calendar')}
                onNotify={pushToast}
              />
            ) : activePage === 'ideas' ? (
              <ProjectIdeasWorkspace
                userId={isCloudConnected ? (user?.id ?? null) : null}
                userEmail={user?.email}
                linkedMember={linkedMember}
                isAdmin={isAdmin}
                sharedIdeaVisibility={sharedIdeaVisibility}
                contentDeletionMode={contentDeletionMode}
                isUpdatingSharedVisibility={isUpdatingSharedIdeaVisibility}
                onSetSharedIdeaVisibility={setSharedIdeaVisibility}
                onOpenCloudSync={() => handleOpenAuthModal('login')}
                onNotify={pushToast}
              />
            ) : (
              <AttendanceToolsSection
                activeSubPage={activePage === 'calendar' ? 'calendar' : 'tracker'}
                periodLabel={currentPeriodLabel}
                memberCount={activeMemberCount}
                isMemberSidebarOpen={preferences.isMemberSidebarOpen}
                isAccountsPanelOpen={isCloudConnected && isAdmin && isAccountsPanelOpen}
                accountsPanelId={accountsPanelId}
                accountsCount={isCloudConnected && isAdmin ? adminProfiles.length : 0}
                isTutorialActive={isTutorialActive}
                sidebarId={memberSidebarId}
                isCloudConnected={isCloudConnected}
                accessScope={accessScope}
                canBrowseFullRoster={canBrowseFullRoster}
                isAdmin={isAdmin}
                syncStatus={syncStatus}
                realtimeStatus={realtimeStatus}
                pendingSyncCount={pendingCount}
                conflictCount={conflictCount}
                isEditingActive={isEditingActive}
                syncError={syncError}
                onNavigate={handleNavigate}
                onRetrySync={() => void flushPendingChanges()}
                onOpenConflictModal={() => setIsConflictModalOpen(true)}
                onToggleMemberSidebar={handleToggleMemberSidebar}
                onToggleAccountsPanel={
                  isCloudConnected && isAdmin ? handleToggleAccountsPanel : undefined
                }
                onStartTutorial={handleStartTutorial}
                onOpenCreateSession={handleOpenCreateSessionModal}
              >
                {activePage === 'tracker' ? (
                  <>
                    <StatsStrip
                      members={displayedMembers}
                      sessions={displayedSessions}
                      activeSession={displayedActiveSession}
                      accessScope={accessScope}
                      linkedMember={linkedMember}
                      canViewAttendanceRates={canViewAttendanceRates}
                    />
                    {displayedActiveSession ? (
                      <AttendanceWorkspace
                        activeSession={displayedActiveSession}
                        members={displayedMembers}
                        preferences={preferences}
                        accessScope={accessScope}
                        linkedMember={linkedMember}
                        canViewAttendanceRates={canViewAttendanceRates}
                        canBrowseFullRoster={canBrowseFullRoster}
                        canManageClubRecords={canManageClubRecords}
                        onBackToHub={
                          isTutorialDemoSession ? () => undefined : handleBackToSessionHub
                        }
                        onOpenMemberManager={() =>
                          handleUpdatePreferences({
                            isMemberSidebarOpen: true,
                            selectedMemberId:
                              !canBrowseFullRoster && accessScope === 'member_self'
                                ? (linkedMemberId ?? null)
                                : null,
                          })
                        }
                        onOpenMemberProfile={
                          isTutorialDemoSession ? () => undefined : handleOpenMemberProfile
                        }
                        onEditSession={
                          isTutorialDemoSession ? undefined : handleOpenEditSession
                        }
                        onDeleteSession={
                          isTutorialDemoSession ? () => undefined : handleDeleteSession
                        }
                        onAssignMemberToSession={
                          isTutorialDemoSession ? () => undefined : handleAssignMemberToSession
                        }
                        onAssignMembersToSession={
                          isTutorialDemoSession ? () => undefined : handleAssignMembersToSession
                        }
                        onRemoveMemberFromSession={
                          isTutorialDemoSession ? () => undefined : handleRemoveMemberFromSession
                        }
                        onToggleAttendanceStatus={
                          isTutorialDemoSession ? () => undefined : handleToggleAttendanceStatus
                        }
                        onSetAbsenceReason={
                          isTutorialDemoSession ? () => undefined : handleSetAbsenceReason
                        }
                        onBeginFieldEdit={isTutorialDemoSession ? undefined : beginFieldEdit}
                        onEndFieldEdit={isTutorialDemoSession ? undefined : endFieldEdit}
                        onResetSessionMarks={
                          isTutorialDemoSession ? () => undefined : handleResetSessionMarks
                        }
                        onUpdatePreferences={handleUpdatePreferences}
                      />
                    ) : (
                      <>
                        <SessionHub
                          sessions={sessions}
                          members={members}
                          viewMode={preferences.sessionHubViewMode}
                          accessScope={accessScope}
                          linkedMemberId={linkedMemberId}
                          canViewAttendanceRates={canViewAttendanceRates}
                          canViewCalendarDetails={canViewCalendarDetails}
                          userEmail={user?.email}
                          canManageClubRecords={canManageClubRecords}
                          onRefreshRole={() => void refreshRoleAndProfiles()}
                          onChangeViewMode={(mode) =>
                            handleUpdatePreferences({ sessionHubViewMode: mode })
                          }
                          onSelectSession={handleSelectSession}
                          onEditSession={handleOpenEditSession}
                          onDuplicateSession={handleDuplicateSession}
                          onDeleteSession={handleDeleteSession}
                          onOpenCreateSession={handleOpenCreateSessionModal}
                        />
                        {canViewAttendanceRates && !isTutorialDemoSession && (
                          <AttendanceLeaderboard
                            members={members}
                            sessions={sessions}
                            currentMemberId={linkedMemberId}
                            canOpenMemberProfile={canBrowseFullRoster}
                            onOpenMemberProfile={handleOpenMemberProfile}
                          />
                        )}
                      </>
                    )}
                  </>
                ) : (
                  <SessionCalendarWorkspace
                    sessions={sessions}
                    members={members}
                    selectedDateKey={selectedDateKey}
                    viewMode={preferences.calendarViewMode}
                    accessScope={accessScope}
                    linkedMemberId={linkedMemberId}
                    canViewAttendanceRates={canViewAttendanceRates}
                    canViewCalendarDetails={canViewCalendarDetails}
                    canBrowseFullRoster={canBrowseFullRoster}
                    onChangeViewMode={(mode) =>
                      handleUpdatePreferences({ calendarViewMode: mode })
                    }
                    onSelectDate={setSelectedDateKey}
                    onOpenCreateSessionForDate={(dateKey) => {
                      if (!canManageClubRecords) {
                        notifyAdminRequired('record sessions');
                        return;
                      }
                      setDuplicateSourceSession(null);
                      setSelectedDateKey(dateKey);
                      setIsCreateModalOpen(true);
                    }}
                    onEditSession={canManageClubRecords ? handleOpenEditSession : undefined}
                    onOpenSessionInTracker={handleOpenSessionInTracker}
                    onOpenMemberProfile={handleOpenMemberProfile}
                  />
                )}
              </AttendanceToolsSection>
            )}
          </div>
        </main>
      </div>

      {isCloudConnected && isAdmin && accessScope === 'admin' && (
        <AccountsLeftPanel
          id={accountsPanelId}
          isOpen={isAccountsPanelOpen}
          currentUserId={user?.id ?? null}
          profiles={adminProfiles}
          memberCredentials={memberCredentials}
          members={members}
          isProfilesLoading={isProfilesLoading}
          profilesError={profilesError}
          onClose={() => setIsAccountsPanelOpen(false)}
          onSyncProfiles={syncAdminProfiles}
          onEnsureMemberSynced={flushPendingChanges}
          onCreateAndLinkMemberAccount={createAndLinkMemberAccount}
          onResetMemberPassword={resetMemberPassword}
          onSyncMemberEmailToRoster={(targetMember, nextEmail) => {
            const normalizedEmail = nextEmail.trim().toLowerCase();
            if (!normalizedEmail) return;
            handleUpdateMember(targetMember.id, {
              name: targetMember.name,
              memberType: targetMember.memberType,
              classYear: targetMember.classYear,
              classLetter: targetMember.classLetter,
              className: targetMember.className,
              isLegacy: targetMember.isLegacy,
              retiredAt: targetMember.retiredAt,
              lastPromotedYear: targetMember.lastPromotedYear,
              graduationYear: targetMember.graduationYear,
              role: targetMember.role,
              email: normalizedEmail,
              phone: targetMember.phone,
              handle: targetMember.handle,
              joinedDate: targetMember.joinedDate,
              notes: targetMember.notes,
            });
          }}
          onUpdateUserAdminRole={updateUserAdminRole}
          onLinkUserToMember={linkUserToMember}
          onSetAccountDisabled={setAccountDisabled}
          onRemoveAccount={removeAccount}
          onOpenMemberProfile={handleOpenMemberProfile}
          onNotify={pushToast}
        />
      )}

      <MemberManagerSidebar
        id={memberSidebarId}
        isOpen={preferences.isMemberSidebarOpen}
        members={members}
        sessions={sessions}
        selectedMemberId={preferences.selectedMemberId}
        confirmDeleteMember={preferences.confirmDirectoryMemberDeletion}
        canManageClubRecords={canManageClubRecords}
        accessScope={accessScope}
        linkedMemberId={linkedMemberId}
        canBrowseFullRoster={canBrowseFullRoster}
        canViewAttendanceRates={canViewAttendanceRates}
        isCloudConnected={isCloudConnected}
        isAdmin={isAdmin}
        currentUserId={user?.id ?? null}
        adminProfiles={isCloudConnected && isAdmin ? adminProfiles : undefined}
        isProfilesLoading={isProfilesLoading}
        onEnsureMemberSynced={flushPendingChanges}
        onSyncAdminProfiles={isCloudConnected && isAdmin ? syncAdminProfiles : undefined}
        onCreateAndLinkMemberAccount={
          isCloudConnected && isAdmin ? createAndLinkMemberAccount : undefined
        }
        onSyncAndLinkMemberAccount={
          isCloudConnected && isAdmin ? syncAndLinkMemberAccount : undefined
        }
        onLinkUserToMember={isCloudConnected && isAdmin ? linkUserToMember : undefined}
        onResetMemberPassword={isCloudConnected && isAdmin ? resetMemberPassword : undefined}
        onRemoveAccount={isCloudConnected && isAdmin ? removeAccount : undefined}
        onOpenChangePassword={
          isCloudConnected && !isAdmin
            ? () => {
                setOpenSettingsToPassword(true);
                setIsSettingsModalOpen(true);
              }
            : undefined
        }
        onNotify={pushToast}
        onSelectMember={(memberId) => handleUpdatePreferences({ selectedMemberId: memberId })}
        onClose={() => handleUpdatePreferences({ isMemberSidebarOpen: false })}
        onAddMember={handleAddMember}
        onAddMembersBulk={handleAddMembersBulk}
        onUpdateMember={handleUpdateMember}
        onUpdateMembersClass={handleUpdateMembersClass}
        onSetMemberLegacyStatus={handleSetMemberLegacyStatus}
        onSetMembersLegacyStatus={handleSetMembersLegacyStatus}
        onDeleteMember={(memberId) => handleDeleteMembers([memberId])}
        onDeleteMembers={handleDeleteMembers}
        onBeginFieldEdit={beginFieldEdit}
        onEndFieldEdit={endFieldEdit}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        openPasswordFormOnOpen={openSettingsToPassword}
        preferences={preferences}
        tutorialStatus={tutorialState.status}
        isCloudConnected={isCloudConnected}
        currentUserId={user?.id ?? null}
        userEmail={user?.email}
        userRole={userRole}
        isAdmin={isAdmin}
        accessScope={accessScope}
        linkedMember={linkedMember}
        canViewAllAttendance={canViewAllAttendance}
        members={members}
        isRoleLoading={isRoleLoading}
        roleError={roleError}
        adminProfiles={adminProfiles}
        isProfilesLoading={isProfilesLoading}
        profilesError={profilesError}
        canManageClubRecords={canManageClubRecords}
        syncStatus={syncStatus}
        pendingSyncCount={pendingCount}
        syncError={syncError}
        memberCount={members.length}
        sessionCount={sessions.length}
        onUpdatePreferences={handleUpdatePreferences}
        onResetPreferences={handleResetPreferences}
        onStartTutorial={handleStartTutorial}
        onOpenCloudSync={() => handleOpenAuthModal('login')}
        onOpenCreateAccount={() => handleOpenAuthModal('register')}
        onChangePassword={handleChangePassword}
        onSignOut={handleDisconnectCloudSync}
        onRefreshAdminProfiles={refreshRoleAndProfiles}
        onUpdateUserAdminRole={updateUserAdminRole}
        onLinkUserToMember={linkUserToMember}
        onUpdateUserVisibilityScope={updateUserVisibilityScope}
        onRemoveAccount={isCloudConnected && isAdmin ? removeAccount : undefined}
        memberVisibilityPermissions={memberVisibilityPermissions}
        isUpdatingSharedIdeaVisibility={isUpdatingSharedIdeaVisibility}
        onUpdateMemberVisibilityPermissions={updateMemberVisibilityPermissions}
        contentDeletionMode={contentDeletionMode}
        isUpdatingContentDeletionMode={isUpdatingContentDeletionMode}
        onSetContentDeletionMode={setContentDeletionMode}
        onExportBackup={handleExportBackup}
        onImportBackupFile={handleImportBackupFile}
        onClose={() => {
          setIsSettingsModalOpen(false);
          setOpenSettingsToPassword(false);
        }}
      />

      <CreateSessionModal
        isOpen={isCreateModalOpen}
        defaultDate={activePage === 'calendar' ? selectedDateKey : undefined}
        duplicateSource={duplicateSourceSession}
        duplicateMemberCount={
          duplicateSourceSession
            ? getSessionAssignedMembers(duplicateSourceSession, members).filter(
                (member) => !isLegacyMember(member),
              ).length
            : 0
        }
        showVisibilityControls={isCloudConnected && isAdmin}
        onClose={() => {
          setIsCreateModalOpen(false);
          setDuplicateSourceSession(null);
        }}
        onCreateSession={handleCreateSession}
      />

      <MeetingSettingsModal
        isOpen={editingSession !== null}
        session={editingSession}
        showVisibilityControls={isCloudConnected && isAdmin}
        currentUserId={isCloudConnected ? (user?.id ?? null) : null}
        onClose={() => setEditingSessionId(null)}
        onSave={handleUpdateSession}
        onBeginFieldEdit={beginFieldEdit}
        onEndFieldEdit={endFieldEdit}
      />

      <CloudSyncModal
        isOpen={isCloudSyncModalOpen}
        initialMode={authModalMode}
        hasLocalRecords={hasLocalRecords}
        localMemberCount={members.length}
        localSessionCount={sessions.length}
        onClose={() => setIsCloudSyncModalOpen(false)}
        onConnect={handleConnectCloudSync}
        onRegisterAdmin={handleRegisterAdminAccount}
      />

      <SyncConflictModal
        isOpen={isConflictModalOpen}
        conflicts={conflicts}
        onResolveConflict={resolveConflict}
        onResolveAll={resolveAllConflicts}
        onClose={() => setIsConflictModalOpen(false)}
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={handleDismissToast}
        onUndo={handleUndoToast}
      />

      <TutorialOverlay
        isOpen={isTutorialActive}
        steps={activeTutorialSteps}
        stepIndex={clampedTutorialStepIndex}
        isDemoSessionActive={isTutorialDemoSession}
        onNext={handleTutorialNext}
        onBack={handleTutorialBack}
        onSkip={() => finishTutorial('dismissed')}
        onComplete={() => finishTutorial('completed')}
      />
    </div>
  );
}

export default App;
