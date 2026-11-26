import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import { generateId } from '../utils/attendance';

export type LoungeRoomId = 'general' | 'build-talk' | 'off-topic';

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

export const LOUNGE_QUICK_REACTIONS = ['🔥', '✨', '😂', '👍', '🎉'] as const;

export const LOUNGE_VIBES = ['Chilling', 'Building', 'Studying', 'Listening to music'] as const;
export type LoungeVibe = (typeof LOUNGE_VIBES)[number];

export interface LoungeReplyRef {
  id: string;
  authorName: string;
  snippet: string;
}

export interface LoungeChatMessage {
  id: string;
  room: LoungeRoomId;
  senderClientId: string;
  authorUserId?: string;
  authorName: string;
  authorRole: 'admin' | 'member' | 'guest';
  content: string;
  replyTo?: LoungeReplyRef;
  reactions: Record<string, string[]>;
  createdAt: string;
}

export interface LoungeOnlineMember {
  key: string;
  name: string;
  role: 'admin' | 'member' | 'guest';
  vibe: LoungeVibe;
  room: LoungeRoomId;
}

const CHAT_STORAGE_KEY = 'team-spirit:lounge-chat:v1';
const CLIENT_ID_STORAGE_KEY = 'team-spirit:lounge-client-id:v1';
const NICKNAME_STORAGE_KEY = 'team-spirit:lounge-nickname:v1';
const MAX_STORED_MESSAGES = 180;
const REALTIME_CHANNEL_NAME = 'team-spirit-student-lounge-v1';

type ChatBroadcastEvent =
  | { type: 'message'; payload: LoungeChatMessage }
  | { type: 'reaction'; payload: { messageId: string; emoji: string; actorKey: string } }
  | { type: 'delete'; payload: { messageId: string } };

function getOrCreateClientId(): string {
  if (typeof window === 'undefined') return 'client-ssr';
  try {
    const existing = window.localStorage.getItem(CLIENT_ID_STORAGE_KEY);
    if (existing && existing.trim().length > 0) return existing;
    const created = generateId('lounge');
    window.localStorage.setItem(CLIENT_ID_STORAGE_KEY, created);
    return created;
  } catch {
    return generateId('lounge');
  }
}

