import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  LocalSyncStore,
  MemberType,
  SyncConflictItem,
  SyncConflictResolution,
  SyncedAttendanceRecord,
  SyncedMemberRecord,
  SyncedSessionRecord,
} from '../types/attendance';
import {
  compareMembersByRoleAndName,
  normalizeAcademicYear,
  normalizeMemberType,
  resolveStudentClassFields,
} from '../utils/attendance';
import {
  clearLegacyWorkspaceStorage,
  loadMembers as loadLegacyMembers,
  loadSessions as loadLegacySessions,
} from '../utils/storage';
import {
  ATTENDANCE_MERGE_FIELDS,
  MEMBER_MERGE_FIELDS,
  SESSION_MERGE_FIELDS,
  buildAttendanceConflictItem,
  buildMemberConflictItem,
  buildSessionConflictItem,
  makeConflictId,
  normalizeMergedAttendance,
  reconcileIncomingEntity,
  removeConflictByEntity,
  upsertConflictItem,
} from './syncConflictEngine';
import { supabase } from './supabase';

const SYNC_STORE_KEY_PREFIX = 'team-spirit:sync-store:v1:';
const TAB_ID_SESSION_KEY = 'team-spirit:tab-id:v1';
export const LOCAL_ONLY_STORE_KEY = 'team-spirit:local-store:v1';

let fallbackTabId: string | null = null;

/** Returns a stable identifier unique to the current browser tab for self-echo & cross-tab coordination. */
export function getClientTabId(): string {
  if (typeof window === 'undefined') return 'tab-ssr';
  try {
    const existing = window.sessionStorage.getItem(TAB_ID_SESSION_KEY);
    if (existing) return existing;
    const created =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `tab-${crypto.randomUUID()}`
        : `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(TAB_ID_SESSION_KEY, created);
    return created;
  } catch {
    if (!fallbackTabId) {
      fallbackTabId = `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    }
    return fallbackTabId;
  }
}

interface DbMemberRow {
  id: string;
  name: string;
  member_type?: string | null;
  class_name: string | null;
  class_year?: number | null;
  class_letter?: string | null;
  is_legacy?: boolean | null;
  retired_at?: string | null;
  last_promoted_year?: number | null;
  graduation_year?: number | null;
  role: string | null;
  email: string | null;
  phone: string | null;
  handle: string | null;
  joined_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version?: number | null;
  last_edited_by?: string | null;
}

interface DbSessionRow {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string | null;
  description: string | null;
  event_type: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  sync_version?: number | null;
  last_edited_by?: string | null;
}

interface DbAttendanceRow {
  session_id: string;
  member_id: string;
  status: AttendanceStatus;
  reason: string | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string | null;
  sync_version?: number | null;
  last_edited_by?: string | null;
}

export interface RemoteSnapshot {
  members: Record<string, SyncedMemberRecord>;
  sessions: Record<string, SyncedSessionRecord>;
  attendance: Record<string, SyncedAttendanceRecord>;
}

const MISSING_TABLE_USER_MESSAGE =
  'Supabase tables (club_members, attendance_sessions, session_attendance) were not found. Run supabase/schema.sql in your Supabase SQL Editor, then click to retry.';

const MISSING_COLUMN_USER_MESSAGE =
  'Supabase columns (e.g. sync_version, last_edited_by, or club_members profile fields) are missing. Run the updated supabase/schema.sql in your Supabase SQL Editor, then click to retry.';

const PERMISSION_DENIED_USER_MESSAGE =
  'Supabase denied access (403 Forbidden). Run the updated GRANT & RLS script in supabase/schema.sql in your Supabase SQL Editor, then click to retry.';

const AUTH_EXPIRED_USER_MESSAGE =
  'Your Supabase Cloud Sync session expired or is invalid. Sign out and sign back in via Cloud Sync.';

const SCHEMA_CONSTRAINT_USER_MESSAGE =
  'Supabase club_members check constraints are outdated (e.g. N/A class letter or required role). Run the updated supabase/schema.sql in your Supabase SQL Editor, then click to retry.';

const MISSING_COLUMN_PATTERN = /could not find the .* column|column .* does not exist/i;
const MISSING_TABLE_PATTERN = /could not find the table|relation .* does not exist|schema cache/i;
const SCHEMA_CONSTRAINT_PATTERN = /club_members_class_letter_check|club_members_role_check/i;
const PERMISSION_DENIED_PATTERN =
  /permission denied|insufficient_privilege|row-level security|forbidden|not allowed/i;
const AUTH_EXPIRED_PATTERN =
  /jwt expired|invalid jwt|jwt malformed|no suitable key|token has expired|session.*missing|not authenticated/i;

/** Normalized Error wrapper for Supabase PostgREST / network failures. */
export class SupabaseSyncError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly isMissingTable: boolean;
  readonly isMissingColumn: boolean;
  readonly isPermissionDenied: boolean;
  readonly isAuthExpired: boolean;

  constructor(
    message: string,
    options?: {
      code?: string;
      status?: number;
      isMissingTable?: boolean;
      isMissingColumn?: boolean;
      isPermissionDenied?: boolean;
      isAuthExpired?: boolean;
    },
  ) {
    super(message);
    this.name = 'SupabaseSyncError';
    this.code = options?.code;
    this.status = options?.status;
    this.isMissingTable = Boolean(options?.isMissingTable);
    this.isMissingColumn = Boolean(options?.isMissingColumn);
    this.isPermissionDenied = Boolean(options?.isPermissionDenied);
    this.isAuthExpired = Boolean(options?.isAuthExpired);
  }
}

/** Converts Supabase PostgrestError plain objects or unknown rejections into a SupabaseSyncError. */
export function toSupabaseSyncError(
  error: unknown,
  fallbackMessage = 'Unable to reach Supabase database.',
  httpStatus?: number,
): SupabaseSyncError {
  if (error instanceof SupabaseSyncError) {
    return error;
  }

  let rawMessage = '';
  let code: string | undefined;
  let details = '';
  let hint = '';
  let status = typeof httpStatus === 'number' && httpStatus > 0 ? httpStatus : undefined;

  if (error instanceof Error) {
    rawMessage = error.message;
    const errorWithProps = error as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      details?: unknown;
      hint?: unknown;
    };
    if (typeof errorWithProps.code === 'string') code = errorWithProps.code;
    if (typeof errorWithProps.details === 'string') details = errorWithProps.details;
    if (typeof errorWithProps.hint === 'string') hint = errorWithProps.hint;
    if (status === undefined) {
      if (typeof errorWithProps.status === 'number') status = errorWithProps.status;
      else if (typeof errorWithProps.statusCode === 'number') status = errorWithProps.statusCode;
    }
  } else if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') rawMessage = obj.message;
    if (typeof obj.code === 'string') code = obj.code;
    if (typeof obj.details === 'string') details = obj.details;
    if (typeof obj.hint === 'string') hint = obj.hint;
    if (status === undefined) {
      if (typeof obj.status === 'number') status = obj.status;
      else if (typeof obj.statusCode === 'number') status = obj.statusCode;
    }
  } else if (typeof error === 'string') {
    rawMessage = error;
  }

  const isMissingColumn =
    code === 'PGRST204' ||
    code === '42703' ||
    MISSING_COLUMN_PATTERN.test(rawMessage) ||
    MISSING_COLUMN_PATTERN.test(details);

  if (isMissingColumn) {
    return new SupabaseSyncError(MISSING_COLUMN_USER_MESSAGE, {
      code,
      status: status ?? 400,
      isMissingColumn: true,
    });
  }

  const isMissingTable =
    code === 'PGRST205' ||
    code === '42P01' ||
    status === 404 ||
    MISSING_TABLE_PATTERN.test(rawMessage) ||
    MISSING_TABLE_PATTERN.test(details);

  if (isMissingTable) {
    return new SupabaseSyncError(MISSING_TABLE_USER_MESSAGE, {
      code,
      status: status ?? 404,
      isMissingTable: true,
    });
  }

  const isAuthExpired =
    code === 'PGRST301' ||
    status === 401 ||
    AUTH_EXPIRED_PATTERN.test(rawMessage) ||
    AUTH_EXPIRED_PATTERN.test(details);

  if (isAuthExpired) {
    return new SupabaseSyncError(AUTH_EXPIRED_USER_MESSAGE, {
      code,
      status: status ?? 401,
      isAuthExpired: true,
    });
  }

  const isPermissionDenied =
    code === '42501' ||
    status === 403 ||
    PERMISSION_DENIED_PATTERN.test(rawMessage) ||
    PERMISSION_DENIED_PATTERN.test(details);

  if (isPermissionDenied) {
    return new SupabaseSyncError(PERMISSION_DENIED_USER_MESSAGE, {
      code,
      status: status ?? 403,
      isPermissionDenied: true,
    });
  }

  const isOutdatedConstraint =
    code === '23514' &&
    (SCHEMA_CONSTRAINT_PATTERN.test(rawMessage) || SCHEMA_CONSTRAINT_PATTERN.test(details));

  if (isOutdatedConstraint) {
    return new SupabaseSyncError(SCHEMA_CONSTRAINT_USER_MESSAGE, {
      code,
      status: status ?? 400,
    });
  }

  const message =
    rawMessage.trim() || details.trim() || hint.trim() || fallbackMessage;

  return new SupabaseSyncError(message, {
    code,
    status,
  });
}

