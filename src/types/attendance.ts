export type AttendanceStatus =
  | 'present'
  | 'absent_with_reason'
  | 'absent_without_reason'
  | 'unmarked';

export type FilterStatus = 'all' | AttendanceStatus;

export type ViewMode = 'list' | 'grid';

export type CalendarViewMode = 'day' | 'week' | 'month' | 'year';

/** Individual club member record keyed by a unique primary key (`id`). */
export interface ClubMember {
  id: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  handle?: string;
  joinedDate?: string;
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

/** Input payload collected when creating or updating a club member profile. */
export interface MemberProfileInput {
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  handle?: string;
  joinedDate?: string;
  notes?: string;
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

/** Persisted session record containing metadata, assigned member IDs, and attendance entries. */
export interface AttendanceSession extends NewSessionInput {
  id: string;
  createdAt: string;
  updatedAt?: string;
  memberIds: string[];
  attendance: Record<string, SessionAttendanceEntry>;
}

/** Synchronized member record carrying timestamped modification & soft-delete metadata. */
export interface SyncedMemberRecord extends ClubMember {
  updatedAt: string;
  deletedAt: string | null;
}

/** Synchronized session record carrying timestamped modification & soft-delete metadata. */
export interface SyncedSessionRecord extends NewSessionInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Synchronized per-session member assignment & attendance mark with tombstone support. */
export interface SyncedAttendanceRecord {
  sessionId: string;
  memberId: string;
  status: AttendanceStatus;
  reason?: string;
  sortOrder: number;
  updatedAt: string;
  deletedAt: string | null;
}

/** Timestamped local sync cache persisted per user to resolve offline edits & deletions. */
export interface LocalSyncStore {
  members: Record<string, SyncedMemberRecord>;
  sessions: Record<string, SyncedSessionRecord>;
  attendance: Record<string, SyncedAttendanceRecord>;
  dirtyMemberIds: string[];
  dirtySessionIds: string[];
  dirtyAttendanceKeys: string[];
  legacyImported: boolean;
}

export type SyncStatus = 'local' | 'idle' | 'loading' | 'synced' | 'syncing' | 'pending' | 'error';

/** Locally persisted workspace UI preferences. */
export interface UserPreferences {
  activeSessionId: string | null;
  selectedMemberId: string | null;
  viewMode: ViewMode;
  calendarViewMode: CalendarViewMode;
  filter: FilterStatus;
  searchQuery: string;
  isMemberSidebarOpen: boolean;
  confirmSessionMemberRemoval: boolean;
  confirmDirectoryMemberDeletion: boolean;
}
