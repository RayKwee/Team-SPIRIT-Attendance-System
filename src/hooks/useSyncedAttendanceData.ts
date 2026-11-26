import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOCAL_ONLY_STORE_KEY,
  applyConflictResolutionToStore,
  attendanceFromDbRow,
  clearLocalSyncStore,
  createEmptySyncStore,
  deriveWorkspaceState,
  getClientTabId,
  getEffectiveTimestamp,
  getSyncStoreKey,
  hasDirtySyncItems,
  hasSyncConflicts,
  loadLocalOnlyStore,
  loadLocalSyncStore,
  makeAttendanceKey,
  memberFromDbRow,
  mergeLocalOnlyIntoUserStore,
  pushDirtyQueueToSupabase,
  reconcileWithSupabase,
  saveLocalOnlyStore,
  saveLocalSyncStore,
  sessionFromDbRow,
  toSupabaseSyncError,
  type SupabaseSyncError,
} from '../lib/attendanceSync';
import {
  ATTENDANCE_MERGE_FIELDS,
  MEMBER_MERGE_FIELDS,
  SESSION_MERGE_FIELDS,
  buildAttendanceConflictItem,
  buildMemberConflictItem,
  buildSessionConflictItem,
  normalizeMergedAttendance,
  reconcileIncomingEntity,
  removeConflictByEntity,
  upsertConflictItem,
} from '../lib/syncConflictEngine';
import { supabase } from '../lib/supabase';
import type {
  AttendanceSession,
  AttendanceStatus,
  ClassLetter,
  ClassYear,
  ClubMember,
  DefaultAssignmentStatus,
  LocalSyncStore,
  MemberProfileInput,
  NewSessionInput,
  RealtimeStatus,
  SessionUpdateInput,
  SyncConflictItem,
  SyncConflictResolution,
  SyncStatus,
  SyncedAttendanceRecord,
  SyncedMemberRecord,
  SyncedSessionRecord,
} from '../types/attendance';
import {
  applyAnnualProgressionToMember,
  applyMemberProfileUpdate,
  buildClubMember,
  canUserViewSession,
  formatStudentClassName,
  generateId,
  getPromotionCycleYear,
  normalizeMeetingVisibility,
  normalizeMemberType,
  resolveStudentClassFields,
  runAnnualClassProgression,
  type AnnualProgressionSummary,
} from '../utils/attendance';

const REASON_DEBOUNCE_MS = 450;
const BACKGROUND_SYNC_INTERVAL_MS = 15_000;
const CHANGE_SYNC_COOLDOWN_MS = 1_000;
const PUSH_LEASE_TTL_MS = 8_000;

async function withTabPushLease<T>(userId: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks) {
    return await navigator.locks.request(`team-spirit-push:${userId}`, async () => await work());
  }

  const leaseKey = `team-spirit:push-lease:${userId}`;
  const tabId = getClientTabId();
  const waitUntil = Date.now() + 3_000;

  while (Date.now() < waitUntil) {
    try {
      const raw = window.localStorage.getItem(leaseKey);
      const parsed = raw ? (JSON.parse(raw) as { owner?: string; expiresAt?: number }) : null;
      if (!parsed || !parsed.expiresAt || parsed.expiresAt < Date.now() || parsed.owner === tabId) {
        window.localStorage.setItem(
          leaseKey,
          JSON.stringify({ owner: tabId, expiresAt: Date.now() + PUSH_LEASE_TTL_MS }),
        );
        break;
      }
    } catch {
      break;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 60));
  }

  try {
    return await work();
  } finally {
    try {
      const raw = window.localStorage.getItem(leaseKey);
      const parsed = raw ? (JSON.parse(raw) as { owner?: string }) : null;
      if (parsed?.owner === tabId) {
        window.localStorage.removeItem(leaseKey);
      }
    } catch {
      // Ignore lease cleanup errors.
    }
  }
}

function isBlockingSyncError(error: SupabaseSyncError): boolean {
  return (
    error.isMissingTable ||
    error.isMissingColumn ||
    error.isPermissionDenied ||
    error.isAuthExpired
  );
}

interface UndoDelta {
  members: Record<string, SyncedMemberRecord | undefined>;
  sessions: Record<string, SyncedSessionRecord | undefined>;
  attendance: Record<string, SyncedAttendanceRecord | undefined>;
}

function buildUndoDelta(prev: LocalSyncStore, next: LocalSyncStore): UndoDelta {
  const members: Record<string, SyncedMemberRecord | undefined> = {};
  const memberIds = new Set([...Object.keys(prev.members), ...Object.keys(next.members)]);
  for (const id of memberIds) {
    if (prev.members[id] !== next.members[id]) {
      members[id] = prev.members[id];
    }
  }

  const sessions: Record<string, SyncedSessionRecord | undefined> = {};
  const sessionIds = new Set([...Object.keys(prev.sessions), ...Object.keys(next.sessions)]);
  for (const id of sessionIds) {
    if (prev.sessions[id] !== next.sessions[id]) {
      sessions[id] = prev.sessions[id];
    }
  }

  const attendance: Record<string, SyncedAttendanceRecord | undefined> = {};
  const attendanceKeys = new Set([
    ...Object.keys(prev.attendance),
    ...Object.keys(next.attendance),
  ]);
  for (const key of attendanceKeys) {
    if (prev.attendance[key] !== next.attendance[key]) {
      attendance[key] = prev.attendance[key];
    }
  }

  return { members, sessions, attendance };
}

function countDirtySyncItems(store: LocalSyncStore): number {
  return (
    store.dirtyMemberIds.length +
    store.dirtySessionIds.length +
    store.dirtyAttendanceKeys.length
  );
}

export interface UseSyncedAttendanceDataResult {
  members: ClubMember[];
  sessions: AttendanceSession[];
  syncStatus: SyncStatus;
  realtimeStatus: RealtimeStatus;
  syncError: string | null;
  pendingCount: number;
  conflicts: SyncConflictItem[];
  conflictCount: number;
  isEditingActive: boolean;
  hasUnsavedChanges: boolean;
  beginFieldEdit: (fieldKey: string) => void;
  endFieldEdit: (fieldKey: string) => void;
  resolveConflict: (conflictId: string, resolution: SyncConflictResolution) => Promise<void>;
  resolveAllConflicts: (resolution: SyncConflictResolution) => Promise<void>;
  createSession: (
    input: NewSessionInput,
    options?: {
      initialMemberIds?: string[];
      defaultStatus?: DefaultAssignmentStatus;
    },
  ) => AttendanceSession;
  updateSession: (sessionId: string, input: SessionUpdateInput) => AttendanceSession | null;
  deleteSession: (sessionId: string) => void;
  addMember: (input: string | MemberProfileInput) => ClubMember;
  addMembersBulk: (inputs: MemberProfileInput[]) => ClubMember[];
  updateMember: (memberId: string, input: MemberProfileInput) => void;
  updateMembersClass: (
    memberIds: string[],
    patch: { classYear?: ClassYear; classLetter?: ClassLetter },
  ) => number;
  setMemberLegacyStatus: (memberId: string, isLegacy: boolean) => void;
  setMembersLegacyStatus: (
    memberIds: string[],
    isLegacy: boolean,
    options?: { fallbackClassYear?: ClassYear; fallbackClassLetter?: ClassLetter },
  ) => number;
  deleteMembers: (memberIds: string[]) => void;
  assignMemberToSession: (
    sessionId: string,
    memberId: string,
    defaultStatus?: DefaultAssignmentStatus,
  ) => void;
  assignMembersToSession: (
    sessionId: string,
    memberIds: string[],
    defaultStatus?: DefaultAssignmentStatus,
  ) => void;
  removeMemberFromSession: (sessionId: string, memberId: string) => void;
  toggleAttendanceStatus: (
    sessionId: string,
    memberId: string,
    targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
  ) => void;
  setAbsenceReason: (sessionId: string, memberId: string, reason: string) => void;
  resetSessionMarks: (sessionId: string) => void;
  importBackupData: (
    members: ClubMember[],
    sessions: AttendanceSession[],
  ) => { importedMembers: number; importedSessions: number };
  getLastUndoToken: () => string | null;
  undoByToken: (token: string) => boolean;
  flushPendingChanges: () => Promise<boolean>;
  prepareForSignOut: () => Promise<void>;
  setMergeLocalOnNextConnect: (shouldMerge: boolean) => void;
}

/**
 * Coordinates optimistic local mutations, timestamped delete tombstones, Supabase
 * two-way conflict resolution, Realtime updates, and Google-Docs-style beforeunload safety.
 */
