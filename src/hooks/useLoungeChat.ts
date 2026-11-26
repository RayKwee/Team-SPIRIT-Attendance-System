import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteLoungeChatMessage,
  fetchLoungeChatHistory,
  insertLoungeChatMessage,
  isValidLoungeRoom,
  loungeMessageFromDbRow,
  setLoungeChatReaction,
  updateLoungeChatMessage,
  type DbLoungeChatMessageRow,
  type DbLoungeChatReactionRow,
  type LoungeChatMessage,
  type LoungeReplyRef,
  type LoungeRoomId,
} from '../lib/loungeChatApi';
import { supabase } from '../lib/supabase';

export type { LoungeChatMessage, LoungeReplyRef, LoungeRoomId };

export interface LoungeRoomMeta {
  id: LoungeRoomId;
  label: string;
  tagline: string;
}

export const LOUNGE_ROOMS: LoungeRoomMeta[] = [
  {
    id: 'general',
    label: '#general',
    tagline: 'Say hey, share vibes, or see what everyone is up to.',
  },
  {
    id: 'build-talk',
    label: '#build-talk',
    tagline: 'Swap build progress, ask quick questions, drop cool links.',
  },
  {
    id: 'off-topic',
    label: '#off-topic',
    tagline: 'Games, music, study breaks, snacks & random chill chat.',
  },
];

export const LOUNGE_VIBES = ['Chilling', 'Building', 'Studying', 'Listening to music'] as const;
export type LoungeVibe = (typeof LOUNGE_VIBES)[number];

export interface LoungeOnlineMember {
  key: string;
  name: string;
  role: 'admin' | 'member';
  vibe: LoungeVibe;
  room: LoungeRoomId;
}

const CHAT_FALLBACK_STORAGE_KEY = 'team-spirit:lounge-chat-cache:v2';
const BROADCAST_CHANNEL_NAME = 'team-spirit-student-lounge-live-v2';
const BROWSER_BC_NAME = 'team-spirit-lounge-bc-v2';
const MAX_CACHED_MESSAGES = 200;

// Module-level teardown promise prevents React StrictMode / rapid route transitions
// from colliding with an in-flight `supabase.removeChannel()` on the same topic.
let pendingBroadcastTeardown: Promise<void> = Promise.resolve();
let instanceCounter = 0;

type ChatRealtimeEvent =
  | { type: 'message'; payload: LoungeChatMessage }
  | { type: 'edit'; payload: { messageId: string; content: string; updatedAt: string } }
  | {
      type: 'reaction';
      payload: { messageId: string; emoji: string; userId: string; add: boolean };
    }
  | { type: 'delete'; payload: { messageId: string } };

function generateUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // RFC4122 v4 fallback for older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function loadCachedMessages(): LoungeChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHAT_FALLBACK_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: LoungeChatMessage[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const candidate = item as Partial<LoungeChatMessage>;
      if (
        typeof candidate.id !== 'string' ||
        !isValidLoungeRoom(candidate.room) ||
        typeof candidate.authorUserId !== 'string' ||
        typeof candidate.authorName !== 'string' ||
        typeof candidate.content !== 'string' ||
        typeof candidate.createdAt !== 'string'
      ) {
        continue;
      }
      valid.push({
        id: candidate.id,
        room: candidate.room,
        authorUserId: candidate.authorUserId,
        authorName: candidate.authorName,
        authorRole: candidate.authorRole === 'admin' ? 'admin' : 'member',
        content: candidate.content,
        replyTo:
          candidate.replyTo &&
          typeof candidate.replyTo.id === 'string' &&
          typeof candidate.replyTo.authorName === 'string' &&
          typeof candidate.replyTo.snippet === 'string'
            ? candidate.replyTo
            : undefined,
        reactions:
          candidate.reactions && typeof candidate.reactions === 'object'
            ? candidate.reactions
            : {},
        createdAt: candidate.createdAt,
        updatedAt: typeof candidate.updatedAt === 'string' ? candidate.updatedAt : undefined,
      });
    }
    return valid.slice(-MAX_CACHED_MESSAGES);
  } catch {
    return [];
  }
}

function persistCachedMessages(messages: LoungeChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CHAT_FALLBACK_STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_CACHED_MESSAGES)),
    );
  } catch {
    // Ignore storage quota errors safely.
  }
}

