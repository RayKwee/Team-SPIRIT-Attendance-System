import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { useProjectIdeas } from '../hooks/useProjectIdeas';
import type { ClubMember, ViewMode } from '../types/attendance';
import {
  PROJECT_IDEA_CATEGORIES,
  PROJECT_IDEA_STATUS_LABELS,
  canUserDeleteContent,
  type ContentDeletionMode,
  type ProjectIdea,
  type ProjectIdeaReviewStatus,
  type ProjectIdeasFilter,
  type ProjectIdeasSortMode,
} from '../types/projectIdeas';
import { formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelAlertIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelEditIcon,
  PixelEyeIcon,
  PixelEyeOffIcon,
  PixelGridIcon,
  PixelIdeaIcon,
  PixelListIcon,
  PixelLockIcon,
  PixelPlusIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelStarIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
  PixelUserIcon,
} from './PixelIcons';

type IdeaOwnershipFilter = 'all' | 'mine';

interface ProjectIdeasWorkspaceProps {
  userId: string | null;
  userEmail?: string;
  linkedMember?: ClubMember | null;
  isAdmin: boolean;
  sharedIdeaVisibility: boolean;
  contentDeletionMode: ContentDeletionMode;
  isUpdatingSharedVisibility: boolean;
  onSetSharedIdeaVisibility: (allowShared: boolean) => Promise<boolean>;
  onOpenCloudSync: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

const IDEA_STATUS_ACCENTS: Record<ProjectIdeaReviewStatus, string> = {
  pending: 'is-pending',
  under_review: 'is-review',
  approved: 'is-approved',
  archived: 'is-archived',
};

const ALL_REVIEW_STATUSES: ProjectIdeaReviewStatus[] = [
  'pending',
  'under_review',
  'approved',
  'archived',
];

function resolveProfileAuthorName(
  linkedMember: ClubMember | null | undefined,
  userEmail: string | undefined,
): string {
  if (linkedMember?.name?.trim()) {
    return linkedMember.name.trim();
  }
  if (userEmail?.trim()) {
    const localPart = userEmail.split('@')[0]?.trim();
    if (localPart) return localPart;
    return userEmail.trim();
  }
  return 'Club Member';
}

/**
 * Dedicated Team SPIRIT Project Ideas space where signed-in members pitch ideas,
 * browse featured builds (when shared visibility is enabled), and view private admin feedback.
 */
export function ProjectIdeasWorkspace({
  userId,
  userEmail,
  linkedMember = null,
  isAdmin,
  sharedIdeaVisibility,
  contentDeletionMode,
  isUpdatingSharedVisibility,
  onSetSharedIdeaVisibility,
  onOpenCloudSync,
  onNotify,
}: ProjectIdeasWorkspaceProps) {
  const titleInputId = useId();
  const categorySelectId = useId();
  const descriptionInputId = useId();
  const detailTitleId = useId();
  const feedbackInputId = useId();

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement | null>(null);

  const profileAuthorName = resolveProfileAuthorName(linkedMember, userEmail);

  const {
    ideas,
    isLoading,
    error,
    isLiveConnected,
    isSubmitting,
    cooldownRemainingSec,
    refreshIdeas,
    submitIdea,
    toggleHighlight,
    updateReviewStatus,
    saveAdminFeedback,
    removeIdea,
  } = useProjectIdeas({
    userId,
    isAdmin,
    sharedIdeaVisibility,
    contentDeletionMode,
    responderName: profileAuthorName,
  });

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<string>('General');
  const [description, setDescription] = useState('');
  const [formError, setFormError] = useState('');
  const [submitSuccessMessage, setSubmitSuccessMessage] = useState('');

  const [searchQuery, setSearchQuery] = useState('');
  const [highlightFilter, setHighlightFilter] = useState<ProjectIdeasFilter>('all');
  const [ownershipFilter, setOwnershipFilter] = useState<IdeaOwnershipFilter>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | ProjectIdeaReviewStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<ProjectIdeasSortMode>('featured_newest');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [pendingDeleteIdea, setPendingDeleteIdea] = useState<ProjectIdea | null>(null);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState('');
  const [isSavingFeedback, setIsSavingFeedback] = useState(false);

  const selectedIdea = useMemo(
    () => (selectedIdeaId ? ideas.find((item) => item.id === selectedIdeaId) ?? null : null),
    [ideas, selectedIdeaId],
  );

  useEffect(() => {
    setFeedbackDraft(selectedIdea?.adminFeedback?.feedbackText ?? '');
  }, [selectedIdea?.id, selectedIdea?.adminFeedback?.feedbackText]);

  useEffect(() => {
    if (!selectedIdea) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !pendingDeleteIdea && !isSavingFeedback) {
        setSelectedIdeaId(null);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSavingFeedback, pendingDeleteIdea, selectedIdea]);

  const distinctCategories = useMemo(() => {
    const set = new Set<string>();
    for (const idea of ideas) {
      if (idea.category) {
        set.add(idea.category);
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [ideas]);

  const activeCategoryFilter =
    categoryFilter !== 'all' && !distinctCategories.includes(categoryFilter)
      ? 'all'
      : categoryFilter;

  const highlightedCount = useMemo(
    () => ideas.filter((item) => item.isHighlighted).length,
    [ideas],
  );

  const myIdeasCount = useMemo(
    () => (userId ? ideas.filter((item) => item.submittedByUserId === userId).length : 0),
    [ideas, userId],
  );

  const effectiveOwnershipFilter: IdeaOwnershipFilter =
    !isAdmin && !sharedIdeaVisibility ? 'all' : ownershipFilter;

  const filteredIdeas = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const list = ideas.filter((idea) => {
      if (effectiveOwnershipFilter === 'mine' && userId && idea.submittedByUserId !== userId) {
        return false;
      }
      if (highlightFilter === 'highlighted' && !idea.isHighlighted) return false;
      if (statusFilter !== 'all' && idea.reviewStatus !== statusFilter) return false;
      if (activeCategoryFilter !== 'all' && idea.category !== activeCategoryFilter) return false;
      if (!query) return true;

      return [
        idea.title,
        idea.authorName,
        idea.description,
        idea.category,
        idea.adminFeedback?.feedbackText,
        PROJECT_IDEA_STATUS_LABELS[idea.reviewStatus],
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });

    return [...list].sort((a, b) => {
      if (sortMode === 'featured_newest' && a.isHighlighted !== b.isHighlighted) {
        return a.isHighlighted ? -1 : 1;
      }
      return b.createdAt.localeCompare(a.createdAt);
    });
  }, [
    activeCategoryFilter,
    effectiveOwnershipFilter,
    highlightFilter,
    ideas,
    searchQuery,
    sortMode,
    statusFilter,
    userId,
  ]);

  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    highlightFilter !== 'all' ||
    effectiveOwnershipFilter !== 'all' ||
    statusFilter !== 'all' ||
    activeCategoryFilter !== 'all';

  function handleClearFilters() {
    setSearchQuery('');
    setHighlightFilter('all');
    setOwnershipFilter('all');
    setStatusFilter('all');
    setCategoryFilter('all');
    searchInputRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!userId) {
      onOpenCloudSync();
      return;
    }

    const trimmedTitle = title.trim();
    const trimmedDescription = description.trim();

    if (trimmedTitle.length < 2) {
      setFormError('Project Idea Title must be at least 2 characters.');
      titleInputRef.current?.focus();
      return;
    }
    if (trimmedTitle.length > 120) {
      setFormError('Project Idea Title must be 120 characters or fewer.');
      titleInputRef.current?.focus();
      return;
    }
    if (trimmedDescription.length < 5) {
      setFormError('Please write a brief description (at least 5 characters).');
      descriptionInputRef.current?.focus();
      return;
    }
    if (trimmedDescription.length > 2000) {
      setFormError('Description must be 2000 characters or fewer.');
      descriptionInputRef.current?.focus();
      return;
    }

    setFormError('');
    setSubmitSuccessMessage('');
    try {
      const created = await submitIdea({
        authorName: profileAuthorName,
        title: trimmedTitle,
        description: trimmedDescription,
        category,
      });
      setTitle('');
      setDescription('');
      setSubmitSuccessMessage(`Submitted "${created.title}" under ${created.authorName}.`);
      onNotify?.({
        tone: 'success',
        tag: 'Idea Submitted',
        message: `Submitted "${created.title}" under ${created.authorName}.`,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Unable to submit project idea.');
    }
  }

  async function handleToggleSharedVisibility() {
    if (!isAdmin || isUpdatingSharedVisibility) return;
    const nextValue = !sharedIdeaVisibility;
    try {
      const resolved = await onSetSharedIdeaVisibility(nextValue);
      onNotify?.({
        tone: 'info',
        tag: resolved ? 'Shared Ideas ON' : 'Private Ideas Only',
        message: resolved
          ? 'Standard members can now browse shared club ideas (personal admin feedback stays private).'
          : 'Standard members can now see only their own submitted ideas and feedback.',
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Visibility Error',
        message: err instanceof Error ? err.message : 'Unable to update Shared Idea Visibility.',
      });
    }
  }

  async function handleToggleHighlight(idea: ProjectIdea) {
    if (!isAdmin || busyActionId) return;
    const nextHighlighted = !idea.isHighlighted;
    setBusyActionId(idea.id);
    try {
      await toggleHighlight(idea.id, nextHighlighted);
      onNotify?.({
        tone: 'info',
        tag: nextHighlighted ? 'Highlighted' : 'Unhighlighted',
        message: nextHighlighted
          ? `Featured "${idea.title}" at the top of the board.`
          : `Removed highlight from "${idea.title}".`,
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Moderation Error',
        message: err instanceof Error ? err.message : 'Unable to update highlight state.',
      });
    } finally {
      setBusyActionId(null);
    }
  }

  async function handleChangeReviewStatus(idea: ProjectIdea, nextStatus: ProjectIdeaReviewStatus) {
    if (!isAdmin || busyActionId || idea.reviewStatus === nextStatus) return;
    setBusyActionId(idea.id);
    try {
      await updateReviewStatus(idea.id, nextStatus);
      onNotify?.({
        tone: 'success',
        tag: 'Status Updated',
        message: `Marked "${idea.title}" as ${PROJECT_IDEA_STATUS_LABELS[nextStatus]}.`,
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Moderation Error',
        message: err instanceof Error ? err.message : 'Unable to update review status.',
      });
    } finally {
      setBusyActionId(null);
    }
  }

  async function handleSaveAdminFeedback() {
    if (!isAdmin || !selectedIdea || isSavingFeedback) return;
    setIsSavingFeedback(true);
    try {
      await saveAdminFeedback(selectedIdea.id, feedbackDraft);
      onNotify?.({
        tone: 'success',
        tag: 'Feedback Saved',
        message: feedbackDraft.trim()
          ? `Sent personal feedback for "${selectedIdea.title}".`
          : `Cleared personal feedback for "${selectedIdea.title}".`,
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: 'Moderation Error',
        message: err instanceof Error ? err.message : 'Unable to save personal feedback.',
      });
    } finally {
      setIsSavingFeedback(false);
    }
  }

  const activePendingDeleteIdea =
    pendingDeleteIdea &&
    canUserDeleteContent({
      isAdmin,
      userId,
      authorUserId: pendingDeleteIdea.submittedByUserId,
      mode: contentDeletionMode,
    }) &&
    ideas.some((item) => item.id === pendingDeleteIdea.id)
      ? pendingDeleteIdea
      : null;

  const canDeleteSelectedIdea = selectedIdea
    ? canUserDeleteContent({
        isAdmin,
        userId,
        authorUserId: selectedIdea.submittedByUserId,
        mode: contentDeletionMode,
      })
    : false;

  async function handleConfirmDelete() {
    if (!activePendingDeleteIdea || busyActionId) return;
    const target = activePendingDeleteIdea;
    if (
      !canUserDeleteContent({
        isAdmin,
        userId,
        authorUserId: target.submittedByUserId,
        mode: contentDeletionMode,
      })
    ) {
      setPendingDeleteIdea(null);
      onNotify?.({
        tone: 'error',
        tag: 'Deletion Disabled',
        message: 'You do not have permission to delete this idea under the active policy.',
      });
      return;
    }
    setBusyActionId(target.id);
    try {
      await removeIdea(target.id);
      if (selectedIdeaId === target.id) {
        setSelectedIdeaId(null);
      }
      setPendingDeleteIdea(null);
      onNotify?.({
        tone: 'warning',
        tag: 'Idea Deleted',
        message: `Removed "${target.title}" from the Project Ideas board.`,
      });
    } catch (err) {
      onNotify?.({
        tone: 'error',
        tag: isAdmin ? 'Moderation Error' : 'Delete Error',
        message: err instanceof Error ? err.message : 'Unable to delete project idea.',
      });
    } finally {
      setBusyActionId(null);
    }
  }

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, ideaId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelectedIdeaId(ideaId);
    }
  }

  return (
    <div className="ideas-workspace ideas-standalone" data-tutorial-target="project-ideas-board">
      <section className="lounge-welcome-banner ideas-hero-banner" aria-label="Project Ideas overview">
        <div className="lounge-welcome-copy">
          <div className="lounge-welcome-kicker">
            <PixelIdeaIcon width={13} height={13} />
            <span>Community Builds &amp; Proposals</span>
            {userId && (
              <>
                <span className="lounge-welcome-dot" aria-hidden="true">
                  ·
                </span>
                <span>
                  {ideas.length} {ideas.length === 1 ? 'idea' : 'ideas'}
                  {highlightedCount > 0 ? ` · ${highlightedCount} featured` : ''}
                </span>
              </>
            )}
          </div>
          <h2 className="lounge-welcome-heading">Project Ideas Board</h2>
          <p className="lounge-welcome-subtitle">
            Got a cool robot, app, workshop, or club event in mind? Pitch it here and track feedback from leads.
          </p>
        </div>

        <div className="lounge-welcome-actions">
          {isAdmin ? (
            <button
              type="button"
              className={`lounge-pitch-shortcut ${sharedIdeaVisibility ? 'is-shared' : ''}`}
              disabled={isUpdatingSharedVisibility}
              onClick={() => void handleToggleSharedVisibility()}
            >
              {sharedIdeaVisibility ? (
                <PixelEyeIcon width={13} height={13} />
              ) : (
                <PixelEyeOffIcon width={13} height={13} />
              )}
              <span>
                {isUpdatingSharedVisibility
                  ? 'Updating...'
                  : sharedIdeaVisibility
                    ? 'Shared Visibility: ON'
                    : 'Private (Author Only)'}
              </span>
            </button>
          ) : !userId ? (
            <button type="button" className="lounge-pitch-shortcut" onClick={onOpenCloudSync}>
              <PixelUserIcon width={13} height={13} />
              <span>Sign In to Pitch</span>
            </button>
          ) : (
            <span className="lounge-next-meetup-pill is-static">
              <span>
                {sharedIdeaVisibility
                  ? `Shared club board · ${myIdeasCount} yours`
                  : 'Private to you & club leads'}
              </span>
            </span>
          )}
        </div>
      </section>

      <div className="ideas-standalone-stack">
        <div className="ideas-column">
          {!userId ? (
            <section className="tracker-panel ideas-signin-gate" aria-label="Member login required for Project Ideas">
              <div className="tracker-panel-header">
                <div className="panel-title-group">
                  <PixelIdeaIcon />
                  <h2 className="panel-title">Project Ideas</h2>
                  <span className="ideas-scope-pill is-private">
                    <PixelLockIcon width={11} height={11} />
                    <span>Member Login Required</span>
                  </span>
                </div>
              </div>
              <div className="tracker-body">
                <div className="reserved-empty-state">
                  <div className="empty-badge">
                    <PixelLockIcon />
                    <span>Profile-Linked Proposals</span>
                  </div>
                  <h3 className="empty-title">Sign in to pitch &amp; track your project ideas</h3>
                  <p className="empty-description">
                    Club announcements and casual chat are always open in the Student Lounge.
                    Project idea submissions are linked to each member&apos;s club account so
                    personal proposals and admin feedback stay private.
                  </p>
                  <button type="button" className="btn-primary" onClick={onOpenCloudSync}>
                    <PixelUserIcon />
                    <span>Sign In with Club Account</span>
                  </button>
                </div>
              </div>
            </section>
          ) : (
            <>
              <section
                className="tracker-panel ideas-composer-panel"
                aria-label="Submit a project idea"
              >
                <div className="tracker-panel-header">
                  <div className="panel-title-group">
                    <PixelIdeaIcon />
                    <h2 className="panel-title">Pitch an Idea</h2>
                    <span className="ideas-scope-pill is-profile">
                      <PixelUserIcon width={11} height={11} />
                      <span>{profileAuthorName}</span>
                    </span>
                  </div>
                  {linkedMember?.className && (
                    <span className="member-class-pill">{linkedMember.className}</span>
                  )}
                </div>

                <form
                  className="ideas-composer-form"
                  onSubmit={(e) => void handleSubmit(e)}
                  noValidate
                >
                  <p className="ideas-composer-subtitle">
                    Submitting directly under your profile{' '}
                    <strong>{profileAuthorName}</strong>
                    {userEmail ? ` (${userEmail})` : ''}.{' '}
                    {isAdmin || sharedIdeaVisibility
                      ? 'Shared club browsing is enabled, while admin feedback remains private to you.'
                      : 'Your proposal and admin feedback stay private between you and club admins.'}
                  </p>

                  <div className="ideas-composer-row">
                    <div className="form-field ideas-composer-title-field">
                      <label htmlFor={titleInputId}>
                        Project Idea Title <span className="required-mark">*</span>
                      </label>
                      <input
                        ref={titleInputRef}
                        id={titleInputId}
                        type="text"
                        className="form-control"
                        placeholder="e.g. Autonomous Line-Following Rover"
                        maxLength={120}
                        value={title}
                        onChange={(event) => {
                          setTitle(event.target.value);
                          if (formError) setFormError('');
                          if (submitSuccessMessage) setSubmitSuccessMessage('');
                        }}
                        disabled={isSubmitting}
                        required
                      />
                    </div>

                    <div className="form-field ideas-composer-cat-field">
                      <label htmlFor={categorySelectId}>Category</label>
                      <select
                        id={categorySelectId}
                        className="form-control"
                        value={category}
                        onChange={(event) => setCategory(event.target.value)}
                        disabled={isSubmitting}
                      >
                        {PROJECT_IDEA_CATEGORIES.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="form-field">
                    <div className="ideas-field-label-row">
                      <label htmlFor={descriptionInputId}>
                        Description <span className="required-mark">*</span>
                      </label>
                      <span className="ideas-char-counter">{description.length} / 2000</span>
                    </div>
                    <textarea
                      ref={descriptionInputRef}
                      id={descriptionInputId}
                      className="form-control ideas-textarea"
                      rows={3}
                      maxLength={2000}
                      placeholder="Describe the build, workshop, tools or skills needed, and why Team SPIRIT should run it..."
                      value={description}
                      onChange={(event) => {
                        setDescription(event.target.value);
                        if (formError) setFormError('');
                        if (submitSuccessMessage) setSubmitSuccessMessage('');
                      }}
                      disabled={isSubmitting}
                      required
                    />
                  </div>

                  {formError && (
                    <div className="modal-error" role="alert">
                      {formError}
                    </div>
                  )}

                  {submitSuccessMessage && (
                    <div className="settings-backup-notice is-success" role="status">
                      <PixelCheckIcon width={13} height={13} />
                      <span>{submitSuccessMessage}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn-primary ideas-submit-btn"
                    disabled={isSubmitting || cooldownRemainingSec > 0}
                  >
                    <PixelPlusIcon />
                    <span>
                      {isSubmitting
                        ? 'Submitting...'
                        : cooldownRemainingSec > 0
                          ? `Submitted (wait ${cooldownRemainingSec}s)`
                          : 'Submit Project Idea'}
                    </span>
                  </button>
                </form>
              </section>

              <section
                className="tracker-panel ideas-board-panel"
                aria-label="Submitted project ideas"
              >
                <div className="tracker-panel-header">
                  <div className="panel-title-group">
                    <h2 className="panel-title">
                      {isAdmin || sharedIdeaVisibility ? 'Project Ideas Board' : 'My Project Ideas'}
                    </h2>
                    <span className="panel-count">
                      {hasActiveFilters ? `${filteredIdeas.length} / ${ideas.length}` : ideas.length}
                    </span>
                    <span
                      className={`ideas-live-badge ${isLiveConnected ? 'is-live' : ''}`}
                      title={
                        isLiveConnected
                          ? 'Connected live to Supabase Project Ideas board'
                          : 'Connected to Supabase REST'
                      }
                    >
                      <span className="sync-status-dot" aria-hidden="true" />
                      <span>{isLiveConnected ? 'Live' : 'Sync'}</span>
                    </span>
                  </div>

                  <div className="panel-header-actions">
                    {isAdmin && (
                      <button
                        type="button"
                        className={`btn-secondary btn-compact shared-visibility-toggle ${
                          sharedIdeaVisibility ? 'is-shared' : ''
                        }`}
                        disabled={isUpdatingSharedVisibility}
                        onClick={() => void handleToggleSharedVisibility()}
                        title={
                          sharedIdeaVisibility
                            ? 'Shared Idea Visibility is ON — members see all ideas (feedback stays private). Click to restrict to private self-only view.'
                            : 'Shared Idea Visibility is OFF — members see only their own ideas. Click to share ideas across all members.'
                        }
                      >
                        {sharedIdeaVisibility ? (
                          <PixelEyeIcon width={12} height={12} />
                        ) : (
                          <PixelEyeOffIcon width={12} height={12} />
                        )}
                        <span>
                          {isUpdatingSharedVisibility
                            ? 'Updating...'
                            : sharedIdeaVisibility
                              ? 'Shared Ideas: ON'
                              : 'Shared Ideas: OFF'}
                        </span>
                      </button>
                    )}

                    <div className="view-toggle" role="group" aria-label="Sort project ideas">
                      <button
                        type="button"
                        className={`view-btn ${sortMode === 'featured_newest' ? 'is-active' : ''}`}
                        onClick={() => setSortMode('featured_newest')}
                        title="Show highlighted picks first"
                      >
                        <PixelStarIcon width={12} height={12} />
                        <span>Featured</span>
                      </button>
                      <button
                        type="button"
                        className={`view-btn ${sortMode === 'newest' ? 'is-active' : ''}`}
                        onClick={() => setSortMode('newest')}
                        title="Sort strictly newest first"
                      >
                        <span>Newest</span>
                      </button>
                    </div>

                    <div className="view-toggle" role="group" aria-label="Project ideas layout">
                      <button
                        type="button"
                        className={`view-btn ${viewMode === 'grid' ? 'is-active' : ''}`}
                        onClick={() => setViewMode('grid')}
                      >
                        <PixelGridIcon />
                        <span>Cards</span>
                      </button>
                      <button
                        type="button"
                        className={`view-btn ${viewMode === 'list' ? 'is-active' : ''}`}
                        onClick={() => setViewMode('list')}
                      >
                        <PixelListIcon />
                        <span>List</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      className="btn-secondary btn-compact"
                      onClick={() => void refreshIdeas()}
                      disabled={isLoading}
                      title="Refresh ideas from Supabase"
                    >
                      <PixelRefreshIcon />
                      <span>Refresh</span>
                    </button>
                  </div>
                </div>

                <div className="session-hub-toolbar ideas-toolbar">
                  <div className="session-hub-search-wrap">
                    <span className="session-suggest-icon" aria-hidden="true">
                      <PixelSearchIcon />
                    </span>
                    <input
                      ref={searchInputRef}
                      type="text"
                      className="form-control session-hub-search-input"
                      placeholder="Search ideas by title, author, feedback, or status..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Search submitted project ideas"
                    />
                    {searchQuery.length > 0 && (
                      <button
                        type="button"
                        className="session-suggest-clear"
                        onClick={() => {
                          setSearchQuery('');
                          searchInputRef.current?.focus();
                        }}
                        aria-label="Clear search"
                      >
                        <PixelCloseIcon width={11} height={11} />
                      </button>
                    )}
                  </div>

                  <div className="ideas-filter-row">
                    {(isAdmin || sharedIdeaVisibility) && (
                      <div className="filter-pills" role="tablist" aria-label="Filter by ownership">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={effectiveOwnershipFilter === 'all'}
                          className={`filter-pill ${
                            effectiveOwnershipFilter === 'all' ? 'is-active' : ''
                          }`}
                          onClick={() => setOwnershipFilter('all')}
                        >
                          All Club ({ideas.length})
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={effectiveOwnershipFilter === 'mine'}
                          className={`filter-pill ${
                            effectiveOwnershipFilter === 'mine' ? 'is-active' : ''
                          }`}
                          onClick={() => setOwnershipFilter('mine')}
                        >
                          Mine ({myIdeasCount})
                        </button>
                      </div>
                    )}

                    <div
                      className="filter-pills"
                      role="tablist"
                      aria-label="Filter by highlight status"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={highlightFilter === 'all'}
                        className={`filter-pill ${highlightFilter === 'all' ? 'is-active' : ''}`}
                        onClick={() => setHighlightFilter('all')}
                      >
                        All Statuses
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={highlightFilter === 'highlighted'}
                        className={`filter-pill ${
                          highlightFilter === 'highlighted' ? 'is-active' : ''
                        }`}
                        onClick={() => setHighlightFilter('highlighted')}
                      >
                        Featured ({highlightedCount})
                      </button>
                    </div>

                    <select
                      className="form-control ideas-status-select"
                      value={statusFilter}
                      onChange={(event) =>
                        setStatusFilter(event.target.value as 'all' | ProjectIdeaReviewStatus)
                      }
                      aria-label="Filter by review status"
                    >
                      <option value="all">All Review States</option>
                      {ALL_REVIEW_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {PROJECT_IDEA_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>

                    {distinctCategories.length > 0 && (
                      <div className="filter-pills" role="tablist" aria-label="Filter by category">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={activeCategoryFilter === 'all'}
                          className={`filter-pill ${
                            activeCategoryFilter === 'all' ? 'is-active' : ''
                          }`}
                          onClick={() => setCategoryFilter('all')}
                        >
                          All Categories
                        </button>
                        {distinctCategories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            role="tab"
                            aria-selected={activeCategoryFilter === cat}
                            className={`filter-pill ${
                              activeCategoryFilter === cat ? 'is-active' : ''
                            }`}
                            onClick={() => setCategoryFilter(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="tracker-body ideas-board-body">
                  {error ? (
                    <div className="reserved-empty-state">
                      <div className="empty-badge">
                        <PixelAlertIcon />
                        <span>Board Connection Issue</span>
                      </div>
                      <h3 className="empty-title">Unable to reach Project Ideas</h3>
                      <p className="empty-description">{error}</p>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() => void refreshIdeas()}
                      >
                        <PixelRefreshIcon />
                        <span>Retry Connection</span>
                      </button>
                    </div>
                  ) : isLoading && ideas.length === 0 ? (
                    <div className="reserved-empty-state">
                      <div className="empty-badge">
                        <PixelTerminalIcon />
                        <span>Loading Proposals</span>
                      </div>
                      <h3 className="empty-title">Fetching Project Ideas from Supabase...</h3>
                    </div>
                  ) : ideas.length === 0 ? (
                    <div className="reserved-empty-state">
                      <div className="empty-badge">
                        <PixelIdeaIcon />
                        <span>No Proposals Yet</span>
                      </div>
                      <h3 className="empty-title">
                        {isAdmin || sharedIdeaVisibility
                          ? 'No project ideas pitched yet'
                          : 'You have not pitched an idea yet'}
                      </h3>
                      <p className="empty-description">
                        Use the &ldquo;Pitch an Idea&rdquo; form above to submit a project under{' '}
                        <strong>{profileAuthorName}</strong>.
                      </p>
                    </div>
                  ) : filteredIdeas.length === 0 ? (
                    <div className="reserved-empty-state">
                      <div className="empty-badge">
                        <PixelTerminalIcon />
                        <span>No Matches</span>
                      </div>
                      <h3 className="empty-title">No project ideas match your filters</h3>
                      <p className="empty-description">
                        Try another search keyword or reset your filters to inspect all{' '}
                        {ideas.length} visible {ideas.length === 1 ? 'proposal' : 'proposals'}.
                      </p>
                      <button type="button" className="btn-secondary" onClick={handleClearFilters}>
                        Clear Filters
                      </button>
                    </div>
                  ) : viewMode === 'grid' ? (
                    <div className="ideas-cards-grid" role="list" aria-label="Project ideas list">
                      {filteredIdeas.map((idea) => {
                        const isBusy = Boolean(busyActionId);
                        const isMine = Boolean(userId && idea.submittedByUserId === userId);
                        const canDeleteIdea = canUserDeleteContent({
                          isAdmin,
                          userId,
                          authorUserId: idea.submittedByUserId,
                          mode: contentDeletionMode,
                        });
                        return (
                          <article
                            key={idea.id}
                            role="listitem"
                            className={`idea-card ${idea.isHighlighted ? 'is-highlighted' : ''}`}
                          >
                            <div
                              className="idea-card-surface"
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedIdeaId(idea.id)}
                              onKeyDown={(event) => handleCardKeyDown(event, idea.id)}
                              aria-label={`View full project idea: ${idea.title} by ${idea.authorName}`}
                            >
                              <div className="idea-card-head">
                                <div className="idea-badges-row">
                                  {idea.isHighlighted && (
                                    <span className="idea-featured-badge">
                                      <PixelStarIcon width={11} height={11} />
                                      <span>Featured</span>
                                    </span>
                                  )}
                                  <span
                                    className={`idea-status-badge ${
                                      IDEA_STATUS_ACCENTS[idea.reviewStatus]
                                    }`}
                                  >
                                    {PROJECT_IDEA_STATUS_LABELS[idea.reviewStatus]}
                                  </span>
                                  {idea.category && (
                                    <span className="session-type-tag">{idea.category}</span>
                                  )}
                                  {isMine && <span className="admin-self-tag">Yours</span>}
                                </div>

                                {(isAdmin || canDeleteIdea) && (
                                  <div
                                    className="idea-admin-actions"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => event.stopPropagation()}
                                  >
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        className={`icon-btn idea-highlight-btn ${
                                          idea.isHighlighted ? 'is-active' : ''
                                        }`}
                                        disabled={isBusy}
                                        onClick={() => void handleToggleHighlight(idea)}
                                        aria-label={
                                          idea.isHighlighted
                                            ? `Remove highlight from ${idea.title}`
                                            : `Highlight ${idea.title}`
                                        }
                                        title={
                                          idea.isHighlighted
                                            ? 'Remove highlight'
                                            : 'Highlight / feature idea'
                                        }
                                      >
                                        <PixelStarIcon width={12} height={12} />
                                      </button>
                                    )}
                                    {canDeleteIdea && (
                                      <button
                                        type="button"
                                        className="icon-btn icon-btn-danger"
                                        disabled={isBusy}
                                        onClick={() => setPendingDeleteIdea(idea)}
                                        aria-label={`Delete idea ${idea.title}`}
                                        title={
                                          isAdmin
                                            ? 'Delete idea (Admin)'
                                            : isMine
                                              ? 'Delete your idea'
                                              : 'Delete idea'
                                        }
                                      >
                                        <PixelTrashIcon width={12} height={12} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>

                              <h3 className="idea-card-title">{idea.title}</h3>
                              <p className="idea-card-desc">{idea.description}</p>

                              {idea.adminFeedback && (
                                <div className="idea-admin-note-chip">
                                  <PixelEditIcon width={11} height={11} />
                                  <span>
                                    <strong>Feedback:</strong> {idea.adminFeedback.feedbackText}
                                  </span>
                                </div>
                              )}

                              <div className="idea-card-footer">
                                <span className="idea-author-chip">
                                  <PixelUserIcon width={11} height={11} />
                                  <span>{idea.authorName}</span>
                                </span>
                                <span className="idea-date-meta mono-cell">
                                  {formatTimestamp(idea.createdAt)}
                                </span>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="ideas-list-stack" role="list" aria-label="Project ideas list">
                      {filteredIdeas.map((idea) => {
                        const isBusy = Boolean(busyActionId);
                        const isMine = Boolean(userId && idea.submittedByUserId === userId);
                        const canDeleteIdea = canUserDeleteContent({
                          isAdmin,
                          userId,
                          authorUserId: idea.submittedByUserId,
                          mode: contentDeletionMode,
                        });
                        return (
                          <article
                            key={idea.id}
                            role="listitem"
                            className={`idea-list-row ${idea.isHighlighted ? 'is-highlighted' : ''}`}
                          >
                            <div
                              className="idea-list-surface"
                              role="button"
                              tabIndex={0}
                              onClick={() => setSelectedIdeaId(idea.id)}
                              onKeyDown={(event) => handleCardKeyDown(event, idea.id)}
                            >
                              <div className="idea-list-main">
                                <div className="idea-badges-row">
                                  {idea.isHighlighted && (
                                    <span className="idea-featured-badge">
                                      <PixelStarIcon width={11} height={11} />
                                      <span>Featured</span>
                                    </span>
                                  )}
                                  <span
                                    className={`idea-status-badge ${
                                      IDEA_STATUS_ACCENTS[idea.reviewStatus]
                                    }`}
                                  >
                                    {PROJECT_IDEA_STATUS_LABELS[idea.reviewStatus]}
                                  </span>
                                  {idea.category && (
                                    <span className="session-type-tag">{idea.category}</span>
                                  )}
                                  {isMine && <span className="admin-self-tag">Yours</span>}
                                  <h3 className="idea-list-title">{idea.title}</h3>
                                </div>
                                <p className="idea-list-desc">{idea.description}</p>
                                {idea.adminFeedback && (
                                  <div className="idea-admin-note-chip">
                                    <PixelEditIcon width={11} height={11} />
                                    <span>
                                      <strong>Feedback:</strong> {idea.adminFeedback.feedbackText}
                                    </span>
                                  </div>
                                )}
                              </div>

                              <div className="idea-list-meta">
                                <span className="idea-author-chip">
                                  <PixelUserIcon width={11} height={11} />
                                  <span>{idea.authorName}</span>
                                </span>
                                <span className="idea-date-meta mono-cell">
                                  {formatTimestamp(idea.createdAt)}
                                </span>
                                {(isAdmin || canDeleteIdea) && (
                                  <div
                                    className="idea-admin-actions"
                                    onClick={(event) => event.stopPropagation()}
                                    onKeyDown={(event) => event.stopPropagation()}
                                  >
                                    {isAdmin && (
                                      <button
                                        type="button"
                                        className={`icon-btn idea-highlight-btn ${
                                          idea.isHighlighted ? 'is-active' : ''
                                        }`}
                                        disabled={isBusy}
                                        onClick={() => void handleToggleHighlight(idea)}
                                        title={
                                          idea.isHighlighted ? 'Remove highlight' : 'Highlight idea'
                                        }
                                      >
                                        <PixelStarIcon width={12} height={12} />
                                      </button>
                                    )}
                                    {canDeleteIdea && (
                                      <button
                                        type="button"
                                        className="icon-btn icon-btn-danger"
                                        disabled={isBusy}
                                        onClick={() => setPendingDeleteIdea(idea)}
                                        aria-label={`Delete idea ${idea.title}`}
                                        title={
                                          isAdmin
                                            ? 'Delete idea (Admin)'
                                            : isMine
                                              ? 'Delete your idea'
                                              : 'Delete idea'
                                        }
                                      >
                                        <PixelTrashIcon width={12} height={12} />
                                      </button>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </>
          )}
        </div>
      </div>

      {selectedIdea && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isSavingFeedback) {
              setSelectedIdeaId(null);
            }
          }}
        >
          <div
            className="modal-dialog idea-detail-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={detailTitleId}
          >
            <div className="modal-header">
              <div className="modal-title-group">
                <div className="idea-badges-row">
                  {selectedIdea.isHighlighted && (
                    <span className="idea-featured-badge">
                      <PixelStarIcon width={11} height={11} />
                      <span>Featured</span>
                    </span>
                  )}
                  <span
                    className={`idea-status-badge ${
                      IDEA_STATUS_ACCENTS[selectedIdea.reviewStatus]
                    }`}
                  >
                    {PROJECT_IDEA_STATUS_LABELS[selectedIdea.reviewStatus]}
                  </span>
                  {selectedIdea.category && (
                    <span className="session-type-tag">{selectedIdea.category}</span>
                  )}
                </div>
                <h2 id={detailTitleId} className="modal-title">
                  {selectedIdea.title}
                </h2>
              </div>

              <button
                type="button"
                className="modal-close-btn"
                disabled={isSavingFeedback}
                onClick={() => setSelectedIdeaId(null)}
                aria-label="Close idea details"
                title="Close (Esc)"
              >
                <PixelCloseIcon />
              </button>
            </div>

            <div className="idea-detail-body">
              <div className="idea-detail-meta">
                <span className="idea-author-chip">
                  <PixelUserIcon width={12} height={12} />
                  <span>Proposed by {selectedIdea.authorName}</span>
                </span>
                <span className="idea-date-meta mono-cell">
                  {formatTimestamp(selectedIdea.createdAt)}
                </span>
              </div>

              <p className="idea-detail-description">{selectedIdea.description}</p>

              {selectedIdea.adminFeedback && !isAdmin && (
                <div className="idea-feedback-callout">
                  <div className="idea-feedback-callout-head">
                    <PixelEditIcon width={12} height={12} />
                    <strong>
                      Personal Admin Feedback
                      {selectedIdea.adminFeedback.responderName
                        ? ` from ${selectedIdea.adminFeedback.responderName}`
                        : ''}
                    </strong>
                    <span className="mono-meta">
                      {formatTimestamp(selectedIdea.adminFeedback.updatedAt)}
                    </span>
                  </div>
                  <p>{selectedIdea.adminFeedback.feedbackText}</p>
                </div>
              )}

              {isAdmin && (
                <div className="idea-detail-moderation">
                  <div className="idea-detail-mod-header">
                    <strong>Admin Review &amp; Personal Response</strong>
                    <div className="idea-admin-actions">
                      <select
                        className="form-control ideas-status-select"
                        value={selectedIdea.reviewStatus}
                        disabled={Boolean(busyActionId)}
                        onChange={(event) =>
                          void handleChangeReviewStatus(
                            selectedIdea,
                            event.target.value as ProjectIdeaReviewStatus,
                          )
                        }
                        aria-label="Update idea review status"
                      >
                        {ALL_REVIEW_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {PROJECT_IDEA_STATUS_LABELS[status]}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        className={`btn-secondary btn-compact idea-highlight-btn ${
                          selectedIdea.isHighlighted ? 'is-active' : ''
                        }`}
                        disabled={Boolean(busyActionId)}
                        onClick={() => void handleToggleHighlight(selectedIdea)}
                      >
                        <PixelStarIcon width={12} height={12} />
                        <span>{selectedIdea.isHighlighted ? 'Unhighlight' : 'Highlight'}</span>
                      </button>

                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        disabled={Boolean(busyActionId)}
                        onClick={() => setPendingDeleteIdea(selectedIdea)}
                      >
                        <PixelTrashIcon width={12} height={12} />
                        <span>Delete</span>
                      </button>
                    </div>
                  </div>

                  <div className="form-field">
                    <label htmlFor={feedbackInputId}>
                      Personal Feedback (Private to {selectedIdea.authorName} &amp; Admins)
                    </label>
                    <textarea
                      id={feedbackInputId}
                      className="form-control ideas-textarea"
                      rows={3}
                      maxLength={1500}
                      placeholder="Write personal review notes, next steps, or approval details visible only to the author and admins..."
                      value={feedbackDraft}
                      onChange={(event) => setFeedbackDraft(event.target.value)}
                      disabled={isSavingFeedback}
                    />
                    <div className="idea-feedback-actions-row">
                      <span className="ideas-char-counter">{feedbackDraft.length} / 1500</span>
                      <button
                        type="button"
                        className="btn-primary btn-compact"
                        disabled={
                          isSavingFeedback ||
                          feedbackDraft.trim() ===
                            (selectedIdea.adminFeedback?.feedbackText ?? '').trim()
                        }
                        onClick={() => void handleSaveAdminFeedback()}
                      >
                        <span>
                          {isSavingFeedback
                            ? 'Saving...'
                            : feedbackDraft.trim()
                              ? 'Save Feedback'
                              : 'Clear Feedback'}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div
                className={`modal-footer ${
                  !isAdmin && canDeleteSelectedIdea ? 'idea-detail-footer-with-delete' : ''
                }`}
              >
                {!isAdmin && canDeleteSelectedIdea && (
                  <button
                    type="button"
                    className="icon-btn icon-btn-danger"
                    disabled={Boolean(busyActionId)}
                    onClick={() => setPendingDeleteIdea(selectedIdea)}
                  >
                    <PixelTrashIcon width={12} height={12} />
                    <span>Delete Idea</span>
                  </button>
                )}
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={isSavingFeedback}
                  onClick={() => setSelectedIdeaId(null)}
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={activePendingDeleteIdea !== null}
        badgeLabel={isAdmin ? 'Moderate Idea' : 'Delete Idea'}
        title={
          activePendingDeleteIdea ? `Delete "${activePendingDeleteIdea.title}"?` : 'Delete idea?'
        }
        message={
          activePendingDeleteIdea
            ? `Permanently delete "${activePendingDeleteIdea.title}" submitted by ${activePendingDeleteIdea.authorName}?`
            : ''
        }
        confirmLabel="Delete Idea"
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => {
          if (!busyActionId) {
            setPendingDeleteIdea(null);
          }
        }}
      />
    </div>
  );
}
