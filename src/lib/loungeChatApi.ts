import { toSupabaseSyncError } from './attendanceSync';
import { supabase } from './supabase';

export type LoungeRoomId = 'general' | 'build-talk' | 'off-topic';

export interface LoungeReplyRef {
  id: string;
  authorName: string;
  snippet: string;
}

export interface LoungeChatMessage {
  id: string;
  room: LoungeRoomId;
  authorUserId: string;
  authorName: string;
  authorRole: 'admin' | 'member';
  content: string;
  replyTo?: LoungeReplyRef;
  reactions: Record<string, string[]>;
  createdAt: string;
  updatedAt?: string;
}

export interface DbLoungeChatMessageRow {
  id: string;
  room: string;
  author_user_id: string;
  author_name: string;
  author_role: string;
  content: string;
  reply_to_id: string | null;
  reply_to_author: string | null;
  reply_to_snippet: string | null;
  created_at: string;
  updated_at?: string | null;
}

export interface DbLoungeChatReactionRow {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: string;
}

export interface FetchLoungeChatResult {
  messages: LoungeChatMessage[];
  schemaReady: boolean;
}

export function isValidLoungeRoom(room: unknown): room is LoungeRoomId {
  return room === 'general' || room === 'build-talk' || room === 'off-topic';
}

export function loungeMessageFromDbRow(
  row: DbLoungeChatMessageRow,
  reactions: Record<string, string[]> = {},
): LoungeChatMessage {
  return {
    id: row.id,
    room: isValidLoungeRoom(row.room) ? row.room : 'general',
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorRole: row.author_role === 'admin' ? 'admin' : 'member',
    content: row.content,
    replyTo:
      row.reply_to_id && row.reply_to_author && row.reply_to_snippet
        ? {
            id: row.reply_to_id,
            authorName: row.reply_to_author,
            snippet: row.reply_to_snippet,
          }
        : undefined,
    reactions,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  };
}

/**
 * Fetches recent Chill Chat messages and their emoji reactions from Supabase.
 * Publicly readable by both unauthenticated visitors and signed-in members.
 * Gracefully signals `schemaReady: false` if the additive SQL tables have not been applied yet.
 */
export async function fetchLoungeChatHistory(limit = 200): Promise<FetchLoungeChatResult> {
  const { data: msgData, error: msgError, status: msgStatus } = await supabase
    .from('lounge_chat_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (msgError) {
    const syncErr = toSupabaseSyncError(msgError, 'Failed to load Chill Chat.', msgStatus);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      return { messages: [], schemaReady: false };
    }
    throw new Error(syncErr.message || 'Failed to load Chill Chat messages.');
  }

  const rows = ((msgData ?? []) as DbLoungeChatMessageRow[]).reverse();
  const messageIds = rows.map((row) => row.id);

  const reactionsByMessageId = new Map<string, Record<string, string[]>>();
  if (messageIds.length > 0) {
    const { data: reactData, error: reactError, status: reactStatus } = await supabase
      .from('lounge_chat_reactions')
      .select('*')
      .in('message_id', messageIds);

    if (reactError) {
      const syncErr = toSupabaseSyncError(
        reactError,
        'Failed to load Chill Chat reactions.',
        reactStatus,
      );
      if (syncErr.isMissingTable || syncErr.isMissingColumn) {
        return {
          messages: rows.map((row) => loungeMessageFromDbRow(row, {})),
          schemaReady: false,
        };
      }
      throw new Error(syncErr.message || 'Failed to load Chill Chat reactions.');
    }

    for (const row of (reactData ?? []) as DbLoungeChatReactionRow[]) {
      let emojiMap = reactionsByMessageId.get(row.message_id);
      if (!emojiMap) {
        emojiMap = {};
        reactionsByMessageId.set(row.message_id, emojiMap);
      }
      const list = emojiMap[row.emoji] ?? [];
      if (!list.includes(row.user_id)) {
        list.push(row.user_id);
      }
      emojiMap[row.emoji] = list;
    }
  }

  return {
    messages: rows.map((row) =>
      loungeMessageFromDbRow(row, reactionsByMessageId.get(row.id) ?? {}),
    ),
    schemaReady: true,
  };
}

/** Inserts a new Chill Chat message (strictly authenticated; server stamps verified author identity). */
export async function insertLoungeChatMessage(input: {
  id?: string;
  room: LoungeRoomId;
  content: string;
  replyTo?: LoungeReplyRef;
}): Promise<LoungeChatMessage> {
  const payload: Record<string, unknown> = {
    room: input.room,
    author_name: 'Member',
    content: input.content.trim(),
    reply_to_id: input.replyTo?.id ?? null,
    reply_to_author: input.replyTo?.authorName ?? null,
    reply_to_snippet: input.replyTo?.snippet.slice(0, 120) ?? null,
  };
  if (input.id) {
    payload.id = input.id;
  }

  const { data, error, status } = await supabase
    .from('lounge_chat_messages')
    .insert(payload)
    .select('*')
    .single();

  if (error || !data) {
    const syncErr = toSupabaseSyncError(error, 'Failed to send message.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      const missingErr = new Error('LOUNGE_SCHEMA_MISSING');
      throw missingErr;
    }
    throw new Error(syncErr.message || 'Unable to send chat message.');
  }

  return loungeMessageFromDbRow(data as DbLoungeChatMessageRow, {});
}

/** Updates an existing Chill Chat message's text (original author only via RLS). */
export async function updateLoungeChatMessage(
  messageId: string,
  content: string,
): Promise<LoungeChatMessage> {
  const { data, error, status } = await supabase
    .from('lounge_chat_messages')
    .update({ content: content.trim() })
    .eq('id', messageId)
    .select('*')
    .single();

  if (error || !data) {
    const syncErr = toSupabaseSyncError(error, 'Failed to edit message.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      throw new Error('LOUNGE_SCHEMA_MISSING');
    }
    throw new Error(syncErr.message || 'Unable to edit chat message.');
  }

  return loungeMessageFromDbRow(data as DbLoungeChatMessageRow, {});
}

/** Deletes a Chill Chat message (author or admin only via RLS). */
export async function deleteLoungeChatMessage(messageId: string): Promise<void> {
  const { error, status } = await supabase
    .from('lounge_chat_messages')
    .delete()
    .eq('id', messageId);

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to delete message.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      throw new Error('LOUNGE_SCHEMA_MISSING');
    }
    throw new Error(syncErr.message || 'Unable to delete chat message.');
  }
}

/** Adds or removes an emoji reaction for the currently authenticated user. */
export async function setLoungeChatReaction(params: {
  messageId: string;
  userId: string;
  emoji: string;
  add: boolean;
}): Promise<void> {
  const { messageId, userId, emoji, add } = params;
  if (add) {
    const { error, status } = await supabase.from('lounge_chat_reactions').upsert(
      {
        message_id: messageId,
        user_id: userId,
        emoji,
      },
      { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true },
    );

    if (error) {
      const syncErr = toSupabaseSyncError(error, 'Failed to add reaction.', status);
      if (syncErr.isMissingTable || syncErr.isMissingColumn) {
        throw new Error('LOUNGE_SCHEMA_MISSING');
      }
      throw new Error(syncErr.message || 'Unable to add reaction.');
    }
    return;
  }

  const { error, status } = await supabase
    .from('lounge_chat_reactions')
    .delete()
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji);

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to remove reaction.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      throw new Error('LOUNGE_SCHEMA_MISSING');
    }
    throw new Error(syncErr.message || 'Unable to remove reaction.');
  }
}
