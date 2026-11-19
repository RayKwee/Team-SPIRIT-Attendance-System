import { useCallback, useEffect, useRef, useState } from 'react';
import {
  LOCAL_ONLY_STORE_KEY,
  attendanceFromDbRow,
  clearLocalSyncStore,
  createEmptySyncStore,
  deriveWorkspaceState,
  getEffectiveTimestamp,
  hasDirtySyncItems,
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
import { supabase } from '../lib/supabase';
import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  DefaultAssignmentStatus,
  LocalSyncStore,
  MemberProfileInput,
  NewSessionInput,
  SyncStatus,
  SyncedAttendanceRecord,
  SyncedMemberRecord,
  SyncedSessionRecord,
} from '../types/attendance';
import {
  applyAnnualProgressionToMember,
  applyMemberProfileUpdate,
  buildClubMember,
  generateId,
  getPromotionCycleYear,
  runAnnualClassProgression,
  type AnnualProgressionSummary,
} from '../utils/attendance';

const REASON_DEBOUNCE_MS = 450;
const BACKGROUND_SYNC_INTERVAL_MS = 15_000;
const CHANGE_SYNC_COOLDOWN_MS = 1_000;

function isBlockingSyncError(error: SupabaseSyncError): boolean {
  return (
    error.isMissingTable ||
    error.isMissingColumn ||
    error.isPermissionDenied ||
    error.isAuthExpired
  );
}

