import {
  DEFAULT_CONTENT_DELETION_MODE,
  normalizeContentDeletionMode,
  type ClubPost,
  type ClubPostCategory,
  type ClubPostComment,
  type ClubPostCommentInput,
  type ClubPostInput,
  type ClubSettings,
  type ContentDeletionMode,
  type MemberVisibilityPermissions,
} from '../types/projectIdeas';
import { toSupabaseSyncError } from './attendanceSync';
import { supabase } from './supabase';

export interface DbClubPostRow {
  id: string;
  author_user_id: string | null;
  author_name: string;
  category: string;
  title: string;
  content: string;
  event_date: string | null;
  resource_label: string | null;
  resource_url: string | null;
  is_pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface DbClubPostCommentRow {
  id: string;
  post_id: string;
  parent_comment_id: string | null;
  author_user_id: string;
  author_name: string;
  author_role: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface DbClubSettingsRow {
  id: string;
  member_can_view_roster?: boolean | null;
  member_can_view_attendance_rates?: boolean | null;
  member_can_view_calendar_details?: boolean | null;
  shared_idea_visibility?: boolean | null;
  member_can_comment_on_posts?: boolean | null;
  content_deletion_mode?: string | null;
  updated_by: string | null;
  updated_at: string;
}

export const DEFAULT_MEMBER_VISIBILITY_PERMISSIONS: MemberVisibilityPermissions = {
  memberCanViewRoster: false,
  memberCanViewAttendanceRates: false,
  memberCanViewCalendarDetails: false,
  sharedIdeaVisibility: false,
  memberCanCommentOnPosts: false,
};

const VALID_POST_CATEGORIES = new Set<ClubPostCategory>([
  'announcement',
  'meeting_reminder',
  'resource_update',
  'general',
]);

const MISSING_POSTS_SCHEMA_MESSAGE =
  'The Supabase "club_posts", "club_post_comments", or "club_settings" table/columns were not found. Run the updated supabase/schema.sql in your Supabase SQL Editor, then click Retry.';

const POSTS_PERMISSION_MESSAGE =
  'Supabase denied access to "club_posts". Run the updated GRANT & RLS script in supabase/schema.sql in your Supabase SQL Editor.';

function cleanOptionalText(value: string | null | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function normalizePostCategory(value: string | null | undefined): ClubPostCategory {
  if (value && VALID_POST_CATEGORIES.has(value as ClubPostCategory)) {
    return value as ClubPostCategory;
  }
  return 'announcement';
}

export function normalizeHttpUrl(value: string | null | undefined): string | undefined {
  const cleaned = cleanOptionalText(value);
  if (!cleaned) return undefined;
  if (!/^https?:\/\//i.test(cleaned)) {
    throw new Error('Resource URL must start with https:// or http://.');
  }
  return cleaned;
}

export function clubPostFromDbRow(row: DbClubPostRow): ClubPost {
  return {
    id: row.id,
    authorUserId: row.author_user_id ?? undefined,
    authorName: row.author_name,
    category: normalizePostCategory(row.category),
    title: row.title,
    content: row.content,
    eventDate: cleanOptionalText(row.event_date),
    resourceLabel: cleanOptionalText(row.resource_label),
    resourceUrl: cleanOptionalText(row.resource_url),
    isPinned: Boolean(row.is_pinned),
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function clubPostCommentFromDbRow(row: DbClubPostCommentRow): ClubPostComment {
  return {
    id: row.id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id ?? undefined,
    authorUserId: row.author_user_id,
    authorName: row.author_name,
    authorRole: row.author_role === 'admin' ? 'admin' : 'member',
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export function clubSettingsFromDbRow(row: DbClubSettingsRow): ClubSettings {
  return {
    memberCanViewRoster: Boolean(row.member_can_view_roster),
    memberCanViewAttendanceRates: Boolean(row.member_can_view_attendance_rates),
    memberCanViewCalendarDetails: Boolean(row.member_can_view_calendar_details),
    sharedIdeaVisibility: Boolean(row.shared_idea_visibility),
    memberCanCommentOnPosts: Boolean(row.member_can_comment_on_posts),
    contentDeletionMode: normalizeContentDeletionMode(row.content_deletion_mode),
    updatedBy: row.updated_by ?? undefined,
    updatedAt: row.updated_at,
  };
}

function normalizePostsError(error: unknown, fallbackMessage: string, httpStatus?: number): Error {
  const syncErr = toSupabaseSyncError(error, fallbackMessage, httpStatus);
  if (syncErr.isMissingTable || syncErr.isMissingColumn) {
    return new Error(MISSING_POSTS_SCHEMA_MESSAGE);
  }
  if (syncErr.isPermissionDenied) {
    return new Error(POSTS_PERMISSION_MESSAGE);
  }
  return new Error(syncErr.message || fallbackMessage);
}

/** Fetches all public club announcements, meeting reminders, and resource updates (pinned first). */
export async function fetchClubPosts(): Promise<ClubPost[]> {
  const { data, error, status } = await supabase
    .from('club_posts')
    .select('*')
    .order('is_pinned', { ascending: false })
    .order('created_at', { ascending: false });

  if (error) {
    throw normalizePostsError(error, 'Failed to load club posts from Supabase.', status);
  }

  return ((data ?? []) as DbClubPostRow[]).map(clubPostFromDbRow);
}

/** Fetches all comments and replies on club posts ordered chronologically. */
export async function fetchClubPostComments(): Promise<ClubPostComment[]> {
  const { data, error, status } = await supabase
    .from('club_post_comments')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to load post comments.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      return [];
    }
    throw normalizePostsError(error, 'Failed to load post comments from Supabase.', status);
  }

  return ((data ?? []) as DbClubPostCommentRow[]).map(clubPostCommentFromDbRow);
}

/** Fetches all global Member Visibility Permissions from `public.club_settings`. */
export async function fetchClubSettings(): Promise<ClubSettings> {
  const { data, error, status } = await supabase
    .from('club_settings')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to load club settings.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      return {
        ...DEFAULT_MEMBER_VISIBILITY_PERMISSIONS,
        contentDeletionMode: DEFAULT_CONTENT_DELETION_MODE,
        updatedAt: new Date(0).toISOString(),
      };
    }
    throw normalizePostsError(error, 'Failed to load club settings from Supabase.', status);
  }

  if (!data) {
    return {
      ...DEFAULT_MEMBER_VISIBILITY_PERMISSIONS,
      contentDeletionMode: DEFAULT_CONTENT_DELETION_MODE,
      updatedAt: new Date(0).toISOString(),
    };
  }

  return clubSettingsFromDbRow(data as DbClubSettingsRow);
}

/** Admin-only RPC: atomically updates all 5 global Member Visibility Permissions flags. */
export async function updateMemberVisibilityPermissions(
  permissions: MemberVisibilityPermissions,
): Promise<ClubSettings> {
  const { data, error, status } = await supabase.rpc('update_member_visibility_permissions', {
    p_member_can_view_roster: permissions.memberCanViewRoster,
    p_member_can_view_attendance_rates: permissions.memberCanViewAttendanceRates,
    p_member_can_view_calendar_details: permissions.memberCanViewCalendarDetails,
    p_shared_idea_visibility: permissions.sharedIdeaVisibility,
    p_member_can_comment_on_posts: permissions.memberCanCommentOnPosts,
  });

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to update Member Visibility Permissions.'),
      'Failed to update Member Visibility Permissions.',
      status,
    );
  }

  return clubSettingsFromDbRow(data as DbClubSettingsRow);
}

/** Admin-only RPC: enables or disables club-wide Shared Idea Visibility across standard members. */
export async function updateSharedIdeaVisibility(allowShared: boolean): Promise<ClubSettings> {
  const { data, error, status } = await supabase.rpc('set_shared_idea_visibility', {
    allow_shared: allowShared,
  });

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to update Shared Idea Visibility.'),
      'Failed to update Shared Idea Visibility.',
      status,
    );
  }

  return clubSettingsFromDbRow(data as DbClubSettingsRow);
}

