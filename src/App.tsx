import { useEffect, useId, useState } from 'react';
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
import { useAppRoute, type AppPage } from './utils/router';
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
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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

  const activeSession = activeSessionId
    ? sessions.find((session) => session.id === activeSessionId) ?? null
    : null;

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
    if (activePage === 'tracker') {
      setActiveSessionId(newSession.id);
      setPreferences((prev) => ({
        ...prev,
        filter: 'all',
        searchQuery: '',
      }));
    }
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
    deleteSession(sessionId);
    setActiveSessionId((current) => (current === sessionId ? null : current));
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
          onNavigate={handleNavigate}
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
                    onDeleteSession={handleDeleteSession}
                    onOpenCreateSession={() => setIsCreateModalOpen(true)}
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
