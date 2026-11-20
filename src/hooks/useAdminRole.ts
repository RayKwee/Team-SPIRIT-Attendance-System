import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminLinkUserToMember,
  autoLinkMyMemberProfile,
  fetchAllUserProfiles,
  fetchMyUserProfile,
  setUserAdminRole,
  setUserVisibilityScope,
  userProfileFromDbRow,
  type DbUserProfileRow,
} from '../lib/adminApi';
import { supabase } from '../lib/supabase';
import type { AccountRole, UserProfileRecord } from '../types/attendance';

export interface UseAdminRoleResult {
  userRole: AccountRole | null;
  isAdmin: boolean;
  linkedMemberId: string | null;
  canViewAllAttendance: boolean;
  isRoleLoading: boolean;
  roleError: string | null;
  profiles: UserProfileRecord[];
  isProfilesLoading: boolean;
  profilesError: string | null;
  refreshRoleAndProfiles: () => Promise<void>;
  updateUserAdminRole: (targetUserId: string, makeAdmin: boolean) => Promise<UserProfileRecord>;
  linkUserToMember: (
    targetUserId: string,
    targetMemberId: string | null,
  ) => Promise<UserProfileRecord>;
  updateUserVisibilityScope: (
    targetUserId: string,
    allowBroadView: boolean,
  ) => Promise<UserProfileRecord>;
}

/**
 * Verifies the signed-in user's server-assigned role (`admin` vs `member`), linked roster profile,
 * and broader-visibility override from `public.user_profiles` with live Realtime updates.
 */
