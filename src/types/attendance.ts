export type AttendanceStatus =
  | 'present'
  | 'absent_with_reason'
  | 'absent_without_reason'
  | 'unmarked';

export type FilterStatus = 'all' | AttendanceStatus;

export type ViewMode = 'list' | 'grid';

/** Individual club member record keyed by a unique primary key (`id`). */
export interface ClubMember {
  id: string;
  name: string;
  createdAt: string;
}

/** Per-member attendance mark and optional absence reason within a session. */
export interface SessionAttendanceEntry {
  status: AttendanceStatus;
  reason?: string;
  updatedAt: string;
}

/** Input payload collected when creating a new attendance session. */
export interface NewSessionInput {
  name: string;
  date: string;
  time: string;
  location?: string;
  description?: string;
  eventType?: string;
}

/** Persisted session record containing metadata and member attendance entries. */
export interface AttendanceSession extends NewSessionInput {
  id: string;
  createdAt: string;
  attendance: Record<string, SessionAttendanceEntry>;
}

/** Locally persisted workspace UI preferences. */
export interface UserPreferences {
  activeSessionId: string | null;
  viewMode: ViewMode;
  filter: FilterStatus;
  searchQuery: string;
}
