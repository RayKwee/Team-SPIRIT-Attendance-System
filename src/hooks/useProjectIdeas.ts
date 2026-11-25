import { useCallback, useEffect, useRef, useState } from 'react';
import {
  deleteProjectIdea,
  feedbackFromDbRow,
  fetchScopedProjectIdeas,
  projectIdeaFromDbRow,
  submitProjectIdea,
  toggleProjectIdeaHighlight,
  updateProjectIdeaReviewStatus,
  upsertProjectIdeaFeedback,
  type DbProjectIdeaFeedbackRow,
  type DbProjectIdeaRow,
} from '../lib/projectIdeasApi';
import { supabase } from '../lib/supabase';
import {
  DEFAULT_CONTENT_DELETION_MODE,
  canUserDeleteContent,
  type ContentDeletionMode,
  type ProjectIdea,
  type ProjectIdeaFeedback,
  type ProjectIdeaInput,
  type ProjectIdeaReviewStatus,
} from '../types/projectIdeas';

const SUBMIT_COOLDOWN_MS = 5_000;

export interface UseProjectIdeasOptions {
  userId: string | null;
  isAdmin: boolean;
  sharedIdeaVisibility: boolean;
  contentDeletionMode?: ContentDeletionMode;
  responderName?: string;
}

export interface UseProjectIdeasResult {
  ideas: ProjectIdea[];
  isLoading: boolean;
  error: string | null;
  isLiveConnected: boolean;
  isSubmitting: boolean;
  cooldownRemainingSec: number;
  refreshIdeas: () => Promise<void>;
  submitIdea: (input: ProjectIdeaInput) => Promise<ProjectIdea>;
  toggleHighlight: (ideaId: string, nextHighlighted: boolean) => Promise<ProjectIdea>;
  updateReviewStatus: (ideaId: string, nextStatus: ProjectIdeaReviewStatus) => Promise<ProjectIdea>;
  saveAdminFeedback: (ideaId: string, feedbackText: string) => Promise<ProjectIdeaFeedback | undefined>;
  removeIdea: (ideaId: string) => Promise<void>;
}

/**
 * Connects authenticated users to Supabase `project_ideas` and `project_idea_feedback`
 * with server-enforced ownership, Shared Idea Visibility scoping, and live Realtime sync.
 */