export function makeAttendanceKey(sessionId: string, memberId: string): string {
  return `${sessionId}::${memberId}`;
}

export function getSyncStoreKey(userId: string): string {
  return `${SYNC_STORE_KEY_PREFIX}${userId}`;
}

export function createEmptySyncStore(): LocalSyncStore {
  return {
    members: {},
    sessions: {},
    attendance: {},
    baseMembers: {},
    baseSessions: {},
    baseAttendance: {},
    dirtyMemberIds: [],
    dirtySessionIds: [],
    dirtyAttendanceKeys: [],
    conflicts: [],
    legacyImported: false,
  };
}

export function getEffectiveTimestamp(
  updatedAt?: string | null,
  deletedAt?: string | null,
): number {
  const updatedMs = updatedAt ? Date.parse(updatedAt) : Number.NaN;
  const deletedMs = deletedAt ? Date.parse(deletedAt) : Number.NaN;
  const safeUpdated = Number.isFinite(updatedMs) ? updatedMs : 0;
  const safeDeleted = Number.isFinite(deletedMs) ? deletedMs : 0;
  return Math.max(safeUpdated, safeDeleted);
}

function cleanOptionalText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function memberFromDbRow(row: DbMemberRow): SyncedMemberRecord {
  const memberType = normalizeMemberType(row.member_type);
  const classFields = resolveStudentClassFields({
    memberType,
    classYear: row.class_year,
    classLetter: row.class_letter,
    className: cleanOptionalText(row.class_name),
  });
  const isLegacy = Boolean(row.is_legacy);
  return {
    id: row.id,
    name: row.name,
    memberType,
    ...classFields,
    isLegacy,
    retiredAt: isLegacy ? cleanOptionalText(row.retired_at) : undefined,
    lastPromotedYear: normalizeAcademicYear(row.last_promoted_year),
    graduationYear: isLegacy ? normalizeAcademicYear(row.graduation_year) : undefined,
    role: cleanOptionalText(row.role),
    email: cleanOptionalText(row.email),
    phone: cleanOptionalText(row.phone),
    handle: cleanOptionalText(row.handle),
    joinedDate: cleanOptionalText(row.joined_date),
    notes: cleanOptionalText(row.notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    deletedAt: row.deleted_at ?? null,
    syncVersion: typeof row.sync_version === 'number' ? row.sync_version : undefined,
    lastEditedBy: cleanOptionalText(row.last_edited_by),
  };
}

export function memberToDbRow(member: SyncedMemberRecord, editorTabId?: string): DbMemberRow {
  const memberType: MemberType = normalizeMemberType(member.memberType);
  const classFields = resolveStudentClassFields({
    memberType,
    classYear: member.classYear,
    classLetter: member.classLetter,
    className: member.className,
  });
  const isLegacy = Boolean(member.isLegacy);
  return {
    id: member.id,
    name: member.name,
    member_type: memberType,
    class_name: classFields.className ?? null,
    class_year: classFields.classYear ?? null,
    class_letter: classFields.classLetter ?? null,
    is_legacy: isLegacy,
    retired_at: isLegacy ? (member.retiredAt ?? null) : null,
    last_promoted_year: normalizeAcademicYear(member.lastPromotedYear) ?? null,
    graduation_year: isLegacy ? (normalizeAcademicYear(member.graduationYear) ?? null) : null,
    role: cleanOptionalText(member.role) ?? 'Member',
    email: member.email ?? null,
    phone: member.phone ?? null,
    handle: member.handle ?? null,
    joined_date: member.joinedDate ?? null,
    notes: member.notes ?? null,
    created_at: member.createdAt,
    updated_at: member.updatedAt,
    deleted_at: member.deletedAt ?? null,
    last_edited_by: editorTabId ?? member.lastEditedBy ?? getClientTabId(),
  };
}

export function sessionFromDbRow(row: DbSessionRow): SyncedSessionRecord {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    time: row.time,
    location: cleanOptionalText(row.location),
    description: cleanOptionalText(row.description),
    eventType: cleanOptionalText(row.event_type),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    deletedAt: row.deleted_at ?? null,
    syncVersion: typeof row.sync_version === 'number' ? row.sync_version : undefined,
    lastEditedBy: cleanOptionalText(row.last_edited_by),
  };
}

export function sessionToDbRow(session: SyncedSessionRecord, editorTabId?: string): DbSessionRow {
  return {
    id: session.id,
    name: session.name,
    date: session.date,
    time: session.time,
    location: session.location ?? null,
    description: session.description ?? null,
    event_type: session.eventType ?? null,
    created_at: session.createdAt,
    updated_at: session.updatedAt,
    deleted_at: session.deletedAt ?? null,
    last_edited_by: editorTabId ?? session.lastEditedBy ?? getClientTabId(),
  };
}

export function attendanceFromDbRow(row: DbAttendanceRow): SyncedAttendanceRecord {
  return {
    sessionId: row.session_id,
    memberId: row.member_id,
    status: row.status,
    reason: cleanOptionalText(row.reason),
    sortOrder: Number.isFinite(row.sort_order) ? row.sort_order : 0,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at ?? null,
    syncVersion: typeof row.sync_version === 'number' ? row.sync_version : undefined,
    lastEditedBy: cleanOptionalText(row.last_edited_by),
  };
}

export function attendanceToDbRow(
  record: SyncedAttendanceRecord,
  editorTabId?: string,
): DbAttendanceRow {
  return {
    session_id: record.sessionId,
    member_id: record.memberId,
    status: record.status,
    reason: record.status === 'absent_with_reason' ? (record.reason ?? null) : null,
    sort_order: record.sortOrder,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt ?? null,
    last_edited_by: editorTabId ?? record.lastEditedBy ?? getClientTabId(),
  };
}

function saveStoreByKey(storageKey: string, store: LocalSyncStore): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors safely.
  }
}

function normalizeMemberRecord(rec: Partial<SyncedMemberRecord>): SyncedMemberRecord | null {
  if (!rec || typeof rec !== 'object' || typeof rec.id !== 'string' || typeof rec.name !== 'string') {
    return null;
  }
  const memberType = normalizeMemberType(rec.memberType);
  const classFields = resolveStudentClassFields({
    memberType,
    classYear: rec.classYear,
    classLetter: rec.classLetter,
    className: cleanOptionalText(rec.className),
  });
  const isLegacy = Boolean(rec.isLegacy);
  return {
    ...(rec as SyncedMemberRecord),
    memberType,
    ...classFields,
    isLegacy,
    retiredAt: isLegacy ? cleanOptionalText(rec.retiredAt) : undefined,
    lastPromotedYear: normalizeAcademicYear(rec.lastPromotedYear),
    graduationYear: isLegacy ? normalizeAcademicYear(rec.graduationYear) : undefined,
    syncVersion: typeof rec.syncVersion === 'number' ? rec.syncVersion : undefined,
    lastEditedBy: cleanOptionalText(rec.lastEditedBy),
  };
}

