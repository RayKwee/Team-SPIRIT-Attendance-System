import type { AccountRole, UserProfileRecord } from '../types/attendance';
import { toSupabaseSyncError } from './attendanceSync';
import { createEphemeralAuthClient, supabase } from './supabase';

export type AdminProvisionErrorCode =
  | 'signup_disabled'
  | 'already_exists'
  | 'rate_limited'
  | 'weak_password'
  | 'invalid_email'
  | 'already_linked'
  | 'not_found'
  | 'member_not_synced'
  | 'schema_outdated'
  | 'network'
  | 'unknown';

export class AdminAccountProvisionError extends Error {
  readonly code: AdminProvisionErrorCode;
  readonly needsSetupGuide: boolean;

  constructor(code: AdminProvisionErrorCode, message: string, needsSetupGuide = false) {
    super(message);
    this.name = 'AdminAccountProvisionError';
    this.code = code;
    this.needsSetupGuide = needsSetupGuide;
  }
}

export interface AdminCreateAccountResult {
  profile: UserProfileRecord;
  email: string;
  requiresEmailConfirmation: boolean;
}

export interface AdminRemoveAccountResult {
  userId: string;
  mode: 'deleted' | 'disabled_only';
  removed: boolean;
}

export interface DbUserProfileRow {
  user_id: string;
  email: string;
  role: AccountRole;
  linked_member_id?: string | null;
  can_view_all_attendance?: boolean | null;
  is_disabled?: boolean | null;
  disabled_at?: string | null;
  disabled_by?: string | null;
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
    isDisabled: Boolean(row.is_disabled),
    disabledAt: row.disabled_at ?? undefined,
    disabledBy: row.disabled_by ?? undefined,
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

const MISSING_RPC_CODE_SET = new Set(['42883', 'PGRST202']);
const EMAIL_BASIC_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function extractErrorMeta(error: unknown): { code: string; message: string; status?: number } {
  if (error instanceof Error) {
    const withMeta = error as Error & { code?: unknown; status?: unknown };
    return {
      code: typeof withMeta.code === 'string' ? withMeta.code : '',
      message: error.message || '',
      status: typeof withMeta.status === 'number' ? withMeta.status : undefined,
    };
  }
  if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    return {
      code: typeof obj.code === 'string' ? obj.code : '',
      message: typeof obj.message === 'string' ? obj.message : '',
      status: typeof obj.status === 'number' ? obj.status : undefined,
    };
  }
  return { code: '', message: typeof error === 'string' ? error : '' };
}

function isMissingRpcError(error: unknown): boolean {
  const meta = extractErrorMeta(error);
  return (
    MISSING_RPC_CODE_SET.has(meta.code) ||
    /could not find the function|function public\.admin_/i.test(meta.message)
  );
}

function classifySignUpFailure(error: unknown): AdminAccountProvisionError {
  if (error instanceof AdminAccountProvisionError) {
    return error;
  }

  const { code, message, status } = extractErrorMeta(error);
  const normalizedCode = code.toLowerCase();
  const normalizedMessage = message.trim();

  if (
    (typeof navigator !== 'undefined' && navigator.onLine === false) ||
    status === 0 ||
    (typeof status === 'number' && status >= 500) ||
    /failed to fetch|networkerror|network request failed|load failed|timeout|offline/i.test(
      normalizedMessage,
    )
  ) {
    return new AdminAccountProvisionError(
      'network',
      'Unable to reach Supabase Auth right now. Check your internet connection and try again.',
    );
  }

  if (
    normalizedCode === 'signup_disabled' ||
    /signups? not allowed|signup is disabled|user registration is disabled/i.test(normalizedMessage)
  ) {
    return new AdminAccountProvisionError(
      'signup_disabled',
      'Supabase currently has "Allow new users to sign up" disabled, which blocks creating new accounts directly from the sidebar.',
      true,
    );
  }

  if (
    normalizedCode === 'user_already_exists' ||
    normalizedCode === 'email_exists' ||
    /already registered|already exists|duplicate/i.test(normalizedMessage)
  ) {
    return new AdminAccountProvisionError(
      'already_exists',
      'A Supabase login account already exists for this email address. Switch to "Link Account" to sync and bind it to this member immediately.',
    );
  }

  if (
    normalizedCode === 'over_email_send_rate_limit' ||
    normalizedCode === 'over_request_rate_limit' ||
    status === 429 ||
    /rate limit|too many requests|email rate limit/i.test(normalizedMessage)
  ) {
    return new AdminAccountProvisionError(
      'rate_limited',
      'Supabase rate-limited account creation (usually because Confirm Email is enabled and hit the built-in SMTP limit). Disable "Confirm email" in Supabase Auth for @teamspirit.club accounts.',
      true,
    );
  }

  if (
    normalizedCode === 'weak_password' ||
    /password should be|password is too short|weak password|at least \d+ characters/i.test(
      normalizedMessage,
    )
  ) {
    return new AdminAccountProvisionError(
      'weak_password',
      normalizedMessage || 'Password must be at least 6 characters long.',
    );
  }

  if (
    normalizedCode === 'email_address_invalid' ||
    normalizedCode === 'validation_failed' ||
    /invalid email|unable to validate email/i.test(normalizedMessage)
  ) {
    return new AdminAccountProvisionError(
      'invalid_email',
      normalizedMessage || 'Please enter a valid email address (for example: jun.yuen@teamspirit.club).',
    );
  }

  return new AdminAccountProvisionError(
    'unknown',
    normalizedMessage || 'Supabase rejected the account creation request.',
    true,
  );
}

