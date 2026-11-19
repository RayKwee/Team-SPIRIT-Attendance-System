import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { AttendanceWorkspace } from './components/AttendanceWorkspace';
import { CloudSyncModal } from './components/CloudSyncModal';
import { CreateSessionModal } from './components/CreateSessionModal';
import { Header } from './components/Header';
import { MemberManagerSidebar } from './components/MemberManagerSidebar';
import { Preloader } from './components/Preloader';
import { SessionCalendarWorkspace } from './components/SessionCalendarWorkspace';
import { SessionHub } from './components/SessionHub';
import { SettingsModal } from './components/SettingsModal';
import { StatsStrip } from './components/StatsStrip';
import { ToastContainer, type ToastItem, type ToastTone } from './components/ToastContainer';
import { useSupabaseAuth } from './hooks/useSupabaseAuth';
import { useSyncedAttendanceData } from './hooks/useSyncedAttendanceData';
import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  MemberProfileInput,
  NewSessionInput,
  SyncStatus,
  UserPreferences,
} from './types/attendance';
import {
  generateId,
  getSessionAssignedMembers,
  isLegacyMember,
  type AnnualProgressionSummary,
} from './utils/attendance';
import { getCurrentPeriodLabel, toIsoDateString } from './utils/date';
import { usePreloaderPhase } from './utils/preloader';
import { useAppRoute, type AppPage } from './utils/router';
import {
  DEFAULT_PREFERENCES,
  PREFS_STORAGE_KEY,
  buildWorkspaceBackupPayload,
  loadPreferences,
  parseWorkspaceBackupPayload,
  savePreferences,
} from './utils/storage';

/**
 * Unified Team SPIRIT SPA shell.
 * Opens immediately in local-only mode without login barriers, with an optional
 * header Cloud Sync toggle to connect/disconnect Supabase persistence across devices.
 */
