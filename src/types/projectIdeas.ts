export const PROJECT_IDEA_CATEGORIES = [
  'General',
  'Robotics',
  'Software',
  'Hardware',
  'Event',
  'Design',
] as const;

export type ProjectIdeaCategory = (typeof PROJECT_IDEA_CATEGORIES)[number];

export type ProjectIdeasFilter = 'all' | 'highlighted';
export type ProjectIdeasSortMode = 'featured_newest' | 'newest';

export type ProjectIdeaReviewStatus = 'pending' | 'under_review' | 'approved' | 'archived';

export const PROJECT_IDEA_STATUS_LABELS: Record<ProjectIdeaReviewStatus, string> = {
  pending: 'Pending Review',
  under_review: 'Under Review',
  approved: 'Approved',
  archived: 'Archived',
};

export interface ProjectIdeaFeedback {
  ideaId: string;
  feedbackText: string;
  responderUserId?: string;
  responderName?: string;
  updatedAt: string;
}

export interface ProjectIdea {
  id: string;
  submittedByUserId?: string;
  linkedMemberId?: string;
  authorName: string;
  title: string;
  description: string;
  category?: string;
  reviewStatus: ProjectIdeaReviewStatus;
  isHighlighted: boolean;
  adminFeedback?: ProjectIdeaFeedback;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectIdeaInput {
  authorName: string;
  title: string;
  description: string;
  category?: string;
}

export const CLUB_POST_CATEGORIES = [
  'announcement',
  'meeting_reminder',
  'resource_update',
  'general',
] as const;

export type ClubPostCategory = (typeof CLUB_POST_CATEGORIES)[number];

export const CLUB_POST_CATEGORY_LABELS: Record<ClubPostCategory, string> = {
  announcement: 'Announcement',
  meeting_reminder: 'Meeting Reminder',
  resource_update: 'Resource Update',
  general: 'General Update',
};

export interface ClubPost {
  id: string;
  authorUserId?: string;
  authorName: string;
  category: ClubPostCategory;
  title: string;
  content: string;
  eventDate?: string;
  resourceLabel?: string;
  resourceUrl?: string;
  isPinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClubPostInput {
  authorName: string;
  category: ClubPostCategory;
  title: string;
  content: string;
  eventDate?: string;
  resourceLabel?: string;
  resourceUrl?: string;
  isPinned?: boolean;
}

export interface ClubPostComment {
  id: string;
  postId: string;
  parentCommentId?: string;
  authorUserId: string;
  authorName: string;
  authorRole: 'admin' | 'member';
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClubPostCommentInput {
  postId: string;
  parentCommentId?: string;
  content: string;
}

export type ContentDeletionMode = 'own_only' | 'any' | 'disabled';

export const DEFAULT_CONTENT_DELETION_MODE: ContentDeletionMode = 'own_only';

export const CONTENT_DELETION_MODE_LABELS: Record<ContentDeletionMode, string> = {
  own_only: 'Own Content Only',
  any: 'Any Content',
  disabled: 'Disabled',
};

export const CONTENT_DELETION_MODE_DESCRIPTIONS: Record<ContentDeletionMode, string> = {
  own_only:
    'Regular users can delete only content they posted themselves (their own project ideas, comments, and authored posts).',
  any: 'Signed-in regular users can delete any visible posted content across the system (project ideas, posts, and comments).',
  disabled:
    'Content deletion is disabled for regular users entirely. Only administrators can delete posted content.',
};

export function normalizeContentDeletionMode(
  value: string | null | undefined,
): ContentDeletionMode {
  if (value === 'own_only' || value === 'any' || value === 'disabled') {
    return value;
  }
  return DEFAULT_CONTENT_DELETION_MODE;
}

/**
 * Single source of truth for client-side content deletion checks across project ideas,
 * club posts, and post comments. Mirrors PostgreSQL `public.can_current_user_delete_content`.
 */
export function canUserDeleteContent(params: {
  isAdmin: boolean;
  userId: string | null | undefined;
  authorUserId: string | null | undefined;
  mode: ContentDeletionMode;
}): boolean {
  const { isAdmin, userId, authorUserId, mode } = params;
  if (isAdmin) return true;
  if (!userId) return false;
  if (mode === 'disabled') return false;
  if (mode === 'any') return true;
  return Boolean(authorUserId && authorUserId === userId);
}

export interface MemberVisibilityPermissions {
  memberCanViewRoster: boolean;
  memberCanViewAttendanceRates: boolean;
  memberCanViewCalendarDetails: boolean;
  sharedIdeaVisibility: boolean;
  memberCanCommentOnPosts: boolean;
}

export interface ClubSettings extends MemberVisibilityPermissions {
  contentDeletionMode: ContentDeletionMode;
  updatedBy?: string;
  updatedAt: string;
}