function normalizeMembersRecordMap(
  rawMap: unknown,
): Record<string, SyncedMemberRecord> {
  const normalized: Record<string, SyncedMemberRecord> = {};
  if (!rawMap || typeof rawMap !== 'object') return normalized;
  for (const [id, rec] of Object.entries(rawMap as Record<string, Partial<SyncedMemberRecord>>)) {
    const member = normalizeMemberRecord(rec);
    if (member) {
      normalized[id] = member;
    }
  }
  return normalized;
}

function loadStoreByKey(storageKey: string): LocalSyncStore {
  let store = createEmptySyncStore();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalSyncStore>;
      store = {
        members: normalizeMembersRecordMap(parsed.members),
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        attendance:
          parsed.attendance && typeof parsed.attendance === 'object' ? parsed.attendance : {},
        baseMembers: normalizeMembersRecordMap(parsed.baseMembers),
        baseSessions:
          parsed.baseSessions && typeof parsed.baseSessions === 'object'
            ? parsed.baseSessions
            : {},
        baseAttendance:
          parsed.baseAttendance && typeof parsed.baseAttendance === 'object'
            ? parsed.baseAttendance
            : {},
        dirtyMemberIds: Array.isArray(parsed.dirtyMemberIds) ? parsed.dirtyMemberIds : [],
        dirtySessionIds: Array.isArray(parsed.dirtySessionIds) ? parsed.dirtySessionIds : [],
        dirtyAttendanceKeys: Array.isArray(parsed.dirtyAttendanceKeys)
          ? parsed.dirtyAttendanceKeys
          : [],
        conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
        legacyImported: Boolean(parsed.legacyImported),
      };
    }
  } catch {
    store = createEmptySyncStore();
  }

  if (!store.legacyImported) {
    const legacyMembers = loadLegacyMembers();
    const legacySessions = loadLegacySessions();
    const dirtyMemberSet = new Set(store.dirtyMemberIds);
    const dirtySessionSet = new Set(store.dirtySessionIds);
    const dirtyAttendanceSet = new Set(store.dirtyAttendanceKeys);

    for (const member of legacyMembers) {
      if (!store.members[member.id]) {
        store.members[member.id] = {
          ...member,
          updatedAt: member.updatedAt ?? member.createdAt,
          deletedAt: null,
        };
        dirtyMemberSet.add(member.id);
      }
    }

    for (const session of legacySessions) {
      if (!store.sessions[session.id]) {
        store.sessions[session.id] = {
          id: session.id,
          name: session.name,
          date: session.date,
          time: session.time,
          location: session.location,
          description: session.description,
          eventType: session.eventType,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt ?? session.createdAt,
          deletedAt: null,
        };
        dirtySessionSet.add(session.id);
      }

      session.memberIds.forEach((memberId, index) => {
        if (!store.members[memberId]) return;
        const key = makeAttendanceKey(session.id, memberId);
        if (store.attendance[key]) return;
        const entry = session.attendance[memberId];
        store.attendance[key] = {
          sessionId: session.id,
          memberId,
          status: entry?.status ?? 'unmarked',
          reason: entry?.status === 'absent_with_reason' ? entry.reason : undefined,
          sortOrder: index,
          updatedAt: entry?.updatedAt ?? session.createdAt,
          deletedAt: null,
        };
        dirtyAttendanceSet.add(key);
      });
    }

    store.dirtyMemberIds = Array.from(dirtyMemberSet);
    store.dirtySessionIds = Array.from(dirtySessionSet);
    store.dirtyAttendanceKeys = Array.from(dirtyAttendanceSet);
    store.legacyImported = true;
    saveStoreByKey(storageKey, store);
  }

  return store;
}

/** Loads the per-user timestamped sync cache and imports any legacy localStorage items once. */
export function loadLocalSyncStore(userId: string): LocalSyncStore {
  return loadStoreByKey(getSyncStoreKey(userId));
}

/** Loads the unauthenticated local-only device store from localStorage. */
export function loadLocalOnlyStore(): LocalSyncStore {
  return loadStoreByKey(LOCAL_ONLY_STORE_KEY);
}

export function saveLocalSyncStore(userId: string, store: LocalSyncStore): void {
  saveStoreByKey(getSyncStoreKey(userId), store);
}

export function saveLocalOnlyStore(store: LocalSyncStore): void {
  saveStoreByKey(LOCAL_ONLY_STORE_KEY, store);
}

export function clearLocalSyncStore(userId: string): void {
  try {
    window.localStorage.removeItem(getSyncStoreKey(userId));
  } catch {
    // Ignore storage removal errors.
  }
}

export function clearLocalOnlyStore(): void {
  try {
    window.localStorage.removeItem(LOCAL_ONLY_STORE_KEY);
  } catch {
    // Ignore storage removal errors.
  }
}

/**
 * Merges local-only device records into an authenticated user's sync store before
 * Supabase reconciliation, marking newer/unique local entries dirty so they push online.
 */
export function mergeLocalOnlyIntoUserStore(
  userId: string,
  localOnlyStore: LocalSyncStore,
): LocalSyncStore {
  const userStore = loadLocalSyncStore(userId);
  const nextMembers = { ...userStore.members };
  const dirtyMembers = new Set(userStore.dirtyMemberIds);

  for (const [id, localRec] of Object.entries(localOnlyStore.members)) {
    const existing = nextMembers[id];
    const localTs = getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt);
    const existingTs = existing
      ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
      : -1;
    if (!existing || localTs > existingTs) {
      nextMembers[id] = localRec;
      if (!localRec.deletedAt || existing) {
        dirtyMembers.add(id);
      }
    }
  }

  const nextSessions = { ...userStore.sessions };
  const dirtySessions = new Set(userStore.dirtySessionIds);

  for (const [id, localRec] of Object.entries(localOnlyStore.sessions)) {
    const existing = nextSessions[id];
    const localTs = getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt);
    const existingTs = existing
      ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
      : -1;
    if (!existing || localTs > existingTs) {
      nextSessions[id] = localRec;
      if (!localRec.deletedAt || existing) {
        dirtySessions.add(id);
      }
    }
  }

  const nextAttendance = { ...userStore.attendance };
  const dirtyAttendance = new Set(userStore.dirtyAttendanceKeys);

  for (const [key, localRec] of Object.entries(localOnlyStore.attendance)) {
    const existing = nextAttendance[key];
    const localTs = getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt);
    const existingTs = existing
      ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
      : -1;
    if (!existing || localTs > existingTs) {
      nextAttendance[key] = localRec;
      if (!localRec.deletedAt || existing) {
        dirtyAttendance.add(key);
      }
    }
  }

  const mergedStore: LocalSyncStore = {
    members: nextMembers,
    sessions: nextSessions,
    attendance: nextAttendance,
    baseMembers: { ...userStore.baseMembers },
    baseSessions: { ...userStore.baseSessions },
    baseAttendance: { ...userStore.baseAttendance },
    dirtyMemberIds: Array.from(dirtyMembers),
    dirtySessionIds: Array.from(dirtySessions),
    dirtyAttendanceKeys: Array.from(dirtyAttendance),
    conflicts: [...userStore.conflicts],
    legacyImported: true,
  };

  saveLocalSyncStore(userId, mergedStore);
  clearLocalOnlyStore();
  clearLegacyWorkspaceStorage();
  return mergedStore;
}

export function hasDirtySyncItems(store: LocalSyncStore): boolean {
  return (
    store.dirtyMemberIds.length > 0 ||
    store.dirtySessionIds.length > 0 ||
    store.dirtyAttendanceKeys.length > 0
  );
}

export function hasSyncConflicts(store: LocalSyncStore): boolean {
  return store.conflicts.length > 0;
}

