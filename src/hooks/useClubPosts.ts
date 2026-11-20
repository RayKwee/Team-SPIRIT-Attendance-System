import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DEFAULT_MEMBER_VISIBILITY_PERMISSIONS,
  clubPostCommentFromDbRow,
  clubPostFromDbRow,
  clubSettingsFromDbRow,
  createClubPost,
  createClubPostComment,
  deleteClubPost,
  deleteClubPostComment,
  fetchClubPostComments,
  fetchClubPosts,
  fetchClubSettings,
  toggleClubPostPin,
  updateClubPost,
  updateMemberVisibilityPermissions,
  updateSharedIdeaVisibility,
  type DbClubPostCommentRow,
  type DbClubPostRow,
  type DbClubSettingsRow,
} from '../lib/clubPostsApi';
import { supabase } from '../lib/supabase';
import type {
  ClubPost,
  ClubPostComment,
  ClubPostCommentInput,
  ClubPostInput,
  MemberVisibilityPermissions,
} from '../types/projectIdeas';

export interface UseClubPostsResult {
  posts: ClubPost[];
  comments: ClubPostComment[];
  permissions: MemberVisibilityPermissions;
  sharedIdeaVisibility: boolean;
  isPostsLoading: boolean;
  postsError: string | null;
  isLiveConnected: boolean;
  isPublishing: boolean;
  isUpdatingVisibility: boolean;
  refreshPostsAndSettings: () => Promise<void>;
  publishPost: (input: ClubPostInput) => Promise<ClubPost>;
  editPost: (postId: string, input: ClubPostInput) => Promise<ClubPost>;
  togglePinPost: (postId: string, nextPinned: boolean) => Promise<ClubPost>;
  removePost: (postId: string) => Promise<void>;
  addComment: (input: ClubPostCommentInput) => Promise<ClubPostComment>;
  removeComment: (commentId: string) => Promise<void>;
  setSharedIdeaVisibility: (allowShared: boolean) => Promise<boolean>;
  updatePermissions: (
    patch: Partial<MemberVisibilityPermissions>,
  ) => Promise<MemberVisibilityPermissions>;
}

function pruneCommentSubtree(comments: ClubPostComment[], rootId: string): ClubPostComment[] {
  const removedIds = new Set<string>([rootId]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const item of comments) {
      if (item.parentCommentId && removedIds.has(item.parentCommentId) && !removedIds.has(item.id)) {
        removedIds.add(item.id);
        expanded = true;
      }
    }
  }
  return comments.filter((item) => !removedIds.has(item.id));
}

/**
 * Subscribes to public admin announcements (`club_posts`), thread comments (`club_post_comments`),
 * and global Member Visibility Permissions (`club_settings`) with live Realtime sync.
 */
