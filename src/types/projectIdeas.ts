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

export interface MemberVisibilityPermissions {
  memberCanViewRoster: boolean;
  memberCanViewAttendanceRates: boolean;
  memberCanViewCalendarDetails: boolean;
  sharedIdeaVisibility: boolean;
  memberCanCommentOnPosts: boolean;
}

export interface ClubSettings extends MemberVisibilityPermissions {
  updatedBy?: string;
  updatedAt: string;
}
