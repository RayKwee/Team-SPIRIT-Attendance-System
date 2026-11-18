import { useEffect, useState } from 'react';
import { CreateSessionModal } from './components/CreateSessionModal';
import { Header } from './components/Header';
import { SessionCalendarWorkspace } from './components/SessionCalendarWorkspace';
import type {
  AttendanceSession,
  ClubMember,
  NewSessionInput,
  UserPreferences,
} from './types/attendance';
import { generateId } from './utils/attendance';
import { getCurrentPeriodLabel, toIsoDateString } from './utils/date';
import {
  MEMBERS_STORAGE_KEY,
  PREFS_STORAGE_KEY,
  SESSIONS_STORAGE_KEY,
  loadMembers,
  loadPreferences,
  loadSessions,
  savePreferences,
  saveSessions,
} from './utils/storage';

/** Standalone calendar webpage reading and displaying locally saved sessions. */
export function CalendarPage() {
  const [sessions, setSessions] = useState<AttendanceSession[]>(() => loadSessions());
  const [members, setMembers] = useState<ClubMember[]>(() => loadMembers());
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());
  const [selectedDateKey, setSelectedDateKey] = useState<string>(() => toIsoDateString(new Date()));
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

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

  function handleCreateSession(input: NewSessionInput) {
    const newSession: AttendanceSession = {
      ...input,
      id: generateId('session'),
      createdAt: new Date().toISOString(),
      attendance: {},
    };

    setSessions((prev) => [newSession, ...prev]);
    setSelectedDateKey(newSession.date);
    setPreferences((prev) => ({
      ...prev,
      activeSessionId: newSession.id,
    }));
  }

  function handleOpenSessionInTracker(sessionId: string) {
    const nextPrefs: UserPreferences = {
      ...preferences,
      activeSessionId: sessionId,
    };
    savePreferences(nextPrefs);
    window.location.href = './index.html';
  }

  return (
    <div className="app-shell">
      <div className="app-container">
        <Header
          activePage="calendar"
          periodLabel={getCurrentPeriodLabel()}
          onOpenCreateSession={() => setIsCreateModalOpen(true)}
        />

        <main className="workspace-main">
          <SessionCalendarWorkspace
            sessions={sessions}
            members={members}
            selectedDateKey={selectedDateKey}
            onSelectDate={setSelectedDateKey}
            onOpenCreateSessionForDate={(dateKey) => {
              setSelectedDateKey(dateKey);
              setIsCreateModalOpen(true);
            }}
            onOpenSessionInTracker={handleOpenSessionInTracker}
          />
        </main>
      </div>

      <CreateSessionModal
        isOpen={isCreateModalOpen}
        defaultDate={selectedDateKey}
        onClose={() => setIsCreateModalOpen(false)}
        onCreateSession={handleCreateSession}
      />
    </div>
  );
}

export default CalendarPage;
