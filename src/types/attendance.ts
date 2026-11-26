export type AttendanceStatus =
  | 'present'
  | 'absent_with_reason'
  | 'absent_without_reason'
  | 'unmarked';

export type FilterStatus = 'all' | AttendanceStatus;

export type ViewMode = 'list' | 'grid';

export type CalendarViewMode = 'day' | 'week' | 'month' | 'year';

export type MemberType = 'student' | 'teacher' | 'visitor';

export type ClassYear = 7 | 8 | 9 | 10 | 11;

export type ClassLetter = 'T' | 'E' | 'N' | 'B' | 'N/A';

/** Individual club member record keyed by a unique primary key (`id`). */
export interface ClubMember {
  id: string;
  name: string;
  memberType?: MemberType;
  classYear?: ClassYear;
  classLetter?: ClassLetter;
  className?: string;
  isLegacy?: boolean;
  retiredAt?: string;
  lastPromotedYear?: number;
  graduationYear?: number;
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
  memberType?: MemberType;
  classYear?: ClassYear;
  classLetter?: ClassLetter;
  className?: string;
  isLegacy?: boolean;
  retiredAt?: string;
  lastPromotedYear?: number;
  graduationYear?: number;
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

export type MeetingVisibility = 'public' | 'admins_only' | 'private';

/** Input payload collected when creating a new attendance session. */
export interface NewSessionInput {
  name: string;
  date: string;
  time: string;
  location?: string;
  description?: string;
  eventType?: string;
  visibility?: MeetingVisibility;
}

/** Input payload collected when editing an existing meeting's general details and/or visibility. */
export interface SessionUpdateInput {
  name: string;
  date: string;
  time: string;
  location?: string;
  description?: string;
  eventType?: string;
  visibility?: MeetingVisibility;
}

/** Persisted session record containing metadata, assigned member IDs, and attendance entries. */
export interface AttendanceSession extends NewSessionInput {
  id: string;
  visibility?: MeetingVisibility;
  createdByUserId?: string;
  createdAt: string;
  updatedAt?: string;
  memberIds: string[];
  attendance: Record<string, SessionAttendanceEntry>;
}

/** Synchronized member record carrying timestamped modification, CAS version & soft-delete metadata. */
export interface SyncedMemberRecord extends ClubMember {
  updatedAt: string;
  deletedAt: string | null;
  syncVersion?: number;
  lastEditedBy?: string;
}

/** Synchronized session record carrying timestamped modification, CAS version & soft-delete metadata. */
export interface SyncedSessionRecord extends NewSessionInput {
  id: string;
  visibility?: MeetingVisibility;
  createdByUserId?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  syncVersion?: number;
  lastEditedBy?: string;
}

/** Synchronized per-session member assignment & attendance mark with tombstone & CAS version support. */
export interface SyncedAttendanceRecord {
  sessionId: string;
  memberId: string;
  status: AttendanceStatus;
  reason?: string;
  sortOrder: number;
  updatedAt: string;
  deletedAt: string | null;
  syncVersion?: number;
  lastEditedBy?: string;
}

export type SyncConflictEntityType = 'member' | 'session' | 'attendance';
export type SyncConflictResolution = 'keep_local' | 'use_remote';

/** Preserved same-field or edit-vs-delete conflict awaiting explicit user choice. */
export interface SyncConflictItem {
  id: string;
  entityType: SyncConflictEntityType;
  entityId: string;
  label: string;
  sublabel?: string;
  conflictingFields: string[];
  baseRecord?: SyncedMemberRecord | SyncedSessionRecord | SyncedAttendanceRecord;
  localRecord: SyncedMemberRecord | SyncedSessionRecord | SyncedAttendanceRecord;
  remoteRecord: SyncedMemberRecord | SyncedSessionRecord | SyncedAttendanceRecord;
  detectedAt: string;
}

/** Timestamped local sync cache persisted per user with base snapshots to enable 3-way merge & CAS. */
export interface LocalSyncStore {
  members: Record<string, SyncedMemberRecord>;
  sessions: Record<string, SyncedSessionRecord>;
  attendance: Record<string, SyncedAttendanceRecord>;
  baseMembers: Record<string, SyncedMemberRecord>;
  baseSessions: Record<string, SyncedSessionRecord>;
  baseAttendance: Record<string, SyncedAttendanceRecord>;
  dirtyMemberIds: string[];
  dirtySessionIds: string[];
  dirtyAttendanceKeys: string[];
  conflicts: SyncConflictItem[];
  legacyImported: boolean;
}

export type SyncStatus =
  | 'local'
  | 'idle'
  | 'loading'
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'reconnecting'
  | 'conflict'
  | 'error';

export type RealtimeStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

export type ThemeAccent = 'cyan' | 'gold' | 'green' | 'red';

export type RosterDensity = 'comfortable' | 'compact';

export type DefaultAssignmentStatus = 'unmarked' | 'present';

/** Locally persisted workspace UI preferences. */
export interface UserPreferences {
  activeSessionId: string | null;
  selectedMemberId: string | null;
  viewMode: ViewMode;
  sessionHubViewMode: ViewMode;
  calendarViewMode: CalendarViewMode;
  statusFilters: AttendanceStatus[];
  searchQuery: string;
  isMemberSidebarOpen: boolean;
  confirmSessionMemberRemoval: boolean;
  confirmDirectoryMemberDeletion: boolean;
  themeAccent: ThemeAccent;
  rosterDensity: RosterDensity;
  defaultAssignmentStatus: DefaultAssignmentStatus;
}

export type AccountRole = 'admin' | 'member';

export type AccessScope =
  | 'local'
  | 'admin'
  | 'broad_viewer'
  | 'member_self'
  | 'member_unlinked';

/** Server-verified user profile, role, visibility scope & linked roster member record stored in `public.user_profiles`. */
export interface UserProfileRecord {
  userId: string;
  email: string;
  role: AccountRole;
  linkedMemberId?: string;
  canViewAllAttendance: boolean;
  isDisabled?: boolean;
  disabledAt?: string;
  disabledBy?: string;
  promotedBy?: string;
  promotedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** Portable JSON backup payload for exporting and restoring local attendance data. */
export interface WorkspaceBackupPayload {
  version: 1;
  app: 'team-spirit-attendance';
  exportedAt: string;
  sourceMode: 'local' | 'cloud';
  members: ClubMember[];
  sessions: AttendanceSession[];
  preferences?: Partial<UserPreferences>;
}