export interface UseSyncedAttendanceDataResult {
  members: ClubMember[];
  sessions: AttendanceSession[];
  syncStatus: SyncStatus;
  syncError: string | null;
  pendingCount: number;
  hasUnsavedChanges: boolean;
  createSession: (
    input: NewSessionInput,
    options?: {
      initialMemberIds?: string[];
      defaultStatus?: DefaultAssignmentStatus;
    },
  ) => AttendanceSession;
  deleteSession: (sessionId: string) => void;
  addMember: (input: string | MemberProfileInput) => ClubMember;
  updateMember: (memberId: string, input: MemberProfileInput) => void;
  setMemberLegacyStatus: (memberId: string, isLegacy: boolean) => void;
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
  options?: { onAnnualProgression?: (summary: AnnualProgressionSummary) => void },
): UseSyncedAttendanceDataResult {
  const [members, setMembers] = useState<ClubMember[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(() => (userId ? 'loading' : 'local'));
  const [syncError, setSyncError] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const storeRef = useRef<LocalSyncStore>(createEmptySyncStore());
  const userIdRef = useRef<string | null>(userId);
  const onAnnualProgressionRef = useRef(options?.onAnnualProgression);
  onAnnualProgressionRef.current = options?.onAnnualProgression;
  const undoStackRef = useRef<{ token: string; snapshot: LocalSyncStore }[]>([]);
  const lastUndoTokenRef = useRef<string | null>(null);
  const syncInFlightRef = useRef(false);
  const needsFollowUpFlushRef = useRef(false);
  const mergeLocalOnNextConnectRef = useRef(false);
  const debounceTimerRef = useRef<number | null>(null);
  const changeSyncTimerRef = useRef<number | null>(null);
  const backgroundIntervalRef = useRef<number | null>(null);
  const lastChangeSyncAtRef = useRef<number>(0);
  const mountedRef = useRef(true);
  const syncBlockedRef = useRef(false);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  userIdRef.current = userId;

  const setMergeLocalOnNextConnect = useCallback((shouldMerge: boolean) => {
    mergeLocalOnNextConnectRef.current = shouldMerge;
  }, []);

  const applyProgressionToCurrentStore = useCallback((activeUserId: string | null): boolean => {
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

    if (activeUserId) {
      saveLocalSyncStore(activeUserId, nextStore);
    } else {
      saveLocalOnlyStore(nextStore);
    }

    onAnnualProgressionRef.current?.(summary);
    return true;
  }, []);

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
    setHasUnsavedChanges(
      Boolean(userIdRef.current) &&
        (dirtyTotal > 0 || syncInFlightRef.current || hasPendingSyncTimer),
    );
  }, []);

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

  const cleanupRealtimeSubscription = useCallback(() => {
    const channel = realtimeChannelRef.current;
    if (!channel) return;
    realtimeChannelRef.current = null;
    void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
  }, []);

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

      const channel = supabase
        .channel(`team-spirit-sync-${activeUserId}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'club_members' },
          (payload) => {
            if (userIdRef.current !== activeUserId) return;
            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as { id?: string } | null)?.id;
              if (!oldId || !storeRef.current.members[oldId]) return;
              const nextMembers = { ...storeRef.current.members };
              delete nextMembers[oldId];
              storeRef.current = {
                ...storeRef.current,
                members: nextMembers,
                dirtyMemberIds: storeRef.current.dirtyMemberIds.filter((id) => id !== oldId),
              };
              saveLocalSyncStore(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            if (!payload.new) return;
            const incoming = memberFromDbRow(payload.new as Parameters<typeof memberFromDbRow>[0]);
            const existing = storeRef.current.members[incoming.id];
            const incomingTs = getEffectiveTimestamp(incoming.updatedAt, incoming.deletedAt);
            const existingTs = existing
              ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
              : -1;

            if (incomingTs >= existingTs) {
              storeRef.current = {
                ...storeRef.current,
                members: { ...storeRef.current.members, [incoming.id]: incoming },
                dirtyMemberIds: storeRef.current.dirtyMemberIds.filter(
                  (id) => id !== incoming.id,
                ),
              };
              saveLocalSyncStore(activeUserId, storeRef.current);
              refreshDerivedState();
            }
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'attendance_sessions' },
          (payload) => {
            if (userIdRef.current !== activeUserId) return;
            if (payload.eventType === 'DELETE') {
              const oldId = (payload.old as { id?: string } | null)?.id;
              if (!oldId || !storeRef.current.sessions[oldId]) return;
              const nextSessions = { ...storeRef.current.sessions };
              delete nextSessions[oldId];
              storeRef.current = {
                ...storeRef.current,
                sessions: nextSessions,
                dirtySessionIds: storeRef.current.dirtySessionIds.filter((id) => id !== oldId),
              };
              saveLocalSyncStore(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            if (!payload.new) return;
            const incoming = sessionFromDbRow(
              payload.new as Parameters<typeof sessionFromDbRow>[0],
            );
            const existing = storeRef.current.sessions[incoming.id];
            const incomingTs = getEffectiveTimestamp(incoming.updatedAt, incoming.deletedAt);
            const existingTs = existing
              ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
              : -1;

            if (incomingTs >= existingTs) {
              storeRef.current = {
                ...storeRef.current,
                sessions: { ...storeRef.current.sessions, [incoming.id]: incoming },
                dirtySessionIds: storeRef.current.dirtySessionIds.filter(
                  (id) => id !== incoming.id,
                ),
              };
              saveLocalSyncStore(activeUserId, storeRef.current);
              refreshDerivedState();
            }
          },
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'session_attendance' },
          (payload) => {
            if (userIdRef.current !== activeUserId) return;
            if (payload.eventType === 'DELETE') {
              const oldRow = payload.old as { session_id?: string; member_id?: string } | null;
              if (!oldRow?.session_id || !oldRow?.member_id) return;
              const key = makeAttendanceKey(oldRow.session_id, oldRow.member_id);
              if (!storeRef.current.attendance[key]) return;
              const nextAttendance = { ...storeRef.current.attendance };
              delete nextAttendance[key];
              storeRef.current = {
                ...storeRef.current,
                attendance: nextAttendance,
                dirtyAttendanceKeys: storeRef.current.dirtyAttendanceKeys.filter((k) => k !== key),
              };
              saveLocalSyncStore(activeUserId, storeRef.current);
              refreshDerivedState();
              return;
            }

            if (!payload.new) return;
            const incoming = attendanceFromDbRow(
              payload.new as Parameters<typeof attendanceFromDbRow>[0],
            );
            const key = makeAttendanceKey(incoming.sessionId, incoming.memberId);
            const existing = storeRef.current.attendance[key];
            const incomingTs = getEffectiveTimestamp(incoming.updatedAt, incoming.deletedAt);
            const existingTs = existing
              ? getEffectiveTimestamp(existing.updatedAt, existing.deletedAt)
              : -1;

            if (incomingTs >= existingTs) {
              storeRef.current = {
                ...storeRef.current,
                attendance: { ...storeRef.current.attendance, [key]: incoming },
                dirtyAttendanceKeys: storeRef.current.dirtyAttendanceKeys.filter((k) => k !== key),
              };
              saveLocalSyncStore(activeUserId, storeRef.current);
              refreshDerivedState();
            }
          },
        )
        .subscribe();

      realtimeChannelRef.current = channel;
    },
    [refreshDerivedState],
  );

  const flushDirtyQueue = useCallback(async (): Promise<boolean> => {
    const activeUserId = userIdRef.current;
    if (!activeUserId) return true;

    clearDebounceTimer();
    clearChangeSyncTimer();

    if (syncBlockedRef.current) {
      if (mountedRef.current) {
        setSyncStatus(hasDirtySyncItems(storeRef.current) ? 'pending' : 'error');
        refreshDerivedState();
      }
      return false;
    }

    if (!hasDirtySyncItems(storeRef.current)) {
      ensureRealtimeSubscription(activeUserId);
      if (mountedRef.current) {
        setSyncStatus('synced');
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
      const snapshotToPush = storeRef.current;
      const pushed = await pushDirtyQueueToSupabase(activeUserId, snapshotToPush);

      if (userIdRef.current !== activeUserId) {
        syncInFlightRef.current = false;
        return false;
      }

      // Preserve any newer mutations that occurred while push was in flight.
      if (storeRef.current === snapshotToPush) {
        storeRef.current = pushed;
      } else {
        const pushedMembers = new Set(snapshotToPush.dirtyMemberIds);
        const pushedSessions = new Set(snapshotToPush.dirtySessionIds);
        const pushedAttendance = new Set(snapshotToPush.dirtyAttendanceKeys);

        storeRef.current = {
          ...storeRef.current,
          dirtyMemberIds: storeRef.current.dirtyMemberIds.filter((id) => {
            if (!pushedMembers.has(id)) return true;
            return (
              getEffectiveTimestamp(
                storeRef.current.members[id]?.updatedAt,
                storeRef.current.members[id]?.deletedAt,
              ) >
              getEffectiveTimestamp(
                snapshotToPush.members[id]?.updatedAt,
                snapshotToPush.members[id]?.deletedAt,
              )
            );
          }),
          dirtySessionIds: storeRef.current.dirtySessionIds.filter((id) => {
            if (!pushedSessions.has(id)) return true;
            return (
              getEffectiveTimestamp(
                storeRef.current.sessions[id]?.updatedAt,
                storeRef.current.sessions[id]?.deletedAt,
              ) >
              getEffectiveTimestamp(
                snapshotToPush.sessions[id]?.updatedAt,
                snapshotToPush.sessions[id]?.deletedAt,
              )
            );
          }),
          dirtyAttendanceKeys: storeRef.current.dirtyAttendanceKeys.filter((key) => {
            if (!pushedAttendance.has(key)) return true;
            return (
              getEffectiveTimestamp(
                storeRef.current.attendance[key]?.updatedAt,
                storeRef.current.attendance[key]?.deletedAt,
              ) >
              getEffectiveTimestamp(
                snapshotToPush.attendance[key]?.updatedAt,
                snapshotToPush.attendance[key]?.deletedAt,
              )
            );
          }),
        };
        saveLocalSyncStore(activeUserId, storeRef.current);
      }

      syncInFlightRef.current = false;
      syncBlockedRef.current = false;
      ensureRealtimeSubscription(activeUserId);

      if (needsFollowUpFlushRef.current || hasDirtySyncItems(storeRef.current)) {
        needsFollowUpFlushRef.current = false;
        return await flushDirtyQueue();
      }

      if (mountedRef.current) {
        setSyncStatus('synced');
        setSyncError(null);
        refreshDerivedState();
      }
      return true;
    } catch (error) {
      if (userIdRef.current !== activeUserId) {
        syncInFlightRef.current = false;
        return false;
      }
      syncInFlightRef.current = false;
      needsFollowUpFlushRef.current = false;
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
  }, [clearChangeSyncTimer, clearDebounceTimer, ensureRealtimeSubscription, refreshDerivedState]);

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

  const reconcileNow = useCallback(
    async (options?: { background?: boolean }): Promise<boolean> => {
      const activeUserId = userIdRef.current;
      if (!activeUserId || syncBlockedRef.current) return false;

      if (syncInFlightRef.current) {
        if (!options?.background) {
          needsFollowUpFlushRef.current = true;
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
        const merged = await reconcileWithSupabase(activeUserId, storeRef.current);
        if (userIdRef.current !== activeUserId) {
          syncInFlightRef.current = false;
          return false;
        }

        // If local mutations happened while reconciling, preserve newer local items over merged snapshot.
        const current = storeRef.current;
        if (hasDirtySyncItems(current)) {
          const nextMembers = { ...merged.members };
          const nextDirtyMembers = new Set<string>();
          for (const id of current.dirtyMemberIds) {
            const localRec = current.members[id];
            const mergedRec = merged.members[id];
            if (
              localRec &&
              (!mergedRec ||
                getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt) >
                  getEffectiveTimestamp(mergedRec.updatedAt, mergedRec.deletedAt))
            ) {
              nextMembers[id] = localRec;
              nextDirtyMembers.add(id);
            }
          }

          const nextSessions = { ...merged.sessions };
          const nextDirtySessions = new Set<string>();
          for (const id of current.dirtySessionIds) {
            const localRec = current.sessions[id];
            const mergedRec = merged.sessions[id];
            if (
              localRec &&
              (!mergedRec ||
                getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt) >
                  getEffectiveTimestamp(mergedRec.updatedAt, mergedRec.deletedAt))
            ) {
              nextSessions[id] = localRec;
              nextDirtySessions.add(id);
            }
          }

          const nextAttendance = { ...merged.attendance };
          const nextDirtyAttendance = new Set<string>();
          for (const key of current.dirtyAttendanceKeys) {
            const localRec = current.attendance[key];
            const mergedRec = merged.attendance[key];
            if (
              localRec &&
              (!mergedRec ||
                getEffectiveTimestamp(localRec.updatedAt, localRec.deletedAt) >
                  getEffectiveTimestamp(mergedRec.updatedAt, mergedRec.deletedAt))
            ) {
              nextAttendance[key] = localRec;
              nextDirtyAttendance.add(key);
            }
          }

          storeRef.current = {
            members: nextMembers,
            sessions: nextSessions,
            attendance: nextAttendance,
            dirtyMemberIds: Array.from(nextDirtyMembers),
            dirtySessionIds: Array.from(nextDirtySessions),
            dirtyAttendanceKeys: Array.from(nextDirtyAttendance),
            legacyImported: true,
          };
          saveLocalSyncStore(activeUserId, storeRef.current);
        } else {
          storeRef.current = merged;
        }

        syncInFlightRef.current = false;
        syncBlockedRef.current = false;
        ensureRealtimeSubscription(activeUserId);

        const hasActiveEditTimer =
          debounceTimerRef.current !== null || changeSyncTimerRef.current !== null;
        if (!hasActiveEditTimer) {
          applyProgressionToCurrentStore(activeUserId);
        }

        if (!hasActiveEditTimer && (hasDirtySyncItems(storeRef.current) || needsFollowUpFlushRef.current)) {
          needsFollowUpFlushRef.current = false;
          return await flushDirtyQueue();
        }

        if (mountedRef.current) {
          if (!hasActiveEditTimer) {
            setSyncStatus('synced');
            setSyncError(null);
          }
          refreshDerivedState();
        }
        return true;
      } catch (error) {
        if (userIdRef.current !== activeUserId) {
          syncInFlightRef.current = false;
          return false;
        }
        syncInFlightRef.current = false;
        needsFollowUpFlushRef.current = false;
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
  }, [applyProgressionToCurrentStore, ensureRealtimeSubscription, flushDirtyQueue, refreshDerivedState]);

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
    cleanupRealtimeSubscription();
    clearBackgroundInterval();

    if (!userId) {
      clearDebounceTimer();
      clearChangeSyncTimer();
      lastChangeSyncAtRef.current = 0;
      syncInFlightRef.current = false;
      needsFollowUpFlushRef.current = false;
      storeRef.current = loadLocalOnlyStore();
      applyProgressionToCurrentStore(null);
      setSyncStatus('local');
      setSyncError(null);
      refreshDerivedState();

      function handleLocalStorageChange(event: StorageEvent) {
        if (event.key === LOCAL_ONLY_STORE_KEY && !userIdRef.current) {
          storeRef.current = loadLocalOnlyStore();
          applyProgressionToCurrentStore(null);
          refreshDerivedState();
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
        window.removeEventListener('storage', handleLocalStorageChange);
        document.removeEventListener('visibilitychange', handleLocalVisibilityOrInterval);
      };
    }

    const shouldMergeLocal = mergeLocalOnNextConnectRef.current;
    mergeLocalOnNextConnectRef.current = false;

    const initialStore = shouldMergeLocal
      ? mergeLocalOnlyIntoUserStore(userId, loadLocalOnlyStore())
      : loadLocalSyncStore(userId);
    storeRef.current = initialStore;
    setSyncStatus('loading');
    setSyncError(null);
    refreshDerivedState();
    void reconcileNow();

    backgroundIntervalRef.current = window.setInterval(() => {
      if (!mountedRef.current || userIdRef.current !== userId) return;
      if (syncBlockedRef.current) return;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
      if (
        syncInFlightRef.current ||
        debounceTimerRef.current !== null ||
        changeSyncTimerRef.current !== null
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

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mountedRef.current = false;
      syncBlockedRef.current = false;
      clearBackgroundInterval();
      clearChangeSyncTimer();
      clearDebounceTimer();
      lastChangeSyncAtRef.current = 0;
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
    reconcileNow,
    refreshDerivedState,
    userId,
  ]);

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
          { token, snapshot: prevStore },
        ];
        lastUndoTokenRef.current = token;
      }

      storeRef.current = nextStore;

      if (!activeUserId) {
        saveLocalOnlyStore(nextStore);
        refreshDerivedState();
        return;
      }

      saveLocalSyncStore(activeUserId, nextStore);

      if (syncBlockedRef.current) {
        clearDebounceTimer();
        clearChangeSyncTimer();
        setSyncStatus(hasDirtySyncItems(nextStore) ? 'pending' : 'error');
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
    [clearChangeSyncTimer, clearDebounceTimer, refreshDerivedState, scheduleChangeSync],
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

  const setMemberLegacyStatus = useCallback(
    (memberId: string, isLegacy: boolean) => {
      mutateStore(
        (prev, now) => {
          const existing = prev.members[memberId];
          if (!existing || existing.deletedAt) return prev;
          if (Boolean(existing.isLegacy) === isLegacy) return prev;

          const record: SyncedMemberRecord = {
            ...existing,
            isLegacy,
            retiredAt: isLegacy ? (existing.retiredAt ?? now) : undefined,
            graduationYear: isLegacy ? existing.graduationYear : undefined,
            lastPromotedYear: isLegacy
              ? existing.lastPromotedYear
              : getPromotionCycleYear(new Date()),
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
      const target = entry.snapshot;

      mutateStore((current, now) => {
        const nextMembers = { ...current.members };
        const dirtyMembers = new Set(current.dirtyMemberIds);
        const allMemberIds = new Set([
          ...Object.keys(current.members),
          ...Object.keys(target.members),
        ]);

        for (const id of allMemberIds) {
          const cur = current.members[id];
          const prev = target.members[id];
          if (prev && cur !== prev) {
            nextMembers[id] = { ...prev, updatedAt: now };
            dirtyMembers.add(id);
          } else if (!prev && cur && !cur.deletedAt) {
            nextMembers[id] = { ...cur, updatedAt: now, deletedAt: now };
            dirtyMembers.add(id);
          }
        }

        const nextSessions = { ...current.sessions };
        const dirtySessions = new Set(current.dirtySessionIds);
        const allSessionIds = new Set([
          ...Object.keys(current.sessions),
          ...Object.keys(target.sessions),
        ]);

        for (const id of allSessionIds) {
          const cur = current.sessions[id];
          const prev = target.sessions[id];
          if (prev && cur !== prev) {
            nextSessions[id] = { ...prev, updatedAt: now };
            dirtySessions.add(id);
          } else if (!prev && cur && !cur.deletedAt) {
            nextSessions[id] = { ...cur, updatedAt: now, deletedAt: now };
            dirtySessions.add(id);
          }
        }

        const nextAttendance = { ...current.attendance };
        const dirtyAttendance = new Set(current.dirtyAttendanceKeys);
        const allAttendanceKeys = new Set([
          ...Object.keys(current.attendance),
          ...Object.keys(target.attendance),
        ]);

        for (const key of allAttendanceKeys) {
          const cur = current.attendance[key];
          const prev = target.attendance[key];
          if (prev && cur !== prev) {
            nextAttendance[key] = { ...prev, updatedAt: now };
            dirtyAttendance.add(key);
          } else if (!prev && cur && !cur.deletedAt) {
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
    if (flushed) {
      clearLocalSyncStore(activeUserId);
    }
  }, [flushDirtyQueue]);

  return {
    members,
    sessions,
    syncStatus,
    syncError,
    pendingCount,
    hasUnsavedChanges,
    createSession,
    deleteSession,
    addMember,
    updateMember,
    setMemberLegacyStatus,
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