function upsertMessageList(
  prev: LoungeChatMessage[],
  incoming: LoungeChatMessage,
): LoungeChatMessage[] {
  const idx = prev.findIndex((item) => item.id === incoming.id);
  if (idx >= 0) {
    const existing = prev[idx];
    // Preserve reactions already attached locally/from DB when updating canonical message metadata.
    const mergedReactions: Record<string, string[]> = { ...existing.reactions };
    for (const [emoji, users] of Object.entries(incoming.reactions)) {
      const merged = new Set([...(mergedReactions[emoji] ?? []), ...users]);
      if (merged.size > 0) {
        mergedReactions[emoji] = Array.from(merged);
      }
    }
    const next = [...prev];
    next[idx] = { ...incoming, reactions: mergedReactions };
    return next;
  }
  return [...prev, incoming]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_CACHED_MESSAGES);
}

function applyReactionMutation(
  messages: LoungeChatMessage[],
  messageId: string,
  emoji: string,
  actorUserId: string,
  add: boolean,
): LoungeChatMessage[] {
  let changed = false;
  const next = messages.map((msg) => {
    if (msg.id !== messageId) return msg;
    const current = msg.reactions[emoji] ?? [];
    const exists = current.includes(actorUserId);
    if (add && exists) return msg;
    if (!add && !exists) return msg;

    changed = true;
    const updatedUsers = add
      ? [...current, actorUserId]
      : current.filter((id) => id !== actorUserId);
    const nextReactions = { ...msg.reactions };
    if (updatedUsers.length === 0) {
      delete nextReactions[emoji];
    } else {
      nextReactions[emoji] = updatedUsers;
    }
    return {
      ...msg,
      reactions: nextReactions,
    };
  });
  return changed ? next : messages;
}

export interface UseLoungeChatOptions {
  userId: string | null;
  authorName: string;
  isAdmin: boolean;
  activeRoom: LoungeRoomId;
  onError?: (message: string) => void;
}

export interface UseLoungeChatResult {
  messages: LoungeChatMessage[];
  onlineMembers: LoungeOnlineMember[];
  isLoading: boolean;
  isLiveConnected: boolean;
  isDbBacked: boolean;
  vibe: LoungeVibe;
  setVibe: (vibe: LoungeVibe) => void;
  refreshHistory: () => Promise<void>;
  sendMessage: (content: string, replyTo?: LoungeReplyRef) => Promise<LoungeChatMessage | null>;
  editMessage: (messageId: string, content: string) => Promise<LoungeChatMessage | null>;
  toggleReaction: (messageId: string, emoji: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
}

/**
 * Real-time Student Lounge chat backed by Supabase Postgres (`lounge_chat_messages` &
 * `lounge_chat_reactions`) + `postgres_changes` + serialized Realtime Broadcast/Presence
 * + same-browser `BroadcastChannel`.
 *
 * - Unauthenticated visitors (`userId === null`) have strictly read-only live access.
 * - Authenticated users can post messages, react with any emoji, and delete own messages.
 */
export function useLoungeChat({
  userId,
  authorName,
  isAdmin,
  activeRoom,
  onError,
}: UseLoungeChatOptions): UseLoungeChatResult {
  const [messages, setMessages] = useState<LoungeChatMessage[]>(() => loadCachedMessages());
  const [onlineMembers, setOnlineMembers] = useState<LoungeOnlineMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDbBacked, setIsDbBacked] = useState(true);
  const [isBroadcastLive, setIsBroadcastLive] = useState(false);
  const [isDbRealtimeLive, setIsDbRealtimeLive] = useState(false);
  const [vibe, setVibe] = useState<LoungeVibe>('Chilling');

  const mountedRef = useRef(true);
  const messagesRef = useRef<LoungeChatMessage[]>(messages);
  messagesRef.current = messages;
  const isDbBackedRef = useRef(isDbBacked);
  isDbBackedRef.current = isDbBacked;
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isBroadcastReadyRef = useRef(false);
  const browserBcRef = useRef<BroadcastChannel | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const isLiveConnected = isBroadcastLive || isDbRealtimeLive;

