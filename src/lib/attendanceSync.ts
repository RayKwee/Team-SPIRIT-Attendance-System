import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  LocalSyncStore,
  SyncedAttendanceRecord,
  SyncedMemberRecord,
  SyncedSessionRecord,
} from '../types/attendance';
import {
  clearLegacyWorkspaceStorage,
  loadMembers as loadLegacyMembers,
  loadSessions as loadLegacySessions,
} from '../utils/storage';
import { supabase } from './supabase';

const SYNC_STORE_KEY_PREFIX = 'team-spirit:sync-store:v1:';
export const LOCAL_ONLY_STORE_KEY = 'team-spirit:local-store:v1';

interface DbMemberRow {
  id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  handle: string | null;
  joined_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
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
}

interface DbAttendanceRow {
  session_id: string;
  member_id: string;
  status: AttendanceStatus;
  reason: string | null;
  sort_order: number;
  updated_at: string;
  deleted_at: string | null;
}

export interface RemoteSnapshot {
  members: Record<string, SyncedMemberRecord>;
  sessions: Record<string, SyncedSessionRecord>;
  attendance: Record<string, SyncedAttendanceRecord>;
}

const MISSING_TABLE_USER_MESSAGE =
  'Supabase tables (club_members, attendance_sessions, session_attendance) were not found. Run supabase/schema.sql in your Supabase SQL Editor, then click to retry.';

const PERMISSION_DENIED_USER_MESSAGE =
  'Supabase denied access (403 Forbidden). Run the updated GRANT & RLS script in supabase/schema.sql in your Supabase SQL Editor, then click to retry.';

const AUTH_EXPIRED_USER_MESSAGE =
  'Your Supabase Cloud Sync session expired or is invalid. Sign out and sign back in via Cloud Sync.';

const MISSING_TABLE_PATTERN = /could not find the table|relation .* does not exist|schema cache/i;
const PERMISSION_DENIED_PATTERN =
  /permission denied|insufficient_privilege|row-level security|forbidden|not allowed/i;
const AUTH_EXPIRED_PATTERN =
  /jwt expired|invalid jwt|jwt malformed|no suitable key|token has expired|session.*missing|not authenticated/i;

/** Normalized Error wrapper for Supabase PostgREST / network failures. */
export class SupabaseSyncError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly isMissingTable: boolean;
  readonly isPermissionDenied: boolean;
  readonly isAuthExpired: boolean;

  constructor(
    message: string,
    options?: {
      code?: string;
      status?: number;
      isMissingTable?: boolean;
      isPermissionDenied?: boolean;
      isAuthExpired?: boolean;
    },
  ) {
    super(message);
    this.name = 'SupabaseSyncError';
    this.code = options?.code;
    this.status = options?.status;
    this.isMissingTable = Boolean(options?.isMissingTable);
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
    dirtyMemberIds: [],
    dirtySessionIds: [],
    dirtyAttendanceKeys: [],
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
  return {
    id: row.id,
    name: row.name,
    role: cleanOptionalText(row.role),
    email: cleanOptionalText(row.email),
    phone: cleanOptionalText(row.phone),
    handle: cleanOptionalText(row.handle),
    joinedDate: cleanOptionalText(row.joined_date),
    notes: cleanOptionalText(row.notes),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
    deletedAt: row.deleted_at ?? null,
  };
}

export function memberToDbRow(member: SyncedMemberRecord): DbMemberRow {
  return {
    id: member.id,
    name: member.name,
    role: member.role ?? null,
    email: member.email ?? null,
    phone: member.phone ?? null,
    handle: member.handle ?? null,
    joined_date: member.joinedDate ?? null,
    notes: member.notes ?? null,
    created_at: member.createdAt,
    updated_at: member.updatedAt,
    deleted_at: member.deletedAt ?? null,
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
  };
}

export function sessionToDbRow(session: SyncedSessionRecord): DbSessionRow {
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
  };
}

export function attendanceToDbRow(record: SyncedAttendanceRecord): DbAttendanceRow {
  return {
    session_id: record.sessionId,
    member_id: record.memberId,
    status: record.status,
    reason: record.status === 'absent_with_reason' ? (record.reason ?? null) : null,
    sort_order: record.sortOrder,
    updated_at: record.updatedAt,
    deleted_at: record.deletedAt ?? null,
  };
}