export function useProjectIdeas({
  userId,
  isAdmin,
  sharedIdeaVisibility,
  contentDeletionMode = DEFAULT_CONTENT_DELETION_MODE,
  responderName = 'Club Admin',
}: UseProjectIdeasOptions): UseProjectIdeasResult {
  const [ideas, setIdeas] = useState<ProjectIdea[]>([]);
  const [isLoading, setIsLoading] = useState(Boolean(userId));
  const [error, setError] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [cooldownUntilMs, setCooldownUntilMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const mountedRef = useRef(true);
  const ideasRef = useRef<ProjectIdea[]>(ideas);
  ideasRef.current = ideas;
  const activeUserIdRef = useRef<string | null>(userId);
  activeUserIdRef.current = userId;
  const prevUserIdRef = useRef<string | null>(userId);
  const requestSeqRef = useRef(0);

  const loadIdeas = useCallback(async () => {
    const targetUserId = activeUserIdRef.current;
    const reqId = ++requestSeqRef.current;
    const isCurrentRequest = () =>
      mountedRef.current &&
      activeUserIdRef.current === targetUserId &&
      requestSeqRef.current === reqId;

    if (!targetUserId) {
      setIdeas([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const list = await fetchScopedProjectIdeas();
      if (!isCurrentRequest()) return;
      setIdeas(list);
    } catch (err) {
      if (!isCurrentRequest()) return;
      setError(err instanceof Error ? err.message : 'Unable to load Project Ideas.');
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    requestSeqRef.current += 1;

    const userChanged = prevUserIdRef.current !== userId;
    prevUserIdRef.current = userId;

    if (!userId) {
      setIdeas([]);
      setError(null);
      setIsLoading(false);
      setIsLiveConnected(false);
      return () => {
        mountedRef.current = false;
      };
    }

    if (userChanged) {
      setIdeas([]);
      setError(null);
    } else if (!isAdmin && !sharedIdeaVisibility) {
      // Immediately prune peer ideas when shared visibility is restricted for standard members.
      setIdeas((prev) => prev.filter((item) => item.submittedByUserId === userId));
    }

    void loadIdeas();

    const channel = supabase
      .channel(`team-spirit-project-ideas:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_ideas' },
        (payload) => {
          if (!mountedRef.current || activeUserIdRef.current !== userId) return;

          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (!oldId) return;
            setIdeas((prev) => prev.filter((item) => item.id !== oldId));
            return;
          }

          if (!payload.new) return;
          const row = payload.new as DbProjectIdeaRow;
          setIdeas((prev) => {
            const existing = prev.find((item) => item.id === row.id);
            const merged = projectIdeaFromDbRow(row, existing?.adminFeedback);
            if (existing) {
              return prev.map((item) => (item.id === merged.id ? merged : item));
            }
            return [merged, ...prev];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'project_idea_feedback' },
        (payload) => {
          if (!mountedRef.current || activeUserIdRef.current !== userId) return;

          if (payload.eventType === 'DELETE') {
            const oldIdeaId = (payload.old as { idea_id?: string } | null)?.idea_id;
            if (!oldIdeaId) return;
            setIdeas((prev) =>
              prev.map((item) =>
                item.id === oldIdeaId ? { ...item, adminFeedback: undefined } : item,
              ),
            );
            return;
          }

          if (!payload.new) return;
          const feedback = feedbackFromDbRow(payload.new as DbProjectIdeaFeedbackRow);
          setIdeas((prev) =>
            prev.map((item) =>
              item.id === feedback.ideaId ? { ...item, adminFeedback: feedback } : item,
            ),
          );
        },
      )
      .subscribe((status) => {
        if (!mountedRef.current) return;
        setIsLiveConnected(status === 'SUBSCRIBED');
      });

    function handleOnline() {
      void loadIdeas();
    }

    window.addEventListener('online', handleOnline);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
    };
  }, [isAdmin, loadIdeas, sharedIdeaVisibility, userId]);

  useEffect(() => {
    if (cooldownUntilMs <= Date.now()) return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      if (current >= cooldownUntilMs) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => window.clearInterval(timer);
  }, [cooldownUntilMs]);

  const cooldownRemainingSec =
    cooldownUntilMs > nowMs ? Math.ceil((cooldownUntilMs - nowMs) / 1000) : 0;

  const submitIdea = useCallback(
    async (input: ProjectIdeaInput): Promise<ProjectIdea> => {
      if (!userId) {
        throw new Error('Sign in with your club account to submit a project idea.');
      }
      if (isSubmitting) {
        throw new Error('Submission already in progress.');
      }
      if (cooldownUntilMs > Date.now()) {
        const waitSec = Math.ceil((cooldownUntilMs - Date.now()) / 1000);
        throw new Error(`Please wait ${waitSec}s before submitting another proposal.`);
      }

      setIsSubmitting(true);
      try {
        const created = await submitProjectIdea(input);
        if (mountedRef.current) {
          setIdeas((prev) => {
            if (prev.some((item) => item.id === created.id)) return prev;
            return [created, ...prev];
          });
          setCooldownUntilMs(Date.now() + SUBMIT_COOLDOWN_MS);
          setNowMs(Date.now());
        }
        return created;
      } finally {
        if (mountedRef.current) {
          setIsSubmitting(false);
        }
      }
    },
    [cooldownUntilMs, isSubmitting, userId],
  );

  const toggleHighlight = useCallback(
    async (ideaId: string, nextHighlighted: boolean): Promise<ProjectIdea> => {
      const updated = await toggleProjectIdeaHighlight(ideaId, nextHighlighted);
      if (mountedRef.current) {
        setIdeas((prev) =>
          prev.map((item) =>
            item.id === updated.id
              ? { ...updated, adminFeedback: item.adminFeedback }
              : item,
          ),
        );
      }
      return updated;
    },
    [],
  );

  const updateReviewStatus = useCallback(
    async (ideaId: string, nextStatus: ProjectIdeaReviewStatus): Promise<ProjectIdea> => {
      const updated = await updateProjectIdeaReviewStatus(ideaId, nextStatus);
      if (mountedRef.current) {
        setIdeas((prev) =>
          prev.map((item) =>
            item.id === updated.id
              ? { ...updated, adminFeedback: item.adminFeedback }
              : item,
          ),
        );
      }
      return updated;
    },
    [],
  );

  const saveAdminFeedback = useCallback(
    async (ideaId: string, feedbackText: string): Promise<ProjectIdeaFeedback | undefined> => {
      const saved = await upsertProjectIdeaFeedback(ideaId, feedbackText, userId, responderName);
      if (mountedRef.current) {
        setIdeas((prev) =>
          prev.map((item) => (item.id === ideaId ? { ...item, adminFeedback: saved } : item)),
        );
      }
      return saved;
    },
    [responderName, userId],
  );

  const removeIdea = useCallback(
    async (ideaId: string): Promise<void> => {
      const target = ideasRef.current.find((item) => item.id === ideaId);
      if (
        !canUserDeleteContent({
          isAdmin,
          userId,
          authorUserId: target?.submittedByUserId,
          mode: contentDeletionMode,
        })
      ) {
        throw new Error('You do not have permission to delete this project idea under the current policy.');
      }

      await deleteProjectIdea(ideaId);
      if (mountedRef.current) {
        setIdeas((prev) => prev.filter((item) => item.id !== ideaId));
      }
    },
    [contentDeletionMode, isAdmin, userId],
  );

  return {
    ideas,
    isLoading,
    error,
    isLiveConnected,
    isSubmitting,
    cooldownRemainingSec,
    refreshIdeas: loadIdeas,
    submitIdea,
    toggleHighlight,
    updateReviewStatus,
    saveAdminFeedback,
    removeIdea,
  };
}