/** Converts normalized sync records into UI-ready active ClubMember[] and AttendanceSession[] arrays. */
export function deriveWorkspaceState(store: LocalSyncStore): {
  members: ClubMember[];
  sessions: AttendanceSession[];
} {
  const activeMembers: ClubMember[] = Object.values(store.members)
    .filter((member) => !member.deletedAt)
    .sort(compareMembersByRoleAndName)
    .map(({ deletedAt: _deleted, ...member }) => member);

  const activeMemberIds = new Set(activeMembers.map((member) => member.id));

  const attendanceBySession = new Map<string, SyncedAttendanceRecord[]>();
  for (const record of Object.values(store.attendance)) {
    if (record.deletedAt || !activeMemberIds.has(record.memberId)) continue;
    const list = attendanceBySession.get(record.sessionId);
    if (list) {
      list.push(record);
    } else {
      attendanceBySession.set(record.sessionId, [record]);
    }
  }

  const activeSessions: AttendanceSession[] = Object.values(store.sessions)
    .filter((session) => !session.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((session) => {
      const records = (attendanceBySession.get(session.id) ?? []).sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return b.updatedAt.localeCompare(a.updatedAt);
      });

      const memberIds: string[] = [];
      const attendance: AttendanceSession['attendance'] = {};

      for (const rec of records) {
        memberIds.push(rec.memberId);
        if (rec.status !== 'unmarked') {
          attendance[rec.memberId] = {
            status: rec.status,
            ...(rec.status === 'absent_with_reason' ? { reason: rec.reason ?? '' } : {}),
            updatedAt: rec.updatedAt,
          };
        }
      }

      return {
        id: session.id,
        name: session.name,
        date: session.date,
        time: session.time,
        location: session.location,
        description: session.description,
        eventType: session.eventType,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        memberIds,
        attendance,
      };
    });

  return {
    members: activeMembers,
    sessions: activeSessions,
  };
}

const TOKEN_REFRESH_BUFFER_SECONDS = 30;

/** Ensures an active, unexpired JWT access token exists before issuing PostgREST requests. */
async function ensureValidAccessSession(): Promise<void> {
  const { data, error } = await supabase.auth.getSession();
  const session = data.session;
  const nowSeconds = Math.floor(Date.now() / 1000);
  const needsRefresh =
    Boolean(error) ||
    !session?.access_token ||
    (typeof session.expires_at === 'number' &&
      session.expires_at <= nowSeconds + TOKEN_REFRESH_BUFFER_SECONDS);

  if (!needsRefresh) {
    return;
  }

  const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError || !refreshed.session?.access_token) {
    throw new SupabaseSyncError(AUTH_EXPIRED_USER_MESSAGE, {
      code: 'PGRST301',
      status: 401,
      isAuthExpired: true,
    });
  }
}

/** Runs a Supabase PostgREST query with session verification, single 401 refresh retry, and normalized errors. */
async function runSupabaseQueryWithAuthRetry<T>(
  execute: () => PromiseLike<{ data: T; error: unknown; status: number }>,
  fallbackMessage: string,
): Promise<T> {
  await ensureValidAccessSession();

  let res = await execute();
  if (res.error) {
    const firstErr = toSupabaseSyncError(res.error, fallbackMessage, res.status);
    if (firstErr.isAuthExpired) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed.session?.access_token) {
        res = await execute();
        if (!res.error) {
          return res.data;
        }
        throw toSupabaseSyncError(res.error, fallbackMessage, res.status);
      }
    }
    throw firstErr;
  }

  return res.data;
}

/** Runs an INSERT with session verification and a single 401 refresh retry, preserving `23505` collisions for 3-way merge. */
async function runSupabaseInsertWithAuthRetry<T>(
  execute: () => PromiseLike<{ data: T; error: unknown; status: number }>,
  fallbackMessage: string,
): Promise<{ data: NonNullable<T> } | { uniqueViolation: true }> {
  await ensureValidAccessSession();

  let res = await execute();
  if (res.error) {
    if (isUniqueViolationError(res.error)) {
      return { uniqueViolation: true };
    }
    const firstErr = toSupabaseSyncError(res.error, fallbackMessage, res.status);
    if (firstErr.isAuthExpired) {
      const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
      if (!refreshError && refreshed.session?.access_token) {
        res = await execute();
        if (!res.error && res.data !== null && res.data !== undefined) {
          return { data: res.data as NonNullable<T> };
        }
        if (isUniqueViolationError(res.error)) {
          return { uniqueViolation: true };
        }
        throw toSupabaseSyncError(res.error, fallbackMessage, res.status);
      }
    }
    throw firstErr;
  }

  if (res.data === null || res.data === undefined) {
    throw new SupabaseSyncError(fallbackMessage);
  }
  return { data: res.data as NonNullable<T> };
}

/**
 * Fetches the complete timestamped state (including tombstones) from Supabase sequentially
 * so missing-table or permission errors fail fast on the first query instead of firing 3 parallel requests.
 */
export async function pullRemoteSnapshot(): Promise<RemoteSnapshot> {
  const membersData = await runSupabaseQueryWithAuthRetry(
    () => supabase.from('club_members').select('*'),
    'Failed to load club members from Supabase.',
  );

  const sessionsData = await runSupabaseQueryWithAuthRetry(
    () => supabase.from('attendance_sessions').select('*'),
    'Failed to load sessions from Supabase.',
  );

  const attendanceData = await runSupabaseQueryWithAuthRetry(
    () => supabase.from('session_attendance').select('*'),
    'Failed to load session attendance from Supabase.',
  );

  const members: Record<string, SyncedMemberRecord> = {};
  for (const row of (membersData ?? []) as DbMemberRow[]) {
    members[row.id] = memberFromDbRow(row);
  }

  const sessions: Record<string, SyncedSessionRecord> = {};
  for (const row of (sessionsData ?? []) as DbSessionRow[]) {
    sessions[row.id] = sessionFromDbRow(row);
  }

  const attendance: Record<string, SyncedAttendanceRecord> = {};
  for (const row of (attendanceData ?? []) as DbAttendanceRow[]) {
    attendance[makeAttendanceKey(row.session_id, row.member_id)] = attendanceFromDbRow(row);
  }

  return { members, sessions, attendance };
}

async function fetchRemoteMemberById(id: string): Promise<SyncedMemberRecord | null> {
  const row = await runSupabaseQueryWithAuthRetry(
    () => supabase.from('club_members').select('*').eq('id', id).maybeSingle(),
    'Failed to fetch latest club member state from Supabase.',
  );
  return row ? memberFromDbRow(row as DbMemberRow) : null;
}

async function fetchRemoteSessionById(id: string): Promise<SyncedSessionRecord | null> {
  const row = await runSupabaseQueryWithAuthRetry(
    () => supabase.from('attendance_sessions').select('*').eq('id', id).maybeSingle(),
    'Failed to fetch latest session state from Supabase.',
  );
  return row ? sessionFromDbRow(row as DbSessionRow) : null;
}

async function fetchRemoteAttendanceByKey(
  sessionId: string,
  memberId: string,
): Promise<SyncedAttendanceRecord | null> {
  const row = await runSupabaseQueryWithAuthRetry(
    () =>
      supabase
        .from('session_attendance')
        .select('*')
        .eq('session_id', sessionId)
        .eq('member_id', memberId)
        .maybeSingle(),
    'Failed to fetch latest attendance state from Supabase.',
  );
  return row ? attendanceFromDbRow(row as DbAttendanceRow) : null;
}

function isUniqueViolationError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { code?: unknown }).code === '23505';
}

async function pushMemberWithCas(
  id: string,
  local: SyncedMemberRecord,
  base: SyncedMemberRecord | undefined,
  tabId: string,
): Promise<
  | { outcome: 'synced'; record: SyncedMemberRecord }
  | { outcome: 'deleted_remotely' }
  | { outcome: 'conflict'; conflict: SyncConflictItem; remote: SyncedMemberRecord }
