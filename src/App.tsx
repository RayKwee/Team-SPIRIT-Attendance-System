import { useEffect, useId, useState } from 'react';
import { AttendanceWorkspace } from './components/AttendanceWorkspace';
import { CloudSyncModal } from './components/CloudSyncModal';
import { CreateSessionModal } from './components/CreateSessionModal';
import { Header } from './components/Header';
import { MemberManagerSidebar } from './components/MemberManagerSidebar';
import { Preloader } from './components/Preloader';
import { SessionCalendarWorkspace } from './components/SessionCalendarWorkspace';
import { SettingsModal } from './components/SettingsModal';
import { StatsStrip } from './components/StatsStrip';
import { useSupabaseAuth } from './hooks/useSupabaseAuth';
import { useSyncedAttendanceData } from './hooks/useSyncedAttendanceData';
import type {
  AttendanceStatus,
  ClubMember,
  MemberProfileInput,
  NewSessionInput,
  UserPreferences,
} from './types/attendance';
import { getCurrentPeriodLabel, toIsoDateString } from './utils/date';
import { usePreloaderPhase } from './utils/preloader';
import { useAppRoute } from './utils/router';
import {
  PREFS_STORAGE_KEY,
  loadPreferences,
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
    deleteMembers,
    assignMemberToSession,
    removeMemberFromSession,
    toggleAttendanceStatus,
    setAbsenceReason,
    resetSessionMarks,
    flushPendingChanges,
    prepareForSignOut,
    setMergeLocalOnNextConnect,
  } = useSyncedAttendanceData(isCloudConnected ? user?.id ?? null : null);

  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => toIsoDateString(new Date()));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCloudSyncModalOpen, setIsCloudSyncModalOpen] = useState(false);
  const {
    preloaderPhase,
    containerRevealClass,
    handlePreloaderBeginExit,
    handlePreloaderComplete,
  } = usePreloaderPhase();

  const activeSession =
    sessions.find((session) => session.id === preferences.activeSessionId) ??
    sessions[0] ??
    null;

  // Persist workspace UI preferences locally.
  useEffect(() => {
    savePreferences(preferences);
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

  function handleCreateSession(input: NewSessionInput) {
    const newSession = createSession(input);
    setSelectedDateKey(newSession.date);
    setPreferences((prev) => ({
      ...prev,
      activeSessionId: newSession.id,
      filter: 'all',
      searchQuery: '',
    }));
  }

  function handleSelectSession(sessionId: string) {
    setPreferences((prev) => ({ ...prev, activeSessionId: sessionId }));
  }

  function handleDeleteSession(sessionId: string) {
    const remaining = sessions.filter((session) => session.id !== sessionId);
    deleteSession(sessionId);
    setPreferences((prefPrev) => ({
      ...prefPrev,
      activeSessionId:
        prefPrev.activeSessionId === sessionId
          ? remaining[0]?.id ?? null
          : prefPrev.activeSessionId,
    }));
  }

  function handleAddMember(input: string | MemberProfileInput): ClubMember {
    return addMember(input);
  }

  function handleUpdateMember(memberId: string, input: MemberProfileInput) {
    updateMember(memberId, input);
  }

  function handleAssignMemberToSession(memberId: string) {
    if (!activeSession) return;
    assignMemberToSession(activeSession.id, memberId);
  }

  function handleRemoveMemberFromSession(memberId: string) {
    if (!activeSession) return;
    removeMemberFromSession(activeSession.id, memberId);
  }

  function handleDeleteMembers(memberIds: string[]) {
    if (memberIds.length === 0) return;
    const idsToDelete = new Set(memberIds);
    deleteMembers(memberIds);
    if (preferences.selectedMemberId && idsToDelete.has(preferences.selectedMemberId)) {
      setPreferences((prev) => ({
        ...prev,
        selectedMemberId: null,
      }));
    }
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
  }

  function handleUpdatePreferences(patch: Partial<UserPreferences>) {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }

  function handleOpenSessionInTracker(sessionId: string) {
    setPreferences((prev) => ({
      ...prev,
      activeSessionId: sessionId,
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
    setPreferences((prev) => ({
      ...prev,
      activeSessionId: null,
      selectedMemberId: null,
    }));
    await prepareForSignOut();
    await signOut();
  }

  const hasLocalRecords = !isCloudConnected && (members.length > 0 || sessions.length > 0);

  return (
    <div className={`app-shell ${preferences.isMemberSidebarOpen ? 'is-sidebar-open' : ''}`}>
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
          memberCount={members.length}
          isMemberSidebarOpen={preferences.isMemberSidebarOpen}
          sidebarId={memberSidebarId}
          isCloudConnected={isCloudConnected}
          userEmail={user?.email}
          syncStatus={syncStatus}
          pendingSyncCount={pendingCount}
          syncError={syncError}
          onNavigate={navigateTo}
          onRetrySync={() => void flushPendingChanges()}
          onOpenCloudSync={() => setIsCloudSyncModalOpen(true)}
          onDisconnectCloudSync={() => void handleDisconnectCloudSync()}
          onToggleMemberSidebar={handleToggleMemberSidebar}
          onOpenSettings={() => setIsSettingsModalOpen(true)}
          onOpenCreateSession={() => setIsCreateModalOpen(true)}
        />

        <main className="workspace-main">
          <div key={activePage} className="workspace-view-stage">
            {activePage === 'tracker' ? (
              <>
                <StatsStrip members={members} activeSession={activeSession} />
                <AttendanceWorkspace
                  sessions={sessions}
                  activeSession={activeSession}
                  members={members}
                  preferences={preferences}
                  onOpenCreateSession={() => setIsCreateModalOpen(true)}
                  onOpenMemberManager={() =>
                    handleUpdatePreferences({
                      isMemberSidebarOpen: true,
                      selectedMemberId: null,
                    })
                  }
                  onOpenMemberProfile={handleOpenMemberProfile}
                  onSelectSession={handleSelectSession}
                  onDeleteSession={handleDeleteSession}
                  onAssignMemberToSession={handleAssignMemberToSession}
                  onRemoveMemberFromSession={handleRemoveMemberFromSession}
                  onToggleAttendanceStatus={handleToggleAttendanceStatus}
                  onSetAbsenceReason={handleSetAbsenceReason}
                  onResetSessionMarks={handleResetSessionMarks}
                  onUpdatePreferences={handleUpdatePreferences}
                />
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
        onDeleteMember={(memberId) => handleDeleteMembers([memberId])}
      />

      <SettingsModal
        isOpen={isSettingsModalOpen}
        preferences={preferences}
        onUpdatePreferences={handleUpdatePreferences}
        onClose={() => setIsSettingsModalOpen(false)}
      />

      <CreateSessionModal
        isOpen={isCreateModalOpen}
        defaultDate={activePage === 'calendar' ? selectedDateKey : undefined}
        onClose={() => setIsCreateModalOpen(false)}
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
    </div>
  );
}

export default App;
