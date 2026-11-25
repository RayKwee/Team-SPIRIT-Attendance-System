import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://ekkwmomfcytqtsdehozp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  'sb_publishable_i3xataKi7A1VcoImfl9OFA_o6RcU8OB';

/** Shared browser Supabase client configured with the project URL and publishable key. */
export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

/**
 * Creates a short-lived, non-persisting Supabase client for Admin-initiated `auth.signUp()`
 * calls so creating a member's login account never replaces the signed-in Admin's session.
 */
export function createEphemeralAuthClient() {
  const memoryStorage = new Map<string, string>();
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: `team-spirit-ephemeral-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      storage: {
        getItem: (key: string) => memoryStorage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          memoryStorage.set(key, value);
        },
        removeItem: (key: string) => {
          memoryStorage.delete(key);
        },
      },
    },
  });
}
