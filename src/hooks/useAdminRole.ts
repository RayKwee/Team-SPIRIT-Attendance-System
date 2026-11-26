import { useCallback, useEffect, useRef, useState } from 'react';
import {
  adminCreateAndLinkMemberAccount,
  adminLinkUserToMember,
  adminResetMemberPassword,
  adminSyncAndLinkMemberAccount,
  autoLinkMyMemberProfile,
  fetchAllUserProfiles,
  fetchMemberCredentials,
  fetchMyUserProfile,
  removeUserAccount,
  setUserAccountDisabled,
  setUserAdminRole,
  setUserVisibilityScope,
  syncAuthProfiles,
  userProfileFromDbRow,
  type AdminCreateAccountResult,
  type AdminRemoveAccountResult,
  type DbUserProfileRow,
} from '../lib/adminApi';
import { supabase } from '../lib/supabase';
import type { AccountRole, UserProfileRecord } from '../types/attendance';

export interface UseAdminRoleResult {
  userRole: AccountRole | null;
  isAdmin: boolean;
  isAccountDisabled: boolean;
  linkedMemberId: string | null;
  canViewAllAttendance: boolean;
  isRoleLoading: boolean;
  roleError: string | null;
  profiles: UserProfileRecord[];
  memberCredentials: Record<string, string>;
  isProfilesLoading: boolean;
  profilesError: string | null;
  refreshRoleAndProfiles: () => Promise<void>;
  syncAdminProfiles: () => Promise<UserProfileRecord[]>;
  updateUserAdminRole: (targetUserId: string, makeAdmin: boolean) => Promise<UserProfileRecord>;
  linkUserToMember: (
    targetUserId: string,
    targetMemberId: string | null,
  ) => Promise<UserProfileRecord>;
  createAndLinkMemberAccount: (params: {
    memberId?: string | null;
    memberName?: string;
    email: string;
    password: string;
  }) => Promise<AdminCreateAccountResult>;
  resetMemberPassword: (targetUserId: string, newPassword: string) => Promise<void>;
  syncAndLinkMemberAccount: (params: {
    memberId: string;
    email?: string;
    userId?: string;
  }) => Promise<UserProfileRecord>;
  updateUserVisibilityScope: (
    targetUserId: string,
    allowBroadView: boolean,
  ) => Promise<UserProfileRecord>;
  setAccountDisabled: (targetUserId: string, disableAccount: boolean) => Promise<UserProfileRecord>;
  removeAccount: (targetUserId: string) => Promise<AdminRemoveAccountResult>;
}

/**
 * Verifies the signed-in user's server-assigned role (`admin` vs `member`), linked roster profile,
 * and broader-visibility override from `public.user_profiles` with live Realtime updates.
 */
