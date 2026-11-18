import type {
  AttendanceSession,
  AttendanceStatus,
  CalendarViewMode,
  ClubMember,
  FilterStatus,
  SessionAttendanceEntry,
  UserPreferences,
  ViewMode,
} from '../types/attendance';
import { normalizeMemberType } from './attendance';

export const SESSIONS_STORAGE_KEY = 'team-spirit:sessions:v1';
export const MEMBERS_STORAGE_KEY = 'team-spirit:members:v1';
export const PREFS_STORAGE_KEY = 'team-spirit:prefs:v1';
const LEGACY_ROSTER_STORAGE_KEY = 'team-spirit:roster:v1';

const VALID_STATUSES: ReadonlySet<AttendanceStatus> = new Set([
  'present',
  'absent_with_reason',
  'absent_without_reason',
  'unmarked',
]);

const VALID_FILTERS: ReadonlySet<FilterStatus> = new Set([
  'all',
  'present',
  'absent_with_reason',
  'absent_without_reason',
  'unmarked',
]);

const VALID_VIEWS: ReadonlySet<ViewMode> = new Set(['list', 'grid']);

const VALID_CALENDAR_VIEWS: ReadonlySet<CalendarViewMode> = new Set([
  'day',
  'week',
  'month',
  'year',
]);

export const DEFAULT_PREFERENCES: UserPreferences = {
  activeSessionId: null,
  selectedMemberId: null,
  viewMode: 'list',
  sessionHubViewMode: 'grid',
  calendarViewMode: 'month',
  filter: 'all',
  searchQuery: '',
  isMemberSidebarOpen: false,
  confirmSessionMemberRemoval: false,
  confirmDirectoryMemberDeletion: true,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isValidMember(value: unknown): value is ClubMember {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.createdAt === 'string'
  );
}

function normalizeMember(raw: ClubMember): ClubMember {
  const memberType = normalizeMemberType(raw.memberType);
  return {
    id: raw.id,
    name: raw.name.trim(),
    memberType,
    className: memberType === 'student' ? cleanOptionalString(raw.className) : undefined,
    role: cleanOptionalString(raw.role),
    email: cleanOptionalString(raw.email),
    phone: cleanOptionalString(raw.phone),
    handle: cleanOptionalString(raw.handle),
    joinedDate: cleanOptionalString(raw.joinedDate),
    notes: cleanOptionalString(raw.notes),
    createdAt: raw.createdAt,
  };
}

function sanitizeAttendanceMap(value: unknown): Record<string, SessionAttendanceEntry> {
  if (!isRecord(value)) return {};
  const result: Record<string, SessionAttendanceEntry> = {};

  for (const [memberId, entry] of Object.entries(value)) {
    if (!memberId || !isRecord(entry)) continue;
    if (typeof entry.status !== 'string' || !VALID_STATUSES.has(entry.status as AttendanceStatus)) {
      continue;
    }
    if (entry.status === 'unmarked') {
      continue;
    }
    const sanitized: SessionAttendanceEntry = {
      status: entry.status as AttendanceStatus,
      updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
    };
    if (
      entry.status === 'absent_with_reason' &&
      typeof entry.reason === 'string' &&
      entry.reason.length > 0
    ) {
      sanitized.reason = entry.reason;
    }
    result[memberId] = sanitized;
  }

  return result;
}

function isValidSession(value: unknown): value is AttendanceSession {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.length > 0 &&
    typeof value.name === 'string' &&
    value.name.trim().length > 0 &&
    typeof value.date === 'string' &&
    value.date.length > 0 &&
    typeof value.time === 'string' &&
    value.time.length > 0 &&
    typeof value.createdAt === 'string'
  );
}

function sanitizeMemberIds(
  rawMemberIds: unknown,
  attendance: Record<string, SessionAttendanceEntry>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  if (Array.isArray(rawMemberIds)) {
    for (const id of rawMemberIds) {
      if (typeof id === 'string' && id.length > 0 && !seen.has(id)) {
        seen.add(id);
        result.push(id);
      }
    }
  }

  for (const id of Object.keys(attendance)) {
    if (id.length > 0 && !seen.has(id)) {
      seen.add(id);
      result.push(id);
    }
  }

  return result;
}

function normalizeSession(raw: AttendanceSession): AttendanceSession {
  const attendance = sanitizeAttendanceMap(raw.attendance);
  return {
    id: raw.id,
    name: raw.name.trim(),
    date: raw.date,
    time: raw.time,
    location: typeof raw.location === 'string' && raw.location.trim() ? raw.location.trim() : undefined,
    description:
      typeof raw.description === 'string' && raw.description.trim()
        ? raw.description.trim()
        : undefined,
    eventType:
      typeof raw.eventType === 'string' && raw.eventType.trim() ? raw.eventType.trim() : undefined,
    createdAt: raw.createdAt,
    memberIds: sanitizeMemberIds(raw.memberIds, attendance),
    attendance,
  };
}

/** Loads persisted sessions from localStorage with schema validation. */
export function loadSessions(): AttendanceSession[] {
  try {
    const raw = window.localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSession).map(normalizeSession);
  } catch {
    return [];
  }
}