  const applyRealtimeEvent = useCallback((event: ChatRealtimeEvent) => {
    if (!mountedRef.current) return;
    if (event.type === 'message' && event.payload?.id) {
      setMessages((prev) => {
        const next = upsertMessageList(prev, event.payload);
        persistCachedMessages(next);
        return next;
      });
    } else if (event.type === 'edit' && event.payload?.messageId) {
      const { messageId, content, updatedAt } = event.payload;
      setMessages((prev) => {
        const next = prev.map((item) =>
          item.id === messageId ? { ...item, content, updatedAt } : item,
        );
        persistCachedMessages(next);
        return next;
      });
    } else if (event.type === 'reaction' && event.payload?.messageId) {
      const { messageId, emoji, userId: actorId, add } = event.payload;
      setMessages((prev) => {
        const next = applyReactionMutation(prev, messageId, emoji, actorId, add);
        if (next !== prev) persistCachedMessages(next);
        return next;
      });
    } else if (event.type === 'delete' && event.payload?.messageId) {
      const { messageId } = event.payload;
      setMessages((prev) => {
        const next = prev.filter((item) => item.id !== messageId);
        if (next.length !== prev.length) persistCachedMessages(next);
        return next;
      });
    }
  }, []);

  const relayEvent = useCallback((event: ChatRealtimeEvent) => {
    // 1. Instant 0ms delivery to other tabs on the same browser
    try {
      browserBcRef.current?.postMessage(event);
    } catch {
      // Ignore BroadcastChannel errors in restricted contexts.
    }

    // 2. Instant cross-device delivery over Supabase Realtime Broadcast
    const ch = broadcastChannelRef.current;
    if (ch) {
      void ch
        .send({
          type: 'broadcast',
          event: 'lounge_event',
          payload: event,
        })
        .catch(() => {});
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const result = await fetchLoungeChatHistory(MAX_CACHED_MESSAGES);
      if (!mountedRef.current) return;
      setIsDbBacked(result.schemaReady);
      isDbBackedRef.current = result.schemaReady;
      if (result.schemaReady) {
        setMessages(result.messages);
        persistCachedMessages(result.messages);
      }
    } catch {
      // Keep existing messages visible if temporarily offline.
    } finally {
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  }, []);

  // Load canonical history on mount, reconnect, and tab foreground.
  useEffect(() => {
    mountedRef.current = true;
    void refreshHistory();

    function handleOnline() {
      void refreshHistory();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        void refreshHistory();
      }
    }

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshHistory]);

  // Same-browser cross-tab BroadcastChannel + storage fallback.
  useEffect(() => {
    let bc: BroadcastChannel | null = null;
    if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
      try {
        bc = new BroadcastChannel(BROWSER_BC_NAME);
        bc.onmessage = (msgEvent: MessageEvent<ChatRealtimeEvent>) => {
          if (msgEvent.data) {
            applyRealtimeEvent(msgEvent.data);
          }
        };
        browserBcRef.current = bc;
      } catch {
        bc = null;
      }
    }

    function handleStorage(event: StorageEvent) {
      if (event.key === CHAT_FALLBACK_STORAGE_KEY && !isDbBackedRef.current) {
        setMessages(loadCachedMessages());
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
      if (bc) {
        bc.close();
      }
      if (browserBcRef.current === bc) {
        browserBcRef.current = null;
      }
    };
  }, [applyRealtimeEvent]);

  // 1. Dedicated Postgres Changes channel (unique topic per mount -> zero teardown races).
  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let currentChannel: ReturnType<typeof supabase.channel> | null = null;

    function cleanupChannel() {
      const ch = currentChannel;
      currentChannel = null;
      if (ch) {
        void Promise.resolve(supabase.removeChannel(ch)).catch(() => {});
      }
    }

