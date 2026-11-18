import { useEffect, useState } from 'react';
import { AttendanceWorkspace } from './components/AttendanceWorkspace';
import { CreateSessionModal } from './components/CreateSessionModal';
import { Header } from './components/Header';
import { StatsStrip } from './components/StatsStrip';
import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  NewSessionInput,
  SessionAttendanceEntry,
  UserPreferences,
} from './types/attendance';
import {
  MEMBERS_STORAGE_KEY,
  PREFS_STORAGE_KEY,
  SESSIONS_STORAGE_KEY,
  loadMembers,
  loadPreferences,
  loadSessions,
  saveMembers,
  savePreferences,
  saveSessions,
} from './utils/storage';
import { generateId } from './utils/attendance';
import { getCurrentPeriodLabel } from './utils/date';

export function App() {
  const [sessions, setSessions] = useState<AttendanceSession[]>(() => loadSessions());
  const [members, setMembers] = useState<ClubMember[]>(() => loadMembers());
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const activeSession =
    sessions.find((session) => session.id === preferences.activeSessionId) ??
    sessions[0] ??
    null;

  // Automatically persist sessions, member roster, and workspace preferences locally.
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    saveMembers(members);
  }, [members]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  // Keep multiple open tabs synchronized via storage events.
  useEffect(() => {
    function handleStorageChange(event: StorageEvent) {
      if (event.key === SESSIONS_STORAGE_KEY) {
        setSessions(loadSessions());
      } else if (event.key === MEMBERS_STORAGE_KEY) {
        setMembers(loadMembers());
      } else if (event.key === PREFS_STORAGE_KEY) {
        setPreferences(loadPreferences());
      }
    }

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  function updateSessionAttendance(
    sessionId: string,
    memberId: string,
    updater: (current: SessionAttendanceEntry | undefined) => SessionAttendanceEntry | undefined,
  ) {
    setSessions((prev) =>
      prev.map((session) => {
        if (session.id !== sessionId) return session;
        const nextEntry = updater(session.attendance[memberId]);
        const nextAttendance = { ...session.attendance };
        if (!nextEntry || nextEntry.status === 'unmarked') {
          delete nextAttendance[memberId];
        } else {
          nextAttendance[memberId] = nextEntry;
        }
        return { ...session, attendance: nextAttendance };
      }),
    );
  }

  function handleCreateSession(input: NewSessionInput) {
    const newSession: AttendanceSession = {
      ...input,
      id: generateId('session'),
      createdAt: new Date().toISOString(),
      attendance: {},
    };

    setSessions((prev) => [newSession, ...prev]);
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
    setSessions((prev) => {
      const remaining = prev.filter((session) => session.id !== sessionId);
      setPreferences((prefPrev) => ({
        ...prefPrev,
        activeSessionId:
          prefPrev.activeSessionId === sessionId
            ? remaining[0]?.id ?? null
            : prefPrev.activeSessionId,
      }));
      return remaining;
    });
  }

  function handleAddMember(name: string) {
    const newMember: ClubMember = {
      id: generateId('member'),
      name,
      createdAt: new Date().toISOString(),
    };
    setMembers((prev) => [newMember, ...prev]);
  }

  function handleRenameMember(memberId: string, nextName: string) {
    setMembers((prev) =>
      prev.map((member) => (member.id === memberId ? { ...member, name: nextName } : member)),
    );
  }

  function handleDeleteMembers(memberIds: string[]) {
    if (memberIds.length === 0) return;
    const idsToDelete = new Set(memberIds);
    const nextMembers = members.filter((member) => !idsToDelete.has(member.id));
    const nextSessions = sessions.map((session) => {
      const hasDeletedMember = Object.keys(session.attendance).some((id) => idsToDelete.has(id));
      if (!hasDeletedMember) return session;
      const nextAttendance = { ...session.attendance };
      for (const id of idsToDelete) {
        delete nextAttendance[id];
      }
      return { ...session, attendance: nextAttendance };
    });

    // Persist immediately so deleted members never reappear on reload or mark reset.
    saveMembers(nextMembers);
    saveSessions(nextSessions);
    setMembers(nextMembers);
    setSessions(nextSessions);
  }

  function handleToggleAttendanceStatus(
    memberId: string,
    targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
  ) {
    if (!activeSession) return;
    const now = new Date().toISOString();
    updateSessionAttendance(activeSession.id, memberId, (current) => {
      if (current?.status === targetStatus) {
        return undefined;
      }
      if (targetStatus === 'absent_with_reason') {
        return {
          status: targetStatus,
          reason: current?.reason ?? '',
          updatedAt: now,
        };
      }
      return {
        status: targetStatus,
        updatedAt: now,
      };
    });
  }

  function handleSetAbsenceReason(memberId: string, reason: string) {
    if (!activeSession) return;
    const now = new Date().toISOString();
    updateSessionAttendance(activeSession.id, memberId, () => ({
      status: 'absent_with_reason',
      reason,
      updatedAt: now,
    }));
  }

  function handleResetSessionMarks() {
    if (!activeSession) return;
    const nextSessions = sessions.map((session) =>
      session.id === activeSession.id ? { ...session, attendance: {} } : session,
    );
    saveSessions(nextSessions);
    setSessions(nextSessions);
  }

  function handleUpdatePreferences(patch: Partial<UserPreferences>) {
    setPreferences((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        <Header
          activePage="tracker"
          periodLabel={getCurrentPeriodLabel()}
          onOpenCreateSession={() => setIsCreateModalOpen(true)}
        />

        <main className="workspace-main">
          <StatsStrip members={members} activeSession={activeSession} />
          <AttendanceWorkspace
            sessions={sessions}
            activeSession={activeSession}
            members={members}
            preferences={preferences}
            onOpenCreateSession={() => setIsCreateModalOpen(true)}
            onSelectSession={handleSelectSession}
            onDeleteSession={handleDeleteSession}
            onAddMember={handleAddMember}
            onRenameMember={handleRenameMember}
            onDeleteMembers={handleDeleteMembers}
            onToggleAttendanceStatus={handleToggleAttendanceStatus}
            onSetAbsenceReason={handleSetAbsenceReason}
            onResetSessionMarks={handleResetSessionMarks}
            onUpdatePreferences={handleUpdatePreferences}
          />
        </main>
      </div>

      <CreateSessionModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateSession={handleCreateSession}
      />
    </div>
  );
}

export default App;