export function App() {
  const memberSidebarId = useId();
  const [activePage, navigateTo] = useAppRoute();
  const { authStatus, user, signIn, signOut } = useSupabaseAuth();
  const isCloudConnected = authStatus === 'authenticated' && Boolean(user?.id);

  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => toIsoDateString(new Date()));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [duplicateSourceSession, setDuplicateSourceSession] =
    useState<AttendanceSession | null>(null);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCloudSyncModalOpen, setIsCloudSyncModalOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);

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
    syncError,
    pendingCount,
    createSession,
    deleteSession,
    addMember,
    updateMember,
    setMemberLegacyStatus,
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
  });

  const prevSyncStatusRef = useRef<SyncStatus>(syncStatus);
  const {
    preloaderPhase,
    containerRevealClass,
    handlePreloaderBeginExit,
    handlePreloaderComplete,
  } = usePreloaderPhase();

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

  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;

  // Persist workspace UI preferences locally and sync theme/density attributes on root.
  useEffect(() => {
    savePreferences(preferences);
    document.documentElement.dataset.accent = preferences.themeAccent;
    document.documentElement.dataset.density = preferences.rosterDensity;
  }, [preferences]);

  // Keep UI preferences synchronized across open tabs.
  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key === PREFS_STORAGE_KEY) {
        setPreferences(loadPreferences());
      }
    }

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  function handleCreateSession(
    input: NewSessionInput,
    options?: { includeSourceMembers?: boolean },
  ) {
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
        filter: 'all',
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
    setDuplicateSourceSession(null);
    setIsCreateModalOpen(true);
  }

  function handleDuplicateSession(session: AttendanceSession) {
    setDuplicateSourceSession(session);
    setIsCreateModalOpen(true);
  }

  function handleSelectSession(sessionId: string) {
    setActiveSessionId(sessionId);
    setPreferences((prev) => ({
      ...prev,
      filter: 'all',
      searchQuery: '',
    }));
  }

  function handleBackToSessionHub() {
    setActiveSessionId(null);
  }

  function handleDeleteSession(sessionId: string) {
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
    const undoToken = getLastUndoToken();
    pushToast({
      tone: 'success',
      tag: 'Member Added',
      message: `Added "${created.name}" to Member Manager.`,
      undoToken,
    });
    return created;
  }

  function handleUpdateMember(memberId: string, input: MemberProfileInput) {
    updateMember(memberId, input);
    const undoToken = getLastUndoToken();
    pushToast({
      tone: 'success',
      tag: 'Updated',
      message: `Saved profile updates for "${input.name.trim()}".`,
      undoToken,
    });
  }

  function handleSetMemberLegacyStatus(memberId: string, isLegacy: boolean) {
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

  function handleAssignMemberToSession(memberId: string) {
    if (!activeSession) return;
    assignMemberToSession(activeSession.id, memberId, preferences.defaultAssignmentStatus);
  }

  function handleAssignMembersToSession(memberIds: string[]) {
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

  function handleToggleMemberSidebar() {
    setPreferences((prev) => ({
      ...prev,
      isMemberSidebarOpen: !prev.isMemberSidebarOpen,
    }));
  }

  function handleOpenMemberProfile(memberId: string) {
    setPreferences((prev) => ({
      ...prev,
      selectedMemberId: memberId,
      isMemberSidebarOpen: true,
    }));
  }

  function handleToggleAttendanceStatus(
    memberId: string,
    targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
  ) {
    if (!activeSession) return;
    toggleAttendanceStatus(activeSession.id, memberId, targetStatus);
  }

  function handleSetAbsenceReason(memberId: string, reason: string) {
    if (!activeSession) return;
    setAbsenceReason(activeSession.id, memberId, reason);
  }

  function handleResetSessionMarks() {
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
    URL.revokeObjectURL(url);
    pushToast({
      tone: 'info',
      tag: 'Backup Exported',
      message: `Saved JSON snapshot (${members.length} members, ${sessions.length} sessions).`,
    });
  }

  async function handleImportBackupFile(
    file: File,
  ): Promise<{ importedMembers: number; importedSessions: number }> {
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
    if (page === 'tracker') {
      setActiveSessionId(null);
    }
    if (page !== activePage) {
      navigateTo(page);
    }
  }

  function handleOpenSessionInTracker(sessionId: string) {
    setActiveSessionId(sessionId);
    setPreferences((prev) => ({
      ...prev,
      filter: 'all',
      searchQuery: '',
    }));
    navigateTo('tracker');
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
    }
    return result;
  }

  async function handleDisconnectCloudSync() {
    setIsCreateModalOpen(false);
    setIsSettingsModalOpen(false);
    setIsCloudSyncModalOpen(false);
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

  const activeMemberCount = members.filter((member) => !isLegacyMember(member)).length;
  const hasLocalRecords = !isCloudConnected && (members.length > 0 || sessions.length > 0);

  return (
    <div
      className={`app-shell ${preferences.isMemberSidebarOpen ? 'is-sidebar-open' : ''}`}
      data-density={preferences.rosterDensity}
    >
      {preloaderPhase !== 'done' && (
        <Preloader
          ariaLabel={
            activePage === 'calendar'
              ? 'Loading Team SPIRIT Session Calendar'
              : 'Loading Team SPIRIT Attendance Dashboard'
          }
          onBeginExit={handlePreloaderBeginExit}
          onComplete={handlePreloaderComplete}
        />
      )}

      <div className={`app-container ${containerRevealClass}`}>
        <Header
          activePage={activePage}
          periodLabel={getCurrentPeriodLabel()}
          memberCount={activeMemberCount}
          isMemberSidebarOpen={preferences.isMemberSidebarOpen}
          sidebarId={memberSidebarId}
          isCloudConnected={isCloudConnected}
          userEmail={user?.email}
          syncStatus={syncStatus}
          pendingSyncCount={pendingCount}
          syncError={syncError}
          onNavigate={handleNavigate}
          onRetrySync={() => void flushPendingChanges()}
          onOpenCloudSync={() => setIsCloudSyncModalOpen(true)}
          onToggleMemberSidebar={handleToggleMemberSidebar}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onOpenCreateSession={handleOpenCreateSessionModal}
        />

        <main className="workspace-main">
          <div key={activePage} className="workspace-view-stage">
            {activePage === 'tracker' ? (
              <>
                <StatsStrip
                  members={members}
                  sessions={sessions}
                  activeSession={activeSession}
                />
                {activeSession ? (
                  <AttendanceWorkspace
                    activeSession={activeSession}
                    members={members}
                    preferences={preferences}
                    onBackToHub={handleBackToSessionHub}
                    onOpenMemberManager={() =>
                      handleUpdatePreferences({
                        isMemberSidebarOpen: true,
                        selectedMemberId: null,
                      })
                    }
                    onOpenMemberProfile={handleOpenMemberProfile}
                    onDeleteSession={handleDeleteSession}
                    onAssignMemberToSession={handleAssignMemberToSession}
                    onAssignMembersToSession={handleAssignMembersToSession}
                    onRemoveMemberFromSession={handleRemoveMemberFromSession}
                    onToggleAttendanceStatus={handleToggleAttendanceStatus}
                    onSetAbsenceReason={handleSetAbsenceReason}
                    onResetSessionMarks={handleResetSessionMarks}
                    onUpdatePreferences={handleUpdatePreferences}
                  />
                ) : (
                  <SessionHub
                    sessions={sessions}
                    members={members}
                    viewMode={preferences.sessionHubViewMode}
                    onChangeViewMode={(mode) =>
                      handleUpdatePreferences({ sessionHubViewMode: mode })
                    }
                    onSelectSession={handleSelectSession}
                    onDuplicateSession={handleDuplicateSession}
                    onDeleteSession={handleDeleteSession}
                    onOpenCreateSession={handleOpenCreateSessionModal}
                  />
                )}
              </>
            ) : (
              <SessionCalendarWorkspace
                sessions={sessions}
                members={members}
                selectedDateKey={selectedDateKey}
                viewMode={preferences.calendarViewMode}
                onChangeViewMode={(mode) =>
                  handleUpdatePreferences({ calendarViewMode: mode })
                }
                onSelectDate={setSelectedDateKey}
                onOpenCreateSessionForDate={(dateKey) => {
                  setDuplicateSourceSession(null);
                  setSelectedDateKey(dateKey);
                  setIsCreateModalOpen(true);
                }}
                onOpenSessionInTracker={handleOpenSessionInTracker}
                onOpenMemberProfile={handleOpenMemberProfile}
              />
            )}
          </div>
        </main>
      </div>

      <MemberManagerSidebar
        id={memberSidebarId}
        isOpen={preferences.isMemberSidebarOpen}
        members={members}
        sessions={sessions}
        selectedMemberId={preferences.selectedMemberId}
        confirmDeleteMember={preferences.confirmDirectoryMemberDeletion}
        onSelectMember={(memberId) => handleUpdatePreferences({ selectedMemberId: memberId })}
        onClose={() => handleUpdatePreferences({ isMemberSidebarOpen: false })}
        onAddMember={handleAddMember}
        onUpdateMember={handleUpdateMember}
        onSetMemberLegacyStatus={handleSetMemberLegacyStatus}
        onDeleteMember={(memberId) => handleDeleteMembers([memberId])}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        preferences={preferences}
        isCloudConnected={isCloudConnected}
        userEmail={user?.email}
        syncStatus={syncStatus}
        pendingSyncCount={pendingCount}
        syncError={syncError}
        memberCount={members.length}
        sessionCount={sessions.length}
        onUpdatePreferences={handleUpdatePreferences}
        onResetPreferences={handleResetPreferences}
        onOpenCloudSync={() => setIsCloudSyncModalOpen(true)}
        onSignOut={handleDisconnectCloudSync}
        onExportBackup={handleExportBackup}
        onImportBackupFile={handleImportBackupFile}
        onClose={() => setIsSettingsModalOpen(false)}
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
        onClose={() => {
          setIsCreateModalOpen(false);
          setDuplicateSourceSession(null);
        }}
        onCreateSession={handleCreateSession}
      />

      <CloudSyncModal
        isOpen={isCloudSyncModalOpen}
        hasLocalRecords={hasLocalRecords}
        localMemberCount={members.length}
        localSessionCount={sessions.length}
        onClose={() => setIsCloudSyncModalOpen(false)}
        onConnect={handleConnectCloudSync}
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={handleDismissToast}
        onUndo={handleUndoToast}
      />
    </div>
  );
}

export default App;