/** Admin-only RPC: sets the global user content deletion policy (`own_only`, `any`, or `disabled`). */
export async function updateContentDeletionMode(
  mode: ContentDeletionMode,
): Promise<ClubSettings> {
  const { data, error, status } = await supabase.rpc('set_content_deletion_mode', {
    p_mode: mode,
  });

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to update Content Deletion Policy.'),
      'Failed to update Content Deletion Policy.',
      status,
    );
  }

  return clubSettingsFromDbRow(data as DbClubSettingsRow);
}

/** Admin-only: publishes a new announcement, meeting reminder, or resource update. */
export async function createClubPost(input: ClubPostInput): Promise<ClubPost> {
  const resourceUrl = normalizeHttpUrl(input.resourceUrl);
  const resourceLabel = cleanOptionalText(input.resourceLabel);
  const eventDate = cleanOptionalText(input.eventDate);

  const { data, error, status } = await supabase
    .from('club_posts')
    .insert({
      author_name: input.authorName.trim(),
      category: normalizePostCategory(input.category),
      title: input.title.trim(),
      content: input.content.trim(),
      event_date: eventDate ?? null,
      resource_label: resourceLabel ?? null,
      resource_url: resourceUrl ?? null,
      is_pinned: Boolean(input.isPinned),
    })
    .select('*')
    .single();

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to publish update.'),
      'Failed to publish club post to Supabase.',
      status,
    );
  }

  return clubPostFromDbRow(data as DbClubPostRow);
}

