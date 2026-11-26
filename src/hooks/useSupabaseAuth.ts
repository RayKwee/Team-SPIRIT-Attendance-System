import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { createEphemeralAuthClient, supabase } from '../lib/supabase';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthErrorCategory =
  | 'validation'
  | 'account_not_found'
  | 'already_exists'
  | 'invalid_credentials'
  | 'email_unconfirmed'
  | 'weak_password'
  | 'signup_disabled'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export interface AuthLoginError {
  category: AuthErrorCategory;
  code: string;
  title: string;
  message: string;
  hint: string;
  field?: 'email' | 'password' | 'confirm' | 'both';
}

export interface PasswordChangeError {
  code: string;
  message: string;
  field?: 'current' | 'new' | 'confirm' | 'general';
}

export interface UseSupabaseAuthResult {
  authStatus: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<{ error: AuthLoginError | null }>;
  signUpAdmin: (email: string, password: string) => Promise<{ error: AuthLoginError | null }>;
  signOut: () => Promise<void>;
  changePassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ error: PasswordChangeError | null }>;
}

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch|timeout|econnrefused|enotfound|offline/i;
const ACCOUNT_NOT_FOUND_PATTERN =
  /user not found|account not found|no user|no account|email not found/i;
const EMAIL_UNCONFIRMED_PATTERN = /email not confirmed|not confirmed/i;
const RATE_LIMIT_PATTERN = /rate limit|too many requests|too many attempts/i;
const INVALID_CREDENTIALS_PATTERN =
  /invalid login credentials|invalid credentials|invalid email or password|wrong password|incorrect password/i;
const SAME_PASSWORD_PATTERN = /different from the old password|same password/i;
const WEAK_PASSWORD_PATTERN = /at least \d+ characters|weak password|password should be/i;

function extractAuthErrorMeta(error: unknown): {
  message: string;
  code: string;
  name: string;
  status?: number;
} {
  let rawMessage = '';
  let code = '';
  let name = '';
  let status: number | undefined;

  if (error instanceof Error) {
    rawMessage = error.message;
    name = error.name;
    const errWithMeta = error as Error & { code?: unknown; status?: unknown };
    if (typeof errWithMeta.code === 'string') code = errWithMeta.code;
    if (typeof errWithMeta.status === 'number') status = errWithMeta.status;
  } else if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') rawMessage = obj.message;
    if (typeof obj.code === 'string') code = obj.code;
    if (typeof obj.name === 'string') name = obj.name;
    if (typeof obj.status === 'number') status = obj.status;
  } else if (typeof error === 'string') {
    rawMessage = error;
  }

  return { message: rawMessage.trim(), code, name, status };
}

function classifyPasswordUpdateError(error: unknown): PasswordChangeError {
  const { message, code, name, status } = extractAuthErrorMeta(error);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (
    isOffline ||
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    (typeof status === 'number' && status >= 500) ||
    NETWORK_ERROR_PATTERN.test(message)
  ) {
    return {
      code: 'network',
      message: 'Unable to reach Supabase. Check your internet connection and try again.',
      field: 'general',
    };
  }

  if (code === 'same_password' || SAME_PASSWORD_PATTERN.test(message)) {
    return {
      code: 'same_password',
      message: 'New password must be different from your current password.',
      field: 'new',
    };
  }

  if (code === 'weak_password' || WEAK_PASSWORD_PATTERN.test(message)) {
    return {
      code: 'weak_password',
      message: message || 'New password must be at least 6 characters.',
      field: 'new',
    };
  }

  if (code === 'over_request_rate_limit' || status === 429 || RATE_LIMIT_PATTERN.test(message)) {
    return {
      code: 'rate_limited',
      message: 'Too many attempts. Please wait a moment and try again.',
      field: 'general',
    };
  }

  if (code === 'reauthentication_needed' || /reauthentication/i.test(message)) {
    return {
      code: 'reauthentication_needed',
      message: message || 'Please sign out and sign back in before changing your password.',
      field: 'general',
    };
  }

  return {
    code: code || 'update_failed',
    message: message || 'Unable to update password. Please try again.',
    field: 'general',
  };
}

