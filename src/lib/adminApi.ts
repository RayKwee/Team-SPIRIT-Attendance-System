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
  password: string;
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
 * Admin-only RPC: finalizes a standalone (unlinked) newly created member account
 * in `public.user_profiles` and guarantees immediate verification in `auth.users`.
 */
export async function adminSyncUnlinkedMemberAccount(params: {
  userId?: string;
  email?: string;
}): Promise<UserProfileRecord> {
  const targetUserId = params.userId?.trim() || null;
  const normalizedEmail = params.email?.trim().toLowerCase() || null;

  const { data, error } = await supabase.rpc('admin_sync_unlinked_member_account', {
    target_user_id: targetUserId,
    target_email: normalizedEmail,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      const syncedList = await syncAuthProfiles();
      const matched = syncedList.find(
        (profile) =>
          (targetUserId && profile.userId === targetUserId) ||
          (normalizedEmail && profile.email.trim().toLowerCase() === normalizedEmail),
      );
      if (matched) return matched;
      throw new AdminAccountProvisionError(
        'schema_outdated',
        'Run the updated supabase/schema.sql in Supabase SQL Editor to enable standalone member account finalization.',
        true,
      );
    }
    throw classifyLinkRpcFailure(error, 'Unable to finalize the new member account.');
  }

  if (!data) {
    throw new AdminAccountProvisionError(
      'unknown',
      'Supabase did not return the new account profile.',
    );
  }

  return userProfileFromDbRow(data as DbUserProfileRow);
}

/**
 * Admin-only workflow: creates a new auto-verified Supabase Auth member account via an
 * isolated non-persisting auth client (never replacing the Admin's active session).
 * Linking to an existing `club_members` profile is optional: when `memberId` is provided
 * the account is linked immediately; otherwise it is created as a standalone unlinked member.
 */
export async function adminCreateAndLinkMemberAccount(params: {
  memberId?: string | null;
  memberName?: string;
  email: string;
  password: string;
}): Promise<AdminCreateAccountResult> {
  const normalizedEmail = params.email.trim().toLowerCase();
  const password = params.password;
  const cleanedMemberId = params.memberId?.trim() || '';
  const cleanedMemberName = params.memberName?.trim() || '';

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

  try {
    const metadata: Record<string, string> = {
      signup_flow: 'admin_member_provision',
    };
    if (cleanedMemberName) {
      metadata.full_name = cleanedMemberName;
    }
    if (cleanedMemberId) {
      metadata.club_member_id = cleanedMemberId;
    }

    const { data, error } = await ephemeralClient.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: metadata,
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
        cleanedMemberName
          ? `An account for "${normalizedEmail}" already exists in Supabase. Switch to "Link Account" to sync and bind it to ${cleanedMemberName}.`
          : `An account for "${normalizedEmail}" already exists in Supabase.`,
      );
    }

    createdUserId = createdUser.id;
  } catch (err) {
    throw classifySignUpFailure(err);
  } finally {
    await ephemeralClient.auth.signOut({ scope: 'local' }).catch(() => {});
  }

  // Finalize (and optionally link) using the primary Admin-authenticated Supabase client.
  let finalizedProfile: UserProfileRecord;
  try {
    finalizedProfile = cleanedMemberId
      ? await adminSyncAndLinkMemberAccount({
          memberId: cleanedMemberId,
          userId: createdUserId,
          email: normalizedEmail,
        })
      : await adminSyncUnlinkedMemberAccount({
          userId: createdUserId,
          email: normalizedEmail,
        });
  } catch (firstFinalizeErr) {
    const classified = classifyLinkRpcFailure(
      firstFinalizeErr,
      cleanedMemberId
        ? 'Account was created in Supabase Auth, but linking to the roster profile failed.'
        : 'Account was created in Supabase Auth, but finalizing the member profile failed.',
    );
    if (classified.code === 'not_found' || classified.code === 'unknown') {
      await new Promise((resolve) => window.setTimeout(resolve, 400));
      finalizedProfile = cleanedMemberId
        ? await adminSyncAndLinkMemberAccount({
            memberId: cleanedMemberId,
            userId: createdUserId,
            email: normalizedEmail,
          })
        : await adminSyncUnlinkedMemberAccount({
            userId: createdUserId,
            email: normalizedEmail,
          });
    } else {
      throw classified;
    }
  }

  // Store the member password in the strictly member-only credential vault (never for admins).
  if (finalizedProfile.role === 'member') {
    await storeMemberCredential(finalizedProfile.userId, password);
  }

  return {
    profile: finalizedProfile,
    email: finalizedProfile.email || normalizedEmail,
    password,
  };
}

/**
 * Admin-only: fetches stored passwords strictly for standard `member` accounts.
 * Postgres RLS ensures admin passwords are never stored or returned.
 */
export async function fetchMemberCredentials(): Promise<Record<string, string>> {
  const { data, error, status } = await supabase
    .from('member_account_credentials')
    .select('user_id, login_password');

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to load member credentials.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      return {};
    }
    throw normalizeAdminError(error, 'Failed to load member credentials.', status);
  }

  const map: Record<string, string> = {};
  for (const row of (data ?? []) as { user_id?: string; login_password?: string }[]) {
    if (row.user_id && typeof row.login_password === 'string' && row.login_password.length > 0) {
      map[row.user_id] = row.login_password;
    }
  }
  return map;
}

/**
 * Admin-only RPC: persists a standard member's password in `public.member_account_credentials`.
 * Strictly rejects any Admin target on the server.
 */
export async function storeMemberCredential(
  targetUserId: string,
  plainPassword: string,
): Promise<boolean> {
  const { error } = await supabase.rpc('admin_store_member_credential', {
    target_user_id: targetUserId,
    plain_password: plainPassword,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      return false;
    }
    // Never fail member creation if credential storage is unavailable or target is admin.
    return false;
  }

  return true;
}

/**
 * Admin-only RPC: resets or changes the password of a standard `member` account ONLY.
 * Server strictly rejects any attempt to modify an Admin account's password.
 */
export async function adminResetMemberPassword(
  targetUserId: string,
  newPassword: string,
): Promise<void> {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('New password must be at least 6 characters long.');
  }

  const { error, status } = await supabase.rpc('admin_reset_member_password', {
    target_user_id: targetUserId,
    new_password: newPassword,
  });

  if (error) {
    if (isMissingRpcError(error)) {
      throw new Error(
        'Run the updated supabase/schema.sql in your Supabase SQL Editor to enable admin member password resets.',
      );
    }
    throw normalizeAdminError(error, 'Unable to update member password.', status);
  }
}

/**
 * Syncs a standard member's updated password into `public.member_account_credentials`.
 * Server RPC strictly ignores Admin callers so admin passwords are never persisted.
 */
export async function syncMyMemberCredential(newPassword: string): Promise<void> {
  if (!newPassword || newPassword.length < 6) return;
  try {
    await supabase.rpc('sync_my_member_credential', {
      new_password: newPassword,
    });
  } catch {
    // Non-blocking sync; ignore if schema has not been updated yet.
  }
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