function classifyLinkRpcFailure(error: unknown, fallbackMessage: string): AdminAccountProvisionError {
  if (error instanceof AdminAccountProvisionError) {
    return error;
  }

  const { code, message } = extractErrorMeta(error);
  const normalizedMessage = message.trim();

  if (isMissingRpcError(error)) {
    return new AdminAccountProvisionError(
      'schema_outdated',
      'Run the updated supabase/schema.sql in your Supabase SQL Editor to enable direct auth-user syncing and linking.',
      true,
    );
  }

  if (code === '23505' || /already linked to/i.test(normalizedMessage)) {
    return new AdminAccountProvisionError(
      'already_linked',
      normalizedMessage || 'This account or roster member is already linked elsewhere. Unlink it first.',
    );
  }

  if (code === 'P0002' && /club member does not exist/i.test(normalizedMessage)) {
    return new AdminAccountProvisionError(
      'member_not_synced',
      'This roster member has not finished syncing to Supabase Cloud yet. Wait for sync to complete and try again.',
    );
  }

  if (code === 'P0002' || /no supabase login account found|not found/i.test(normalizedMessage)) {
    return new AdminAccountProvisionError(
      'not_found',
      normalizedMessage || 'No matching Supabase login account was found for that email address.',
    );
  }

  return new AdminAccountProvisionError('unknown', normalizedMessage || fallbackMessage);
}

/**
 * Admin-only RPC: backfills any `auth.users` rows missing from `public.user_profiles`
 * and returns the refreshed registered accounts directory.
 */
export async function syncAuthProfiles(): Promise<UserProfileRecord[]> {
  const { data, error, status } = await supabase.rpc('admin_sync_auth_profiles');

  if (error) {
    if (isMissingRpcError(error)) {
      return fetchAllUserProfiles();
    }
    throw normalizeAdminError(error, 'Failed to sync Supabase accounts.', status);
  }

  return ((data ?? []) as DbUserProfileRow[]).map(userProfileFromDbRow);
}

/**
 * Admin-only RPC: syncs an existing `auth.users` account (by `userId` or `email`) into
 * `public.user_profiles`, links it to `memberId`, and backfills prior `project_ideas`.
 */
export async function adminSyncAndLinkMemberAccount(params: {
  memberId: string;
  email?: string;
  userId?: string;
}): Promise<UserProfileRecord> {
  const trimmedMemberId = params.memberId.trim();
  const normalizedEmail = params.email?.trim().toLowerCase() || null;
  const targetUserId = params.userId?.trim() || null;

  const { data, error } = await supabase.rpc('admin_sync_and_link_member_account', {
    target_member_id: trimmedMemberId,
    target_email: normalizedEmail,
    target_user_id: targetUserId,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      try {
        if (targetUserId) {
          return await adminLinkUserToMember(targetUserId, trimmedMemberId);
        }
        if (normalizedEmail) {
          const allProfiles = await fetchAllUserProfiles();
          const matched = allProfiles.find(
            (profile) => profile.email.trim().toLowerCase() === normalizedEmail,
          );
          if (matched) {
            return await adminLinkUserToMember(matched.userId, trimmedMemberId);
          }
          throw new AdminAccountProvisionError(
            'schema_outdated',
            `No profile found for "${normalizedEmail}" in user_profiles. Run the updated supabase/schema.sql in Supabase SQL Editor to sync directly from auth.users, or create the account first.`,
            true,
          );
        }
      } catch (fallbackError) {
        throw classifyLinkRpcFailure(fallbackError, 'Unable to link member account.');
      }
    }
    throw classifyLinkRpcFailure(error, 'Unable to sync and link the Supabase account.');
  }

  if (!data) {
    throw new AdminAccountProvisionError(
      'unknown',
      'Supabase did not return the updated account profile after linking.',
    );
  }

  return userProfileFromDbRow(data as DbUserProfileRow);
}