> {
  let candidate = local;
  let expectedVersion = base?.syncVersion;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (expectedVersion === undefined) {
      const insertOutcome = await runSupabaseInsertWithAuthRetry(
        () =>
          supabase
            .from('club_members')
            .insert(memberToDbRow(candidate, tabId))
            .select('*')
            .single(),
        'Failed to create club member in Supabase.',
      );

      if ('data' in insertOutcome) {
        return { outcome: 'synced', record: memberFromDbRow(insertOutcome.data as DbMemberRow) };
      }

      // Same ID was created concurrently on another device; fetch and 3-way merge.
      const remote = await fetchRemoteMemberById(id);
      if (!remote) continue;
      const mergedResult = reconcileIncomingEntity({
        local: candidate,
        base,
        remote,
        isDirty: true,
        fields: MEMBER_MERGE_FIELDS,
      });
      if (mergedResult.action === 'accept_remote') {
        return { outcome: 'synced', record: remote };
      }
      if (mergedResult.action === 'conflict') {
        return {
          outcome: 'conflict',
          conflict: buildMemberConflictItem(
            id,
            base,
            candidate,
            remote,
            mergedResult.conflictingFields,
          ),
          remote,
        };
      }
      if (!mergedResult.needsPush) {
        return { outcome: 'synced', record: mergedResult.record };
      }
      candidate = mergedResult.record;
      base = remote;
      expectedVersion = remote.syncVersion;
      continue;
    }

    const row = memberToDbRow(candidate, tabId);
    const { id: _id, created_at: _createdAt, sync_version: _sv, ...updateFields } = row;
    const updatedRow = await runSupabaseQueryWithAuthRetry(
      () =>
        supabase
          .from('club_members')
          .update(updateFields)
          .eq('id', id)
          .eq('sync_version', expectedVersion!)
          .select('*')
          .maybeSingle(),
      'Failed to sync club member with Supabase.',
    );

    if (updatedRow) {
      return { outcome: 'synced', record: memberFromDbRow(updatedRow as DbMemberRow) };
    }

    // CAS mismatch (0 rows matched expectedVersion): another tab/device modified or hard-deleted.
    const remote = await fetchRemoteMemberById(id);
    if (!remote) {
      if (candidate.deletedAt) {
        return { outcome: 'deleted_remotely' };
      }
      const deletedRemote: SyncedMemberRecord = {
        ...(base ?? candidate),
        syncVersion: undefined,
        deletedAt: new Date().toISOString(),
      };
      return {
        outcome: 'conflict',
        conflict: buildMemberConflictItem(id, base, candidate, deletedRemote, ['Deleted on Cloud']),
        remote: deletedRemote,
      };
    }

    const mergedResult = reconcileIncomingEntity({
      local: candidate,
      base,
      remote,
      isDirty: true,
      fields: MEMBER_MERGE_FIELDS,
    });
    if (mergedResult.action === 'accept_remote') {
      return { outcome: 'synced', record: remote };
    }
    if (mergedResult.action === 'conflict') {
      return {
        outcome: 'conflict',
        conflict: buildMemberConflictItem(
          id,
          base,
          candidate,
          remote,
          mergedResult.conflictingFields,
        ),
        remote,
      };
    }
    if (!mergedResult.needsPush) {
      return { outcome: 'synced', record: mergedResult.record };
    }
    candidate = mergedResult.record;
    base = remote;
    expectedVersion = remote.syncVersion;
  }

  const latestRemote = (await fetchRemoteMemberById(id)) ?? candidate;
  return {
    outcome: 'conflict',
    conflict: buildMemberConflictItem(id, base, local, latestRemote, ['Concurrent Update']),
    remote: latestRemote,
  };
}

async function pushSessionWithCas(
  id: string,
  local: SyncedSessionRecord,
  base: SyncedSessionRecord | undefined,
  tabId: string,
): Promise<
  | { outcome: 'synced'; record: SyncedSessionRecord }
  | { outcome: 'deleted_remotely' }
  | { outcome: 'conflict'; conflict: SyncConflictItem; remote: SyncedSessionRecord }
> {
  let candidate = local;
  let expectedVersion = base?.syncVersion;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (expectedVersion === undefined) {
      const insertOutcome = await runSupabaseInsertWithAuthRetry(
        () =>
          supabase
            .from('attendance_sessions')
            .insert(sessionToDbRow(candidate, tabId))
            .select('*')
            .single(),
        'Failed to create session in Supabase.',
      );

      if ('data' in insertOutcome) {
        return { outcome: 'synced', record: sessionFromDbRow(insertOutcome.data as DbSessionRow) };
      }

      const remote = await fetchRemoteSessionById(id);
      if (!remote) continue;
      const mergedResult = reconcileIncomingEntity({
        local: candidate,
        base,
        remote,
        isDirty: true,
        fields: SESSION_MERGE_FIELDS,
      });
      if (mergedResult.action === 'accept_remote') {
        return { outcome: 'synced', record: remote };
      }
      if (mergedResult.action === 'conflict') {
        return {
          outcome: 'conflict',
          conflict: buildSessionConflictItem(
            id,
            base,
            candidate,
            remote,
            mergedResult.conflictingFields,
          ),
          remote,
        };
      }
      if (!mergedResult.needsPush) {
        return { outcome: 'synced', record: mergedResult.record };
      }
      candidate = mergedResult.record;
      base = remote;
      expectedVersion = remote.syncVersion;
      continue;
    }

    const row = sessionToDbRow(candidate, tabId);
    const { id: _id, created_at: _createdAt, sync_version: _sv, ...updateFields } = row;
    const updatedRow = await runSupabaseQueryWithAuthRetry(
      () =>
        supabase
          .from('attendance_sessions')
          .update(updateFields)
          .eq('id', id)
          .eq('sync_version', expectedVersion!)
          .select('*')
          .maybeSingle(),
      'Failed to sync session with Supabase.',
    );

    if (updatedRow) {
      return { outcome: 'synced', record: sessionFromDbRow(updatedRow as DbSessionRow) };
    }

    const remote = await fetchRemoteSessionById(id);
    if (!remote) {
      if (candidate.deletedAt) {
        return { outcome: 'deleted_remotely' };
      }
      const deletedRemote: SyncedSessionRecord = {
        ...(base ?? candidate),
        syncVersion: undefined,
        deletedAt: new Date().toISOString(),
      };
      return {
        outcome: 'conflict',
        conflict: buildSessionConflictItem(id, base, candidate, deletedRemote, ['Deleted on Cloud']),
        remote: deletedRemote,
      };
    }

    const mergedResult = reconcileIncomingEntity({
      local: candidate,
      base,
      remote,
      isDirty: true,
      fields: SESSION_MERGE_FIELDS,
    });
    if (mergedResult.action === 'accept_remote') {
      return { outcome: 'synced', record: remote };
    }
    if (mergedResult.action === 'conflict') {
      return {
        outcome: 'conflict',
        conflict: buildSessionConflictItem(
          id,
          base,
          candidate,
          remote,
          mergedResult.conflictingFields,
        ),
        remote,
      };
    }
    if (!mergedResult.needsPush) {
      return { outcome: 'synced', record: mergedResult.record };
    }
    candidate = mergedResult.record;
    base = remote;
    expectedVersion = remote.syncVersion;
  }

  const latestRemote = (await fetchRemoteSessionById(id)) ?? candidate;
  return {
    outcome: 'conflict',
    conflict: buildSessionConflictItem(id, base, local, latestRemote, ['Concurrent Update']),
    remote: latestRemote,
  };
}

async function pushAttendanceWithCas(
  key: string,
  local: SyncedAttendanceRecord,
  base: SyncedAttendanceRecord | undefined,
  tabId: string,
  context: { memberName?: string; sessionName?: string },
): Promise<
  | { outcome: 'synced'; record: SyncedAttendanceRecord }
  | { outcome: 'deleted_remotely' }
  | { outcome: 'conflict'; conflict: SyncConflictItem; remote: SyncedAttendanceRecord }