/** Admin-only: updates an existing club post's content, links, reminder date, or pin status. */
export async function updateClubPost(postId: string, input: ClubPostInput): Promise<ClubPost> {
  const resourceUrl = normalizeHttpUrl(input.resourceUrl);
  const resourceLabel = cleanOptionalText(input.resourceLabel);
  const eventDate = cleanOptionalText(input.eventDate);

  const { data, error, status } = await supabase
    .from('club_posts')
    .update({
      category: normalizePostCategory(input.category),
      title: input.title.trim(),
      content: input.content.trim(),
      event_date: eventDate ?? null,
      resource_label: resourceLabel ?? null,
      resource_url: resourceUrl ?? null,
      is_pinned: Boolean(input.isPinned),
    })
    .eq('id', postId)
    .select('*')
    .single();

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to update post.'),
      'Failed to update club post.',
      status,
    );
  }

  return clubPostFromDbRow(data as DbClubPostRow);
}

/** Admin-only: pins or unpins a post at the top of the Posts & Updates feed. */
export async function toggleClubPostPin(postId: string, isPinned: boolean): Promise<ClubPost> {
  const { data, error, status } = await supabase
    .from('club_posts')
    .update({ is_pinned: isPinned })
    .eq('id', postId)
    .select('*')
    .single();

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to update pin status.'),
      'Failed to update post pin state.',
      status,
    );
  }

  return clubPostFromDbRow(data as DbClubPostRow);
}

/** Permanently deletes a club post (server RLS enforces the active content deletion policy). */
export async function deleteClubPost(postId: string): Promise<void> {
  const { data, error, status } = await supabase
    .from('club_posts')
    .delete()
    .eq('id', postId)
    .select('id');

  if (error) {
    throw normalizePostsError(error, 'Failed to delete club post.', status);
  }
  if (!data || data.length === 0) {
    throw new Error(
      'Deletion is not permitted under the current content deletion policy (or the post was already removed).',
    );
  }
}

/** Creates a comment or reply under a club post (server stamps identity & checks comment permission). */
export async function createClubPostComment(
  input: ClubPostCommentInput,
): Promise<ClubPostComment> {
  const content = input.content.trim();
  const { data, error, status } = await supabase
    .from('club_post_comments')
    .insert({
      post_id: input.postId,
      parent_comment_id: input.parentCommentId ?? null,
      author_name: 'Member',
      content,
    })
    .select('*')
    .single();

  if (error || !data) {
    throw normalizePostsError(
      error ?? new Error('Unable to post comment.'),
      'Failed to post comment.',
      status,
    );
  }

  return clubPostCommentFromDbRow(data as DbClubPostCommentRow);
}

/** Deletes a post comment (server RLS enforces the active content deletion policy). */
export async function deleteClubPostComment(commentId: string): Promise<void> {
  const { data, error, status } = await supabase
    .from('club_post_comments')
    .delete()
    .eq('id', commentId)
    .select('id');

  if (error) {
    throw normalizePostsError(error, 'Failed to delete comment.', status);
  }
  if (!data || data.length === 0) {
    throw new Error(
      'Deletion is not permitted under the current content deletion policy (or the comment was already removed).',
    );
  }
}