/** Classifies Supabase Auth errors and network failures into structured, user-friendly login errors. */
export function classifySupabaseAuthError(error: unknown): AuthLoginError {
  let rawMessage = '';
  let code = '';
  let name = '';
  let status: number | undefined;

  if (error instanceof Error) {
    rawMessage = error.message;
    name = error.name;
    const errWithMeta = error as Error & { code?: unknown; status?: unknown };
    if (typeof errWithMeta.code === 'string') code = errWithMeta.code;
    if (typeof errWithMeta.status === 'number') status = errWithMeta.status;
  } else if (typeof error === 'object' && error !== null) {
    const obj = error as Record<string, unknown>;
    if (typeof obj.message === 'string') rawMessage = obj.message;
    if (typeof obj.code === 'string') code = obj.code;
    if (typeof obj.name === 'string') name = obj.name;
    if (typeof obj.status === 'number') status = obj.status;
  } else if (typeof error === 'string') {
    rawMessage = error;
  }

  const normalizedMessage = rawMessage.trim();
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (
    isOffline ||
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    (typeof status === 'number' && status >= 500) ||
    NETWORK_ERROR_PATTERN.test(normalizedMessage)
  ) {
    return {
      category: 'network',
      code: 'NET_CONNECTION_FAILED',
      title: 'Network or Connection Issue',
      message: 'Unable to reach the Supabase authentication server.',
      hint: 'Check your internet connection or firewall settings and try again. The website remains fully usable in Local-Only Mode.',
    };
  }

  if (code === 'user_not_found' || ACCOUNT_NOT_FOUND_PATTERN.test(normalizedMessage)) {
    return {
      category: 'account_not_found',
      code: 'AUTH_ACCOUNT_NOT_FOUND',
      title: 'Account Not Found',
      message: 'No Team SPIRIT cloud account was found for this email address.',
      hint: 'Verify the spelling of your email or create this user in your Supabase Dashboard (Authentication → Users).',
      field: 'email',
    };
  }

  if (code === 'email_not_confirmed' || EMAIL_UNCONFIRMED_PATTERN.test(normalizedMessage)) {
    return {
      category: 'email_unconfirmed',
      code: 'AUTH_EMAIL_UNCONFIRMED',
      title: 'Account Not Confirmed',
      message: 'This account exists in Supabase, but email confirmation is still pending.',
      hint: 'Open your Supabase Dashboard (Authentication → Users) and confirm the user, or enable Auto Confirm User.',
      field: 'email',
    };
  }

  if (
    code === 'over_request_rate_limit' ||
    status === 429 ||
    RATE_LIMIT_PATTERN.test(normalizedMessage)
  ) {
    return {
      category: 'rate_limited',
      code: 'AUTH_RATE_LIMITED',
      title: 'Too Many Sign-In Attempts',
      message: 'Supabase temporarily paused login requests after repeated failed attempts.',
      hint: 'Wait a moment before trying again, or continue working in Local-Only Mode without interruption.',
      field: 'both',
    };
  }

  if (
    code === 'invalid_credentials' ||
    status === 400 ||
    INVALID_CREDENTIALS_PATTERN.test(normalizedMessage)
  ) {
    return {
      category: 'invalid_credentials',
      code: 'AUTH_INVALID_CREDENTIALS',
      title: 'Incorrect Password or Account Not Found',
      message:
        'The password you entered is incorrect, or no account exists for this email address.',
      hint: 'Double-check your password and email, or verify that this user exists in your Supabase Dashboard (Authentication → Users).',
      field: 'both',
    };
  }

  return {
    category: 'unknown',
    code: 'AUTH_REJECTED',
    title: 'Authentication Failed',
    message: normalizedMessage || 'Supabase rejected the sign-in request.',
    hint: 'Verify your account credentials or continue in Local-Only Mode.',
    field: 'both',
  };
}