> {
  let candidate = normalizeMergedAttendance(local);
  let expectedVersion = base?.syncVersion;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (expectedVersion === undefined) {
      const insertOutcome = await runSupabaseInsertWithAuthRetry(
        () =>
          supabase
            .from('session_attendance')
            .insert(attendanceToDbRow(candidate, tabId))
            .select('*')
            .single(),
        'Failed to create attendance record in Supabase.',
      );

      if ('data' in insertOutcome) {
        return {
          outcome: 'synced',
          record: attendanceFromDbRow(insertOutcome.data as DbAttendanceRow),
        };
      }

      const remote = await fetchRemoteAttendanceByKey(candidate.sessionId, candidate.memberId);
      if (!remote) continue;
      const mergedResult = reconcileIncomingEntity({
        local: candidate,
        base,
        remote,
        isDirty: true,
        fields: ATTENDANCE_MERGE_FIELDS,
        normalizeMerged: normalizeMergedAttendance,
      });
      if (mergedResult.action === 'accept_remote') {
        return { outcome: 'synced', record: remote };
      }
      if (mergedResult.action === 'conflict') {
        return {
          outcome: 'conflict',
          conflict: buildAttendanceConflictItem(
            key,
            base,
            candidate,
            remote,
            mergedResult.conflictingFields,
            context,
          ),
          remote,
        };
      }
      if (!mergedResult.needsPush) {
        return { outcome: 'synced', record: mergedResult.record };
      }
      candidate = mergedResult.record;
      base = remote;
      expectedVersion = remote.syncVersion;
      continue;
    }

    const row = attendanceToDbRow(candidate, tabId);
    const {
      session_id: _sid,
      member_id: _mid,
      sync_version: _sv,
      ...updateFields
    } = row;
    const updatedRow = await runSupabaseQueryWithAuthRetry(
      () =>
        supabase
          .from('session_attendance')
          .update(updateFields)
          .eq('session_id', candidate.sessionId)
          .eq('member_id', candidate.memberId)
          .eq('sync_version', expectedVersion!)
          .select('*')
          .maybeSingle(),
      'Failed to sync attendance record with Supabase.',
    );

    if (updatedRow) {
      return { outcome: 'synced', record: attendanceFromDbRow(updatedRow as DbAttendanceRow) };
    }

    const remote = await fetchRemoteAttendanceByKey(candidate.sessionId, candidate.memberId);
    if (!remote) {
      if (candidate.deletedAt) {
        return { outcome: 'deleted_remotely' };
      }
      const deletedRemote: SyncedAttendanceRecord = {
        ...(base ?? candidate),
        syncVersion: undefined,
        deletedAt: new Date().toISOString(),
      };
      return {
        outcome: 'conflict',
        conflict: buildAttendanceConflictItem(
          key,
          base,
          candidate,
          deletedRemote,
          ['Deleted on Cloud'],
          context,
        ),
        remote: deletedRemote,
      };
    }

    const mergedResult = reconcileIncomingEntity({
      local: candidate,
      base,
      remote,
      isDirty: true,
      fields: ATTENDANCE_MERGE_FIELDS,
      normalizeMerged: normalizeMergedAttendance,
    });
    if (mergedResult.action === 'accept_remote') {
      return { outcome: 'synced', record: remote };
    }
    if (mergedResult.action === 'conflict') {
      return {
        outcome: 'conflict',
        conflict: buildAttendanceConflictItem(
          key,
          base,
          candidate,
          remote,
          mergedResult.conflictingFields,
          context,
        ),
        remote,
      };
    }
    if (!mergedResult.needsPush) {
      return { outcome: 'synced', record: mergedResult.record };
    }
    candidate = mergedResult.record;
    base = remote;
    expectedVersion = remote.syncVersion;
  }

  const latestRemote =
    (await fetchRemoteAttendanceByKey(local.sessionId, local.memberId)) ?? candidate;
  return {
    outcome: 'conflict',
    conflict: buildAttendanceConflictItem(
      key,
      base,
      local,
      latestRemote,
      ['Concurrent Update'],
      context,
    ),
    remote: latestRemote,
  };
}

/**
 * Merges local timestamped state with Supabase using 3-way field merge & base snapshots,
 * auto-merging non-overlapping edits, preserving true conflicts, and pruning non-dirty stale rows.
 */