/**
 * Admin-only workflow: creates a new Supabase Auth user via an isolated non-persisting
 * auth client (never replacing the Admin's active session) and immediately links the new
 * account to the target `club_members` roster record.
 */
export async function adminCreateAndLinkMemberAccount(params: {
  memberId: string;
  memberName: string;
  email: string;
  password: string;
}): Promise<AdminCreateAccountResult> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const password = params.password;

  if (!normalizedEmail || !EMAIL_BASIC_RE.test(normalizedEmail)) {
    throw new AdminAccountProvisionError(
      'invalid_email',
      'Enter a valid club login email (for example: jun.yuen@teamspirit.club).',
    );
  }

  if (password.length < 6) {
    throw new AdminAccountProvisionError(
      'weak_password',
      'Initial password must be at least 6 characters long.',
    );
  }

  const ephemeralClient = createEphemeralAuthClient();
  let createdUserId: string | null = null;
  let requiresEmailConfirmation = false;

  try {
    const { data, error } = await ephemeralClient.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: {
          full_name: params.memberName.trim(),
          club_member_id: params.memberId,
        },
      },
    });

    if (error) {
      throw classifySignUpFailure(error);
    }

    const createdUser = data.user;
    if (!createdUser?.id) {
      throw new AdminAccountProvisionError(
        'unknown',
        'Supabase did not return a user record for the new account.',
        true,
      );
    }

    // When "Confirm email" is enabled, Supabase returns a pseudo-user with empty identities for existing emails.
    if (Array.isArray(createdUser.identities) && createdUser.identities.length === 0) {
      throw new AdminAccountProvisionError(
        'already_exists',
        `An account for "${normalizedEmail}" already exists in Supabase. Switch to "Link Account" to sync and bind it to ${params.memberName.trim()}.`,
      );
    }

    createdUserId = createdUser.id;
    requiresEmailConfirmation = Boolean(
      !data.session && !createdUser.email_confirmed_at && !createdUser.confirmed_at,
    );
  } catch (err) {
    throw classifySignUpFailure(err);
  } finally {
    await ephemeralClient.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  // Link using the primary Admin-authenticated Supabase client.
  let linkedProfile: UserProfileRecord;
  try {
    linkedProfile = await adminSyncAndLinkMemberAccount({
      memberId: params.memberId,
      userId: createdUserId,
      email: normalizedEmail,
    });
  } catch (firstLinkErr) {
    const classified = classifyLinkRpcFailure(
      firstLinkErr,
      'Account was created in Supabase Auth, but linking to the roster profile failed.',
    );
    if (classified.code === 'not_found' || classified.code === 'unknown') {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      linkedProfile = await adminSyncAndLinkMemberAccount({
        memberId: params.memberId,
        userId: createdUserId,
        email: normalizedEmail,
      });
    } else {
      throw classified;
    }
  }

  return {
    profile: linkedProfile,
    email: linkedProfile.email || normalizedEmail,
    requiresEmailConfirmation,
  };
}

/** Admin-only RPC: disables or re-enables a user account with self & last-admin protection. */
export async function setUserAccountDisabled(
  targetUserId: string,
  disableAccount: boolean,
): Promise<UserProfileRecord> {
  const { data, error, status } = await supabase.rpc('admin_set_user_disabled', {
    target_user_id: targetUserId,
    disable_account: disableAccount,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error(
        'Run the updated supabase/schema.sql in your Supabase SQL Editor to enable disabling/re-enabling accounts.',
      );
    }
    throw normalizeAdminError(
      error,
      disableAccount ? 'Unable to disable user account.' : 'Unable to re-enable user account.',
      status,
    );
  }

  if (!data) {
    throw new Error('Supabase did not return the updated user profile.');
  }

  return userProfileFromDbRow(data as DbUserProfileRow);
}

/** Admin-only RPC: removes a user account permanently (or revokes all access if Auth deletion is restricted). */
export async function removeUserAccount(targetUserId: string): Promise<AdminRemoveAccountResult> {
  const { data, error, status } = await supabase.rpc('admin_remove_user_account', {
    target_user_id: targetUserId,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error(
        'Run the updated supabase/schema.sql in your Supabase SQL Editor to enable removing user accounts.',
      );
    }
    throw normalizeAdminError(error, 'Unable to remove user account.', status);
  }

  const payload = (data ?? {}) as {
    user_id?: string;
    mode?: string;
    removed?: boolean;
  };

  return {
    userId: payload.user_id || targetUserId,
    mode: payload.mode === 'disabled_only' ? 'disabled_only' : 'deleted',
    removed: payload.removed !== false,
  };
}