/** Saves attendance sessions to localStorage, ignoring quota/privacy errors safely. */
export function saveSessions(sessions: AttendanceSession[]): void {
  try {
    window.localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    // Ignore write failures when localStorage is unavailable or full.
  }
}

/** Loads persisted club members from localStorage, migrating any legacy v1 roster names once. */
export function loadMembers(): ClubMember[] {
  try {
    const raw = window.localStorage.getItem(MEMBERS_STORAGE_KEY);
    if (raw !== null) {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isValidMember).map(normalizeMember);
    }

    const legacyRaw = window.localStorage.getItem(LEGACY_ROSTER_STORAGE_KEY);
    if (!legacyRaw) return [];
    const legacyParsed: unknown = JSON.parse(legacyRaw);
    if (!Array.isArray(legacyParsed)) return [];

    const migrated = legacyParsed
      .filter(
        (item): item is { id: string; name: string; updatedAt?: string } =>
          isRecord(item) &&
          typeof item.id === 'string' &&
          item.id.length > 0 &&
          typeof item.name === 'string' &&
          item.name.trim().length > 0,
      )
      .map((item) => ({
        id: item.id,
        name: item.name.trim(),
        createdAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      }));

    saveMembers(migrated);
    return migrated;
  } catch {
    return [];
  }
}

/** Saves club members to localStorage and retires any legacy v1 roster key. */
export function saveMembers(members: ClubMember[]): void {
  try {
    window.localStorage.setItem(MEMBERS_STORAGE_KEY, JSON.stringify(members));
    window.localStorage.removeItem(LEGACY_ROSTER_STORAGE_KEY);
  } catch {
    // Ignore write failures when localStorage is unavailable or full.
  }
}

/** Loads persisted user preferences from localStorage with safe defaults. */
export function loadPreferences(): UserPreferences {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return DEFAULT_PREFERENCES;

    const activeSessionId =
      typeof parsed.activeSessionId === 'string' && parsed.activeSessionId.length > 0
        ? parsed.activeSessionId
        : null;

    const selectedMemberId =
      typeof parsed.selectedMemberId === 'string' && parsed.selectedMemberId.length > 0
        ? parsed.selectedMemberId
        : null;

    const viewMode =
      typeof parsed.viewMode === 'string' && VALID_VIEWS.has(parsed.viewMode as ViewMode)
        ? (parsed.viewMode as ViewMode)
        : DEFAULT_PREFERENCES.viewMode;

    const sessionHubViewMode =
      typeof parsed.sessionHubViewMode === 'string' &&
      VALID_VIEWS.has(parsed.sessionHubViewMode as ViewMode)
        ? (parsed.sessionHubViewMode as ViewMode)
        : DEFAULT_PREFERENCES.sessionHubViewMode;

    const calendarViewMode =
      typeof parsed.calendarViewMode === 'string' &&
      VALID_CALENDAR_VIEWS.has(parsed.calendarViewMode as CalendarViewMode)
        ? (parsed.calendarViewMode as CalendarViewMode)
        : DEFAULT_PREFERENCES.calendarViewMode;

    const filter =
      typeof parsed.filter === 'string' && VALID_FILTERS.has(parsed.filter as FilterStatus)
        ? (parsed.filter as FilterStatus)
        : DEFAULT_PREFERENCES.filter;

    const searchQuery =
      typeof parsed.searchQuery === 'string' ? parsed.searchQuery : DEFAULT_PREFERENCES.searchQuery;

    const isMemberSidebarOpen =
      typeof parsed.isMemberSidebarOpen === 'boolean'
        ? parsed.isMemberSidebarOpen
        : DEFAULT_PREFERENCES.isMemberSidebarOpen;

    const confirmSessionMemberRemoval =
      typeof parsed.confirmSessionMemberRemoval === 'boolean'
        ? parsed.confirmSessionMemberRemoval
        : DEFAULT_PREFERENCES.confirmSessionMemberRemoval;

    const confirmDirectoryMemberDeletion =
      typeof parsed.confirmDirectoryMemberDeletion === 'boolean'
        ? parsed.confirmDirectoryMemberDeletion
        : DEFAULT_PREFERENCES.confirmDirectoryMemberDeletion;

    return {
      activeSessionId,
      selectedMemberId,
      viewMode,
      sessionHubViewMode,
      calendarViewMode,
      filter,
      searchQuery,
      isMemberSidebarOpen,
      confirmSessionMemberRemoval,
      confirmDirectoryMemberDeletion,
    };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/** Saves user preferences to localStorage. */
export function savePreferences(preferences: UserPreferences): void {
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore write failures when localStorage is unavailable or full.
  }
}

/** Clears legacy unauthenticated localStorage roster/session keys after cloud migration. */
export function clearLegacyWorkspaceStorage(): void {
  try {
    window.localStorage.removeItem(SESSIONS_STORAGE_KEY);
    window.localStorage.removeItem(MEMBERS_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_ROSTER_STORAGE_KEY);
  } catch {
    // Ignore storage removal errors.
  }
}