export async function reconcileWithSupabase(
  userId: string,
  localStore: LocalSyncStore,
  options?: {
    readOnlyPullOnly?: boolean;
    onPartialProgress?: (partialStore: LocalSyncStore) => void;
  },
): Promise<LocalSyncStore> {
  const remote = await pullRemoteSnapshot();

  if (options?.readOnlyPullOnly) {
    const readOnlyStore: LocalSyncStore = {
      members: { ...remote.members },
      sessions: { ...remote.sessions },
      attendance: { ...remote.attendance },
      baseMembers: { ...remote.members },
      baseSessions: { ...remote.sessions },
      baseAttendance: { ...remote.attendance },
      dirtyMemberIds: [],
      dirtySessionIds: [],
      dirtyAttendanceKeys: [],
      conflicts: [],
      legacyImported: true,
    };
    saveLocalSyncStore(userId, readOnlyStore);
    return readOnlyStore;
  }
  const dirtyMemberSet = new Set(localStore.dirtyMemberIds);
  const dirtySessionSet = new Set(localStore.dirtySessionIds);
  const dirtyAttendanceSet = new Set(localStore.dirtyAttendanceKeys);

  const nextMembers: Record<string, SyncedMemberRecord> = {};
  const nextBaseMembers: Record<string, SyncedMemberRecord> = {};
  const nextDirtyMembers = new Set<string>();
  let nextConflicts = [...localStore.conflicts];

  const allMemberIds = new Set([
    ...Object.keys(localStore.members),
    ...Object.keys(remote.members),
  ]);

  for (const id of allMemberIds) {
    const local = localStore.members[id];
    const base = localStore.baseMembers[id];
    const remoteRec = remote.members[id];
    const isDirty = dirtyMemberSet.has(id);

    if (remoteRec && local) {
      const outcome = reconcileIncomingEntity({
        local,
        base,
        remote: remoteRec,
        isDirty,
        fields: MEMBER_MERGE_FIELDS,
      });

      if (outcome.action === 'accept_remote') {
        nextMembers[id] = outcome.record;
        nextBaseMembers[id] = outcome.base;
        nextConflicts = removeConflictByEntity(nextConflicts, 'member', id);
      } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
        nextMembers[id] = outcome.record;
        nextBaseMembers[id] = outcome.base;
        if (outcome.needsPush) {
          nextDirtyMembers.add(id);
        }
        nextConflicts = removeConflictByEntity(nextConflicts, 'member', id);
      } else {
        nextMembers[id] = local;
        nextBaseMembers[id] = outcome.base;
        nextConflicts = upsertConflictItem(
          nextConflicts,
          buildMemberConflictItem(id, base, local, remoteRec, outcome.conflictingFields),
        );
      }
    } else if (remoteRec) {
      nextMembers[id] = remoteRec;
      nextBaseMembers[id] = remoteRec;
      nextConflicts = removeConflictByEntity(nextConflicts, 'member', id);
    } else if (local && isDirty) {
      if (base?.syncVersion !== undefined) {
        if (!local.deletedAt) {
          const deletedRemote: SyncedMemberRecord = {
            ...base,
            syncVersion: undefined,
            deletedAt: new Date().toISOString(),
          };
          nextMembers[id] = local;
          nextConflicts = upsertConflictItem(
            nextConflicts,
            buildMemberConflictItem(id, base, local, deletedRemote, ['Deleted on Cloud']),
          );
        }
      } else if (!local.deletedAt) {
        nextMembers[id] = local;
        nextDirtyMembers.add(id);
      }
    }
    // Non-dirty local records missing from remote are pruned rather than resurrected.
  }

  const nextSessions: Record<string, SyncedSessionRecord> = {};
  const nextBaseSessions: Record<string, SyncedSessionRecord> = {};
  const nextDirtySessions = new Set<string>();

  const allSessionIds = new Set([
    ...Object.keys(localStore.sessions),
    ...Object.keys(remote.sessions),
  ]);

  for (const id of allSessionIds) {
    const local = localStore.sessions[id];
    const base = localStore.baseSessions[id];
    const remoteRec = remote.sessions[id];
    const isDirty = dirtySessionSet.has(id);

    if (remoteRec && local) {
      const outcome = reconcileIncomingEntity({
        local,
        base,
        remote: remoteRec,
        isDirty,
        fields: SESSION_MERGE_FIELDS,
      });

      if (outcome.action === 'accept_remote') {
        nextSessions[id] = outcome.record;
        nextBaseSessions[id] = outcome.base;
        nextConflicts = removeConflictByEntity(nextConflicts, 'session', id);
      } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
        nextSessions[id] = outcome.record;
        nextBaseSessions[id] = outcome.base;
        if (outcome.needsPush) {
          nextDirtySessions.add(id);
        }
        nextConflicts = removeConflictByEntity(nextConflicts, 'session', id);
      } else {
        nextSessions[id] = local;
        nextBaseSessions[id] = outcome.base;
        nextConflicts = upsertConflictItem(
          nextConflicts,
          buildSessionConflictItem(id, base, local, remoteRec, outcome.conflictingFields),
        );
      }
    } else if (remoteRec) {
      nextSessions[id] = remoteRec;
      nextBaseSessions[id] = remoteRec;
      nextConflicts = removeConflictByEntity(nextConflicts, 'session', id);
    } else if (local && isDirty) {
      if (base?.syncVersion !== undefined) {
        if (!local.deletedAt) {
          const deletedRemote: SyncedSessionRecord = {
            ...base,
            syncVersion: undefined,
            deletedAt: new Date().toISOString(),
          };
          nextSessions[id] = local;
          nextConflicts = upsertConflictItem(
            nextConflicts,
            buildSessionConflictItem(id, base, local, deletedRemote, ['Deleted on Cloud']),
          );
        }
      } else if (!local.deletedAt) {
        nextSessions[id] = local;
        nextDirtySessions.add(id);
      }
    }
  }

  const nextAttendance: Record<string, SyncedAttendanceRecord> = {};
  const nextBaseAttendance: Record<string, SyncedAttendanceRecord> = {};
  const nextDirtyAttendance = new Set<string>();

  const allAttendanceKeys = new Set([
    ...Object.keys(localStore.attendance),
    ...Object.keys(remote.attendance),
  ]);

  for (const key of allAttendanceKeys) {
    const local = localStore.attendance[key];
    const base = localStore.baseAttendance[key];
    const remoteRec = remote.attendance[key];
    const isDirty = dirtyAttendanceSet.has(key);

    if (remoteRec && local) {
      const outcome = reconcileIncomingEntity({
        local,
        base,
        remote: remoteRec,
        isDirty,
        fields: ATTENDANCE_MERGE_FIELDS,
        normalizeMerged: normalizeMergedAttendance,
      });

      if (outcome.action === 'accept_remote') {
        nextAttendance[key] = outcome.record;
        nextBaseAttendance[key] = outcome.base;
        nextConflicts = removeConflictByEntity(nextConflicts, 'attendance', key);
      } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
        nextAttendance[key] = outcome.record;
        nextBaseAttendance[key] = outcome.base;
        if (outcome.needsPush) {
          nextDirtyAttendance.add(key);
        }
        nextConflicts = removeConflictByEntity(nextConflicts, 'attendance', key);
      } else {
        nextAttendance[key] = local;
        nextBaseAttendance[key] = outcome.base;
        nextConflicts = upsertConflictItem(
          nextConflicts,
          buildAttendanceConflictItem(
            key,
            base,
            local,
            remoteRec,
            outcome.conflictingFields,
            {
              memberName: nextMembers[local.memberId]?.name,
              sessionName: nextSessions[local.sessionId]?.name,
            },
          ),
        );
      }
    } else if (remoteRec) {
      nextAttendance[key] = remoteRec;
      nextBaseAttendance[key] = remoteRec;
      nextConflicts = removeConflictByEntity(nextConflicts, 'attendance', key);
    } else if (local && isDirty) {
      if (base?.syncVersion !== undefined) {
        if (!local.deletedAt) {
          const deletedRemote: SyncedAttendanceRecord = {
            ...base,
            syncVersion: undefined,
            deletedAt: new Date().toISOString(),
          };
          nextAttendance[key] = local;
          nextConflicts = upsertConflictItem(
            nextConflicts,
            buildAttendanceConflictItem(key, base, local, deletedRemote, ['Deleted on Cloud'], {
              memberName: nextMembers[local.memberId]?.name,
              sessionName: nextSessions[local.sessionId]?.name,
            }),
          );
        }
      } else if (!local.deletedAt) {
        nextAttendance[key] = local;
        nextDirtyAttendance.add(key);
      }
    }
  }

  const mergedBeforePush: LocalSyncStore = {
    members: nextMembers,
    sessions: nextSessions,
    attendance: nextAttendance,
    baseMembers: nextBaseMembers,
    baseSessions: nextBaseSessions,
    baseAttendance: nextBaseAttendance,
    dirtyMemberIds: Array.from(nextDirtyMembers),
    dirtySessionIds: Array.from(nextDirtySessions),
    dirtyAttendanceKeys: Array.from(nextDirtyAttendance),
    conflicts: nextConflicts,
    legacyImported: true,
  };

  const pushed = await pushDirtyQueueToSupabase(userId, mergedBeforePush, {
    onPartialProgress: options?.onPartialProgress,
  });
  clearLegacyWorkspaceStorage();
  return pushed;
}

/**
 * Pushes queued dirty items in FK dependency order using Compare-And-Swap (`sync_version`)
 * so stale local caches cannot overwrite newer remote rows without 3-way merge or conflict review.
 */
