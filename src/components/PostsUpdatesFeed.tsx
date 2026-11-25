import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  CLUB_POST_CATEGORIES,
  CLUB_POST_CATEGORY_LABELS,
  canUserDeleteContent,
  type ClubPost,
  type ClubPostCategory,
  type ClubPostComment,
  type ClubPostCommentInput,
  type ClubPostInput,
  type ContentDeletionMode,
} from '../types/projectIdeas';
import { formatSessionDate, formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelCalendarIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelEditIcon,
  PixelLinkIcon,
  PixelMegaphoneIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelTrashIcon,
  PixelUserIcon,
} from './PixelIcons';

interface PostsUpdatesFeedProps {
  userId: string | null;
  posts: ClubPost[];
  comments: ClubPostComment[];
  isLoading: boolean;
  error: string | null;
  isLiveConnected: boolean;
  isPublishing: boolean;
  isAdmin: boolean;
  memberCanCommentOnPosts: boolean;
  contentDeletionMode: ContentDeletionMode;
  authorDisplayName: string;
  onRefresh: () => Promise<void>;
  onPublishPost: (input: ClubPostInput) => Promise<ClubPost>;
  onEditPost: (postId: string, input: ClubPostInput) => Promise<ClubPost>;
  onTogglePinPost: (postId: string, nextPinned: boolean) => Promise<ClubPost>;
  onDeletePost: (postId: string) => Promise<void>;
  onAddComment: (input: ClubPostCommentInput) => Promise<ClubPostComment>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onOpenCloudSync: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

const POST_CATEGORY_ACCENTS: Record<ClubPostCategory, string> = {
  announcement: 'is-announcement',
  meeting_reminder: 'is-reminder',
  resource_update: 'is-resource',
  general: 'is-general',
};

/**
 * Official Team SPIRIT Posts & Updates feed: publicly readable by everyone,
 * with live admin publishing, pinning, resource links, and meeting reminders.
 */
export function PostsUpdatesFeed({
  userId,
  posts,
  comments,
  isLoading,
  error,
  isLiveConnected,
  isPublishing,
  isAdmin,
  memberCanCommentOnPosts,
  contentDeletionMode,
  authorDisplayName,
  onRefresh,
  onPublishPost,
  onEditPost,
  onTogglePinPost,
  onDeletePost,
  onAddComment,
  onDeleteComment,
  onOpenCloudSync,
  onNotify,
}: PostsUpdatesFeedProps) {
  const modalTitleId = useId();
  const postTitleId = useId();
  const postCategoryId = useId();
  const postContentId = useId();
  const postDateId = useId();
  const postLinkLabelId = useId();
  const postLinkUrlId = useId();
  const postPinnedId = useId();

  const titleInputRef = useRef<HTMLInputElement | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<'all' | ClubPostCategory>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [editingPost, setEditingPost] = useState<ClubPost | null>(null);
  const [formCategory, setFormCategory] = useState<ClubPostCategory>('announcement');
  const [formTitle, setFormTitle] = useState('');
  const [formContent, setFormContent] = useState('');
  const [formEventDate, setFormEventDate] = useState('');
  const [formResourceLabel, setFormResourceLabel] = useState('');
  const [formResourceUrl, setFormResourceUrl] = useState('');
  const [formPinned, setFormPinned] = useState(false);
  const [formError, setFormError] = useState('');
  const [isSavingPost, setIsSavingPost] = useState(false);

  const [busyPostId, setBusyPostId] = useState<string | null>(null);
  const [pendingDeletePost, setPendingDeletePost] = useState<ClubPost | null>(null);
  const [expandedCommentPostIds, setExpandedCommentPostIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [commentDraftByPostId, setCommentDraftByPostId] = useState<Record<string, string>>({});
  const [replyTargetByPostId, setReplyTargetByPostId] = useState<
    Record<string, ClubPostComment | null>
  >({});
  const [busyCommentPostId, setBusyCommentPostId] = useState<string | null>(null);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  const commentsByPostId = useMemo(() => {
    const grouped = new Map<string, ClubPostComment[]>();
    for (const comment of comments) {
      const existing = grouped.get(comment.postId);
      if (existing) {
        existing.push(comment);
      } else {
        grouped.set(comment.postId, [comment]);
      }
    }
    return grouped;
  }, [comments]);

  const canCurrentUserComment = Boolean(userId) && (isAdmin || memberCanCommentOnPosts);

  const filteredPosts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = posts.filter((post) => {
      if (categoryFilter !== 'all' && post.category !== categoryFilter) return false;
      if (!q) return true;
      return [
        post.title,
        post.content,
        post.authorName,
        post.resourceLabel,
        CLUB_POST_CATEGORY_LABELS[post.category],
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(q));
    });

    return [...list].sort((a, b) => {
      if (a.isPinned !== b.isPinned) {
        return a.isPinned ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [categoryFilter, posts, searchQuery]);

  useEffect(() => {
    if (!isComposerOpen) return;
    const timer = window.setTimeout(() => {
      titleInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [isComposerOpen]);

  useEffect(() => {
    if (!isComposerOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !isSavingPost && !isPublishing) {
        setIsComposerOpen(false);
        setEditingPost(null);
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isComposerOpen, isPublishing, isSavingPost]);

  function openCreateModal() {
    if (!isAdmin) return;
    setEditingPost(null);
    setFormCategory('announcement');
    setFormTitle('');
    setFormContent('');
    setFormEventDate('');
    setFormResourceLabel('');
    setFormResourceUrl('');
    setFormPinned(false);
    setFormError('');
    setIsComposerOpen(true);
  }

  function openEditModal(post: ClubPost) {
    if (!isAdmin) return;
    setEditingPost(post);
    setFormCategory(post.category);
    setFormTitle(post.title);
    setFormContent(post.content);
    setFormEventDate(post.eventDate ?? '');
    setFormResourceLabel(post.resourceLabel ?? '');
    setFormResourceUrl(post.resourceUrl ?? '');
    setFormPinned(post.isPinned);
    setFormError('');
    setIsComposerOpen(true);
  }

  async function handleSubmitPost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isAdmin || isSavingPost || isPublishing) return;

    const trimmedTitle = formTitle.trim();
    const trimmedContent = formContent.trim();
    const trimmedUrl = formResourceUrl.trim();
    const trimmedLabel = formResourceLabel.trim();

    if (trimmedTitle.length < 2 || trimmedTitle.length > 140) {
      setFormError('Post headline must be between 2 and 140 characters.');
      titleInputRef.current?.focus();
      return;
    }
    if (trimmedContent.length < 5 || trimmedContent.length > 4000) {
      setFormError('Update details must be between 5 and 4000 characters.');
      return;
    }
    if (trimmedUrl && !/^https?:\/\//i.test(trimmedUrl)) {
      setFormError('Resource link must start with https:// or http://.');
      return;
    }
    if (trimmedUrl.length > 500) {
      setFormError('Resource URL must be 500 characters or fewer.');
      return;
    }

    const payload: ClubPostInput = {
      authorName: authorDisplayName || 'Club Admin',
      category: formCategory,
      title: trimmedTitle,
      content: trimmedContent,
      eventDate: formEventDate.trim() || undefined,
      resourceLabel: trimmedLabel || undefined,
      resourceUrl: trimmedUrl || undefined,
      isPinned: formPinned,
    };

    setIsSavingPost(true);
    setFormError('');
    try {
      if (editingPost) {
        const updated = await onEditPost(editingPost.id, payload);
        onNotify?.({
          tone: 'success',
          tag: 'Update Saved',
          message: `Updated "${updated.title}".`,
        });
      } else {
        const created = await onPublishPost(payload);
        onNotify?.({
          tone: 'success',
          tag: 'Update Published',
          message: `Published "${created.title}" to everyone.`,
        });
      }
      setIsComposerOpen(false);
      setEditingPost(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to save club update.');
    } finally {
      setIsSavingPost(false);
    }
  }

  async function handleTogglePin(post: ClubPost) {
    if (!isAdmin || busyPostId) return;
    const nextPinned = !post.isPinned;
    setBusyPostId(post.id);
    try {
      await onTogglePinPost(post.id, nextPinned);
      onNotify?.({
        tone: 'info',
        tag: nextPinned ? 'Pinned' : 'Unpinned',
        message: nextPinned
          ? `Pinned "${post.title}" to the top of Updates.`
          : `Unpinned "${post.title}".`,
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Post Error',
        message: err instanceof Error ? err.message : 'Unable to update pin state.',
      });
    } finally {
      setBusyPostId(null);
    }
  }

  const activePendingDeletePost =
    pendingDeletePost &&
    canUserDeleteContent({
      isAdmin,
      userId,
      authorUserId: pendingDeletePost.authorUserId,
      mode: contentDeletionMode,
    }) &&
    posts.some((post) => post.id === pendingDeletePost.id)
      ? pendingDeletePost
      : null;

  async function handleConfirmDeletePost() {
    if (!activePendingDeletePost || busyPostId) return;
    const target = activePendingDeletePost;
    if (
      !canUserDeleteContent({
        isAdmin,
        userId,
        authorUserId: target.authorUserId,
        mode: contentDeletionMode,
      })
    ) {
      setPendingDeletePost(null);
      onNotify?.({
        tone: 'error',
        tag: 'Deletion Disabled',
        message: 'You do not have permission to delete this post under the active policy.',
      });
      return;
    }
    setBusyPostId(target.id);
    try {
      await onDeletePost(target.id);
      setPendingDeletePost(null);
      onNotify?.({
        tone: 'warning',
        tag: 'Update Deleted',
        message: `Removed post "${target.title}".`,
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Post Error',
        message: err instanceof Error ? err.message : 'Unable to delete update.',
      });
    } finally {
      setBusyPostId(null);
    }
  }

  function handleToggleComments(postId: string) {
    setExpandedCommentPostIds((prev) => {
      const next = new Set(prev);
      if (next.has(postId)) {
        next.delete(postId);
      } else {
        next.add(postId);
      }
      return next;
    });
  }

  async function handleSubmitComment(event: FormEvent<HTMLFormElement>, postId: string) {
    event.preventDefault();
    if (!canCurrentUserComment || busyCommentPostId) return;

    const draft = (commentDraftByPostId[postId] ?? '').trim();
    if (!draft) return;
    if (draft.length > 1000) {
      onNotify?.({
        tone: 'error',
        tag: 'Comment Too Long',
        message: 'Comments must be 1000 characters or fewer.',
      });
      return;
    }

    const rawReplyTarget = replyTargetByPostId[postId] ?? null;
    const postComments = commentsByPostId.get(postId) ?? [];
    const replyTarget =
      rawReplyTarget && postComments.some((item) => item.id === rawReplyTarget.id)
        ? rawReplyTarget
        : null;
    if (rawReplyTarget && !replyTarget) {
      setReplyTargetByPostId((prev) => ({ ...prev, [postId]: null }));
    }
    setBusyCommentPostId(postId);
    try {
      await onAddComment({
        postId,
        parentCommentId: replyTarget?.id,
        content: draft,
      });
      setCommentDraftByPostId((prev) => ({ ...prev, [postId]: '' }));
      setReplyTargetByPostId((prev) => ({ ...prev, [postId]: null }));
      setExpandedCommentPostIds((prev) => new Set(prev).add(postId));
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Comment Error',
        message: err instanceof Error ? err.message : 'Unable to post comment.',
      });
    } finally {
      setBusyCommentPostId(null);
    }
  }

  async function handleDeleteCommentClick(comment: ClubPostComment) {
    if (deletingCommentId) return;
    if (
      !canUserDeleteContent({
        isAdmin,
        userId,
        authorUserId: comment.authorUserId,
        mode: contentDeletionMode,
      })
    ) {
      onNotify?.({
        tone: 'error',
        tag: 'Deletion Disabled',
        message: 'You do not have permission to delete this comment under the active policy.',
      });
      return;
    }
    setDeletingCommentId(comment.id);
    try {
      await onDeleteComment(comment.id);
      onNotify?.({
        tone: 'warning',
        tag: 'Comment Removed',
        message: 'Removed comment from update thread.',
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Comment Error',
        message: err instanceof Error ? err.message : 'Unable to remove comment.',
      });
    } finally {
      setDeletingCommentId(null);
    }
  }

  return (
    <section className="tracker-panel club-posts-panel" aria-label="Club Posts and Updates feed">
      <div className="tracker-panel-header">
        <div className="panel-title-group">
          <PixelMegaphoneIcon />
          <h2 className="panel-title">Posts &amp; Updates</h2>
          <span className="panel-count">{filteredPosts.length}</span>
          <span className="ideas-public-tag" title="Visible to everyone visiting Team SPIRIT">
            Public Feed
          </span>
          <span
            className={`ideas-live-badge ${isLiveConnected ? 'is-live' : ''}`}
            title={isLiveConnected ? 'Live Supabase Realtime feed' : 'Standard refresh sync'}
          >
            <span className="sync-status-dot" aria-hidden="true" />
            <span>{isLiveConnected ? 'Live' : 'Sync'}</span>
          </span>
        </div>

        <div className="panel-header-actions">
          <button
            type="button"
            className="btn-secondary btn-compact"
            onClick={() => void onRefresh()}
            disabled={isLoading}
            title="Refresh club updates"
          >
            <PixelRefreshIcon />
            <span>Refresh</span>
          </button>

          {isAdmin && (
            <button
              type="button"
              className="btn-primary btn-compact-primary"
              onClick={openCreateModal}
            >
              <PixelPlusIcon />
              <span>Publish Update</span>
            </button>
          )}
        </div>
      </div>

      <div className="session-hub-toolbar ideas-toolbar posts-toolbar">
        <div className="session-hub-search-wrap">
          <span className="session-suggest-icon" aria-hidden="true">
            <PixelSearchIcon />
          </span>
          <input
            type="text"
            className="form-control session-hub-search-input"
            placeholder="Search announcements, reminders, resources..."
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            aria-label="Search club announcements"
          />
          {searchQuery.length > 0 && (
            <button
              type="button"
              className="session-suggest-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear announcement search"
            >
              <PixelCloseIcon width={11} height={11} />
            </button>
          )}
        </div>

        <div className="filter-pills" role="tablist" aria-label="Filter updates by type">
          <button
            type="button"
            role="tab"
            aria-selected={categoryFilter === 'all'}
            className={`filter-pill ${categoryFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setCategoryFilter('all')}
          >
            All
          </button>
          {CLUB_POST_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              role="tab"
              aria-selected={categoryFilter === cat}
              className={`filter-pill ${categoryFilter === cat ? 'is-active' : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {CLUB_POST_CATEGORY_LABELS[cat]}
            </button>
          ))}
        </div>
      </div>

      <div className="tracker-body posts-feed-body">
        {error ? (
          <div className="reserved-empty-state" role="alert">
            <div className="empty-badge">
              <PixelAlertIcon />
              <span>Feed Connection Issue</span>
            </div>
            <h3 className="empty-title">Unable to reach Club Posts</h3>
            <p className="empty-description">{error}</p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void onRefresh()}
            >
              <PixelRefreshIcon />
              <span>Retry Connection</span>
            </button>
          </div>
        ) : isLoading && posts.length === 0 ? (
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelMegaphoneIcon />
              <span>Loading Feed</span>
            </div>
            <h3 className="empty-title">Fetching official club updates from Supabase...</h3>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelMegaphoneIcon />
              <span>{posts.length === 0 ? 'No Posts Yet' : 'No Matches'}</span>
            </div>
            <h3 className="empty-title">
              {posts.length === 0 ? 'No updates published yet' : 'No matching updates found'}
            </h3>
            <p className="empty-description">
              {posts.length === 0
                ? isAdmin
                  ? 'Click "Publish Update" above to share an announcement, meeting reminder, or resource link with the club.'
                  : 'Admins have not posted any club announcements yet. Check back soon.'
                : 'Try adjusting your search keyword or category filter.'}
            </p>
          </div>
        ) : (
          <div className="posts-feed-list" role="feed" aria-label="Official club updates">
            {filteredPosts.map((post) => {
              const isBusy = Boolean(busyPostId);
              const canDeletePost = canUserDeleteContent({
                isAdmin,
                userId,
                authorUserId: post.authorUserId,
                mode: contentDeletionMode,
              });
              const postComments = commentsByPostId.get(post.id) ?? [];
              const commentsExpanded = expandedCommentPostIds.has(post.id);
              const rawReplyTarget = replyTargetByPostId[post.id] ?? null;
              const replyTarget =
                rawReplyTarget && postComments.some((item) => item.id === rawReplyTarget.id)
                  ? rawReplyTarget
                  : null;
              const commentDraft = commentDraftByPostId[post.id] ?? '';
              const isSendingComment = busyCommentPostId === post.id;
              const commentById = new Map(postComments.map((item) => [item.id, item]));

              return (
                <article
                  key={post.id}
                  className={`club-post-card ${post.isPinned ? 'is-pinned' : ''}`}
                >
                  <div className="club-post-card-head">
                    <div className="club-post-badges">
                      {post.isPinned && (
                        <span className="post-pinned-badge" title="Pinned by club admin">
                          <PixelPinIcon width={11} height={11} />
                          <span>Pinned</span>
                        </span>
                      )}
                      <span
                        className={`post-category-badge ${POST_CATEGORY_ACCENTS[post.category]}`}
                      >
                        {CLUB_POST_CATEGORY_LABELS[post.category]}
                      </span>
                      {post.eventDate && (
                        <span className="session-meta-pill">
                          <PixelCalendarIcon width={11} height={11} />
                          <span>{formatSessionDate(post.eventDate)}</span>
                        </span>
                      )}
                    </div>

                    {(isAdmin || canDeletePost) && (
                      <div className="idea-admin-actions">
                        {isAdmin && (
                          <>
                            <button
                              type="button"
                              className={`icon-btn idea-highlight-btn ${
                                post.isPinned ? 'is-active' : ''
                              }`}
                              disabled={isBusy}
                              onClick={() => void handleTogglePin(post)}
                              title={post.isPinned ? 'Unpin update' : 'Pin update to top'}
                              aria-label={post.isPinned ? `Unpin ${post.title}` : `Pin ${post.title}`}
                            >
                              <PixelPinIcon width={12} height={12} />
                            </button>
                            <button
                              type="button"
                              className="icon-btn"
                              disabled={isBusy}
                              onClick={() => openEditModal(post)}
                              title="Edit update"
                              aria-label={`Edit ${post.title}`}
                            >
                              <PixelEditIcon width={12} height={12} />
                            </button>
                          </>
                        )}
                        {canDeletePost && (
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger"
                            disabled={isBusy}
                            onClick={() => setPendingDeletePost(post)}
                            title="Delete update"
                            aria-label={`Delete ${post.title}`}
                          >
                            <PixelTrashIcon width={12} height={12} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <h3 className="club-post-title">{post.title}</h3>
                  <p className="club-post-content">{post.content}</p>

                  {post.resourceUrl && (
                    <a
                      href={post.resourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="club-post-resource-link"
                    >
                      <PixelLinkIcon width={12} height={12} />
                      <span>{post.resourceLabel || post.resourceUrl}</span>
                    </a>
                  )}

                  <div className="club-post-footer">
                    <span className="idea-author-chip">
                      <PixelUserIcon width={11} height={11} />
                      <span>{post.authorName}</span>
                    </span>

                    <div className="club-post-footer-right">
                      <button
                        type="button"
                        className={`btn-secondary btn-compact post-comments-toggle ${
                          commentsExpanded ? 'is-active' : ''
                        }`}
                        onClick={() => handleToggleComments(post.id)}
                        aria-expanded={commentsExpanded}
                      >
                        <span>
                          Comments ({postComments.length})
                        </span>
                      </button>

                      <span className="idea-date-meta mono-cell">
                        {formatTimestamp(post.createdAt)}
                      </span>
                    </div>
                  </div>

                  {commentsExpanded && (
                    <div className="post-comments-thread" aria-label={`Comments on ${post.title}`}>
                      {postComments.length === 0 ? (
                        <p className="post-comments-empty">No comments or replies yet.</p>
                      ) : (
                        <ul className="post-comments-list">
                          {postComments.map((comment) => {
                            const parentComment = comment.parentCommentId
                              ? commentById.get(comment.parentCommentId)
                              : undefined;
                            const canDeleteComment = canUserDeleteContent({
                              isAdmin,
                              userId,
                              authorUserId: comment.authorUserId,
                              mode: contentDeletionMode,
                            });
                            return (
                              <li
                                key={comment.id}
                                className={`post-comment-item ${
                                  comment.parentCommentId ? 'is-reply' : ''
                                }`}
                              >
                                <div className="post-comment-head">
                                  <div className="post-comment-author-row">
                                    <strong>{comment.authorName}</strong>
                                    <span
                                      className={`account-role-tag ${
                                        comment.authorRole === 'admin' ? 'is-admin' : 'is-member'
                                      }`}
                                    >
                                      {comment.authorRole === 'admin' ? 'Admin' : 'Member'}
                                    </span>
                                    {parentComment && (
                                      <span className="post-reply-ref">
                                        replied to {parentComment.authorName}
                                      </span>
                                    )}
                                  </div>

                                  <div className="post-comment-meta-actions">
                                    <span className="mono-meta">
                                      {formatTimestamp(comment.createdAt)}
                                    </span>
                                    {canCurrentUserComment && (
                                      <button
                                        type="button"
                                        className="ideas-inline-link post-comment-action-link"
                                        onClick={() =>
                                          setReplyTargetByPostId((prev) => ({
                                            ...prev,
                                            [post.id]: comment,
                                          }))
                                        }
                                      >
                                        Reply
                                      </button>
                                    )}
                                    {canDeleteComment && (
                                      <button
                                        type="button"
                                        className="icon-btn icon-btn-danger post-comment-delete-btn"
                                        disabled={deletingCommentId === comment.id}
                                        onClick={() => void handleDeleteCommentClick(comment)}
                                        aria-label="Delete comment"
                                        title="Delete comment"
                                      >
                                        <PixelTrashIcon width={11} height={11} />
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <p className="post-comment-body">{comment.content}</p>
                              </li>
                            );
                          })}
                        </ul>
                      )}

                      {canCurrentUserComment ? (
                        <form
                          className="post-comment-form"
                          onSubmit={(event) => void handleSubmitComment(event, post.id)}
                        >
                          {replyTarget && (
                            <div className="post-reply-banner">
                              <span>
                                Replying to <strong>{replyTarget.authorName}</strong>
                              </span>
                              <button
                                type="button"
                                className="ideas-inline-link"
                                onClick={() =>
                                  setReplyTargetByPostId((prev) => ({ ...prev, [post.id]: null }))
                                }
                              >
                                Cancel reply
                              </button>
                            </div>
                          )}
                          <div className="post-comment-input-row">
                            <input
                              type="text"
                              className="form-control"
                              maxLength={1000}
                              placeholder={
                                replyTarget
                                  ? `Reply to ${replyTarget.authorName}...`
                                  : `Comment as ${authorDisplayName}...`
                              }
                              value={commentDraft}
                              onChange={(event) =>
                                setCommentDraftByPostId((prev) => ({
                                  ...prev,
                                  [post.id]: event.target.value,
                                }))
                              }
                              disabled={isSendingComment}
                              aria-label={`Write a comment on ${post.title}`}
                            />
                            <button
                              type="submit"
                              className="btn-primary btn-compact"
                              disabled={isSendingComment || commentDraft.trim().length === 0}
                            >
                              <span>{isSendingComment ? 'Posting...' : 'Reply'}</span>
                            </button>
                          </div>
                        </form>
                      ) : userId ? (
                        <p className="post-comments-locked-note">
                          Comments &amp; replies are currently disabled for members by club admins.
                        </p>
                      ) : (
                        <p className="post-comments-locked-note">
                          <button
                            type="button"
                            className="ideas-inline-link"
                            onClick={onOpenCloudSync}
                          >
                            Sign in
                          </button>{' '}
                          to reply if member commenting is enabled.
                        </p>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </div>

      {isComposerOpen && isAdmin && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingPost && !isPublishing) {
              setIsComposerOpen(false);
              setEditingPost(null);
            }
          }}
        >
          <div
            className="modal-dialog club-post-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <span className="modal-badge">
                  <PixelMegaphoneIcon />
                  <span>{editingPost ? 'Edit Post' : 'New Club Update'}</span>
                </span>
                <h2 id={modalTitleId} className="modal-title">
                  {editingPost ? 'Edit Club Announcement' : 'Publish Club Update'}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => {
                  setIsComposerOpen(false);
                  setEditingPost(null);
                }}
                disabled={isSavingPost || isPublishing}
                aria-label="Close post composer"
              >
                <PixelCloseIcon />
              </button>
            </div>

            <form className="modal-form" onSubmit={handleSubmitPost} noValidate>
              <div className="modal-grid-2">
                <div className="form-field">
                  <label htmlFor={postCategoryId}>Update Type</label>
                  <select
                    id={postCategoryId}
                    className="form-control"
                    value={formCategory}
                    onChange={(event) => setFormCategory(event.target.value as ClubPostCategory)}
                    disabled={isSavingPost}
                  >
                    {CLUB_POST_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CLUB_POST_CATEGORY_LABELS[cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label htmlFor={postDateId}>Reminder Date (optional)</label>
                  <input
                    id={postDateId}
                    type="date"
                    className="form-control"
                    value={formEventDate}
                    onChange={(event) => setFormEventDate(event.target.value)}
                    disabled={isSavingPost}
                  />
                </div>
              </div>

              <div className="form-field">
                <label htmlFor={postTitleId}>
                  Headline <span className="required-mark">*</span>
                </label>
                <input
                  id={postTitleId}
                  ref={titleInputRef}
                  type="text"
                  className="form-control"
                  placeholder="e.g. Friday Build Lab Reminder & Parts Checklist"
                  maxLength={140}
                  value={formTitle}
                  onChange={(event) => setFormTitle(event.target.value)}
                  disabled={isSavingPost}
                  required
                />
              </div>

              <div className="form-field">
                <label htmlFor={postContentId}>
                  Message Details <span className="required-mark">*</span>
                </label>
                <textarea
                  id={postContentId}
                  className="form-control ideas-textarea"
                  rows={5}
                  placeholder="Share meeting agenda, room notes, deadlines, or competition instructions..."
                  maxLength={4000}
                  value={formContent}
                  onChange={(event) => setFormContent(event.target.value)}
                  disabled={isSavingPost}
                  required
                />
              </div>

              <div className="modal-grid-2">
                <div className="form-field">
                  <label htmlFor={postLinkLabelId}>Resource Label (optional)</label>
                  <input
                    id={postLinkLabelId}
                    type="text"
                    className="form-control"
                    placeholder="e.g. Workshop Slides / CAD Folder"
                    maxLength={80}
                    value={formResourceLabel}
                    onChange={(event) => setFormResourceLabel(event.target.value)}
                    disabled={isSavingPost}
                  />
                </div>

                <div className="form-field">
                  <label htmlFor={postLinkUrlId}>Resource URL (https://...)</label>
                  <input
                    id={postLinkUrlId}
                    type="url"
                    className="form-control"
                    placeholder="https://..."
                    maxLength={500}
                    value={formResourceUrl}
                    onChange={(event) => setFormResourceUrl(event.target.value)}
                    disabled={isSavingPost}
                  />
                </div>
              </div>

              <label htmlFor={postPinnedId} className="post-pin-checkbox-row">
                <input
                  id={postPinnedId}
                  type="checkbox"
                  checked={formPinned}
                  onChange={(event) => setFormPinned(event.target.checked)}
                  disabled={isSavingPost}
                />
                <span>Pin this update to the top of the Posts &amp; Updates feed</span>
              </label>

              {formError && (
                <div className="modal-error" role="alert">
                  {formError}
                </div>
              )}

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setIsComposerOpen(false);
                    setEditingPost(null);
                  }}
                  disabled={isSavingPost}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isSavingPost}>
                  <PixelCheckIcon />
                  <span>
                    {isSavingPost
                      ? 'Saving...'
                      : editingPost
                        ? 'Save Changes'
                        : 'Publish to Everyone'}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={activePendingDeletePost !== null}
        badgeLabel="Delete Update"
        title="Delete Club Update"
        message={
          activePendingDeletePost
            ? `Permanently delete "${activePendingDeletePost.title}" from the public Posts & Updates feed?`
            : ''
        }
        confirmLabel="Delete Post"
        onConfirm={() => void handleConfirmDeletePost()}
        onCancel={() => {
          if (!busyPostId) {
            setPendingDeletePost(null);
          }
        }}
      />
    </section>
  );
}