export function useSyncedAttendanceData(
  userId: string | null,
  options?: {
    onAnnualProgression?: (summary: AnnualProgressionSummary) => void;
    isReadOnlyCloud?: boolean;
    isAuthResolving?: boolean;
    scopeVersionKey?: string;
  },
): UseSyncedAttendanceDataResult {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (userId ? 'loading' : 'local'));
  const [realtimeStatus, setRealtimeStatus] = useState<RealtimeStatus>('disconnected');
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<SyncConflictItem[]>([]);
  const [isEditingActive, setIsEditingActive] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const storeRef = useRef<LocalSyncStore>(createEmptySyncStore());
  const userIdRef = useRef<string | null>(userId);
  const isReadOnlyCloud = Boolean(userId && options?.isReadOnlyCloud);
  const isAuthResolving = Boolean(userId && options?.isAuthResolving);
  const scopeVersionKey = options?.scopeVersionKey ?? '';
  const isReadOnlyCloudRef = useRef(isReadOnlyCloud);
  const isAuthResolvingRef = useRef(isAuthResolving);
  isReadOnlyCloudRef.current = isReadOnlyCloud;
  isAuthResolvingRef.current = isAuthResolving;
  const onAnnualProgressionRef = useRef(options?.onAnnualProgression);
  onAnnualProgressionRef.current = options?.onAnnualProgression;
  const undoStackRef = useRef<{ token: string; delta: UndoDelta }[]>([]);
  const lastUndoTokenRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const needsFollowUpFlushRef = useRef(false);
  const needsFollowUpReconcileRef = useRef(false);
  const mergeLocalOnNextConnectRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const changeSyncTimerRef = useRef<number | null>(null);
  const backgroundIntervalRef = useRef<number | null>(null);
  const realtimeReconnectTimerRef = useRef<number | null>(null);
  const realtimeReconnectAttemptRef = useRef(0);
  const lastChangeSyncAtRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const syncBlockedRef = useRef(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const broadcastChannelRef = useRef<BroadcastChannel | null>(null);
  const activeFieldEditsRef = useRef<Set<string>>(new Set());
  const deferredMemberRealtimeRef = useRef<Map<string, SyncedMemberRecord>>(new Map());
  const deferredSessionRealtimeRef = useRef<Map<string, SyncedSessionRecord>>(new Map());
  const deferredAttendanceRealtimeRef = useRef<Map<string, SyncedAttendanceRecord>>(new Map());
  const prevScopeVersionKeyRef = useRef<string>(scopeVersionKey);

  userIdRef.current = userId;

  const setMergeLocalOnNextConnect = useCallback((shouldMerge: boolean) => {
    mergeLocalOnNextConnectRef.current = shouldMerge;
  }, []);

  const persistStoreAndNotifyTabs = useCallback(
    (activeUserId: string | null, nextStore: LocalSyncStore) => {
      if (activeUserId) {
        saveLocalSyncStore(activeUserId, nextStore);
      } else {
        saveLocalOnlyStore(nextStore);
      }
      try {
        broadcastChannelRef.current?.postMessage({
          type: 'store-updated',
          senderTabId: getClientTabId(),
        });
      } catch {
        // Ignore BroadcastChannel errors.
      }
    },
    [],
  );

  const resolveStatusFromStore = useCallback(
    (store: LocalSyncStore, fallback: SyncStatus): SyncStatus => {
      if (!userIdRef.current) return 'local';
      if (hasSyncConflicts(store)) return 'conflict';
      if (syncBlockedRef.current) return hasDirtySyncItems(store) ? 'pending' : 'error';
      if (syncInFlightRef.current) return 'syncing';
      if (hasDirtySyncItems(store)) return 'pending';
      return fallback;
    },
    [],
  );

  const applyProgressionToCurrentStore = useCallback(
    (activeUserId: string | null): boolean => {
      const current = storeRef.current;
      const { nextMembers, summary } = runAnnualClassProgression(current.members, new Date());
      if (summary.changedIds.length === 0) {
        return false;
      }

      const nextStore: LocalSyncStore = {
        ...current,
        members: nextMembers,
        dirtyMemberIds: Array.from(new Set([...current.dirtyMemberIds, ...summary.changedIds])),
      };
      storeRef.current = nextStore;
      persistStoreAndNotifyTabs(activeUserId, nextStore);
      onAnnualProgressionRef.current?.(summary);
      return true;
    },
    [persistStoreAndNotifyTabs],
  );

  const refreshDerivedState = useCallback(() => {
    const store = storeRef.current;
    const derived = deriveWorkspaceState(store);
    const dirtyTotal =
      store.dirtyMemberIds.length +
      store.dirtySessionIds.length +
      store.dirtyAttendanceKeys.length;
    const hasPendingSyncTimer =
      debounceTimerRef.current !== null || changeSyncTimerRef.current !== null;

    setMembers(derived.members);
    setSessions(derived.sessions);
    setPendingCount(userIdRef.current ? dirtyTotal : 0);
    setConflicts(userIdRef.current ? store.conflicts : []);
    setHasUnsavedChanges(
      Boolean(userIdRef.current) &&
        (dirtyTotal > 0 ||
          syncInFlightRef.current ||
          hasPendingSyncTimer ||
          activeFieldEditsRef.current.size > 0),
    );
  }, []);

  const beginFieldEdit = useCallback(
    (fieldKey: string) => {
      activeFieldEditsRef.current.add(fieldKey);
      setIsEditingActive(true);
      refreshDerivedState();
    },
    [refreshDerivedState],
  );

  const clearDebounceTimer = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const clearChangeSyncTimer = useCallback(() => {
    if (changeSyncTimerRef.current !== null) {
      window.clearTimeout(changeSyncTimerRef.current);
      changeSyncTimerRef.current = null;
    }
  }, []);

  const clearBackgroundInterval = useCallback(() => {
    if (backgroundIntervalRef.current !== null) {
      window.clearInterval(backgroundIntervalRef.current);
      backgroundIntervalRef.current = null;
    }
  }, []);

  const clearRealtimeReconnectTimer = useCallback(() => {
    if (realtimeReconnectTimerRef.current !== null) {
      window.clearTimeout(realtimeReconnectTimerRef.current);
      realtimeReconnectTimerRef.current = null;
    }
  }, []);

  const cleanupRealtimeSubscription = useCallback(() => {
    clearRealtimeReconnectTimer();
    const channel = realtimeChannelRef.current;
    if (!channel) {
      setRealtimeStatus('disconnected');
      return;
    }
    realtimeChannelRef.current = null;
    setRealtimeStatus('disconnected');
    void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
  }, [clearRealtimeReconnectTimer]);

  const mergeSiblingStoreIntoCurrent = useCallback(
    (activeUserId: string | null, siblingStore: LocalSyncStore) => {
      const current = storeRef.current;
      const currentDirtyMembers = new Set(current.dirtyMemberIds);
      const currentDirtySessions = new Set(current.dirtySessionIds);
      const currentDirtyAttendance = new Set(current.dirtyAttendanceKeys);
      const siblingDirtyMembers = new Set(siblingStore.dirtyMemberIds);
      const siblingDirtySessions = new Set(siblingStore.dirtySessionIds);
      const siblingDirtyAttendance = new Set(siblingStore.dirtyAttendanceKeys);

      const nextMembers = { ...siblingStore.members };
      const nextDirtyMembers = new Set(siblingStore.dirtyMemberIds);
      for (const id of currentDirtyMembers) {
        const localRec = current.members[id];
        const siblingRec = siblingStore.members[id];
        const isEditingThis = activeFieldEditsRef.current.has(`member:${id}`);
        if (
          localRec &&
          (isEditingThis ||
            !siblingRec ||
            (!siblingDirtyMembers.has(id) &&
              getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt) >
                getEffectiveTimestamp(siblingRec.updatedAt, siblingRec.deletedAt)))
        ) {
          nextMembers[id] = localRec;
          nextDirtyMembers.add(id);
        }
      }

      const nextSessions = { ...siblingStore.sessions };
      const nextDirtySessions = new Set(siblingStore.dirtySessionIds);
      for (const id of currentDirtySessions) {
        const localRec = current.sessions[id];
        const siblingRec = siblingStore.sessions[id];
        const isEditingThis = activeFieldEditsRef.current.has(`session:${id}`);
        if (
          localRec &&
          (isEditingThis ||
            !siblingRec ||
            (!siblingDirtySessions.has(id) &&
              getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt) >
                getEffectiveTimestamp(siblingRec.updatedAt, siblingRec.deletedAt)))
        ) {
          nextSessions[id] = localRec;
          nextDirtySessions.add(id);
        }
      }

      const nextAttendance = { ...siblingStore.attendance };
      const nextDirtyAttendance = new Set(siblingStore.dirtyAttendanceKeys);
      for (const key of currentDirtyAttendance) {
        const localRec = current.attendance[key];
        const siblingRec = siblingStore.attendance[key];
        const isEditingThis = activeFieldEditsRef.current.has(`attendance:${key}`);
        if (
          localRec &&
          (isEditingThis ||
            !siblingRec ||
            (!siblingDirtyAttendance.has(key) &&
              getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt) >
                getEffectiveTimestamp(siblingRec.updatedAt, siblingRec.deletedAt)))
        ) {
          nextAttendance[key] = localRec;
          nextDirtyAttendance.add(key);
        }
      }

      // Preserve any actively edited field even if not yet queued dirty.
      for (const editKey of activeFieldEditsRef.current) {
        if (editKey.startsWith('attendance:')) {
          const attKey = editKey.slice('attendance:'.length);
          if (current.attendance[attKey]) {
            nextAttendance[attKey] = current.attendance[attKey];
          }
        } else if (editKey.startsWith('member:')) {
          const memberId = editKey.slice('member:'.length);
          if (current.members[memberId]) {
            nextMembers[memberId] = current.members[memberId];
          }
        } else if (editKey.startsWith('session:')) {
          const sessionId = editKey.slice('session:'.length);
          if (current.sessions[sessionId]) {
            nextSessions[sessionId] = current.sessions[sessionId];
          }
        }
      }

      storeRef.current = {
        members: nextMembers,
        sessions: nextSessions,
        attendance: nextAttendance,
        baseMembers: siblingStore.baseMembers,
        baseSessions: siblingStore.baseSessions,
        baseAttendance: siblingStore.baseAttendance,
        dirtyMemberIds: Array.from(nextDirtyMembers),
        dirtySessionIds: Array.from(nextDirtySessions),
        dirtyAttendanceKeys: Array.from(nextDirtyAttendance),
        conflicts: siblingStore.conflicts,
        legacyImported: siblingStore.legacyImported,
      };

      if (activeUserId && !syncInFlightRef.current) {
        setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
      }
      refreshDerivedState();
    },
    [refreshDerivedState, resolveStatusFromStore],
  );

  const ensureRealtimeSubscription = useCallback(
    (activeUserId: string) => {
      if (
        !mountedRef.current ||
        userIdRef.current !== activeUserId ||
        syncBlockedRef.current ||
        realtimeChannelRef.current
      ) {
        return;
      }

      setRealtimeStatus((prev) => (prev === 'reconnecting' ? 'reconnecting' : 'connecting'));

      const channel = supabase
        .channel(`team-spirit-sync-${activeUserId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'club_members' },
          (payload) => {
            if (userIdRef.current !== activeUserId) return;
            const current = storeRef.current;

            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as { id?: string } | null)?.id;
              if (!oldId || !current.members[oldId]) return;
              const isDirty = current.dirtyMemberIds.includes(oldId);
              const isEditingThis = activeFieldEditsRef.current.has(`member:${oldId}`);
              if (isDirty || isEditingThis) {
                const deletedRemote: SyncedMemberRecord = {
                  ...(current.baseMembers[oldId] ?? current.members[oldId]),
                  syncVersion: undefined,
                  deletedAt: new Date().toISOString(),
                };
                const nextBaseMembers = { ...current.baseMembers };
                delete nextBaseMembers[oldId];
                storeRef.current = {
                  ...current,
                  baseMembers: nextBaseMembers,
                  dirtyMemberIds: current.dirtyMemberIds.filter((id) => id !== oldId),
                  conflicts: upsertConflictItem(
                    current.conflicts,
                    buildMemberConflictItem(
                      oldId,
                      current.baseMembers[oldId],
                      current.members[oldId],
                      deletedRemote,
                      ['Deleted on Cloud'],
                    ),
                  ),
                };
                persistStoreAndNotifyTabs(activeUserId, storeRef.current);
                setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
                refreshDerivedState();
                return;
              }

              const nextMembers = { ...current.members };
              const nextBaseMembers = { ...current.baseMembers };
              delete nextMembers[oldId];
              delete nextBaseMembers[oldId];
              storeRef.current = {
                ...current,
                members: nextMembers,
                baseMembers: nextBaseMembers,
                conflicts: removeConflictByEntity(current.conflicts, 'member', oldId),
              };
              persistStoreAndNotifyTabs(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            if (!payload.new) return;
            const incoming = memberFromDbRow(payload.new as Parameters<typeof memberFromDbRow>[0]);
            const existing = current.members[incoming.id];
            const base = current.baseMembers[incoming.id];
            const isDirty = current.dirtyMemberIds.includes(incoming.id);
            const isEditingThis = activeFieldEditsRef.current.has(`member:${incoming.id}`);

            // Ignore older or duplicate server versions already stored as base.
            if (
              base?.syncVersion !== undefined &&
              incoming.syncVersion !== undefined &&
              incoming.syncVersion <= base.syncVersion &&
              !isDirty
            ) {
              return;
            }

            if (isEditingThis) {
              // Defer remote update until blur/save without advancing `base`, so CAS still
              // detects true concurrent edits against the ancestor version the editor loaded.
              deferredMemberRealtimeRef.current.set(incoming.id, incoming);
              return;
            }

            const outcome = reconcileIncomingEntity({
              local: existing,
              base,
              remote: incoming,
              isDirty,
              fields: MEMBER_MERGE_FIELDS,
            });

            if (outcome.action === 'accept_remote') {
              storeRef.current = {
                ...current,
                members: { ...current.members, [incoming.id]: outcome.record },
                baseMembers: { ...current.baseMembers, [incoming.id]: outcome.base },
                dirtyMemberIds: current.dirtyMemberIds.filter((id) => id !== incoming.id),
                conflicts: removeConflictByEntity(current.conflicts, 'member', incoming.id),
              };
            } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
              const nextDirty = outcome.needsPush
                ? Array.from(new Set([...current.dirtyMemberIds, incoming.id]))
                : current.dirtyMemberIds.filter((id) => id !== incoming.id);
              storeRef.current = {
                ...current,
                members: { ...current.members, [incoming.id]: outcome.record },
                baseMembers: { ...current.baseMembers, [incoming.id]: outcome.base },
                dirtyMemberIds: nextDirty,
                conflicts: removeConflictByEntity(current.conflicts, 'member', incoming.id),
              };
            } else {
              storeRef.current = {
                ...current,
                baseMembers: { ...current.baseMembers, [incoming.id]: outcome.base },
                dirtyMemberIds: current.dirtyMemberIds.filter((id) => id !== incoming.id),
                conflicts: upsertConflictItem(
                  current.conflicts,
                  buildMemberConflictItem(
                    incoming.id,
                    base,
                    existing!,
                    incoming,
                    outcome.conflictingFields,
                  ),
                ),
              };
            }

            persistStoreAndNotifyTabs(activeUserId, storeRef.current);
            setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
            refreshDerivedState();
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'attendance_sessions' },
          (payload) => {
            if (userIdRef.current !== activeUserId) return;
            const current = storeRef.current;

            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as { id?: string } | null)?.id;
              if (!oldId || !current.sessions[oldId]) return;
              const isDirty = current.dirtySessionIds.includes(oldId);
              const isEditingThis = activeFieldEditsRef.current.has(`session:${oldId}`);
              if (isDirty || isEditingThis) {
                const deletedRemote: SyncedSessionRecord = {
                  ...(current.baseSessions[oldId] ?? current.sessions[oldId]),
                  syncVersion: undefined,
                  deletedAt: new Date().toISOString(),
                };
                const nextBaseSessions = { ...current.baseSessions };
                delete nextBaseSessions[oldId];
                storeRef.current = {
                  ...current,
                  baseSessions: nextBaseSessions,
                  dirtySessionIds: current.dirtySessionIds.filter((id) => id !== oldId),
                  conflicts: upsertConflictItem(
                    current.conflicts,
                    buildSessionConflictItem(
                      oldId,
                      current.baseSessions[oldId],
                      current.sessions[oldId],
                      deletedRemote,
                      ['Deleted on Cloud'],
                    ),
                  ),
                };
                persistStoreAndNotifyTabs(activeUserId, storeRef.current);
                setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
                refreshDerivedState();
                return;
              }

              const nextSessions = { ...current.sessions };
              const nextBaseSessions = { ...current.baseSessions };
              delete nextSessions[oldId];
              delete nextBaseSessions[oldId];
              storeRef.current = {
                ...current,
                sessions: nextSessions,
                baseSessions: nextBaseSessions,
                conflicts: removeConflictByEntity(current.conflicts, 'session', oldId),
              };
              persistStoreAndNotifyTabs(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            if (!payload.new) return;
            const incoming = sessionFromDbRow(
              payload.new as Parameters<typeof sessionFromDbRow>[0],
            );

            // Defense-in-depth visibility enforcement for Realtime updates.
            const canViewIncoming = canUserViewSession(incoming, {
              isCloudConnected: true,
              isAdmin: !isReadOnlyCloudRef.current,
              currentUserId: activeUserId,
            });
            if (!canViewIncoming) {
              if (!current.sessions[incoming.id] && !current.baseSessions[incoming.id]) {
                return;
              }
              const nextSessions = { ...current.sessions };
              const nextBaseSessions = { ...current.baseSessions };
              delete nextSessions[incoming.id];
              delete nextBaseSessions[incoming.id];
              storeRef.current = {
                ...current,
                sessions: nextSessions,
                baseSessions: nextBaseSessions,
                dirtySessionIds: current.dirtySessionIds.filter((id) => id !== incoming.id),
                conflicts: removeConflictByEntity(current.conflicts, 'session', incoming.id),
              };
              persistStoreAndNotifyTabs(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            const existing = current.sessions[incoming.id];
            const base = current.baseSessions[incoming.id];
            const isDirty = current.dirtySessionIds.includes(incoming.id);
            const isEditingThis = activeFieldEditsRef.current.has(`session:${incoming.id}`);

            if (
              base?.syncVersion !== undefined &&
              incoming.syncVersion !== undefined &&
              incoming.syncVersion <= base.syncVersion &&
              !isDirty
            ) {
              return;
            }

            if (isEditingThis) {
              deferredSessionRealtimeRef.current.set(incoming.id, incoming);
              return;
            }

            const outcome = reconcileIncomingEntity({
              local: existing,
              base,
              remote: incoming,
              isDirty,
              fields: SESSION_MERGE_FIELDS,
            });

            if (outcome.action === 'accept_remote') {
              storeRef.current = {
                ...current,
                sessions: { ...current.sessions, [incoming.id]: outcome.record },
                baseSessions: { ...current.baseSessions, [incoming.id]: outcome.base },
                dirtySessionIds: current.dirtySessionIds.filter((id) => id !== incoming.id),
                conflicts: removeConflictByEntity(current.conflicts, 'session', incoming.id),
              };
            } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
              const nextDirty = outcome.needsPush
                ? Array.from(new Set([...current.dirtySessionIds, incoming.id]))
                : current.dirtySessionIds.filter((id) => id !== incoming.id);
              storeRef.current = {
                ...current,
                sessions: { ...current.sessions, [incoming.id]: outcome.record },
                baseSessions: { ...current.baseSessions, [incoming.id]: outcome.base },
                dirtySessionIds: nextDirty,
                conflicts: removeConflictByEntity(current.conflicts, 'session', incoming.id),
              };
            } else {
              storeRef.current = {
                ...current,
                baseSessions: { ...current.baseSessions, [incoming.id]: outcome.base },
                dirtySessionIds: current.dirtySessionIds.filter((id) => id !== incoming.id),
                conflicts: upsertConflictItem(
                  current.conflicts,
                  buildSessionConflictItem(
                    incoming.id,
                    base,
                    existing!,
                    incoming,
                    outcome.conflictingFields,
                  ),
                ),
              };
            }

            persistStoreAndNotifyTabs(activeUserId, storeRef.current);
            setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
            refreshDerivedState();
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'session_attendance' },
          (payload) => {
            if (userIdRef.current !== activeUserId) return;
            const current = storeRef.current;

            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as { session_id?: string; member_id?: string } | null;
              if (!oldRow?.session_id || !oldRow?.member_id) return;
              const key = makeAttendanceKey(oldRow.session_id, oldRow.member_id);
              if (!current.attendance[key]) return;
              const isDirty = current.dirtyAttendanceKeys.includes(key);
              const isEditingThis = activeFieldEditsRef.current.has(`attendance:${key}`);
              if (isDirty || isEditingThis) {
                const deletedRemote: SyncedAttendanceRecord = {
                  ...(current.baseAttendance[key] ?? current.attendance[key]),
                  syncVersion: undefined,
                  deletedAt: new Date().toISOString(),
                };
                const nextBaseAttendance = { ...current.baseAttendance };
                delete nextBaseAttendance[key];
                storeRef.current = {
                  ...current,
                  baseAttendance: nextBaseAttendance,
                  dirtyAttendanceKeys: current.dirtyAttendanceKeys.filter((k) => k !== key),
                  conflicts: upsertConflictItem(
                    current.conflicts,
                    buildAttendanceConflictItem(
                      key,
                      current.baseAttendance[key],
                      current.attendance[key],
                      deletedRemote,
                      ['Deleted on Cloud'],
                      {
                        memberName: current.members[oldRow.member_id]?.name,
                        sessionName: current.sessions[oldRow.session_id]?.name,
                      },
                    ),
                  ),
                };
                persistStoreAndNotifyTabs(activeUserId, storeRef.current);
                setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
                refreshDerivedState();
                return;
              }

              const nextAttendance = { ...current.attendance };
              const nextBaseAttendance = { ...current.baseAttendance };
              delete nextAttendance[key];
              delete nextBaseAttendance[key];
              storeRef.current = {
                ...current,
                attendance: nextAttendance,
                baseAttendance: nextBaseAttendance,
                conflicts: removeConflictByEntity(current.conflicts, 'attendance', key),
              };
              persistStoreAndNotifyTabs(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            if (!payload.new) return;
            const incoming = attendanceFromDbRow(
              payload.new as Parameters<typeof attendanceFromDbRow>[0],
            );
            const key = makeAttendanceKey(incoming.sessionId, incoming.memberId);
            const existing = current.attendance[key];
            const base = current.baseAttendance[key];
            const isDirty = current.dirtyAttendanceKeys.includes(key);
            const isEditingThis = activeFieldEditsRef.current.has(`attendance:${key}`);

            if (
              base?.syncVersion !== undefined &&
              incoming.syncVersion !== undefined &&
              incoming.syncVersion <= base.syncVersion &&
              !isDirty
            ) {
              return;
            }

            if (isEditingThis) {
              // Keep user's focused absence-reason text intact without advancing `base`, so CAS
              // still detects concurrent edits against the true ancestor version.
              deferredAttendanceRealtimeRef.current.set(key, incoming);
              return;
            }

            const outcome = reconcileIncomingEntity({
              local: existing,
              base,
              remote: incoming,
              isDirty,
              fields: ATTENDANCE_MERGE_FIELDS,
              normalizeMerged: normalizeMergedAttendance,
            });

            if (outcome.action === 'accept_remote') {
              storeRef.current = {
                ...current,
                attendance: { ...current.attendance, [key]: outcome.record },
                baseAttendance: { ...current.baseAttendance, [key]: outcome.base },
                dirtyAttendanceKeys: current.dirtyAttendanceKeys.filter((k) => k !== key),
                conflicts: removeConflictByEntity(current.conflicts, 'attendance', key),
              };
            } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
              const nextDirty = outcome.needsPush
                ? Array.from(new Set([...current.dirtyAttendanceKeys, key]))
                : current.dirtyAttendanceKeys.filter((k) => k !== key);
              storeRef.current = {
                ...current,
                attendance: { ...current.attendance, [key]: outcome.record },
                baseAttendance: { ...current.baseAttendance, [key]: outcome.base },
                dirtyAttendanceKeys: nextDirty,
                conflicts: removeConflictByEntity(current.conflicts, 'attendance', key),
              };
            } else {
              storeRef.current = {
                ...current,
                baseAttendance: { ...current.baseAttendance, [key]: outcome.base },
                dirtyAttendanceKeys: current.dirtyAttendanceKeys.filter((k) => k !== key),
                conflicts: upsertConflictItem(
                  current.conflicts,
                  buildAttendanceConflictItem(
                    key,
                    base,
                    existing!,
                    incoming,
                    outcome.conflictingFields,
                    {
                      memberName: current.members[incoming.memberId]?.name,
                      sessionName: current.sessions[incoming.sessionId]?.name,
                    },
                  ),
                ),
              };
            }

            persistStoreAndNotifyTabs(activeUserId, storeRef.current);
            setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
            refreshDerivedState();
          },
        )
        .subscribe((status) => {
          if (!mountedRef.current || userIdRef.current !== activeUserId) return;
          if (status === 'SUBSCRIBED') {
            realtimeReconnectAttemptRef.current = 0;
            clearRealtimeReconnectTimer();
            setRealtimeStatus('connected');
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            if (realtimeChannelRef.current === channel) {
              realtimeChannelRef.current = null;
              void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
            }
            setRealtimeStatus('reconnecting');
            if (realtimeReconnectTimerRef.current === null && !syncBlockedRef.current) {
              const attempt = realtimeReconnectAttemptRef.current;
              realtimeReconnectAttemptRef.current = Math.min(attempt + 1, 4);
              const delayMs = Math.min(2_000 * 2 ** attempt, 20_000);
              realtimeReconnectTimerRef.current = window.setTimeout(() => {
                realtimeReconnectTimerRef.current = null;
                if (mountedRef.current && userIdRef.current === activeUserId && !syncBlockedRef.current) {
                  ensureRealtimeSubscription(activeUserId);
                }
              }, delayMs);
            }
          }
        });

      realtimeChannelRef.current = channel;
    },
    [
      clearRealtimeReconnectTimer,
      persistStoreAndNotifyTabs,
      refreshDerivedState,
      resolveStatusFromStore,
    ],
  );

  const mergeConcurrentEditsIntoResult = useCallback(
    (
      snapshotBefore: LocalSyncStore,
      remoteResult: LocalSyncStore,
      current: LocalSyncStore,
      options?: { readOnlyPullOnly?: boolean },
    ): { store: LocalSyncStore; hadConcurrentEdits: boolean } => {
      const hasActiveEdits = activeFieldEditsRef.current.size > 0;
      if (options?.readOnlyPullOnly || (current === snapshotBefore && !hasActiveEdits)) {
        return { store: remoteResult, hadConcurrentEdits: false };
      }

      const nextMembers = { ...remoteResult.members };
      const nextBaseMembers = { ...remoteResult.baseMembers };
      const nextDirtyMembers = new Set(remoteResult.dirtyMemberIds);
      let hadConcurrentEdits = false;

      if (current !== snapshotBefore) {
        for (const id of current.dirtyMemberIds) {
          const curRec = current.members[id];
          const snapRec = snapshotBefore.members[id];
          const isEditingThis = activeFieldEditsRef.current.has(`member:${id}`);
          if (curRec && (curRec !== snapRec || isEditingThis)) {
            nextMembers[id] = curRec;
            nextDirtyMembers.add(id);
            hadConcurrentEdits = true;
          }
        }
      }

      const nextSessions = { ...remoteResult.sessions };
      const nextDirtySessions = new Set(remoteResult.dirtySessionIds);
      if (current !== snapshotBefore) {
        for (const id of current.dirtySessionIds) {
          const curRec = current.sessions[id];
          const snapRec = snapshotBefore.sessions[id];
          if (curRec && curRec !== snapRec) {
            nextSessions[id] = curRec;
            nextDirtySessions.add(id);
            hadConcurrentEdits = true;
          }
        }
      }

      const nextAttendance = { ...remoteResult.attendance };
      const nextBaseAttendance = { ...remoteResult.baseAttendance };
      const nextDirtyAttendance = new Set(remoteResult.dirtyAttendanceKeys);
      if (current !== snapshotBefore) {
        for (const key of current.dirtyAttendanceKeys) {
          const curRec = current.attendance[key];
          const snapRec = snapshotBefore.attendance[key];
          const isEditingThis = activeFieldEditsRef.current.has(`attendance:${key}`);
          if (curRec && (curRec !== snapRec || isEditingThis)) {
            nextAttendance[key] = curRec;
            nextDirtyAttendance.add(key);
            hadConcurrentEdits = true;
          }
        }
      }

      for (const editKey of activeFieldEditsRef.current) {
        if (editKey.startsWith('attendance:')) {
          const attKey = editKey.slice('attendance:'.length);
          if (current.attendance[attKey]) {
            if (remoteResult.attendance[attKey]) {
              deferredAttendanceRealtimeRef.current.set(attKey, remoteResult.attendance[attKey]);
            }
            nextAttendance[attKey] = current.attendance[attKey];
            if (snapshotBefore.baseAttendance[attKey]) {
              nextBaseAttendance[attKey] = snapshotBefore.baseAttendance[attKey];
            } else {
              delete nextBaseAttendance[attKey];
            }
          }
        } else if (editKey.startsWith('member:')) {
          const memberId = editKey.slice('member:'.length);
          if (current.members[memberId]) {
            if (remoteResult.members[memberId]) {
              deferredMemberRealtimeRef.current.set(memberId, remoteResult.members[memberId]);
            }
            nextMembers[memberId] = current.members[memberId];
            if (snapshotBefore.baseMembers[memberId]) {
              nextBaseMembers[memberId] = snapshotBefore.baseMembers[memberId];
            } else {
              delete nextBaseMembers[memberId];
            }
          }
        }
      }

      return {
        store: {
          ...remoteResult,
          members: nextMembers,
          sessions: nextSessions,
          attendance: nextAttendance,
          baseMembers: nextBaseMembers,
          baseAttendance: nextBaseAttendance,
          dirtyMemberIds: Array.from(nextDirtyMembers),
          dirtySessionIds: Array.from(nextDirtySessions),
          dirtyAttendanceKeys: Array.from(nextDirtyAttendance),
        },
        hadConcurrentEdits,
      };
    },
    [],
  );

  const flushDirtyQueue = useCallback(async (): Promise<boolean> => {
    const activeUserId = userIdRef.current;
    if (!activeUserId) return true;
    if (isReadOnlyCloudRef.current) {
      return true;
    }

    clearDebounceTimer();
    clearChangeSyncTimer();

    if (syncBlockedRef.current) {
      if (mountedRef.current) {
        setSyncStatus(resolveStatusFromStore(storeRef.current, 'error'));
        refreshDerivedState();
      }
      return false;
    }

    if (!hasDirtySyncItems(storeRef.current)) {
      ensureRealtimeSubscription(activeUserId);
      if (mountedRef.current) {
        setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
        setSyncError(null);
        refreshDerivedState();
      }
      return true;
    }

    if (syncInFlightRef.current) {
      needsFollowUpFlushRef.current = true;
      return false;
    }

    syncInFlightRef.current = true;
    if (mountedRef.current) {
      setSyncStatus('syncing');
      setSyncError(null);
      refreshDerivedState();
    }

    try {
      let hadConcurrentLocalEdits = false;
      let madeDirtyProgress = false;

      const pushed = await withTabPushLease(activeUserId, async () => {
        // Re-read store inside the lease so we push the latest cross-tab state.
        const snapshotToPush = storeRef.current;
        const snapshotDirtyCount = countDirtySyncItems(snapshotToPush);
        const result = await pushDirtyQueueToSupabase(activeUserId, snapshotToPush, {
          onPartialProgress: (partialStore) => {
            if (userIdRef.current !== activeUserId) return;
            const mergedPartial = mergeConcurrentEditsIntoResult(
              snapshotToPush,
              partialStore,
              storeRef.current,
            );
            storeRef.current = mergedPartial.store;
            persistStoreAndNotifyTabs(activeUserId, mergedPartial.store);
          },
        });

        if (userIdRef.current !== activeUserId) {
          return result;
        }

        const merged = mergeConcurrentEditsIntoResult(snapshotToPush, result, storeRef.current);
        hadConcurrentLocalEdits = merged.hadConcurrentEdits;
        madeDirtyProgress = countDirtySyncItems(result) < snapshotDirtyCount;
        storeRef.current = merged.store;
        persistStoreAndNotifyTabs(activeUserId, storeRef.current);

        return storeRef.current;
      });

      if (userIdRef.current !== activeUserId) {
        syncInFlightRef.current = false;
        return false;
      }

      persistStoreAndNotifyTabs(activeUserId, pushed);
      syncInFlightRef.current = false;
      syncBlockedRef.current = false;
      ensureRealtimeSubscription(activeUserId);

      if (needsFollowUpReconcileRef.current) {
        needsFollowUpReconcileRef.current = false;
        needsFollowUpFlushRef.current = false;
        return await reconcileNowRef.current();
      }

      if (
        needsFollowUpFlushRef.current ||
        hadConcurrentLocalEdits ||
        (hasDirtySyncItems(storeRef.current) && madeDirtyProgress)
      ) {
        needsFollowUpFlushRef.current = false;
        return await flushDirtyQueue();
      }

      if (mountedRef.current) {
        setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
        setSyncError(null);
        refreshDerivedState();
      }
      return !hasSyncConflicts(storeRef.current);
    } catch (error) {
      if (userIdRef.current !== activeUserId) {
        syncInFlightRef.current = false;
        return false;
      }
      syncInFlightRef.current = false;
      needsFollowUpFlushRef.current = false;
      needsFollowUpReconcileRef.current = false;
      const syncErr = toSupabaseSyncError(error, 'Unable to sync changes with Supabase.');
      if (isBlockingSyncError(syncErr)) {
        syncBlockedRef.current = true;
      }
      if (mountedRef.current) {
        setSyncStatus(hasDirtySyncItems(storeRef.current) ? 'pending' : 'error');
        setSyncError(syncErr.message);
        refreshDerivedState();
      }
      return false;
    }
  }, [
    clearChangeSyncTimer,
    clearDebounceTimer,
    ensureRealtimeSubscription,
    mergeConcurrentEditsIntoResult,
    persistStoreAndNotifyTabs,
    refreshDerivedState,
    resolveStatusFromStore,
  ]);

  const scheduleChangeSync = useCallback(() => {
    const activeUserId = userIdRef.current;
    if (!activeUserId || syncBlockedRef.current) return;

    const elapsed = Date.now() - lastChangeSyncAtRef.current;
    if (elapsed >= CHANGE_SYNC_COOLDOWN_MS && !syncInFlightRef.current) {
      clearChangeSyncTimer();
      lastChangeSyncAtRef.current = Date.now();
      void flushDirtyQueue();
      return;
    }

    if (changeSyncTimerRef.current !== null) {
      return;
    }

    const remainingMs = Math.max(CHANGE_SYNC_COOLDOWN_MS - elapsed, 100);
    changeSyncTimerRef.current = window.setTimeout(() => {
      changeSyncTimerRef.current = null;
      if (!mountedRef.current || !userIdRef.current || syncBlockedRef.current) {
        return;
      }
      lastChangeSyncAtRef.current = Date.now();
      void flushDirtyQueue();
    }, remainingMs);
  }, [clearChangeSyncTimer, flushDirtyQueue]);

  const reconcileNowRef = useRef<(options?: { background?: boolean }) => Promise<boolean>>(
    async () => false,
  );

  const reconcileNow = useCallback(
    async (options?: { background?: boolean }): Promise<boolean> => {
      const activeUserId = userIdRef.current;
      if (!activeUserId || syncBlockedRef.current || isAuthResolvingRef.current) return false;

      if (syncInFlightRef.current) {
        if (!options?.background) {
          needsFollowUpReconcileRef.current = true;
        }
        return false;
      }

      syncInFlightRef.current = true;
      if (mountedRef.current && !options?.background) {
        setSyncStatus((prev) => (prev === 'idle' ? 'loading' : 'syncing'));
        setSyncError(null);
        refreshDerivedState();
      }

      try {
        const readOnlyPullOnly = isReadOnlyCloudRef.current;
        let hadConcurrentLocalEdits = false;

        await withTabPushLease(activeUserId, async () => {
          const snapshotBeforeReconcile = storeRef.current;
          const merged = await reconcileWithSupabase(activeUserId, snapshotBeforeReconcile, {
            readOnlyPullOnly,
            onPartialProgress: (partialStore) => {
              if (userIdRef.current !== activeUserId) return;
              const mergedPartial = mergeConcurrentEditsIntoResult(
                snapshotBeforeReconcile,
                partialStore,
                storeRef.current,
                { readOnlyPullOnly },
              );
              storeRef.current = mergedPartial.store;
              persistStoreAndNotifyTabs(activeUserId, mergedPartial.store);
            },
          });

          if (userIdRef.current !== activeUserId) {
            return;
          }

          const finalState = mergeConcurrentEditsIntoResult(
            snapshotBeforeReconcile,
            merged,
            storeRef.current,
            { readOnlyPullOnly },
          );
          hadConcurrentLocalEdits = finalState.hadConcurrentEdits;
          storeRef.current = finalState.store;
          persistStoreAndNotifyTabs(activeUserId, storeRef.current);
        });

        if (userIdRef.current !== activeUserId) {
          syncInFlightRef.current = false;
          return false;
        }

        syncInFlightRef.current = false;
        syncBlockedRef.current = false;
        ensureRealtimeSubscription(activeUserId);

        const hasActiveEditTimer =
          debounceTimerRef.current !== null ||
          changeSyncTimerRef.current !== null ||
          activeFieldEditsRef.current.size > 0;
        let didProgression = false;
        if (!hasActiveEditTimer && !hasSyncConflicts(storeRef.current) && !isReadOnlyCloudRef.current) {
          didProgression = applyProgressionToCurrentStore(activeUserId);
        }

        if (needsFollowUpReconcileRef.current) {
          needsFollowUpReconcileRef.current = false;
          return await reconcileNow();
        }

        if (
          !hasActiveEditTimer &&
          (needsFollowUpFlushRef.current || hadConcurrentLocalEdits || didProgression)
        ) {
          needsFollowUpFlushRef.current = false;
          return await flushDirtyQueue();
        }

        if (mountedRef.current) {
          setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
          setSyncError(null);
          refreshDerivedState();
        }
        return !hasSyncConflicts(storeRef.current);
      } catch (error) {
        if (userIdRef.current !== activeUserId) {
          syncInFlightRef.current = false;
          return false;
        }
        syncInFlightRef.current = false;
        needsFollowUpFlushRef.current = false;
        needsFollowUpReconcileRef.current = false;
        const syncErr = toSupabaseSyncError(error, 'Unable to reach Supabase database.');
        if (isBlockingSyncError(syncErr)) {
          syncBlockedRef.current = true;
        }
        if (mountedRef.current) {
          setSyncStatus(hasDirtySyncItems(storeRef.current) ? 'pending' : 'error');
          setSyncError(syncErr.message);
          refreshDerivedState();
        }
        return false;
      }
    },
    [
      applyProgressionToCurrentStore,
      ensureRealtimeSubscription,
      flushDirtyQueue,
      mergeConcurrentEditsIntoResult,
      persistStoreAndNotifyTabs,
      refreshDerivedState,
      resolveStatusFromStore,
    ],
  );

  reconcileNowRef.current = reconcileNow;

  const endFieldEdit = useCallback(
    (fieldKey: string) => {
      activeFieldEditsRef.current.delete(fieldKey);
      setIsEditingActive(activeFieldEditsRef.current.size > 0);

      const activeUserId = userIdRef.current;
      if (activeUserId && fieldKey.startsWith('member:')) {
        const memberId = fieldKey.slice('member:'.length);
        const deferred = deferredMemberRealtimeRef.current.get(memberId);
        if (deferred) {
          deferredMemberRealtimeRef.current.delete(memberId);
          const current = storeRef.current;
          const isDirty = current.dirtyMemberIds.includes(memberId);
          const existing = current.members[memberId];
          const base = current.baseMembers[memberId];
          const outcome = reconcileIncomingEntity({
            local: existing,
            base,
            remote: deferred,
            isDirty,
            fields: MEMBER_MERGE_FIELDS,
          });
          if (outcome.action === 'accept_remote') {
            storeRef.current = {
              ...current,
              members: { ...current.members, [memberId]: outcome.record },
              baseMembers: { ...current.baseMembers, [memberId]: outcome.base },
              dirtyMemberIds: current.dirtyMemberIds.filter((id) => id !== memberId),
              conflicts: removeConflictByEntity(current.conflicts, 'member', memberId),
            };
          } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
            const nextDirty = outcome.needsPush
              ? Array.from(new Set([...current.dirtyMemberIds, memberId]))
              : current.dirtyMemberIds.filter((id) => id !== memberId);
            storeRef.current = {
              ...current,
              members: { ...current.members, [memberId]: outcome.record },
              baseMembers: { ...current.baseMembers, [memberId]: outcome.base },
              dirtyMemberIds: nextDirty,
              conflicts: removeConflictByEntity(current.conflicts, 'member', memberId),
            };
          } else {
            storeRef.current = {
              ...current,
              baseMembers: { ...current.baseMembers, [memberId]: outcome.base },
              dirtyMemberIds: current.dirtyMemberIds.filter((id) => id !== memberId),
              conflicts: upsertConflictItem(
                current.conflicts,
                buildMemberConflictItem(
                  memberId,
                  base,
                  existing!,
                  deferred,
                  outcome.conflictingFields,
                ),
              ),
            };
          }
          persistStoreAndNotifyTabs(activeUserId, storeRef.current);
          setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
        }
      } else if (activeUserId && fieldKey.startsWith('session:')) {
        const sessionId = fieldKey.slice('session:'.length);
        const deferred = deferredSessionRealtimeRef.current.get(sessionId);
        if (deferred) {
          deferredSessionRealtimeRef.current.delete(sessionId);
          const current = storeRef.current;
          const isDirty = current.dirtySessionIds.includes(sessionId);
          const existing = current.sessions[sessionId];
          const base = current.baseSessions[sessionId];
          const outcome = reconcileIncomingEntity({
            local: existing,
            base,
            remote: deferred,
            isDirty,
            fields: SESSION_MERGE_FIELDS,
          });
          if (outcome.action === 'accept_remote') {
            storeRef.current = {
              ...current,
              sessions: { ...current.sessions, [sessionId]: outcome.record },
              baseSessions: { ...current.baseSessions, [sessionId]: outcome.base },
              dirtySessionIds: current.dirtySessionIds.filter((id) => id !== sessionId),
              conflicts: removeConflictByEntity(current.conflicts, 'session', sessionId),
            };
          } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
            const nextDirty = outcome.needsPush
              ? Array.from(new Set([...current.dirtySessionIds, sessionId]))
              : current.dirtySessionIds.filter((id) => id !== sessionId);
            storeRef.current = {
              ...current,
              sessions: { ...current.sessions, [sessionId]: outcome.record },
              baseSessions: { ...current.baseSessions, [sessionId]: outcome.base },
              dirtySessionIds: nextDirty,
              conflicts: removeConflictByEntity(current.conflicts, 'session', sessionId),
            };
          } else {
            storeRef.current = {
              ...current,
              baseSessions: { ...current.baseSessions, [sessionId]: outcome.base },
              dirtySessionIds: current.dirtySessionIds.filter((id) => id !== sessionId),
              conflicts: upsertConflictItem(
                current.conflicts,
                buildSessionConflictItem(
                  sessionId,
                  base,
                  existing!,
                  deferred,
                  outcome.conflictingFields,
                ),
              ),
            };
          }
          persistStoreAndNotifyTabs(activeUserId, storeRef.current);
          setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
        }
      } else if (activeUserId && fieldKey.startsWith('attendance:')) {
        const attKey = fieldKey.slice('attendance:'.length);
        const deferred = deferredAttendanceRealtimeRef.current.get(attKey);
        if (deferred) {
          deferredAttendanceRealtimeRef.current.delete(attKey);
          const current = storeRef.current;
          const isDirty = current.dirtyAttendanceKeys.includes(attKey);
          const existing = current.attendance[attKey];
          const base = current.baseAttendance[attKey];
          const outcome = reconcileIncomingEntity({
            local: existing,
            base,
            remote: deferred,
            isDirty,
            fields: ATTENDANCE_MERGE_FIELDS,
            normalizeMerged: normalizeMergedAttendance,
          });
          if (outcome.action === 'accept_remote') {
            storeRef.current = {
              ...current,
              attendance: { ...current.attendance, [attKey]: outcome.record },
              baseAttendance: { ...current.baseAttendance, [attKey]: outcome.base },
              dirtyAttendanceKeys: current.dirtyAttendanceKeys.filter((k) => k !== attKey),
              conflicts: removeConflictByEntity(current.conflicts, 'attendance', attKey),
            };
          } else if (outcome.action === 'keep_local' || outcome.action === 'merged') {
            const nextDirty = outcome.needsPush
              ? Array.from(new Set([...current.dirtyAttendanceKeys, attKey]))
              : current.dirtyAttendanceKeys.filter((k) => k !== attKey);
            storeRef.current = {
              ...current,
              attendance: { ...current.attendance, [attKey]: outcome.record },
              baseAttendance: { ...current.baseAttendance, [attKey]: outcome.base },
              dirtyAttendanceKeys: nextDirty,
              conflicts: removeConflictByEntity(current.conflicts, 'attendance', attKey),
            };
          } else {
            storeRef.current = {
              ...current,
              baseAttendance: { ...current.baseAttendance, [attKey]: outcome.base },
              dirtyAttendanceKeys: current.dirtyAttendanceKeys.filter((k) => k !== attKey),
              conflicts: upsertConflictItem(
                current.conflicts,
                buildAttendanceConflictItem(
                  attKey,
                  base,
                  existing!,
                  deferred,
                  outcome.conflictingFields,
                  {
                    memberName: current.members[deferred.memberId]?.name,
                    sessionName: current.sessions[deferred.sessionId]?.name,
                  },
                ),
              ),
            };
          }
          persistStoreAndNotifyTabs(activeUserId, storeRef.current);
          setSyncStatus(resolveStatusFromStore(storeRef.current, 'synced'));
        }
      }

      refreshDerivedState();
      if (
        userIdRef.current &&
        activeFieldEditsRef.current.size === 0 &&
        hasDirtySyncItems(storeRef.current) &&
        debounceTimerRef.current === null
      ) {
        scheduleChangeSync();
      }
    },
    [persistStoreAndNotifyTabs, refreshDerivedState, resolveStatusFromStore, scheduleChangeSync],
  );

  const resolveConflict = useCallback(
    async (conflictId: string, resolution: SyncConflictResolution) => {
      const activeUserId = userIdRef.current;
      const nextStore = applyConflictResolutionToStore(storeRef.current, conflictId, resolution);
      if (nextStore === storeRef.current) return;

      storeRef.current = nextStore;
      persistStoreAndNotifyTabs(activeUserId, nextStore);
      setSyncStatus(resolveStatusFromStore(nextStore, 'synced'));
      refreshDerivedState();

      if (activeUserId && hasDirtySyncItems(nextStore) && !syncBlockedRef.current) {
        await flushDirtyQueue();
      }
    },
    [flushDirtyQueue, persistStoreAndNotifyTabs, refreshDerivedState, resolveStatusFromStore],
  );

  const resolveAllConflicts = useCallback(
    async (resolution: SyncConflictResolution) => {
      const activeUserId = userIdRef.current;
      let nextStore = storeRef.current;
      for (const conflict of storeRef.current.conflicts) {
        nextStore = applyConflictResolutionToStore(nextStore, conflict.id, resolution);
      }
      if (nextStore === storeRef.current) return;

      storeRef.current = nextStore;
      persistStoreAndNotifyTabs(activeUserId, nextStore);
      setSyncStatus(resolveStatusFromStore(nextStore, 'synced'));
      refreshDerivedState();

      if (activeUserId && hasDirtySyncItems(nextStore) && !syncBlockedRef.current) {
        await flushDirtyQueue();
      }
    },
    [flushDirtyQueue, persistStoreAndNotifyTabs, refreshDerivedState, resolveStatusFromStore],
  );

  const retrySync = useCallback(async (): Promise<boolean> => {
    if (!userIdRef.current) return true;
    syncBlockedRef.current = false;
    clearDebounceTimer();
    clearChangeSyncTimer();
    return await reconcileNow();
  }, [clearChangeSyncTimer, clearDebounceTimer, reconcileNow]);

  // Hydrate local-only mode when signed out, or subscribe & reconcile with Supabase when connected.
  useEffect(() => {
    mountedRef.current = true;
    syncBlockedRef.current = false;
    undoStackRef.current = [];
    lastUndoTokenRef.current = null;
    activeFieldEditsRef.current.clear();
    deferredMemberRealtimeRef.current.clear();
    deferredSessionRealtimeRef.current.clear();
    deferredAttendanceRealtimeRef.current.clear();
    setIsEditingActive(false);
    cleanupRealtimeSubscription();
    clearBackgroundInterval();

    if (broadcastChannelRef.current) {
      broadcastChannelRef.current.close();
      broadcastChannelRef.current = null;
    }

    const channelName = userId ? `team-spirit-sync-bc:${userId}` : 'team-spirit-sync-bc:local';
    if (typeof BroadcastChannel !== 'undefined') {
      try {
        const bc = new BroadcastChannel(channelName);
        bc.onmessage = (event: MessageEvent<{ type?: string; senderTabId?: string }>) => {
          if (!mountedRef.current) return;
          if (event.data?.senderTabId === getClientTabId()) return;
          if (event.data?.type === 'store-updated') {
            const latest = userIdRef.current
              ? loadLocalSyncStore(userIdRef.current)
              : loadLocalOnlyStore();
            mergeSiblingStoreIntoCurrent(userIdRef.current, latest);
          }
        };
        broadcastChannelRef.current = bc;
      } catch {
        broadcastChannelRef.current = null;
      }
    }

    if (!userId) {
      clearDebounceTimer();
      clearChangeSyncTimer();
      lastChangeSyncAtRef.current = 0;
      syncInFlightRef.current = false;
      needsFollowUpFlushRef.current = false;
      needsFollowUpReconcileRef.current = false;
      storeRef.current = loadLocalOnlyStore();
      applyProgressionToCurrentStore(null);
      setSyncStatus('local');
      setSyncError(null);
      refreshDerivedState();

      function handleLocalStorageChange(event: StorageEvent) {
        if (event.key === LOCAL_ONLY_STORE_KEY && !userIdRef.current) {
          mergeSiblingStoreIntoCurrent(null, loadLocalOnlyStore());
          applyProgressionToCurrentStore(null);
        }
      }

      function handleLocalVisibilityOrInterval() {
        if (userIdRef.current) return;
        if (document.visibilityState === 'visible' && applyProgressionToCurrentStore(null)) {
          refreshDerivedState();
        }
      }

      const localProgressionInterval = window.setInterval(() => {
        if (mountedRef.current && !userIdRef.current && applyProgressionToCurrentStore(null)) {
          refreshDerivedState();
        }
      }, 60_000);

      window.addEventListener('storage', handleLocalStorageChange);
      document.addEventListener('visibilitychange', handleLocalVisibilityOrInterval);
      return () => {
        mountedRef.current = false;
        syncBlockedRef.current = false;
        window.clearInterval(localProgressionInterval);
        clearBackgroundInterval();
        clearChangeSyncTimer();
        clearDebounceTimer();
        broadcastChannelRef.current?.close();
        broadcastChannelRef.current = null;
        window.removeEventListener('storage', handleLocalStorageChange);
        document.removeEventListener('visibilitychange', handleLocalVisibilityOrInterval);
      };
    }

    const connectedUserId = userId;
    if (isAuthResolving) {
      storeRef.current = loadLocalSyncStore(connectedUserId);
      setSyncStatus('loading');
      setSyncError(null);
      refreshDerivedState();
      return () => {
        mountedRef.current = false;
        broadcastChannelRef.current?.close();
        broadcastChannelRef.current = null;
      };
    }

    const shouldMergeLocal = mergeLocalOnNextConnectRef.current && !isReadOnlyCloud;
    mergeLocalOnNextConnectRef.current = false;

    const initialStore = shouldMergeLocal
      ? mergeLocalOnlyIntoUserStore(connectedUserId, loadLocalOnlyStore())
      : loadLocalSyncStore(connectedUserId);
    storeRef.current = initialStore;
    setSyncStatus('loading');
    setSyncError(null);
    refreshDerivedState();
    void reconcileNow();

    const userStoreKey = getSyncStoreKey(connectedUserId);
    function handleCloudStorageChange(event: StorageEvent) {
      if (event.key === userStoreKey && userIdRef.current === connectedUserId) {
        mergeSiblingStoreIntoCurrent(connectedUserId, loadLocalSyncStore(connectedUserId));
      }
    }

    backgroundIntervalRef.current = window.setInterval(() => {
      if (!mountedRef.current || userIdRef.current !== userId) return;
      if (syncBlockedRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (
        syncInFlightRef.current ||
        debounceTimerRef.current !== null ||
        changeSyncTimerRef.current !== null ||
        activeFieldEditsRef.current.size > 0
      ) {
        return;
      }
      void reconcileNow({ background: true });
    }, BACKGROUND_SYNC_INTERVAL_MS);

    function handleOnline() {
      if (!syncBlockedRef.current) {
        void reconcileNow();
      }
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible' && !syncBlockedRef.current) {
        void reconcileNow();
      }
    }

    window.addEventListener('storage', handleCloudStorageChange);
    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      syncBlockedRef.current = false;
      clearBackgroundInterval();
      clearChangeSyncTimer();
      clearDebounceTimer();
      lastChangeSyncAtRef.current = 0;
      broadcastChannelRef.current?.close();
      broadcastChannelRef.current = null;
      window.removeEventListener('storage', handleCloudStorageChange);
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      cleanupRealtimeSubscription();
    };
  }, [
    applyProgressionToCurrentStore,
    cleanupRealtimeSubscription,
    clearBackgroundInterval,
    clearChangeSyncTimer,
    clearDebounceTimer,
    isAuthResolving,
    isReadOnlyCloud,
    mergeSiblingStoreIntoCurrent,
    reconcileNow,
    refreshDerivedState,
    userId,
  ]);

  // Re-pull visible cloud records when role or global Member Visibility permissions change,
  // without tearing down Realtime, pending sync timers, active field edits, or undo history.
  useEffect(() => {
    const prevScope = prevScopeVersionKeyRef.current;
    prevScopeVersionKeyRef.current = scopeVersionKey;
    if (!userId || isAuthResolving || prevScope === scopeVersionKey) {
      return;
    }
    void reconcileNow();
  }, [isAuthResolving, reconcileNow, scopeVersionKey, userId]);

  // Warn only when closing/reloading while unsaved/unsynced changes exist (Google Docs behavior).
  useEffect(() => {
    if (!hasUnsavedChanges) return;

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = '';
    }

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  const mutateStore = useCallback(
    (
      mutator: (prev: LocalSyncStore, now: string) => LocalSyncStore,
      options?: { debounce?: boolean; recordUndo?: boolean },
    ) => {
      const activeUserId = userIdRef.current;
      const prevStore = storeRef.current;
      const now = new Date().toISOString();
      const nextStore = mutator(prevStore, now);
      if (nextStore === prevStore) {
        if (options?.recordUndo) {
          lastUndoTokenRef.current = null;
        }
        return;
      }

      if (options?.recordUndo) {
        const token = generateId('undo');
        undoStackRef.current = [
          ...undoStackRef.current.slice(-14),
          { token, delta: buildUndoDelta(prevStore, nextStore) },
        ];
        lastUndoTokenRef.current = token;
      }

      storeRef.current = nextStore;

      if (!activeUserId) {
        persistStoreAndNotifyTabs(null, nextStore);
        refreshDerivedState();
        return;
      }

      if (isReadOnlyCloudRef.current) {
        // Read-only cloud users cannot mutate shared club records; revert optimistic mutation.
        storeRef.current = prevStore;
        refreshDerivedState();
        return;
      }

      persistStoreAndNotifyTabs(activeUserId, nextStore);

      if (syncBlockedRef.current) {
        clearDebounceTimer();
        clearChangeSyncTimer();
        setSyncStatus(resolveStatusFromStore(nextStore, 'error'));
        refreshDerivedState();
        return;
      }

      if (options?.debounce) {
        clearDebounceTimer();
        setSyncStatus('syncing');
        debounceTimerRef.current = window.setTimeout(() => {
          debounceTimerRef.current = null;
          scheduleChangeSync();
        }, REASON_DEBOUNCE_MS);
        refreshDerivedState();
      } else {
        setSyncStatus('syncing');
        scheduleChangeSync();
        refreshDerivedState();
      }
    },
    [
      clearChangeSyncTimer,
      clearDebounceTimer,
      persistStoreAndNotifyTabs,
      refreshDerivedState,
      resolveStatusFromStore,
      scheduleChangeSync,
    ],
  );

  const createSession = useCallback(
    (
      input: NewSessionInput,
      options?: {
        initialMemberIds?: string[];
        defaultStatus?: DefaultAssignmentStatus;
      },
    ): AttendanceSession => {
      const now = new Date().toISOString();
      const newSessionRecord: SyncedSessionRecord = {
        ...input,
        id: generateId('session'),
        visibility: normalizeMeetingVisibility(input.visibility),
        createdByUserId: userIdRef.current ?? undefined,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      const initialMemberIds = Array.from(new Set(options?.initialMemberIds ?? []));
      const initialStatus: DefaultAssignmentStatus = options?.defaultStatus ?? 'unmarked';
      const initialAttendance: AttendanceSession['attendance'] = {};

      mutateStore(
        (prev, stamp) => {
          const nextAttendance = { ...prev.attendance };
          const dirtyAttendance = new Set(prev.dirtyAttendanceKeys);
          const validMemberIds: string[] = [];

          initialMemberIds.forEach((memberId, index) => {
            const member = prev.members[memberId];
            if (!member || member.deletedAt || member.isLegacy) return;
            validMemberIds.push(memberId);
            const key = makeAttendanceKey(newSessionRecord.id, memberId);
            nextAttendance[key] = {
              sessionId: newSessionRecord.id,
              memberId,
              status: initialStatus,
              sortOrder: index,
              updatedAt: stamp,
              deletedAt: null,
            };
            dirtyAttendance.add(key);
          });

          return {
            ...prev,
            sessions: { ...prev.sessions, [newSessionRecord.id]: newSessionRecord },
            attendance: nextAttendance,
            dirtySessionIds: Array.from(new Set([...prev.dirtySessionIds, newSessionRecord.id])),
            dirtyAttendanceKeys: Array.from(dirtyAttendance),
          };
        },
        { recordUndo: true },
      );

      if (initialStatus !== 'unmarked') {
        for (const memberId of initialMemberIds) {
          initialAttendance[memberId] = { status: initialStatus, updatedAt: now };
        }
      }

      return {
        ...newSessionRecord,
        memberIds: initialMemberIds,
        attendance: initialAttendance,
      };
    },
    [mutateStore],
  );

  const updateSession = useCallback(
    (sessionId: string, input: SessionUpdateInput): AttendanceSession | null => {
      let updatedRecord: SyncedSessionRecord | null = null;
      const cleanedName = input.name.trim();
      const cleanedDate = input.date.trim();
      const cleanedTime = input.time.trim();
      if (!cleanedName || !cleanedDate || !cleanedTime) {
        return null;
      }
      const cleanedLocation = input.location?.trim() || undefined;
      const cleanedEventType = input.eventType?.trim() || undefined;
      const cleanedDescription = input.description?.trim() || undefined;

      mutateStore(
        (prev, now) => {
          const existing = prev.sessions[sessionId];
          if (!existing || existing.deletedAt) return prev;

          const currentVisibility = normalizeMeetingVisibility(existing.visibility);
          const nextVisibility =
            input.visibility !== undefined
              ? normalizeMeetingVisibility(input.visibility)
              : currentVisibility;

          // Prevent another admin from switching a colleague's session to Private.
          if (
            nextVisibility === 'private' &&
            existing.createdByUserId &&
            userIdRef.current &&
            existing.createdByUserId !== userIdRef.current
          ) {
            return prev;
          }

          const nextCreatedByUserId =
            existing.createdByUserId ??
            (nextVisibility === 'private' && userIdRef.current ? userIdRef.current : undefined);

          const hasChanged =
            existing.name !== cleanedName ||
            existing.date !== cleanedDate ||
            existing.time !== cleanedTime ||
            (existing.location ?? undefined) !== cleanedLocation ||
            (existing.eventType ?? undefined) !== cleanedEventType ||
            (existing.description ?? undefined) !== cleanedDescription ||
            currentVisibility !== nextVisibility ||
            existing.createdByUserId !== nextCreatedByUserId;

          if (!hasChanged) return prev;

          const nextSession: SyncedSessionRecord = {
            ...existing,
            name: cleanedName,
            date: cleanedDate,
            time: cleanedTime,
            location: cleanedLocation,
            eventType: cleanedEventType,
            description: cleanedDescription,
            visibility: nextVisibility,
            createdByUserId: nextCreatedByUserId,
            updatedAt: now,
            deletedAt: null,
          };
          updatedRecord = nextSession;

          return {
            ...prev,
            sessions: { ...prev.sessions, [sessionId]: nextSession },
            dirtySessionIds: Array.from(new Set([...prev.dirtySessionIds, sessionId])),
          };
        },
        { recordUndo: true },
      );

      if (!updatedRecord) return null;
      const derived = deriveWorkspaceState(storeRef.current);
      return derived.sessions.find((session) => session.id === sessionId) ?? null;
    },
    [mutateStore],
  );

  const deleteSession = useCallback(
    (sessionId: string) => {
      mutateStore(
        (prev, now) => {
          const existing = prev.sessions[sessionId];
          if (!existing) return prev;

          const nextSession: SyncedSessionRecord = {
            ...existing,
            updatedAt: now,
            deletedAt: now,
          };

          const nextAttendance = { ...prev.attendance };
          const dirtyAttendance = new Set(prev.dirtyAttendanceKeys);

          for (const [key, rec] of Object.entries(prev.attendance)) {
            if (rec.sessionId === sessionId && !rec.deletedAt) {
              nextAttendance[key] = { ...rec, updatedAt: now, deletedAt: now };
              dirtyAttendance.add(key);
            }
          }

          return {
            ...prev,
            sessions: { ...prev.sessions, [sessionId]: nextSession },
            attendance: nextAttendance,
            dirtySessionIds: Array.from(new Set([...prev.dirtySessionIds, sessionId])),
            dirtyAttendanceKeys: Array.from(dirtyAttendance),
          };
        },
        { recordUndo: true },
      );
    },
    [mutateStore],
  );

  const addMember = useCallback(
    (input: string | MemberProfileInput): ClubMember => {
      const created = buildClubMember(input);
      const record: SyncedMemberRecord = {
        ...created,
        updatedAt: created.updatedAt ?? created.createdAt,
        deletedAt: null,
      };

      mutateStore(
        (prev) => ({
          ...prev,
          members: { ...prev.members, [record.id]: record },
          dirtyMemberIds: Array.from(new Set([...prev.dirtyMemberIds, record.id])),
        }),
        { recordUndo: true },
      );

      return created;
    },
    [mutateStore],
  );

  const addMembersBulk = useCallback(
    (inputs: MemberProfileInput[]): ClubMember[] => {
      if (inputs.length === 0) return [];

      const createdMembers = inputs.map((input) => buildClubMember(input));
      mutateStore(
        (prev) => {
          const nextMembers = { ...prev.members };
          const dirtyMembers = new Set(prev.dirtyMemberIds);

          for (const created of createdMembers) {
            nextMembers[created.id] = {
              ...created,
              updatedAt: created.updatedAt ?? created.createdAt,
              deletedAt: null,
            };
            dirtyMembers.add(created.id);
          }

          return {
            ...prev,
            members: nextMembers,
            dirtyMemberIds: Array.from(dirtyMembers),
          };
        },
        { recordUndo: true },
      );

      return createdMembers;
    },
    [mutateStore],
  );

  const updateMember = useCallback(
    (memberId: string, input: MemberProfileInput) => {
      mutateStore(
        (prev, now) => {
          const existing = prev.members[memberId];
          if (!existing || existing.deletedAt) return prev;
          const updated = applyMemberProfileUpdate(existing, input);
          const record: SyncedMemberRecord = {
            ...updated,
            updatedAt: now,
            deletedAt: null,
          };

          return {
            ...prev,
            members: { ...prev.members, [memberId]: record },
            dirtyMemberIds: Array.from(new Set([...prev.dirtyMemberIds, memberId])),
          };
        },
        { recordUndo: true },
      );
    },
    [mutateStore],
  );

  const updateMembersClass = useCallback(
    (
      memberIds: string[],
      patch: { classYear?: ClassYear; classLetter?: ClassLetter },
    ): number => {
      if (memberIds.length === 0 || (!patch.classYear && !patch.classLetter)) {
        return 0;
      }

      const targetIds = new Set(memberIds);
      const cycleYear = getPromotionCycleYear(new Date());
      const isSettingNa = patch.classLetter === 'N/A';
      let updatedCount = 0;

      mutateStore(
        (prev, now) => {
          const nextMembers = { ...prev.members };
          const dirtyMembers = new Set(prev.dirtyMemberIds);
          let changed = false;

          for (const id of targetIds) {
            const existing = nextMembers[id];
            if (!existing || existing.deletedAt) continue;

            const memberType = normalizeMemberType(existing.memberType);

            if (isSettingNa) {
              if (
                existing.classYear === undefined &&
                existing.classLetter === 'N/A' &&
                existing.className === 'N/A'
              ) {
                continue;
              }
              nextMembers[id] = {
                ...existing,
                memberType,
                classYear: undefined,
                classLetter: 'N/A',
                className: 'N/A',
                updatedAt: now,
                deletedAt: null,
              };
              dirtyMembers.add(id);
              updatedCount += 1;
              changed = true;
              continue;
            }

            if (memberType !== 'student') continue;

            const resolved = resolveStudentClassFields({
              memberType,
              classYear: existing.classYear,
              classLetter: existing.classLetter,
              className: existing.className,
            });

            const existingStandardLetter =
              resolved.classLetter && resolved.classLetter !== 'N/A'
                ? resolved.classLetter
                : undefined;
            const nextYear = patch.classYear ?? resolved.classYear;
            const nextLetter = patch.classLetter ?? existingStandardLetter;
            if (!nextYear || !nextLetter || nextLetter === 'N/A') continue;

            const nextClassName = formatStudentClassName(nextYear, nextLetter);
            if (
              existing.classYear === nextYear &&
              existing.classLetter === nextLetter &&
              existing.className === nextClassName
            ) {
              continue;
            }

            const yearChanged = nextYear !== resolved.classYear;
            nextMembers[id] = {
              ...existing,
              memberType,
              classYear: nextYear,
              classLetter: nextLetter,
              className: nextClassName,
              lastPromotedYear: yearChanged ? cycleYear : existing.lastPromotedYear,
              updatedAt: now,
              deletedAt: null,
            };
            dirtyMembers.add(id);
            updatedCount += 1;
            changed = true;
          }

          if (!changed) return prev;

          return {
            ...prev,
            members: nextMembers,
            dirtyMemberIds: Array.from(dirtyMembers),
          };
        },
        { recordUndo: true },
      );

      return updatedCount;
    },
    [mutateStore],
  );

  const setMembersLegacyStatus = useCallback(
    (
      memberIds: string[],
      isLegacy: boolean,
      options?: { fallbackClassYear?: ClassYear; fallbackClassLetter?: ClassLetter },
    ): number => {
      if (memberIds.length === 0) return 0;

      const targetIds = new Set(memberIds);
      const cycleYear = getPromotionCycleYear(new Date());
      let updatedCount = 0;

      mutateStore(
        (prev, now) => {
          const nextMembers = { ...prev.members };
          const dirtyMembers = new Set(prev.dirtyMemberIds);
          let changed = false;

          for (const id of targetIds) {
            const existing = nextMembers[id];
            if (!existing || existing.deletedAt) continue;
            if (Boolean(existing.isLegacy) === isLegacy) continue;

            let classFields: Pick<SyncedMemberRecord, 'classYear' | 'classLetter' | 'className'> = {
              classYear: existing.classYear,
              classLetter: existing.classLetter,
              className: existing.className,
            };

            if (!isLegacy) {
              const memberType = normalizeMemberType(existing.memberType);
              if (memberType === 'student') {
                const resolved = resolveStudentClassFields({
                  memberType,
                  classYear: existing.classYear,
                  classLetter: existing.classLetter,
                  className: existing.className,
                });
                if (resolved.classLetter === 'N/A') {
                  classFields = {
                    classYear: undefined,
                    classLetter: 'N/A',
                    className: 'N/A',
                  };
                } else if (
                  (!resolved.classYear || !resolved.classLetter) &&
                  options?.fallbackClassLetter === 'N/A'
                ) {
                  classFields = {
                    classYear: undefined,
                    classLetter: 'N/A',
                    className: 'N/A',
                  };
                } else {
                  const nextYear = resolved.classYear ?? options?.fallbackClassYear;
                  const nextLetter = resolved.classLetter ?? options?.fallbackClassLetter;
                  if (!nextYear || !nextLetter || nextLetter === 'N/A') {
                    continue;
                  }
                  classFields = {
                    classYear: nextYear,
                    classLetter: nextLetter,
                    className: formatStudentClassName(nextYear, nextLetter),
                  };
                }
              }
            }

            nextMembers[id] = {
              ...existing,
              ...classFields,
              isLegacy,
              retiredAt: isLegacy ? (existing.retiredAt ?? now) : undefined,
              graduationYear: isLegacy ? existing.graduationYear : undefined,
              lastPromotedYear: isLegacy ? existing.lastPromotedYear : cycleYear,
              updatedAt: now,
              deletedAt: null,
            };
            dirtyMembers.add(id);
            updatedCount += 1;
            changed = true;
          }

          if (!changed) return prev;

          return {
            ...prev,
            members: nextMembers,
            dirtyMemberIds: Array.from(dirtyMembers),
          };
        },
        { recordUndo: true },
      );

      return updatedCount;
    },
    [mutateStore],
  );

  const setMemberLegacyStatus = useCallback(
    (memberId: string, isLegacy: boolean) => {
      setMembersLegacyStatus([memberId], isLegacy);
    },
    [setMembersLegacyStatus],
  );

  const deleteMembers = useCallback(
    (memberIds: string[]) => {
      if (memberIds.length === 0) return;
      const targetIds = new Set(memberIds);

      mutateStore(
        (prev, now) => {
          const nextMembers = { ...prev.members };
          const dirtyMembers = new Set(prev.dirtyMemberIds);

          for (const id of targetIds) {
            const existing = nextMembers[id];
            if (existing && !existing.deletedAt) {
              nextMembers[id] = { ...existing, updatedAt: now, deletedAt: now };
              dirtyMembers.add(id);
            }
          }

          const nextAttendance = { ...prev.attendance };
          const dirtyAttendance = new Set(prev.dirtyAttendanceKeys);

          for (const [key, rec] of Object.entries(prev.attendance)) {
            if (targetIds.has(rec.memberId) && !rec.deletedAt) {
              nextAttendance[key] = { ...rec, updatedAt: now, deletedAt: now };
              dirtyAttendance.add(key);
            }
          }

          return {
            ...prev,
            members: nextMembers,
            attendance: nextAttendance,
            dirtyMemberIds: Array.from(dirtyMembers),
            dirtyAttendanceKeys: Array.from(dirtyAttendance),
          };
        },
        { recordUndo: true },
      );
    },
    [mutateStore],
  );

  const assignMembersToSession = useCallback(
    (
      sessionId: string,
      memberIds: string[],
      defaultStatus: DefaultAssignmentStatus = 'unmarked',
    ) => {
      if (memberIds.length === 0) return;

      mutateStore(
        (prev, now) => {
          let minSortOrder = 0;
          for (const rec of Object.values(prev.attendance)) {
            if (rec.sessionId === sessionId && !rec.deletedAt && rec.sortOrder <= minSortOrder) {
              minSortOrder = rec.sortOrder - 1;
            }
          }

          const nextAttendance = { ...prev.attendance };
          const dirtyAttendance = new Set(prev.dirtyAttendanceKeys);
          let changed = false;

          // Iterate in reverse so the array's natural order is preserved at the top of the list.
          for (let index = memberIds.length - 1; index >= 0; index -= 1) {
            const memberId = memberIds[index];
            const member = prev.members[memberId];
            if (!member || member.deletedAt || member.isLegacy) continue;

            const key = makeAttendanceKey(sessionId, memberId);
            const existing = nextAttendance[key];
            if (existing && !existing.deletedAt) continue;

            nextAttendance[key] = {
              sessionId,
              memberId,
              status: defaultStatus,
              sortOrder: minSortOrder,
              updatedAt: now,
              deletedAt: null,
            };
            minSortOrder -= 1;
            dirtyAttendance.add(key);
            changed = true;
          }

          if (!changed) return prev;

          return {
            ...prev,
            attendance: nextAttendance,
            dirtyAttendanceKeys: Array.from(dirtyAttendance),
          };
        },
        { recordUndo: true },
      );
    },
    [mutateStore],
  );

  const assignMemberToSession = useCallback(
    (
      sessionId: string,
      memberId: string,
      defaultStatus: DefaultAssignmentStatus = 'unmarked',
    ) => {
      assignMembersToSession(sessionId, [memberId], defaultStatus);
    },
    [assignMembersToSession],
  );

  const removeMemberFromSession = useCallback(
    (sessionId: string, memberId: string) => {
      mutateStore(
        (prev, now) => {
          const key = makeAttendanceKey(sessionId, memberId);
          const existing = prev.attendance[key];
          if (!existing || existing.deletedAt) return prev;

          const nextRecord: SyncedAttendanceRecord = {
            ...existing,
            status: 'unmarked',
            reason: undefined,
            updatedAt: now,
            deletedAt: now,
          };

          return {
            ...prev,
            attendance: { ...prev.attendance, [key]: nextRecord },
            dirtyAttendanceKeys: Array.from(new Set([...prev.dirtyAttendanceKeys, key])),
          };
        },
        { recordUndo: true },
      );
    },
    [mutateStore],
  );

  const toggleAttendanceStatus = useCallback(
    (
      sessionId: string,
      memberId: string,
      targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
    ) => {
      mutateStore((prev, now) => {
        const key = makeAttendanceKey(sessionId, memberId);
        const existing = prev.attendance[key];

        let minSortOrder = 0;
        if (!existing || existing.deletedAt) {
          for (const rec of Object.values(prev.attendance)) {
            if (rec.sessionId === sessionId && !rec.deletedAt && rec.sortOrder <= minSortOrder) {
              minSortOrder = rec.sortOrder - 1;
            }
          }
        }

        const currentStatus =
          existing && !existing.deletedAt ? existing.status : 'unmarked';
        const nextStatus: AttendanceStatus =
          currentStatus === targetStatus ? 'unmarked' : targetStatus;

        const nextRecord: SyncedAttendanceRecord = {
          sessionId,
          memberId,
          status: nextStatus,
          reason:
            nextStatus === 'absent_with_reason' ? (existing?.reason ?? '') : undefined,
          sortOrder: existing && !existing.deletedAt ? existing.sortOrder : minSortOrder,
          updatedAt: now,
          deletedAt: null,
        };

        return {
          ...prev,
          attendance: { ...prev.attendance, [key]: nextRecord },
          dirtyAttendanceKeys: Array.from(new Set([...prev.dirtyAttendanceKeys, key])),
        };
      });
    },
    [mutateStore],
  );

  const setAbsenceReason = useCallback(
    (sessionId: string, memberId: string, reason: string) => {
      mutateStore(
        (prev, now) => {
          const key = makeAttendanceKey(sessionId, memberId);
          const existing = prev.attendance[key];

          let minSortOrder = 0;
          if (!existing || existing.deletedAt) {
            for (const rec of Object.values(prev.attendance)) {
              if (rec.sessionId === sessionId && !rec.deletedAt && rec.sortOrder <= minSortOrder) {
                minSortOrder = rec.sortOrder - 1;
              }
            }
          }

          const nextRecord: SyncedAttendanceRecord = {
            sessionId,
            memberId,
            status: 'absent_with_reason',
            reason,
            sortOrder: existing && !existing.deletedAt ? existing.sortOrder : minSortOrder,
            updatedAt: now,
            deletedAt: null,
          };

          return {
            ...prev,
            attendance: { ...prev.attendance, [key]: nextRecord },
            dirtyAttendanceKeys: Array.from(new Set([...prev.dirtyAttendanceKeys, key])),
          };
        },
        { debounce: true },
      );
    },
    [mutateStore],
  );

  const resetSessionMarks = useCallback(
    (sessionId: string) => {
      mutateStore(
        (prev, now) => {
          const nextAttendance = { ...prev.attendance };
          const dirtyAttendance = new Set(prev.dirtyAttendanceKeys);
          let changed = false;

          for (const [key, rec] of Object.entries(prev.attendance)) {
            if (rec.sessionId === sessionId && !rec.deletedAt && rec.status !== 'unmarked') {
              nextAttendance[key] = {
                ...rec,
                status: 'unmarked',
                reason: undefined,
                updatedAt: now,
              };
              dirtyAttendance.add(key);
              changed = true;
            }
          }

          if (!changed) return prev;

          return {
            ...prev,
            attendance: nextAttendance,
            dirtyAttendanceKeys: Array.from(dirtyAttendance),
          };
        },
        { recordUndo: true },
      );
    },
    [mutateStore],
  );

  const importBackupData = useCallback(
    (
      importedMembers: ClubMember[],
      importedSessions: AttendanceSession[],
    ): { importedMembers: number; importedSessions: number } => {
      let memberChanges = 0;
      let sessionChanges = 0;

      mutateStore(
        (prev, now) => {
          const nextMembers = { ...prev.members };
          const dirtyMembers = new Set(prev.dirtyMemberIds);

          for (const member of importedMembers) {
            const existing = nextMembers[member.id];
            const incomingTs = getEffectiveTimestamp(member.updatedAt ?? member.createdAt, null);
            const existingTs = existing
              ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
              : -1;

            if (!existing || existing.deletedAt || incomingTs > existingTs) {
              const progressed = applyAnnualProgressionToMember(
                {
                  ...member,
                  updatedAt: member.updatedAt ?? member.createdAt,
                  deletedAt: null,
                },
                new Date(),
              ).member;
              nextMembers[member.id] = {
                ...progressed,
                updatedAt: now,
                deletedAt: null,
              };
              dirtyMembers.add(member.id);
              memberChanges += 1;
            }
          }

          const nextSessions = { ...prev.sessions };
          const dirtySessions = new Set(prev.dirtySessionIds);
          const nextAttendance = { ...prev.attendance };
          const dirtyAttendance = new Set(prev.dirtyAttendanceKeys);

          for (const session of importedSessions) {
            const existingSession = nextSessions[session.id];
            const incomingSessionTs = getEffectiveTimestamp(
              session.updatedAt ?? session.createdAt,
              null,
            );
            const existingSessionTs = existingSession
              ? getEffectiveTimestamp(existingSession.updatedAt, existingSession.deletedAt)
              : -1;

            if (
              !existingSession ||
              existingSession.deletedAt ||
              incomingSessionTs > existingSessionTs
            ) {
              nextSessions[session.id] = {
                id: session.id,
                name: session.name,
                date: session.date,
                time: session.time,
                location: session.location,
                description: session.description,
                eventType: session.eventType,
                visibility: normalizeMeetingVisibility(session.visibility),
                createdByUserId: session.createdByUserId,
                createdAt: session.createdAt,
                updatedAt: now,
                deletedAt: null,
              };
              dirtySessions.add(session.id);
              sessionChanges += 1;
            }

            session.memberIds.forEach((memberId, index) => {
              if (!nextMembers[memberId] || nextMembers[memberId].deletedAt) return;
              const key = makeAttendanceKey(session.id, memberId);
              const existingAtt = nextAttendance[key];
              const entry = session.attendance[memberId];
              const incomingAttTs = getEffectiveTimestamp(
                entry?.updatedAt ?? session.updatedAt ?? session.createdAt,
                null,
              );
              const existingAttTs = existingAtt
                ? getEffectiveTimestamp(existingAtt.updatedAt, existingAtt.deletedAt)
                : -1;

              if (!existingAtt || existingAtt.deletedAt || incomingAttTs > existingAttTs) {
                const status = entry?.status ?? 'unmarked';
                nextAttendance[key] = {
                  sessionId: session.id,
                  memberId,
                  status,
                  reason: status === 'absent_with_reason' ? entry?.reason : undefined,
                  sortOrder: existingAtt && !existingAtt.deletedAt ? existingAtt.sortOrder : index,
                  updatedAt: now,
                  deletedAt: null,
                };
                dirtyAttendance.add(key);
              }
            });
          }

          return {
            ...prev,
            members: nextMembers,
            sessions: nextSessions,
            attendance: nextAttendance,
            dirtyMemberIds: Array.from(dirtyMembers),
            dirtySessionIds: Array.from(dirtySessions),
            dirtyAttendanceKeys: Array.from(dirtyAttendance),
          };
        },
        { recordUndo: true },
      );

      return {
        importedMembers: memberChanges,
        importedSessions: sessionChanges,
      };
    },
    [mutateStore],
  );

  const getLastUndoToken = useCallback((): string | null => {
    const token = lastUndoTokenRef.current;
    lastUndoTokenRef.current = null;
    return token;
  }, []);

  const undoByToken = useCallback(
    (token: string): boolean => {
      const idx = undoStackRef.current.findIndex((item) => item.token === token);
      if (idx === -1) return false;

      const entry = undoStackRef.current[idx];
      undoStackRef.current = undoStackRef.current.filter((item) => item.token !== token);
      const { delta } = entry;

      mutateStore((current, now) => {
        const nextMembers = { ...current.members };
        const dirtyMembers = new Set(current.dirtyMemberIds);

        for (const [id, prev] of Object.entries(delta.members)) {
          const cur = current.members[id];
          if (prev) {
            nextMembers[id] = {
              ...prev,
              syncVersion: cur?.syncVersion ?? prev.syncVersion,
              updatedAt: now,
            };
            dirtyMembers.add(id);
          } else if (cur && !cur.deletedAt) {
            nextMembers[id] = { ...cur, updatedAt: now, deletedAt: now };
            dirtyMembers.add(id);
          }
        }

        const nextSessions = { ...current.sessions };
        const dirtySessions = new Set(current.dirtySessionIds);

        for (const [id, prev] of Object.entries(delta.sessions)) {
          const cur = current.sessions[id];
          if (prev) {
            nextSessions[id] = {
              ...prev,
              syncVersion: cur?.syncVersion ?? prev.syncVersion,
              updatedAt: now,
            };
            dirtySessions.add(id);
          } else if (cur && !cur.deletedAt) {
            nextSessions[id] = { ...cur, updatedAt: now, deletedAt: now };
            dirtySessions.add(id);
          }
        }

        const nextAttendance = { ...current.attendance };
        const dirtyAttendance = new Set(current.dirtyAttendanceKeys);

        for (const [key, prev] of Object.entries(delta.attendance)) {
          const cur = current.attendance[key];
          if (prev) {
            nextAttendance[key] = {
              ...prev,
              syncVersion: cur?.syncVersion ?? prev.syncVersion,
              updatedAt: now,
            };
            dirtyAttendance.add(key);
          } else if (cur && !cur.deletedAt) {
            nextAttendance[key] = { ...cur, updatedAt: now, deletedAt: now };
            dirtyAttendance.add(key);
          }
        }

        return {
          ...current,
          members: nextMembers,
          sessions: nextSessions,
          attendance: nextAttendance,
          dirtyMemberIds: Array.from(dirtyMembers),
          dirtySessionIds: Array.from(dirtySessions),
          dirtyAttendanceKeys: Array.from(dirtyAttendance),
        };
      });

      return true;
    },
    [mutateStore],
  );

  const prepareForSignOut = useCallback(async () => {
    const activeUserId = userIdRef.current;
    if (!activeUserId) return;

    const flushed = await flushDirtyQueue();
    // Clear local sync cache on clean sign-out so signed-out browsers retain no club records.
    if (flushed && !hasSyncConflicts(storeRef.current)) {
      clearLocalSyncStore(activeUserId);
    }
  }, [flushDirtyQueue]);

  return {
    members,
    sessions,
    syncStatus,
    realtimeStatus,
    syncError,
    pendingCount,
    conflicts,
    conflictCount: conflicts.length,
    isEditingActive,
    hasUnsavedChanges,
    beginFieldEdit,
    endFieldEdit,
    resolveConflict,
    resolveAllConflicts,
    createSession,
    updateSession,
    deleteSession,
    addMember,
    addMembersBulk,
    updateMember,
    updateMembersClass,
    setMemberLegacyStatus,
    setMembersLegacyStatus,
    deleteMembers,
    assignMemberToSession,
    assignMembersToSession,
    removeMemberFromSession,
    toggleAttendanceStatus,
    setAbsenceReason,
    resetSessionMarks,
    importBackupData,
    getLastUndoToken,
    undoByToken,
    flushPendingChanges: retrySync,
    prepareForSignOut,
    setMergeLocalOnNextConnect,
  };
}