export function useClubPosts(): UseClubPostsResult {
  const [posts, setPosts] = useState<ClubPost[]>([]);
  const [comments, setComments] = useState<ClubPostComment[]>([]);
  const [permissions, setPermissions] = useState<MemberVisibilityPermissions>(
    DEFAULT_MEMBER_VISIBILITY_PERMISSIONS,
  );
  const [isPostsLoading, setIsPostsLoading] = useState(true);
  const [postsError, setPostsError] = useState<string | null>(null);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isUpdatingVisibility, setIsUpdatingVisibility] = useState(false);

  const mountedRef = useRef(true);
  const permissionsRef = useRef<MemberVisibilityPermissions>(permissions);
  permissionsRef.current = permissions;

  const loadAll = useCallback(async () => {
    setIsPostsLoading(true);
    setPostsError(null);
    try {
      const [postList, commentList, settings] = await Promise.all([
        fetchClubPosts(),
        fetchClubPostComments(),
        fetchClubSettings(),
      ]);
      if (!mountedRef.current) return;
      setPosts(postList);
      setComments(commentList);
      setPermissions({
        memberCanViewRoster: settings.memberCanViewRoster,
        memberCanViewAttendanceRates: settings.memberCanViewAttendanceRates,
        memberCanViewCalendarDetails: settings.memberCanViewCalendarDetails,
        sharedIdeaVisibility: settings.sharedIdeaVisibility,
        memberCanCommentOnPosts: settings.memberCanCommentOnPosts,
      });
    } catch (err) {
      if (!mountedRef.current) return;
      setPostsError(err instanceof Error ? err.message : 'Unable to load Posts & Updates.');
    } finally {
      if (mountedRef.current) {
        setIsPostsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void loadAll();

    const channel = supabase
      .channel('team-spirit-club-posts-and-settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'club_posts' },
        (payload) => {
          if (!mountedRef.current) return;

          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (!oldId) return;
            setPosts((prev) => prev.filter((item) => item.id !== oldId));
            setComments((prev) => prev.filter((item) => item.postId !== oldId));
            return;
          }

          if (!payload.new) return;
          const incoming = clubPostFromDbRow(payload.new as DbClubPostRow);
          setPosts((prev) => {
            const exists = prev.some((item) => item.id === incoming.id);
            if (exists) {
              return prev.map((item) => (item.id === incoming.id ? incoming : item));
            }
            return [incoming, ...prev];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'club_post_comments' },
        (payload) => {
          if (!mountedRef.current) return;

          if (payload.eventType === 'DELETE') {
            const oldId = (payload.old as { id?: string } | null)?.id;
            if (!oldId) return;
            setComments((prev) => pruneCommentSubtree(prev, oldId));
            return;
          }

          if (!payload.new) return;
          const incoming = clubPostCommentFromDbRow(payload.new as DbClubPostCommentRow);
          setComments((prev) => {
            const exists = prev.some((item) => item.id === incoming.id);
            if (exists) {
              return prev.map((item) => (item.id === incoming.id ? incoming : item));
            }
            return [...prev, incoming];
          });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'club_settings' },
        (payload) => {
          if (!mountedRef.current || !payload.new) return;
          const next = clubSettingsFromDbRow(payload.new as DbClubSettingsRow);
          setPermissions({
            memberCanViewRoster: next.memberCanViewRoster,
            memberCanViewAttendanceRates: next.memberCanViewAttendanceRates,
            memberCanViewCalendarDetails: next.memberCanViewCalendarDetails,
            sharedIdeaVisibility: next.sharedIdeaVisibility,
            memberCanCommentOnPosts: next.memberCanCommentOnPosts,
          });
        },
      )
      .subscribe((status) => {
        if (!mountedRef.current) return;
        setIsLiveConnected(status === 'SUBSCRIBED');
      });

    function handleOnline() {
      void loadAll();
    }

    window.addEventListener('online', handleOnline);

    return () => {
      mountedRef.current = false;
      window.removeEventListener('online', handleOnline);
      void Promise.resolve(supabase.removeChannel(channel)).catch(() => {});
    };
  }, [loadAll]);

  const publishPost = useCallback(
    async (input: ClubPostInput): Promise<ClubPost> => {
      if (isPublishing) {
        throw new Error('Publishing already in progress.');
      }
      setIsPublishing(true);
      try {
        const created = await createClubPost(input);
        if (mountedRef.current) {
          setPosts((prev) => {
            if (prev.some((item) => item.id === created.id)) return prev;
            return [created, ...prev];
          });
        }
        return created;
      } finally {
        if (mountedRef.current) {
          setIsPublishing(false);
        }
      }
    },
    [isPublishing],
  );

  const editPost = useCallback(async (postId: string, input: ClubPostInput): Promise<ClubPost> => {
    const updated = await updateClubPost(postId, input);
    if (mountedRef.current) {
      setPosts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    }
    return updated;
  }, []);

  const togglePinPost = useCallback(async (postId: string, nextPinned: boolean): Promise<ClubPost> => {
    const updated = await toggleClubPostPin(postId, nextPinned);
    if (mountedRef.current) {
      setPosts((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
    }
    return updated;
  }, []);

  const removePost = useCallback(async (postId: string): Promise<void> => {
    await deleteClubPost(postId);
    if (mountedRef.current) {
      setPosts((prev) => prev.filter((item) => item.id !== postId));
      setComments((prev) => prev.filter((item) => item.postId !== postId));
    }
  }, []);

  const addComment = useCallback(
    async (input: ClubPostCommentInput): Promise<ClubPostComment> => {
      const created = await createClubPostComment(input);
      if (mountedRef.current) {
        setComments((prev) => {
          if (prev.some((item) => item.id === created.id)) return prev;
          return [...prev, created];
        });
      }
      return created;
    },
    [],
  );

  const removeComment = useCallback(async (commentId: string): Promise<void> => {
    await deleteClubPostComment(commentId);
    if (mountedRef.current) {
      setComments((prev) => pruneCommentSubtree(prev, commentId));
    }
  }, []);

  const updatePermissions = useCallback(
    async (patch: Partial<MemberVisibilityPermissions>): Promise<MemberVisibilityPermissions> => {
      const next: MemberVisibilityPermissions = {
        ...permissionsRef.current,
        ...patch,
      };
      setIsUpdatingVisibility(true);
      try {
        const saved = await updateMemberVisibilityPermissions(next);
        const resolved: MemberVisibilityPermissions = {
          memberCanViewRoster: saved.memberCanViewRoster,
          memberCanViewAttendanceRates: saved.memberCanViewAttendanceRates,
          memberCanViewCalendarDetails: saved.memberCanViewCalendarDetails,
          sharedIdeaVisibility: saved.sharedIdeaVisibility,
          memberCanCommentOnPosts: saved.memberCanCommentOnPosts,
        };
        if (mountedRef.current) {
          setPermissions(resolved);
        }
        return resolved;
      } finally {
        if (mountedRef.current) {
          setIsUpdatingVisibility(false);
        }
      }
    },
    [],
  );

  const setSharedIdeaVisibility = useCallback(async (allowShared: boolean): Promise<boolean> => {
    setIsUpdatingVisibility(true);
    try {
      const updated = await updateSharedIdeaVisibility(allowShared);
      if (mountedRef.current) {
        setPermissions((prev) => ({
          ...prev,
          sharedIdeaVisibility: updated.sharedIdeaVisibility,
        }));
      }
      return updated.sharedIdeaVisibility;
    } finally {
      if (mountedRef.current) {
        setIsUpdatingVisibility(false);
      }
    }
  }, []);

  return {
    posts,
    comments,
    permissions,
    sharedIdeaVisibility: permissions.sharedIdeaVisibility,
    isPostsLoading,
    postsError,
    isLiveConnected,
    isPublishing,
    isUpdatingVisibility,
    refreshPostsAndSettings: loadAll,
    publishPost,
    editPost,
    togglePinPost,
    removePost,
    addComment,
    removeComment,
    setSharedIdeaVisibility,
    updatePermissions,
  };
}