export function useAdminRole(userId: string | null): UseAdminRoleResult {
  const [userRole, setUserRole] = useState<AccountRole | null>(null);
  const [isAccountDisabled, setIsAccountDisabled] = useState(false);
  const [linkedMemberId, setLinkedMemberId] = useState<string | null>(null);
  const [canViewAllAttendance, setCanViewAllAttendance] = useState(false);
  const [isRoleLoading, setIsRoleLoading] = useState(false);
  const [roleError, setRoleError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<UserProfileRecord[]>([]);
  const [memberCredentials, setMemberCredentials] = useState<Record<string, string>>({});
  const [isProfilesLoading, setIsProfilesLoading] = useState(false);
  const [profilesError, setProfilesError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const activeUserIdRef = useRef<string | null>(userId);
  activeUserIdRef.current = userId;
  const userRoleRef = useRef<AccountRole | null>(userRole);
  userRoleRef.current = userRole;
  const profilesRef = useRef<UserProfileRecord[]>(profiles);
  profilesRef.current = profiles;
  const requestSeqRef = useRef(0);

  const filterCredentialsToMembersOnly = useCallback(
    (raw: Record<string, string>, directory: UserProfileRecord[]): Record<string, string> => {
      const memberIds = new Set(
        directory.filter((p) => p.role === 'member').map((p) => p.userId),
      );
      const filtered: Record<string, string> = {};
      for (const [uid, pwd] of Object.entries(raw)) {
        if (memberIds.has(uid) && pwd) {
          filtered[uid] = pwd;
        }
      }
      return filtered;
    },
    [],
  );

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

      if (myProfile?.isDisabled) {
        userRoleRef.current = 'member';
        setIsAccountDisabled(true);
        setUserRole('member');
        setLinkedMemberId(null);
        setCanViewAllAttendance(false);
        setProfiles([]);
        setMemberCredentials({});
        setProfilesError(null);
        setIsProfilesLoading(false);
        return;
      }

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
      setIsAccountDisabled(false);
      setUserRole(resolvedRole);
      setLinkedMemberId(myProfile?.linkedMemberId ?? null);
      setCanViewAllAttendance(Boolean(myProfile?.canViewAllAttendance));

      if (resolvedRole === 'admin') {
        setIsProfilesLoading(true);
        setProfilesError(null);
        try {
          const [allProfiles, rawCreds] = await Promise.all([
            fetchAllUserProfiles(),
            fetchMemberCredentials().catch(() => ({})),
          ]);
          if (!isCurrentRequest()) return;
          setProfiles(allProfiles);
          setMemberCredentials(filterCredentialsToMembersOnly(rawCreds, allProfiles));
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
        setMemberCredentials({});
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
      setMemberCredentials({});
      setProfilesError(null);
      setIsProfilesLoading(false);
      setRoleError(err instanceof Error ? err.message : 'Unable to verify account permissions.');
    } finally {
      if (isCurrentRequest()) {
        setIsRoleLoading(false);
      }
    }
  }, [filterCredentialsToMembersOnly]);

  useEffect(() => {
    mountedRef.current = true;
    requestSeqRef.current += 1;

    // Always clear previous user's role & directory state immediately on user change.
    userRoleRef.current = null;
    setIsAccountDisabled(false);
    setUserRole(null);
    setLinkedMemberId(null);
    setCanViewAllAttendance(false);
    setRoleError(null);
    setProfiles([]);
    setMemberCredentials({});
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
            setMemberCredentials((prev) => {
              if (!(deletedId in prev)) return prev;
              const next = { ...prev };
              delete next[deletedId];
              return next;
            });
            if (deletedId === userId) {
              userRoleRef.current = 'member';
              setIsAccountDisabled(true);
              setUserRole('member');
              setLinkedMemberId(null);
              setCanViewAllAttendance(false);
              setProfiles([]);
              setMemberCredentials({});
            }
            return;
          }

          if (!payload.new) return;
          const incoming = userProfileFromDbRow(payload.new as DbUserProfileRow);
          // Immediately strip any cached credential if an account becomes an Admin.
          if (incoming.role === 'admin') {
            setMemberCredentials((prev) => {
              if (!(incoming.userId in prev)) return prev;
              const next = { ...prev };
              delete next[incoming.userId];
              return next;
            });
          }
          if (incoming.userId === userId) {
            if (incoming.isDisabled) {
              userRoleRef.current = 'member';
              setIsAccountDisabled(true);
              setUserRole('member');
              setLinkedMemberId(null);
              setCanViewAllAttendance(false);
              setProfiles([]);
              setMemberCredentials({});
              return;
            }
            const roleChanged = userRoleRef.current !== incoming.role;
            userRoleRef.current = incoming.role;
            setIsAccountDisabled(false);
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
              setMemberCredentials({});
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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'member_account_credentials' },
        (payload) => {
          if (!mountedRef.current || activeUserIdRef.current !== userId) return;
          if (userRoleRef.current !== 'admin') return;

          if (payload.eventType === 'DELETE') {
            const deletedId = (payload.old as { user_id?: string } | null)?.user_id;
            if (!deletedId) return;
            setMemberCredentials((prev) => {
              if (!(deletedId in prev)) return prev;
              const next = { ...prev };
              delete next[deletedId];
              return next;
            });
            return;
          }

          const row = payload.new as { user_id?: string; login_password?: string } | null;
          if (!row?.user_id || typeof row.login_password !== 'string') return;
          const targetProfile = profilesRef.current.find((p) => p.userId === row.user_id);
          if (targetProfile && targetProfile.role !== 'member') return;

          setMemberCredentials((prev) => ({
            ...prev,
            [row.user_id!]: row.login_password!,
          }));
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
    if (updated.role === 'admin') {
      setMemberCredentials((prev) => {
        if (!(updated.userId in prev)) return prev;
        const next = { ...prev };
        delete next[updated.userId];
        return next;
      });
    }
    if (updated.userId === activeUserIdRef.current) {
      userRoleRef.current = updated.role;
      setUserRole(updated.role);
      setLinkedMemberId(updated.linkedMemberId ?? null);
      setCanViewAllAttendance(updated.canViewAllAttendance);
      if (updated.role !== 'admin') {
        setProfiles([]);
        setMemberCredentials({});
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

  const syncAdminProfiles = useCallback(async (): Promise<UserProfileRecord[]> => {
    if (!activeUserIdRef.current || userRoleRef.current !== 'admin') {
      return [];
    }
    setIsProfilesLoading(true);
    setProfilesError(null);
    try {
      const [synced, rawCreds] = await Promise.all([
        syncAuthProfiles(),
        fetchMemberCredentials().catch(() => ({})),
      ]);
      if (mountedRef.current && userRoleRef.current === 'admin') {
        setProfiles(synced);
        setMemberCredentials(filterCredentialsToMembersOnly(rawCreds, synced));
      }
      return synced;
    } catch (err) {
      if (mountedRef.current) {
        setProfilesError(err instanceof Error ? err.message : 'Unable to sync registered accounts.');
      }
      throw err;
    } finally {
      if (mountedRef.current) {
        setIsProfilesLoading(false);
      }
    }
  }, [filterCredentialsToMembersOnly]);

  const createAndLinkMemberAccount = useCallback(
    async (params: {
      memberId?: string | null;
      memberName?: string;
      email: string;
      password: string;
    }): Promise<AdminCreateAccountResult> => {
      const result = await adminCreateAndLinkMemberAccount(params);
      syncUpdatedProfileIntoState(result.profile);
      if (mountedRef.current && result.profile.role === 'member' && result.password) {
        setMemberCredentials((prev) => ({
          ...prev,
          [result.profile.userId]: result.password,
        }));
      }
      return result;
    },
    [syncUpdatedProfileIntoState],
  );

  const resetMemberPassword = useCallback(
    async (targetUserId: string, newPassword: string): Promise<void> => {
      const targetProfile = profilesRef.current.find((p) => p.userId === targetUserId);
      if (targetProfile && targetProfile.role !== 'member') {
        throw new Error('Administrators cannot view or modify the passwords of admin accounts.');
      }
      await adminResetMemberPassword(targetUserId, newPassword);
      if (mountedRef.current) {
        setMemberCredentials((prev) => ({
          ...prev,
          [targetUserId]: newPassword,
        }));
      }
    },
    [],
  );

  const syncAndLinkMemberAccount = useCallback(
    async (params: {
      memberId: string;
      email?: string;
      userId?: string;
    }): Promise<UserProfileRecord> => {
      const updated = await adminSyncAndLinkMemberAccount(params);
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

  const setAccountDisabled = useCallback(
    async (targetUserId: string, disableAccount: boolean): Promise<UserProfileRecord> => {
      const updated = await setUserAccountDisabled(targetUserId, disableAccount);
      syncUpdatedProfileIntoState(updated);
      return updated;
    },
    [syncUpdatedProfileIntoState],
  );

  const removeAccount = useCallback(
    async (targetUserId: string): Promise<AdminRemoveAccountResult> => {
      const result = await removeUserAccount(targetUserId);
      if (!mountedRef.current) return result;
      if (result.mode === 'deleted') {
        setProfiles((prev) => prev.filter((profile) => profile.userId !== targetUserId));
        setMemberCredentials((prev) => {
          if (!(targetUserId in prev)) return prev;
          const next = { ...prev };
          delete next[targetUserId];
          return next;
        });
      } else {
        setProfiles((prev) =>
          prev.map((profile) =>
            profile.userId === targetUserId
              ? {
                  ...profile,
                  role: 'member',
                  linkedMemberId: undefined,
                  canViewAllAttendance: false,
                  isDisabled: true,
                  disabledAt: new Date().toISOString(),
                }
              : profile,
          ),
        );
      }
      return result;
    },
    [],
  );

  return {
    userRole,
    isAdmin: Boolean(userId && userRole === 'admin' && !isAccountDisabled),
    isAccountDisabled,
    linkedMemberId,
    canViewAllAttendance,
    isRoleLoading,
    roleError,
    profiles,
    memberCredentials,
    isProfilesLoading,
    profilesError,
    refreshRoleAndProfiles,
    syncAdminProfiles,
    updateUserAdminRole,
    linkUserToMember,
    createAndLinkMemberAccount,
    resetMemberPassword,
    syncAndLinkMemberAccount,
    updateUserVisibilityScope,
    setAccountDisabled,
    removeAccount,
  };
}