export function useAdminRole(userId: string | null): UseAdminRoleResult {
  const [userRole, setUserRole] = useState<AccountRole | null>(null);
  const [linkedMemberId, setLinkedMemberId] = useState<string | null>(null);
  const [canViewAllAttendance, setCanViewAllAttendance] = useState(false);
  const [isRoleLoading, setIsRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<UserProfileRecord[]>([]);
  const [isProfilesLoading, setIsProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const activeUserIdRef = useRef<string | null>(userId);
  activeUserIdRef.current = userId;
  const userRoleRef = useRef<AccountRole | null>(userRole);
  userRoleRef.current = userRole;
  const requestSeqRef = useRef(0);

  const loadRoleAndDirectory = useCallback(async (targetUserId: string) => {
    const reqId = ++requestSeqRef.current;
    const isCurrentRequest = () =>
      mountedRef.current &&
      activeUserIdRef.current === targetUserId &&
      requestSeqRef.current === reqId;

    setIsRoleLoading(true);
    setRoleError(null);
    try {
      let myProfile = await fetchMyUserProfile(targetUserId);
      if (!isCurrentRequest()) return;

      // Attempt exact-email auto-link once if the signed-in user has no linked roster member yet.
      if (myProfile && !myProfile.linkedMemberId) {
        try {
          const linked = await autoLinkMyMemberProfile();
          if (linked && isCurrentRequest()) {
            myProfile = linked;
          }
        } catch {
          // Ignore auto-link errors and keep current profile state.
        }
      }

      if (!isCurrentRequest()) return;

      const resolvedRole: AccountRole = myProfile?.role === 'admin' ? 'admin' : 'member';
      userRoleRef.current = resolvedRole;
      setUserRole(resolvedRole);
      setLinkedMemberId(myProfile?.linkedMemberId ?? null);
      setCanViewAllAttendance(Boolean(myProfile?.canViewAllAttendance));

      if (resolvedRole === 'admin') {
        setIsProfilesLoading(true);
        setProfilesError(null);
        try {
          const allProfiles = await fetchAllUserProfiles();
          if (!isCurrentRequest()) return;
          setProfiles(allProfiles);
        } catch (dirErr) {
          if (!isCurrentRequest()) return;
          setProfilesError(
            dirErr instanceof Error ? dirErr.message : 'Unable to load registered accounts.',
          );
        } finally {
          if (isCurrentRequest()) {
            setIsProfilesLoading(false);
          }
        }
      } else {
        setProfiles([]);
        setProfilesError(null);
        setIsProfilesLoading(false);
      }
    } catch (err) {
      if (!isCurrentRequest()) return;
      // Default strictly to restricted non-admin status on verification error.
      userRoleRef.current = 'member';
      setUserRole('member');
      setLinkedMemberId(null);
      setCanViewAllAttendance(false);
      setProfiles([]);
      setProfilesError(null);
      setIsProfilesLoading(false);
      setRoleError(err instanceof Error ? err.message : 'Unable to verify account permissions.');
    } finally {
      if (isCurrentRequest()) {
        setIsRoleLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    requestSeqRef.current += 1;

    // Always clear previous user's role & directory state immediately on user change.
    userRoleRef.current = null;
    setUserRole(null);
    setLinkedMemberId(null);
    setCanViewAllAttendance(false);
    setRoleError(null);
    setProfiles([]);
    setIsProfilesLoading(false);
    setProfilesError(null);

    if (!userId) {
      setIsRoleLoading(false);
      return () => {
        mountedRef.current = false;
      };
    }

    void loadRoleAndDirectory(userId);

    const channel = supabase
      .channel(`team-spirit-role-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'user_profiles' },
        (payload) => {
          if (!mountedRef.current || activeUserIdRef.current !== userId) return;

          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { user_id?: string } | null)?.user_id;
            if (!deletedId) return;
            setProfiles((prev) => prev.filter((p) => p.userId !== deletedId));
            if (deletedId === userId) {
              userRoleRef.current = 'member';
              setUserRole('member');
              setLinkedMemberId(null);
              setCanViewAllAttendance(false);
              setProfiles([]);
            }
            return;
          }

          if (!payload.new) return;
          const incoming = userProfileFromDbRow(payload.new as DbUserProfileRow);
          if (incoming.userId === userId) {
            const roleChanged = userRoleRef.current !== incoming.role;
            userRoleRef.current = incoming.role;
            setUserRole(incoming.role);
            setLinkedMemberId(incoming.linkedMemberId ?? null);
            setCanViewAllAttendance(incoming.canViewAllAttendance);
            if (incoming.role === 'admin') {
              setProfiles((prev) => {
                if (prev.length === 0) return prev;
                const exists = prev.some((p) => p.userId === incoming.userId);
                return exists
                  ? prev.map((p) => (p.userId === incoming.userId ? incoming : p))
                  : [...prev, incoming];
              });
            } else {
              setProfiles([]);
            }
            if (roleChanged) {
              void loadRoleAndDirectory(userId);
            }
          } else {
            setProfiles((prev) => {
              const exists = prev.some((p) => p.userId === incoming.userId);
              if (exists) {
                return prev.map((p) => (p.userId === incoming.userId ? incoming : p));
              }
              return [...prev, incoming];
            });
          }
        },
      )
      .subscribe();

    return () => {
      mountedRef.current = false;
      void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
    };
  }, [loadRoleAndDirectory, userId]);

  const refreshRoleAndProfiles = useCallback(async () => {
    if (!activeUserIdRef.current) return;
    await loadRoleAndDirectory(activeUserIdRef.current);
  }, [loadRoleAndDirectory]);

  const syncUpdatedProfileIntoState = useCallback((updated: UserProfileRecord) => {
    if (!mountedRef.current) return;
    setProfiles((prev) => {
      const exists = prev.some((p) => p.userId === updated.userId);
      return exists
        ? prev.map((p) => (p.userId === updated.userId ? updated : p))
        : [...prev, updated];
    });
    if (updated.userId === activeUserIdRef.current) {
      userRoleRef.current = updated.role;
      setUserRole(updated.role);
      setLinkedMemberId(updated.linkedMemberId ?? null);
      setCanViewAllAttendance(updated.canViewAllAttendance);
      if (updated.role !== 'admin') {
        setProfiles([]);
      }
    }
  }, []);

  const updateUserAdminRole = useCallback(
    async (targetUserId: string, makeAdmin: boolean): Promise<UserProfileRecord> => {
      const updated = await setUserAdminRole(targetUserId, makeAdmin);
      syncUpdatedProfileIntoState(updated);
      return updated;
    },
    [syncUpdatedProfileIntoState],
  );

  const linkUserToMember = useCallback(
    async (targetUserId: string, targetMemberId: string | null): Promise<UserProfileRecord> => {
      const updated = await adminLinkUserToMember(targetUserId, targetMemberId);
      syncUpdatedProfileIntoState(updated);
      return updated;
    },
    [syncUpdatedProfileIntoState],
  );

  const updateUserVisibilityScope = useCallback(
    async (targetUserId: string, allowBroadView: boolean): Promise<UserProfileRecord> => {
      const updated = await setUserVisibilityScope(targetUserId, allowBroadView);
      syncUpdatedProfileIntoState(updated);
      return updated;
    },
    [syncUpdatedProfileIntoState],
  );

  return {
    userRole,
    isAdmin: Boolean(userId && userRole === 'admin'),
    linkedMemberId,
    canViewAllAttendance,
    isRoleLoading,
    roleError,
    profiles,
    isProfilesLoading,
    profilesError,
    refreshRoleAndProfiles,
    updateUserAdminRole,
    linkUserToMember,
    updateUserVisibilityScope,
  };
}
