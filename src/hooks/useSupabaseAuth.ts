import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export type AuthErrorCategory =
  | 'validation'
  | 'account_not_found'
  | 'invalid_credentials'
  | 'email_unconfirmed'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export interface AuthLoginError {
  category: AuthErrorCategory;
  code: string;
  title: string;
  message: string;
  hint: string;
  field?: 'email' | 'password' | 'both';
}

export interface UseSupabaseAuthResult {
  authStatus: AuthStatus;
  user: User | null;
  signIn: (email: string, password: string) => Promise<{ error: AuthLoginError | null }>;
  signOut: () => Promise<void>;
}

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|network request failed|load failed|fetch|timeout|econnrefused|enotfound|offline/i;
const ACCOUNT_NOT_FOUND_PATTERN =
  /user not found|account not found|no user|no account|email not found/i;
const EMAIL_UNCONFIRMED_PATTERN = /email not confirmed|not confirmed/i;
const RATE_LIMIT_PATTERN = /rate limit|too many requests|too many attempts/i;
const INVALID_CREDENTIALS_PATTERN =
  /invalid login credentials|invalid credentials|invalid email or password|wrong password|incorrect password/i;

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
    hint: 'Verify your account credentials in the Supabase Dashboard or continue in Local-Only Mode.',
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

  return {
    authStatus,
    user,
    signIn,
    signOut,
  };
}