/** Classifies Supabase self-service registration errors into structured, actionable messages. */
export function classifySupabaseSignUpError(error: unknown): AuthLoginError {
  const { message, code, name, status } = extractAuthErrorMeta(error);
  const normalizedCode = code.toLowerCase();
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  if (
    isOffline ||
    name === 'AuthRetryableFetchError' ||
    status === 0 ||
    (typeof status === 'number' && status >= 500) ||
    NETWORK_ERROR_PATTERN.test(message)
  ) {
    return {
      category: 'network',
      code: 'NET_CONNECTION_FAILED',
      title: 'Network or Connection Issue',
      message: 'Unable to reach the Supabase authentication server.',
      hint: 'Check your internet connection and try again, or continue in Local-Only Mode.',
    };
  }

  if (
    normalizedCode === 'signup_disabled' ||
    /signups? not allowed|signup is disabled|user registration is disabled/i.test(message)
  ) {
    return {
      category: 'signup_disabled',
      code: 'AUTH_SIGNUP_DISABLED',
      title: 'Account Registration Disabled',
      message: 'Supabase currently has new user sign-ups disabled for this project.',
      hint: 'Enable "Allow new users to sign up" in Supabase Auth settings, then retry.',
    };
  }

  if (
    normalizedCode === 'user_already_exists' ||
    normalizedCode === 'email_exists' ||
    /already registered|already exists|duplicate/i.test(message)
  ) {
    return {
      category: 'already_exists',
      code: 'AUTH_EMAIL_EXISTS',
      title: 'Account Already Exists',
      message: 'An account with this email address is already registered.',
      hint: 'Switch to Login to sign in with your existing credentials.',
      field: 'email',
    };
  }

  if (normalizedCode === 'weak_password' || WEAK_PASSWORD_PATTERN.test(message)) {
    return {
      category: 'weak_password',
      code: 'AUTH_WEAK_PASSWORD',
      title: 'Password Too Weak',
      message: message || 'Password must be at least 6 characters long.',
      hint: 'Choose a stronger password with at least 6 characters.',
      field: 'password',
    };
  }

  if (
    normalizedCode === 'email_address_invalid' ||
    normalizedCode === 'validation_failed' ||
    /invalid email|unable to validate email/i.test(message)
  ) {
    return {
      category: 'validation',
      code: 'ERR_INVALID_EMAIL',
      title: 'Invalid Email Address',
      message: message || 'Please enter a valid email address.',
      hint: 'Check the email format and try again.',
      field: 'email',
    };
  }

  if (
    normalizedCode === 'over_email_send_rate_limit' ||
    normalizedCode === 'over_request_rate_limit' ||
    status === 429 ||
    RATE_LIMIT_PATTERN.test(message)
  ) {
    return {
      category: 'rate_limited',
      code: 'AUTH_RATE_LIMITED',
      title: 'Too Many Attempts',
      message: 'Supabase temporarily rate-limited registration requests.',
      hint: 'Wait a moment before trying again (disabling Confirm Email in Supabase Auth also avoids SMTP limits).',
      field: 'email',
    };
  }

  return {
    category: 'unknown',
    code: 'AUTH_SIGNUP_FAILED',
    title: 'Registration Failed',
    message: message || 'Unable to create your admin account right now.',
    hint: 'Verify your details and try again, or continue in Local-Only Mode.',
    field: 'both',
  };
}

