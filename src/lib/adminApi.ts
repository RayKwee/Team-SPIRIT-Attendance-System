import type { AccountRole, UserProfileRecord } from '../types/attendance';
import { toSupabaseSyncError } from './attendanceSync';
import { supabase } from './supabase';

export interface DbUserProfileRow {
  user_id: string;
  email: string;
  role: AccountRole;
  linked_member_id?: string | null;
  can_view_all_attendance?: boolean | null;
  promoted_by: string | null;
  promoted_at: string | null;
  created_at: string;
  updated_at: string;
}

const MISSING_PROFILE_SCHEMA_MESSAGE =
  'Admin role & member-linking schema (public.user_profiles) is outdated or not installed. Run the updated supabase/schema.sql in your Supabase SQL Editor.';

export function userProfileFromDbRow(row: DbUserProfileRow): UserProfileRecord {
  return {
    userId: row.user_id,
    email: row.email,
    role: row.role === 'admin' ? 'admin' : 'member',
    linkedMemberId: row.linked_member_id ?? undefined,
    canViewAllAttendance: Boolean(row.can_view_all_attendance),
    promotedBy: row.promoted_by ?? undefined,
    promotedAt: row.promoted_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

function normalizeAdminError(error: unknown, fallbackMessage: string, httpStatus?: number): Error {
  const syncErr = toSupabaseSyncError(error, fallbackMessage, httpStatus);
  if (syncErr.isMissingTable || syncErr.isMissingColumn) {
    return new Error(MISSING_PROFILE_SCHEMA_MESSAGE);
  }
  return new Error(syncErr.message || fallbackMessage);
}

/** Queries the authenticated user's own role record directly from `public.user_profiles`. */
export async function fetchMyUserProfile(userId: string): Promise<UserProfileRecord | null> {
  const { data, error, status } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw normalizeAdminError(error, 'Failed to verify account role from Supabase.', status);
  }

  return data ? userProfileFromDbRow(data as DbUserProfileRow) : null;
}

/** Admin-only: fetches all registered user profiles ordered with admins first, then earliest created. */
export async function fetchAllUserProfiles(): Promise<UserProfileRecord[]> {
  const { data, error, status } = await supabase
    .from('user_profiles')
    .select('*')
    .order('role', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) {
    throw normalizeAdminError(error, 'Failed to load registered accounts.', status);
  }

  return ((data ?? []) as DbUserProfileRow[]).map(userProfileFromDbRow);
}

/** Admin-only RPC: promotes or demotes a user with server-enforced last-admin protection. */
export async function setUserAdminRole(
  targetUserId: string,
  makeAdmin: boolean,
): Promise<UserProfileRecord> {
  const { data, error, status } = await supabase.rpc('set_user_admin_role', {
    target_user_id: targetUserId,
    make_admin: makeAdmin,
  });

  if (error || !data) {
    throw normalizeAdminError(
      error ?? new Error('Unable to update administrator role.'),
      'Unable to update administrator role.',
      status,
    );
  }

  return userProfileFromDbRow(data as DbUserProfileRow);
}

/** Attempts an exact-email automatic link for the current signed-in user if unlinked. */
export async function autoLinkMyMemberProfile(): Promise<UserProfileRecord | null> {
  const { data, error, status } = await supabase.rpc('auto_link_my_member_profile');
  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Unable to auto-link member profile.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      return null;
    }
    throw normalizeAdminError(error, 'Unable to auto-link member profile.', status);
  }
  return data ? userProfileFromDbRow(data as DbUserProfileRow) : null;
}

/** Admin-only RPC: links or unlinks a registered login account to a club_members profile. */
export async function adminLinkUserToMember(
  targetUserId: string,
  targetMemberId: string | null,
): Promise<UserProfileRecord> {
  const { data, error, status } = await supabase.rpc('admin_link_user_to_member', {
    target_user_id: targetUserId,
    target_member_id: targetMemberId ?? '',
  });

  if (error || !data) {
    throw normalizeAdminError(
      error ?? new Error('Unable to link member profile.'),
      'Unable to link member profile.',
      status,
    );
  }

  return userProfileFromDbRow(data as DbUserProfileRow);
}

/** Admin-only RPC: grants or revokes broad club-wide attendance visibility for a standard member. */
export async function setUserVisibilityScope(
  targetUserId: string,
  allowBroadView: boolean,
): Promise<UserProfileRecord> {
  const { data, error, status } = await supabase.rpc('set_user_visibility_scope', {
    target_user_id: targetUserId,
    allow_broad_view: allowBroadView,
  });

  if (error || !data) {
    throw normalizeAdminError(
      error ?? new Error('Unable to update member visibility scope.'),
      'Unable to update member visibility scope.',
      status,
    );
  }

  return userProfileFromDbRow(data as DbUserProfileRow);
}