    function connectDbChannel() {
      if (!active) return;
      cleanupChannel();

      const uniqueId = ++instanceCounter;
      const channel = supabase
        .channel(`team-spirit-lounge-db-${uniqueId}`)
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'lounge_chat_messages' },
          (payload) => {
            if (!active || !payload.new) return;
            const incoming = loungeMessageFromDbRow(payload.new as DbLoungeChatMessageRow, {});
            setIsDbBacked(true);
            isDbBackedRef.current = true;
            setMessages((prev) => {
              const next = upsertMessageList(prev, incoming);
              persistCachedMessages(next);
              return next;
            });
          },
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'lounge_chat_messages' },
          (payload) => {
            if (!active || !payload.new) return;
            const incoming = loungeMessageFromDbRow(payload.new as DbLoungeChatMessageRow, {});
            setMessages((prev) => {
              const next = upsertMessageList(prev, incoming);
              persistCachedMessages(next);
              return next;
            });
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'lounge_chat_messages' },
          (payload) => {
            if (!active) return;
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (!oldId) return;
            setMessages((prev) => {
              const next = prev.filter((item) => item.id !== oldId);
              if (next.length !== prev.length) persistCachedMessages(next);
              return next;
            });
          },
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'lounge_chat_reactions' },
          (payload) => {
            if (!active || !payload.new) return;
            const row = payload.new as DbLoungeChatReactionRow;
            if (!row.message_id || !row.user_id || !row.emoji) return;
            setMessages((prev) => {
              const next = applyReactionMutation(prev, row.message_id, row.emoji, row.user_id, true);
              if (next !== prev) persistCachedMessages(next);
              return next;
            });
          },
        )
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'lounge_chat_reactions' },
          (payload) => {
            if (!active || !payload.old) return;
            const row = payload.old as Partial<DbLoungeChatReactionRow>;
            if (row.message_id && row.user_id && row.emoji) {
              setMessages((prev) => {
                const next = applyReactionMutation(
                  prev,
                  row.message_id!,
                  row.emoji!,
                  row.user_id!,
                  false,
                );
                if (next !== prev) persistCachedMessages(next);
                return next;
              });
            } else {
              // If replica identity wasn't full, refresh history cleanly to stay consistent.
              void refreshHistory();
            }
          },
        )
        .subscribe((status) => {
          if (!active) return;
          if (status === 'SUBSCRIBED') {
            reconnectAttempt = 0;
            setIsDbRealtimeLive(true);
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setIsDbRealtimeLive(false);
            if (reconnectTimer === null && active) {
              const delayMs = Math.min(2000 * Math.pow(2, reconnectAttempt), 15000);
              reconnectAttempt += 1;
              reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                connectDbChannel();
              }, delayMs);
            }
          }
        });

      currentChannel = channel;
    }

    connectDbChannel();

    return () => {
      active = false;
      setIsDbRealtimeLive(false);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      cleanupChannel();
    };
  }, [refreshHistory]);

  // 2. Shared Realtime Broadcast & Presence channel (serialized teardown eliminates StrictMode/nav races).
  useEffect(() => {
    let active = true;
    let reconnectTimer: number | null = null;
    let reconnectAttempt = 0;
    let ownedChannel: ReturnType<typeof supabase.channel> | null = null;

    async function connectBroadcastChannel() {
      // Wait for any previous unmount's `removeChannel` to finish teardown completely
      // before creating a new channel on the shared topic name.
      await pendingBroadcastTeardown;
      if (!active) return;

      const presenceKey = `tab-${++instanceCounter}-${Math.random().toString(36).slice(2, 7)}`;
      const channel = supabase.channel(BROADCAST_CHANNEL_NAME, {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: presenceKey },
        },
      });
      ownedChannel = channel;
      broadcastChannelRef.current = channel;

      function syncPresenceList() {
        if (!active) return;
        const state = channel.presenceState<LoungeOnlineMember>();
        const seen = new Map<string, LoungeOnlineMember>();
        for (const entries of Object.values(state)) {
          for (const entry of entries) {
            if (!entry || typeof entry.name !== 'string' || typeof entry.key !== 'string') continue;
            seen.set(entry.key, {
              key: entry.key,
              name: entry.name,
              role: entry.role === 'admin' ? 'admin' : 'member',
              vibe: LOUNGE_VIBES.includes(entry.vibe) ? entry.vibe : 'Chilling',
              room: isValidLoungeRoom(entry.room) ? entry.room : 'general',
            });
          }
        }
        setOnlineMembers(Array.from(seen.values()));
      }

      channel
        .on('presence', { event: 'sync' }, syncPresenceList)
        .on('broadcast', { event: 'lounge_event' }, ({ payload }) => {
          if (!active || !payload) return;
          applyRealtimeEvent(payload as ChatRealtimeEvent);
        })
        .subscribe((status) => {
          if (!active) return;
          if (status === 'SUBSCRIBED') {
            reconnectAttempt = 0;
            isBroadcastReadyRef.current = true;
            setIsBroadcastLive(true);
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            isBroadcastReadyRef.current = false;
            setIsBroadcastLive(false);
            if (reconnectTimer === null && active) {
              const delayMs = Math.min(2000 * Math.pow(2, reconnectAttempt), 15000);
              reconnectAttempt += 1;
              const stale = ownedChannel;
              ownedChannel = null;
              if (broadcastChannelRef.current === stale) {
                broadcastChannelRef.current = null;
              }
              if (stale) {
                pendingBroadcastTeardown = Promise.resolve(supabase.removeChannel(stale))
                  .then(() => undefined)
                  .catch(() => undefined);
              }
              reconnectTimer = window.setTimeout(() => {
                reconnectTimer = null;
                void connectBroadcastChannel();
              }, delayMs);
            }
          }
        });
    }

    void connectBroadcastChannel();

    return () => {
      active = false;
      isBroadcastReadyRef.current = false;
      setIsBroadcastLive(false);
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      const ch = ownedChannel;
      ownedChannel = null;
      if (broadcastChannelRef.current === ch) {
        broadcastChannelRef.current = null;
      }
      if (ch) {
        pendingBroadcastTeardown = Promise.resolve(supabase.removeChannel(ch))
          .then(() => undefined)
          .catch(() => undefined);
      }
    };
  }, [applyRealtimeEvent]);

  // Track presence strictly for authenticated users (read-only guests view presence without broadcasting).
  useEffect(() => {
    const channel = broadcastChannelRef.current;
    if (!channel || !isBroadcastLive) return;

    if (!userId) {
      void channel.untrack().catch(() => {});
      return;
    }

    void channel
      .track({
        key: userId,
        name: authorName,
        role: isAdmin ? 'admin' : 'member',
        vibe,
        room: activeRoom,
      } satisfies LoungeOnlineMember)
      .catch(() => {});
  }, [activeRoom, authorName, isAdmin, isBroadcastLive, userId, vibe]);

  const sendMessage = useCallback(
    async (content: string, replyTo?: LoungeReplyRef): Promise<LoungeChatMessage | null> => {
      // Strictly require an authenticated user to post messages.
      if (!userId) {
        onErrorRef.current?.('Sign in with your club account to send messages in Chill Chat.');
        return null;
      }

      const trimmed = content.trim();
      if (!trimmed || trimmed.length > 600) return null;

      const canonicalId = generateUuid();
      const optimistic: LoungeChatMessage = {
        id: canonicalId,
        room: activeRoom,
        authorUserId: userId,
        authorName,
        authorRole: isAdmin ? 'admin' : 'member',
        content: trimmed,
        replyTo,
        reactions: {},
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => {
        const next = upsertMessageList(prev, optimistic);
        persistCachedMessages(next);
        return next;
      });
      relayEvent({ type: 'message', payload: optimistic });

      try {
        const saved = await insertLoungeChatMessage({
          id: canonicalId,
          room: activeRoom,
          content: trimmed,
          replyTo,
        });
        if (mountedRef.current) {
          setIsDbBacked(true);
          isDbBackedRef.current = true;
          setMessages((prev) => {
            const next = upsertMessageList(prev, saved);
            persistCachedMessages(next);
            return next;
          });
        }
        return saved;
      } catch (err) {
        if (err instanceof Error && err.message === 'LOUNGE_SCHEMA_MISSING') {
          if (mountedRef.current) {
            setIsDbBacked(false);
            isDbBackedRef.current = false;
          }
          // Broadcast already delivered live; keep optimistic message gracefully until SQL is run.
          return optimistic;
        }

        // Roll back optimistic bubble on genuine auth/RLS/network rejection.
        if (mountedRef.current) {
          setMessages((prev) => {
            const next = prev.filter((item) => item.id !== canonicalId);
            persistCachedMessages(next);
            return next;
          });
        }
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Unable to send message right now.',
        );
        return null;
      }
    },
    [activeRoom, authorName, isAdmin, relayEvent, userId],
  );

  const editMessage = useCallback(
    async (messageId: string, content: string): Promise<LoungeChatMessage | null> => {
      if (!userId) {
        onErrorRef.current?.('Sign in with your club account to edit messages.');
        return null;
      }

      const trimmed = content.trim();
      if (!trimmed || trimmed.length > 600) return null;

      const targetMsg = messagesRef.current.find((item) => item.id === messageId);
      if (!targetMsg || targetMsg.authorUserId !== userId) return null;
      if (targetMsg.content === trimmed) return targetMsg;

      const editedAt = new Date().toISOString();
      const optimistic: LoungeChatMessage = {
        ...targetMsg,
        content: trimmed,
        updatedAt: editedAt,
      };

      setMessages((prev) => {
        const next = prev.map((item) => (item.id === messageId ? optimistic : item));
        persistCachedMessages(next);
        return next;
      });
      relayEvent({
        type: 'edit',
        payload: { messageId, content: trimmed, updatedAt: editedAt },
      });

      try {
        const saved = await updateLoungeChatMessage(messageId, trimmed);
        if (mountedRef.current) {
          setMessages((prev) => {
            const next = upsertMessageList(prev, saved);
            persistCachedMessages(next);
            return next;
          });
        }
        return saved;
      } catch (err) {
        if (err instanceof Error && err.message === 'LOUNGE_SCHEMA_MISSING') {
          if (mountedRef.current) {
            setIsDbBacked(false);
            isDbBackedRef.current = false;
          }
          return optimistic;
        }

        // Roll back edit on genuine permission or network error.
        if (mountedRef.current) {
          setMessages((prev) => {
            const next = prev.map((item) => (item.id === messageId ? targetMsg : item));
            persistCachedMessages(next);
            return next;
          });
        }
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Unable to save message edit right now.',
        );
        return null;
      }
    },
    [relayEvent, userId],
  );

  const toggleReaction = useCallback(
    async (messageId: string, emoji: string): Promise<void> => {
      // Strictly require an authenticated user to add or remove reactions.
      if (!userId) {
        onErrorRef.current?.('Sign in with your club account to react to messages.');
        return;
      }

      const cleanedEmoji = emoji.trim();
      if (!cleanedEmoji || cleanedEmoji.length > 32) return;

      const targetMsg = messagesRef.current.find((item) => item.id === messageId);
      if (!targetMsg) return;

      const alreadyReacted = (targetMsg.reactions[cleanedEmoji] ?? []).includes(userId);
      const shouldAdd = !alreadyReacted;

      setMessages((prev) => {
        const next = applyReactionMutation(prev, messageId, cleanedEmoji, userId, shouldAdd);
        persistCachedMessages(next);
        return next;
      });
      relayEvent({
        type: 'reaction',
        payload: { messageId, emoji: cleanedEmoji, userId, add: shouldAdd },
      });

      try {
        await setLoungeChatReaction({
          messageId,
          userId,
          emoji: cleanedEmoji,
          add: shouldAdd,
        });
      } catch (err) {
        if (err instanceof Error && err.message === 'LOUNGE_SCHEMA_MISSING') {
          if (mountedRef.current) {
            setIsDbBacked(false);
            isDbBackedRef.current = false;
          }
          return;
        }
        // Revert optimistic reaction toggle on error.
        if (mountedRef.current) {
          setMessages((prev) => {
            const next = applyReactionMutation(
              prev,
              messageId,
              cleanedEmoji,
              userId,
              !shouldAdd,
            );
            persistCachedMessages(next);
            return next;
          });
        }
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Unable to update emoji reaction.',
        );
      }
    },
    [relayEvent, userId],
  );

  const deleteMessage = useCallback(
    async (messageId: string): Promise<void> => {
      if (!userId) return;
      const targetMsg = messagesRef.current.find((item) => item.id === messageId);
      if (!targetMsg) return;
      if (!isAdmin && targetMsg.authorUserId !== userId) return;

      setMessages((prev) => {
        const next = prev.filter((item) => item.id !== messageId);
        persistCachedMessages(next);
        return next;
      });
      relayEvent({ type: 'delete', payload: { messageId } });

      try {
        await deleteLoungeChatMessage(messageId);
      } catch (err) {
        if (err instanceof Error && err.message === 'LOUNGE_SCHEMA_MISSING') {
          if (mountedRef.current) {
            setIsDbBacked(false);
            isDbBackedRef.current = false;
          }
          return;
        }
        if (mountedRef.current) {
          setMessages((prev) => {
            const next = upsertMessageList(prev, targetMsg);
            persistCachedMessages(next);
            return next;
          });
        }
        onErrorRef.current?.(
          err instanceof Error ? err.message : 'Unable to delete chat message.',
        );
      }
    },
    [isAdmin, relayEvent, userId],
  );

  return {
    messages,
    onlineMembers,
    isLoading,
    isLiveConnected,
    isDbBacked,
    vibe,
    setVibe,
    refreshHistory,
    sendMessage,
    editMessage,
    toggleReaction,
    deleteMessage,
  };
}