function saveStoreByKey(storageKey: string, store: LocalSyncStore): void {
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors safely.
  }
}

function loadStoreByKey(storageKey: string): LocalSyncStore {
  let store = createEmptySyncStore();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalSyncStore>;
      store = {
        members: parsed.members && typeof parsed.members === 'object' ? parsed.members : {},
        sessions: parsed.sessions && typeof parsed.sessions === 'object' ? parsed.sessions : {},
        attendance:
          parsed.attendance && typeof parsed.attendance === 'object' ? parsed.attendance : {},
        dirtyMemberIds: Array.isArray(parsed.dirtyMemberIds) ? parsed.dirtyMemberIds : [],
        dirtySessionIds: Array.isArray(parsed.dirtySessionIds) ? parsed.dirtySessionIds : [],
        dirtyAttendanceKeys: Array.isArray(parsed.dirtyAttendanceKeys)
          ? parsed.dirtyAttendanceKeys
          : [],
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
    dirtyMemberIds: Array.from(dirtyMembers),
    dirtySessionIds: Array.from(dirtySessions),
    dirtyAttendanceKeys: Array.from(dirtyAttendance),
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

/** Converts normalized sync records into UI-ready active ClubMember[] and AttendanceSession[] arrays. */
export function deriveWorkspaceState(store: LocalSyncStore): {
  members: ClubMember[];
  sessions: AttendanceSession[];
} {
  const activeMembers: ClubMember[] = Object.values(store.members)
    .filter((member) => !member.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
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

/** Pushes records in foreign-key dependency order: members -> sessions -> attendance. */
async function pushRecordsToSupabase(
  members: SyncedMemberRecord[],
  sessions: SyncedSessionRecord[],
  attendance: SyncedAttendanceRecord[],
): Promise<void> {
  if (members.length > 0) {
    await runSupabaseQueryWithAuthRetry(
      () => supabase.from('club_members').upsert(members.map(memberToDbRow), { onConflict: 'id' }),
      'Failed to sync club members with Supabase.',
    );
  }

  if (sessions.length > 0) {
    await runSupabaseQueryWithAuthRetry(
      () =>
        supabase
          .from('attendance_sessions')
          .upsert(sessions.map(sessionToDbRow), { onConflict: 'id' }),
      'Failed to sync sessions with Supabase.',
    );
  }

  if (attendance.length > 0) {
    await runSupabaseQueryWithAuthRetry(
      () =>
        supabase.from('session_attendance').upsert(attendance.map(attendanceToDbRow), {
          onConflict: 'session_id,member_id',
        }),
      'Failed to sync attendance records with Supabase.',
    );
  }
}

/**
 * Merges local timestamped state (including offline edits & delete tombstones) with Supabase
 * using latest-timestamp-wins conflict resolution, then pushes any newer local changes upward.
 */
export async function reconcileWithSupabase(
  userId: string,
  localStore: LocalSyncStore,
): Promise<LocalSyncStore> {
  const remote = await pullRemoteSnapshot();

  const mergedMembers: Record<string, SyncedMemberRecord> = {};
  const membersToPush: SyncedMemberRecord[] = [];
  const allMemberIds = new Set([
    ...Object.keys(localStore.members),
    ...Object.keys(remote.members),
  ]);

  for (const id of allMemberIds) {
    const local = localStore.members[id];
    const remoteRec = remote.members[id];
    if (local && remoteRec) {
      const localTs = getEffectiveTimestamp(local.updatedAt, local.deletedAt);
      const remoteTs = getEffectiveTimestamp(remoteRec.updatedAt, remoteRec.deletedAt);
      if (remoteTs >= localTs) {
        mergedMembers[id] = remoteRec;
      } else {
        mergedMembers[id] = local;
        membersToPush.push(local);
      }
    } else if (remoteRec) {
      mergedMembers[id] = remoteRec;
    } else if (local) {
      mergedMembers[id] = local;
      if (!local.deletedAt || localStore.dirtyMemberIds.includes(id)) {
        membersToPush.push(local);
      }
    }
  }

  const mergedSessions: Record<string, SyncedSessionRecord> = {};
  const sessionsToPush: SyncedSessionRecord[] = [];
  const allSessionIds = new Set([
    ...Object.keys(localStore.sessions),
    ...Object.keys(remote.sessions),
  ]);

  for (const id of allSessionIds) {
    const local = localStore.sessions[id];
    const remoteRec = remote.sessions[id];
    if (local && remoteRec) {
      const localTs = getEffectiveTimestamp(local.updatedAt, local.deletedAt);
      const remoteTs = getEffectiveTimestamp(remoteRec.updatedAt, remoteRec.deletedAt);
      if (remoteTs >= localTs) {
        mergedSessions[id] = remoteRec;
      } else {
        mergedSessions[id] = local;
        sessionsToPush.push(local);
      }
    } else if (remoteRec) {
      mergedSessions[id] = remoteRec;
    } else if (local) {
      mergedSessions[id] = local;
      if (!local.deletedAt || localStore.dirtySessionIds.includes(id)) {
        sessionsToPush.push(local);
      }
    }
  }

  const mergedAttendance: Record<string, SyncedAttendanceRecord> = {};
  const attendanceToPush: SyncedAttendanceRecord[] = [];
  const allAttendanceKeys = new Set([
    ...Object.keys(localStore.attendance),
    ...Object.keys(remote.attendance),
  ]);

  for (const key of allAttendanceKeys) {
    const local = localStore.attendance[key];
    const remoteRec = remote.attendance[key];
    let winner: SyncedAttendanceRecord | undefined;
    let shouldPush = false;

    if (local && remoteRec) {
      const localTs = getEffectiveTimestamp(local.updatedAt, local.deletedAt);
      const remoteTs = getEffectiveTimestamp(remoteRec.updatedAt, remoteRec.deletedAt);
      if (remoteTs >= localTs) {
        winner = remoteRec;
      } else {
        winner = local;
        shouldPush = true;
      }
    } else if (remoteRec) {
      winner = remoteRec;
    } else if (local) {
      winner = local;
      shouldPush = !local.deletedAt || localStore.dirtyAttendanceKeys.includes(key);
    }

    if (!winner) continue;
    mergedAttendance[key] = winner;

    if (
      shouldPush &&
      mergedSessions[winner.sessionId] &&
      mergedMembers[winner.memberId]
    ) {
      attendanceToPush.push(winner);
    }
  }

  // Push local winners in foreign-key dependency order: members -> sessions -> attendance.
  await pushRecordsToSupabase(membersToPush, sessionsToPush, attendanceToPush);

  const nextStore: LocalSyncStore = {
    members: mergedMembers,
    sessions: mergedSessions,
    attendance: mergedAttendance,
    dirtyMemberIds: [],
    dirtySessionIds: [],
    dirtyAttendanceKeys: [],
    legacyImported: true,
  };

  saveLocalSyncStore(userId, nextStore);
  clearLegacyWorkspaceStorage();
  return nextStore;
}

/** Pushes only queued dirty items (inserts, updates, and delete tombstones) to Supabase. */
export async function pushDirtyQueueToSupabase(
  userId: string,
  store: LocalSyncStore,
): Promise<LocalSyncStore> {
  const dirtyMembers = store.dirtyMemberIds
    .map((id) => store.members[id])
    .filter((item): item is SyncedMemberRecord => Boolean(item));

  const dirtySessions = store.dirtySessionIds
    .map((id) => store.sessions[id])
    .filter((item): item is SyncedSessionRecord => Boolean(item));

  const dirtyAttendance = store.dirtyAttendanceKeys
    .map((key) => store.attendance[key])
    .filter(
      (item): item is SyncedAttendanceRecord =>
        Boolean(item && store.sessions[item.sessionId] && store.members[item.memberId]),
    );

  await pushRecordsToSupabase(dirtyMembers, dirtySessions, dirtyAttendance);

  const nextStore: LocalSyncStore = {
    ...store,
    dirtyMemberIds: [],
    dirtySessionIds: [],
    dirtyAttendanceKeys: [],
  };
  saveLocalSyncStore(userId, nextStore);
  return nextStore;
}