function loadSavedNickname(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(NICKNAME_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveNickname(value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = value.trim();
    if (trimmed) {
      window.localStorage.setItem(NICKNAME_STORAGE_KEY, trimmed);
    } else {
      window.localStorage.removeItem(NICKNAME_STORAGE_KEY);
    }
  } catch {
    // Ignore storage errors in restricted contexts.
  }
}

function isValidRoom(room: unknown): room is LoungeRoomId {
  return room === 'general' || room === 'build-talk' || room === 'off-topic';
}

function loadStoredMessages(): LoungeChatMessage[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const valid: LoungeChatMessage[] = [];
    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const candidate = item as Partial<LoungeChatMessage>;
      if (
        typeof candidate.id !== 'string' ||
        !isValidRoom(candidate.room) ||
        typeof candidate.authorName !== 'string' ||
        typeof candidate.content !== 'string' ||
        typeof candidate.createdAt !== 'string'
      ) {
        continue;
      }
      valid.push({
        id: candidate.id,
        room: candidate.room,
        senderClientId:
          typeof candidate.senderClientId === 'string' ? candidate.senderClientId : 'unknown',
        authorUserId:
          typeof candidate.authorUserId === 'string' ? candidate.authorUserId : undefined,
        authorName: candidate.authorName,
        authorRole:
          candidate.authorRole === 'admin' || candidate.authorRole === 'member'
            ? candidate.authorRole
            : 'guest',
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
      });
    }
    return valid.slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

function persistMessages(messages: LoungeChatMessage[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CHAT_STORAGE_KEY,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // Ignore quota/storage errors safely.
  }
}

function applyReactionToggle(
  messages: LoungeChatMessage[],
  messageId: string,
  emoji: string,
  actorKey: string,
): LoungeChatMessage[] {
  return messages.map((msg) => {
    if (msg.id !== messageId) return msg;
    const currentActors = msg.reactions[emoji] ?? [];
    const hasReacted = currentActors.includes(actorKey);
    const nextActors = hasReacted
      ? currentActors.filter((id) => id !== actorKey)
      : [...currentActors, actorKey];
    const nextReactions = { ...msg.reactions };
    if (nextActors.length === 0) {
      delete nextReactions[emoji];
    } else {
      nextReactions[emoji] = nextActors;
    }
    return {
      ...msg,
      reactions: nextReactions,
    };
  });
}

export interface UseLoungeChatOptions {
  userId: string | null;
  authorName: string;
  authorRole: 'admin' | 'member' | 'guest';
  activeRoom: LoungeRoomId;
}

export interface UseLoungeChatResult {
  messages: LoungeChatMessage[];
  onlineMembers: LoungeOnlineMember[];
  isLiveConnected: boolean;
  actorKey: string;
  guestNickname: string;
  vibe: LoungeVibe;
  setGuestNickname: (nickname: string) => void;
  setVibe: (vibe: LoungeVibe) => void;
  sendMessage: (content: string, replyTo?: LoungeReplyRef) => LoungeChatMessage | null;
  toggleReaction: (messageId: string, emoji: string) => void;
  deleteMessage: (messageId: string) => void;
}

/**
 * Real-time student hangout chat powered by Supabase Realtime Broadcast & Presence
 * plus local browser persistence — requires zero database schema modifications.
 */
export function useLoungeChat({
  userId,
  authorName,
  authorRole,
  activeRoom,
}: UseLoungeChatOptions): UseLoungeChatResult {
  const clientIdRef = useRef<string>(getOrCreateClientId());
  const actorKey = userId ?? clientIdRef.current;

  const [messages, setMessages] = useState<LoungeChatMessage[]>(() => loadStoredMessages());
  const [guestNickname, setGuestNicknameState] = useState<string>(() => loadSavedNickname());
  const [vibe, setVibe] = useState<LoungeVibe>('Chilling');
  const [onlineMembers, setOnlineMembers] = useState<LoungeOnlineMember[]>([]);
  const [isLiveConnected, setIsLiveConnected] = useState(false);

  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const resolvedDisplayName = useMemo(() => {
    if (userId) return authorName;
    const custom = guestNickname.trim();
    return custom || authorName || 'Club Member';
  }, [authorName, guestNickname, userId]);

  const setGuestNickname = useCallback((nickname: string) => {
    const cleaned = nickname.slice(0, 32);
    setGuestNicknameState(cleaned);
    saveNickname(cleaned);
  }, []);

  // Sync messages across tabs on the same browser via storage events.
  useEffect(() => {
    function handleStorage(event: StorageEvent) {
      if (event.key === CHAT_STORAGE_KEY) {
        setMessages(loadStoredMessages());
      } else if (event.key === NICKNAME_STORAGE_KEY) {
        setGuestNicknameState(loadSavedNickname());
      }
    }

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // Connect to Supabase Realtime Broadcast & Presence for live cross-device hangout chat.
  useEffect(() => {
    let active = true;
    const presenceKey = `${actorKey}:${clientIdRef.current.slice(-6)}`;

    const channel = supabase.channel(REALTIME_CHANNEL_NAME, {
      config: {
        broadcast: { self: false },
        presence: { key: presenceKey },
      },
    });
    channelRef.current = channel;

    function syncPresenceList() {
      if (!active) return;
      const state = channel.presenceState<LoungeOnlineMember>();
      const seen = new Map<string, LoungeOnlineMember>();
      for (const entries of Object.values(state)) {
        for (const entry of entries) {
          if (!entry || typeof entry.name !== 'string') continue;
          const dedupeKey = entry.key || entry.name;
          seen.set(dedupeKey, {
            key: dedupeKey,
            name: entry.name,
            role:
              entry.role === 'admin' || entry.role === 'member' ? entry.role : 'guest',
            vibe: LOUNGE_VIBES.includes(entry.vibe) ? entry.vibe : 'Chilling',
            room: isValidRoom(entry.room) ? entry.room : 'general',
          });
        }
      }
      setOnlineMembers(Array.from(seen.values()));
    }

    channel
      .on('presence', { event: 'sync' }, syncPresenceList)
      .on('broadcast', { event: 'lounge_event' }, ({ payload }) => {
        if (!active || !payload) return;
        const event = payload as ChatBroadcastEvent;
        if (event.type === 'message' && event.payload?.id) {
          setMessages((prev) => {
            if (prev.some((item) => item.id === event.payload.id)) return prev;
            const next = [...prev, event.payload].slice(-MAX_STORED_MESSAGES);
            persistMessages(next);
            return next;
          });
        } else if (event.type === 'reaction' && event.payload?.messageId) {
          const { messageId, emoji, actorKey: remoteActorKey } = event.payload;
          setMessages((prev) => {
            const next = applyReactionToggle(prev, messageId, emoji, remoteActorKey);
            persistMessages(next);
            return next;
          });
        } else if (event.type === 'delete' && event.payload?.messageId) {
          const { messageId } = event.payload;
          setMessages((prev) => {
            const next = prev.filter((item) => item.id !== messageId);
            persistMessages(next);
            return next;
          });
        }
      })
      .subscribe((status) => {
        if (!active) return;
        const connected = status === 'SUBSCRIBED';
        setIsLiveConnected(connected);
        if (connected) {
          void channel.track({
            key: actorKey,
            name: resolvedDisplayName,
            role: authorRole,
            vibe,
            room: activeRoom,
          } satisfies LoungeOnlineMember);
        }
      });

    return () => {
      active = false;
      channelRef.current = null;
      void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
    };
    // Re-subscribe only when identity key changes; presence updates are tracked below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actorKey]);

  // Keep presence metadata updated whenever room, nickname, role, or vibe changes.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !isLiveConnected) return;
    void channel.track({
      key: actorKey,
      name: resolvedDisplayName,
      role: authorRole,
      vibe,
      room: activeRoom,
    } satisfies LoungeOnlineMember);
  }, [activeRoom, actorKey, authorRole, isLiveConnected, resolvedDisplayName, vibe]);

  const sendMessage = useCallback(
    (content: string, replyTo?: LoungeReplyRef): LoungeChatMessage | null => {
      const trimmed = content.trim();
      if (!trimmed || trimmed.length > 600) return null;

      const created: LoungeChatMessage = {
        id: generateId('chat'),
        room: activeRoom,
        senderClientId: clientIdRef.current,
        authorUserId: userId ?? undefined,
        authorName: resolvedDisplayName,
        authorRole,
        content: trimmed,
        replyTo,
        reactions: {},
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => {
        const next = [...prev, created].slice(-MAX_STORED_MESSAGES);
        persistMessages(next);
        return next;
      });

      if (channelRef.current && isLiveConnected) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'lounge_event',
          payload: { type: 'message', payload: created } satisfies ChatBroadcastEvent,
        });
      }

      return created;
    },
    [activeRoom, authorRole, isLiveConnected, resolvedDisplayName, userId],
  );

  const toggleReaction = useCallback(
    (messageId: string, emoji: string) => {
      setMessages((prev) => {
        const next = applyReactionToggle(prev, messageId, emoji, actorKey);
        persistMessages(next);
        return next;
      });

      if (channelRef.current && isLiveConnected) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'lounge_event',
          payload: {
            type: 'reaction',
            payload: { messageId, emoji, actorKey },
          } satisfies ChatBroadcastEvent,
        });
      }
    },
    [actorKey, isLiveConnected],
  );

  const deleteMessage = useCallback(
    (messageId: string) => {
      setMessages((prev) => {
        const next = prev.filter((item) => item.id !== messageId);
        persistMessages(next);
        return next;
      });

      if (channelRef.current && isLiveConnected) {
        void channelRef.current.send({
          type: 'broadcast',
          event: 'lounge_event',
          payload: { type: 'delete', payload: { messageId } } satisfies ChatBroadcastEvent,
        });
      }
    },
    [isLiveConnected],
  );

  return {
    messages,
    onlineMembers,
    isLiveConnected,
    actorKey,
    guestNickname,
    vibe,
    setGuestNickname,
    setVibe,
    sendMessage,
    toggleReaction,
    deleteMessage,
  };
}