/** Manages Supabase authentication session state across entry pages. */
export function useSupabaseAuth(): UseSupabaseAuthResult {
  const [authStatus, setAuthStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<User | null>(null);
  const authVersionRef = useRef(0);

  useEffect(() => {
    let mounted = true;
    const initialVersion = authVersionRef.current;

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!mounted || authVersionRef.current !== initialVersion) return;
        authVersionRef.current += 1;
        if (error || !data.session?.user) {
          setUser(null);
          setAuthStatus('unauthenticated');
          return;
        }
        setUser(data.session.user);
        setAuthStatus('authenticated');
      })
      .catch(() => {
        if (!mounted || authVersionRef.current !== initialVersion) return;
        authVersionRef.current += 1;
        setUser(null);
        setAuthStatus('unauthenticated');
      });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!mounted) return;
      authVersionRef.current += 1;
      const nextUser = session?.user ?? null;
      setUser(nextUser);
      setAuthStatus(nextUser ? 'authenticated' : 'unauthenticated');
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(
    async (email: string, password: string): Promise<{ error: AuthLoginError | null }> => {
      try {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          return { error: classifySupabaseAuthError(error) };
        }

        const nextUser = data.session?.user ?? data.user ?? null;
        if (!nextUser) {
          authVersionRef.current += 1;
          setUser(null);
          setAuthStatus('unauthenticated');
          return {
            error: {
              category: 'email_unconfirmed',
              code: 'AUTH_SESSION_UNAVAILABLE',
              title: 'No Active Session Returned',
              message: 'Supabase did not return an active user session for this account.',
              hint: 'Ensure the user is confirmed and active in your Supabase Dashboard (Authentication → Users).',
              field: 'email',
            },
          };
        }

        authVersionRef.current += 1;
        setUser(nextUser);
        setAuthStatus('authenticated');
        return { error: null };
      } catch (error) {
        return { error: classifySupabaseAuthError(error) };
      }
    },
    [],
  );

  const signUpAdmin = useCallback(
    async (email: string, password: string): Promise<{ error: AuthLoginError | null }> => {
      const normalizedEmail = email.trim().toLowerCase();
      try {
        const { data, error } = await supabase.auth.signUp({
          email: normalizedEmail,
          password,
          options: {
            data: {
              signup_flow: 'self_service_admin',
            },
          },
        });

        if (error) {
          return { error: classifySupabaseSignUpError(error) };
        }

        const createdUser = data.user ?? null;
        if (!createdUser?.id) {
          return {
            error: {
              category: 'unknown',
              code: 'AUTH_SIGNUP_FAILED',
              title: 'Registration Failed',
              message: 'Supabase did not return an account record after registration.',
              hint: 'Try again or check your Supabase Authentication settings.',
            },
          };
        }

        // Supabase returns a pseudo-user with empty identities if the email already exists while Confirm Email is ON.
        if (Array.isArray(createdUser.identities) && createdUser.identities.length === 0) {
          return {
            error: {
              category: 'already_exists',
              code: 'AUTH_EMAIL_EXISTS',
              title: 'Account Already Exists',
              message: 'An account with this email address is already registered.',
              hint: 'Switch to Login to sign in with your existing credentials.',
              field: 'email',
            },
          };
        }

        if (data.session?.user) {
          authVersionRef.current += 1;
          setUser(data.session.user);
          setAuthStatus('authenticated');
          return { error: null };
        }

        // Account is auto-verified by the database trigger; establish an immediate session right away.
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (signInError || !signInData.session?.user) {
          return {
            error: signInError
              ? classifySupabaseAuthError(signInError)
              : {
                  category: 'unknown',
                  code: 'AUTH_SESSION_UNAVAILABLE',
                  title: 'Account Created — Sign-In Pending',
                  message:
                    'Your account was created, but an immediate session could not be started.',
                  hint: 'Run the updated supabase/schema.sql so auto-verification is active, then log in.',
                },
          };
        }

        authVersionRef.current += 1;
        setUser(signInData.session.user);
        setAuthStatus('authenticated');
        return { error: null };
      } catch (error) {
        return { error: classifySupabaseSignUpError(error) };
      }
    },
    [],
  );

  const signOut = useCallback(async () => {
    try {
      // `scope: 'local'` clears localStorage tokens immediately before attempting
      // server-side refresh token revocation, preventing offline sign-out resurrection.
      await supabase.auth.signOut({ scope: 'local' });
    } catch {
      // Clear local auth state even if network sign-out fails.
    } finally {
      authVersionRef.current += 1;
      setUser(null);
      setAuthStatus('unauthenticated');
    }
  }, []);

  const changePassword = useCallback(
    async (
      currentPassword: string,
      newPassword: string,
    ): Promise<{ error: PasswordChangeError | null }> => {
      try {
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        const activeEmail = sessionData.session?.user?.email?.trim() || user?.email?.trim();

        if (sessionError || !activeEmail) {
          return {
            error: {
              code: 'unauthenticated',
              message: 'Your session is no longer active. Sign in again to change your password.',
              field: 'general',
            },
          };
        }

        // Verify current password using an isolated non-persisting client so the active session
        // and Realtime sync subscriptions are not disrupted.
        const ephemeralClient = createEphemeralAuthClient();
        const { error: verifyError } = await ephemeralClient.auth.signInWithPassword({
          email: activeEmail,
          password: currentPassword,
        });

        if (verifyError) {
          const classified = classifySupabaseAuthError(verifyError);
          if (classified.category === 'network') {
            return {
              error: {
                code: 'network',
                message: 'Unable to reach Supabase. Check your internet connection and try again.',
                field: 'general',
              },
            };
          }
          if (classified.category === 'rate_limited') {
            return {
              error: {
                code: 'rate_limited',
                message: 'Too many attempts. Please wait a moment and try again.',
                field: 'general',
              },
            };
          }
          if (
            classified.category === 'invalid_credentials' ||
            classified.category === 'account_not_found'
          ) {
            return {
              error: {
                code: 'invalid_current_password',
                message: 'Current password is incorrect.',
                field: 'current',
              },
            };
          }
          return {
            error: {
              code: classified.code,
              message: classified.message || 'Unable to verify your current password.',
              field: 'current',
            },
          };
        }

        // Only clear the ephemeral client's in-memory session (never global signOut).
        await ephemeralClient.auth.signOut({ scope: 'local' }).catch(() => undefined);

        const { error: updateError } = await supabase.auth.updateUser({
          password: newPassword,
        });

        if (updateError) {
          return { error: classifyPasswordUpdateError(updateError) };
        }

        return { error: null };
      } catch (error) {
        return { error: classifyPasswordUpdateError(error) };
      }
    },
    [user?.email],
  );

  return {
    authStatus,
    user,
    signIn,
    signUpAdmin,
    signOut,
    changePassword,
  };
}