export async function pushDirtyQueueToSupabase(
  userId: string,
  store: LocalSyncStore,
  options?: { onPartialProgress?: (partialStore: LocalSyncStore) => void },
): Promise<LocalSyncStore> {
  const tabId = getClientTabId();
  const nextMembers = { ...store.members };
  const nextBaseMembers = { ...store.baseMembers };
  const nextSessions = { ...store.sessions };
  const nextBaseSessions = { ...store.baseSessions };
  const nextAttendance = { ...store.attendance };
  const nextBaseAttendance = { ...store.baseAttendance };
  let nextConflicts = [...store.conflicts];

  const remainingDirtyMembers = new Set<string>(store.dirtyMemberIds);
  const remainingDirtySessions = new Set<string>(store.dirtySessionIds);
  const remainingDirtyAttendance = new Set<string>(store.dirtyAttendanceKeys);
  let madeProgress = false;

  const buildSnapshot = (): LocalSyncStore => ({
    ...store,
    members: nextMembers,
    sessions: nextSessions,
    attendance: nextAttendance,
    baseMembers: nextBaseMembers,
    baseSessions: nextBaseSessions,
    baseAttendance: nextBaseAttendance,
    dirtyMemberIds: Array.from(remainingDirtyMembers),
    dirtySessionIds: Array.from(remainingDirtySessions),
    dirtyAttendanceKeys: Array.from(remainingDirtyAttendance),
    conflicts: nextConflicts,
  });

  try {
    for (const id of store.dirtyMemberIds) {
      const local = nextMembers[id];
      if (!local) {
        remainingDirtyMembers.delete(id);
        madeProgress = true;
        continue;
      }
      const base = nextBaseMembers[id];
      const result = await pushMemberWithCas(id, local, base, tabId);
      if (result.outcome === 'synced') {
        nextMembers[id] = result.record;
        nextBaseMembers[id] = result.record;
        nextConflicts = removeConflictByEntity(nextConflicts, 'member', id);
      } else if (result.outcome === 'deleted_remotely') {
        delete nextMembers[id];
        delete nextBaseMembers[id];
        nextConflicts = removeConflictByEntity(nextConflicts, 'member', id);
      } else {
        nextBaseMembers[id] = result.remote;
        nextConflicts = upsertConflictItem(nextConflicts, result.conflict);
      }
      remainingDirtyMembers.delete(id);
      madeProgress = true;
    }

    for (const id of store.dirtySessionIds) {
      const local = nextSessions[id];
      if (!local) {
        remainingDirtySessions.delete(id);
        madeProgress = true;
        continue;
      }
      const base = nextBaseSessions[id];
      const result = await pushSessionWithCas(id, local, base, tabId);
      if (result.outcome === 'synced') {
        nextSessions[id] = result.record;
        nextBaseSessions[id] = result.record;
        nextConflicts = removeConflictByEntity(nextConflicts, 'session', id);
      } else if (result.outcome === 'deleted_remotely') {
        delete nextSessions[id];
        delete nextBaseSessions[id];
        nextConflicts = removeConflictByEntity(nextConflicts, 'session', id);
      } else {
        nextBaseSessions[id] = result.remote;
        nextConflicts = upsertConflictItem(nextConflicts, result.conflict);
      }
      remainingDirtySessions.delete(id);
      madeProgress = true;
    }

    for (const key of store.dirtyAttendanceKeys) {
      const local = nextAttendance[key];
      if (!local) {
        remainingDirtyAttendance.delete(key);
        madeProgress = true;
        continue;
      }
      if (!nextSessions[local.sessionId] || !nextMembers[local.memberId]) {
        remainingDirtyAttendance.delete(key);
        madeProgress = true;
        continue;
      }
      // Wait to push child attendance if its parent session/member is still uncreated on server.
      if (
        (nextMembers[local.memberId].syncVersion === undefined &&
          !nextBaseMembers[local.memberId]?.syncVersion) ||
        (nextSessions[local.sessionId].syncVersion === undefined &&
          !nextBaseSessions[local.sessionId]?.syncVersion)
      ) {
        continue;
      }

      const base = nextBaseAttendance[key];
      const result = await pushAttendanceWithCas(key, local, base, tabId, {
        memberName: nextMembers[local.memberId]?.name,
        sessionName: nextSessions[local.sessionId]?.name,
      });
      if (result.outcome === 'synced') {
        nextAttendance[key] = result.record;
        nextBaseAttendance[key] = result.record;
        nextConflicts = removeConflictByEntity(nextConflicts, 'attendance', key);
      } else if (result.outcome === 'deleted_remotely') {
        delete nextAttendance[key];
        delete nextBaseAttendance[key];
        nextConflicts = removeConflictByEntity(nextConflicts, 'attendance', key);
      } else {
        nextBaseAttendance[key] = result.remote;
        nextConflicts = upsertConflictItem(nextConflicts, result.conflict);
      }
      remainingDirtyAttendance.delete(key);
      madeProgress = true;
    }
  } catch (error) {
    if (madeProgress) {
      const partialStore = buildSnapshot();
      saveLocalSyncStore(userId, partialStore);
      options?.onPartialProgress?.(partialStore);
    }
    throw error;
  }

  const nextStore = buildSnapshot();
  saveLocalSyncStore(userId, nextStore);
  return nextStore;
}

/**
 * Applies a user's explicit conflict resolution ('keep_local' or 'use_remote') and persists/syncs it.
 */
export function applyConflictResolutionToStore(
  store: LocalSyncStore,
  conflictId: string,
  resolution: SyncConflictResolution,
): LocalSyncStore {
  const conflict = store.conflicts.find((item) => item.id === conflictId);
  if (!conflict) return store;

  const now = new Date().toISOString();
  const nextConflicts = store.conflicts.filter((item) => item.id !== conflictId);

  if (conflict.entityType === 'member') {
    const remote = conflict.remoteRecord as SyncedMemberRecord;
    const local = conflict.localRecord as SyncedMemberRecord;
    const nextMembers = { ...store.members };
    const nextBaseMembers = { ...store.baseMembers };
    const dirtyMembers = new Set(store.dirtyMemberIds);

    if (resolution === 'use_remote') {
      if (remote.syncVersion === undefined && remote.deletedAt) {
        delete nextMembers[conflict.entityId];
        delete nextBaseMembers[conflict.entityId];
      } else {
        nextMembers[conflict.entityId] = remote;
        nextBaseMembers[conflict.entityId] = remote;
      }
      dirtyMembers.delete(conflict.entityId);
    } else {
      if (remote.syncVersion === undefined && remote.deletedAt) {
        // Re-create row that was hard-deleted on server
        delete nextBaseMembers[conflict.entityId];
        nextMembers[conflict.entityId] = {
          ...local,
          syncVersion: undefined,
          updatedAt: now,
          deletedAt: null,
        };
      } else {
        nextBaseMembers[conflict.entityId] = remote;
        nextMembers[conflict.entityId] = {
          ...local,
          syncVersion: remote.syncVersion,
          updatedAt: now,
        };
      }
      dirtyMembers.add(conflict.entityId);
    }

    return {
      ...store,
      members: nextMembers,
      baseMembers: nextBaseMembers,
      dirtyMemberIds: Array.from(dirtyMembers),
      conflicts: nextConflicts,
    };
  }

  if (conflict.entityType === 'session') {
    const remote = conflict.remoteRecord as SyncedSessionRecord;
    const local = conflict.localRecord as SyncedSessionRecord;
    const nextSessions = { ...store.sessions };
    const nextBaseSessions = { ...store.baseSessions };
    const dirtySessions = new Set(store.dirtySessionIds);

    if (resolution === 'use_remote') {
      if (remote.syncVersion === undefined && remote.deletedAt) {
        delete nextSessions[conflict.entityId];
        delete nextBaseSessions[conflict.entityId];
      } else {
        nextSessions[conflict.entityId] = remote;
        nextBaseSessions[conflict.entityId] = remote;
      }
      dirtySessions.delete(conflict.entityId);
    } else {
      if (remote.syncVersion === undefined && remote.deletedAt) {
        delete nextBaseSessions[conflict.entityId];
        nextSessions[conflict.entityId] = {
          ...local,
          syncVersion: undefined,
          updatedAt: now,
          deletedAt: null,
        };
      } else {
        nextBaseSessions[conflict.entityId] = remote;
        nextSessions[conflict.entityId] = {
          ...local,
          syncVersion: remote.syncVersion,
          updatedAt: now,
        };
      }
      dirtySessions.add(conflict.entityId);
    }

    return {
      ...store,
      sessions: nextSessions,
      baseSessions: nextBaseSessions,
      dirtySessionIds: Array.from(dirtySessions),
      conflicts: nextConflicts,
    };
  }

  const remote = conflict.remoteRecord as SyncedAttendanceRecord;
  const local = conflict.localRecord as SyncedAttendanceRecord;
  const nextAttendance = { ...store.attendance };
  const nextBaseAttendance = { ...store.baseAttendance };
  const dirtyAttendance = new Set(store.dirtyAttendanceKeys);

  if (resolution === 'use_remote') {
    if (remote.syncVersion === undefined && remote.deletedAt) {
      delete nextAttendance[conflict.entityId];
      delete nextBaseAttendance[conflict.entityId];
    } else {
      nextAttendance[conflict.entityId] = remote;
      nextBaseAttendance[conflict.entityId] = remote;
    }
    dirtyAttendance.delete(conflict.entityId);
  } else {
    if (remote.syncVersion === undefined && remote.deletedAt) {
      delete nextBaseAttendance[conflict.entityId];
      nextAttendance[conflict.entityId] = {
        ...local,
        syncVersion: undefined,
        updatedAt: now,
        deletedAt: null,
      };
    } else {
      nextBaseAttendance[conflict.entityId] = remote;
      nextAttendance[conflict.entityId] = {
        ...local,
        syncVersion: remote.syncVersion,
        updatedAt: now,
      };
    }
    dirtyAttendance.add(conflict.entityId);
  }

  return {
    ...store,
    attendance: nextAttendance,
    baseAttendance: nextBaseAttendance,
    dirtyAttendanceKeys: Array.from(dirtyAttendance),
    conflicts: nextConflicts,
  };
}

export function getConflictIdForEntity(
  entityType: 'member' | 'session' | 'attendance',
  entityId: string,
): string {
  return makeConflictId(entityType, entityId);
}
