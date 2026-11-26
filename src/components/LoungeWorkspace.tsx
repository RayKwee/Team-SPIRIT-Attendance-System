import { useCallback, useMemo, useState } from 'react';
import { useLoungeChat, type LoungeRoomId } from '../hooks/useLoungeChat';
import type { AttendanceSession, ClubMember } from '../types/attendance';
import type {
  ClubPost,
  ClubPostComment,
  ClubPostCommentInput,
  ClubPostInput,
  ContentDeletionMode,
} from '../types/projectIdeas';
import { formatSessionDate, formatSessionTime, toIsoDateString } from '../utils/date';
import { LoungeChatPanel } from './LoungeChatPanel';
import {
  PixelCalendarIcon,
  PixelChatIcon,
  PixelGamepadIcon,
  PixelIdeaIcon,
  PixelLoungeIcon,
  PixelMegaphoneIcon,
} from './PixelIcons';
import { PostsUpdatesFeed } from './PostsUpdatesFeed';

type LoungeMobileTab = 'announcements' | 'chat';

interface LoungeWorkspaceProps {
  userId: string | null;
  userEmail?: string;
  linkedMember?: ClubMember | null;
  isAdmin: boolean;
  periodLabel: string;
  posts: ClubPost[];
  comments: ClubPostComment[];
  sessions: AttendanceSession[];
  memberCanCommentOnPosts: boolean;
  contentDeletionMode: ContentDeletionMode;
  isPostsLoading: boolean;
  postsError: string | null;
  isPostsLiveConnected: boolean;
  isPublishingPost: boolean;
  onRefreshPostsAndSettings: () => Promise<void>;
  onPublishPost: (input: ClubPostInput) => Promise<ClubPost>;
  onEditPost: (postId: string, input: ClubPostInput) => Promise<ClubPost>;
  onTogglePinPost: (postId: string, nextPinned: boolean) => Promise<ClubPost>;
  onDeletePost: (postId: string) => Promise<void>;
  onAddComment: (input: ClubPostCommentInput) => Promise<ClubPostComment>;
  onDeleteComment: (commentId: string) => Promise<void>;
  onOpenCloudSync: () => void;
  onNavigateGames: () => void;
  onNavigateIdeas: () => void;
  onNavigateAttendanceCalendar: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

function resolveDisplayName(
  linkedMember: ClubMember | null | undefined,
  userEmail: string | undefined,
): string {
  if (linkedMember?.name?.trim()) return linkedMember.name.trim();
  if (userEmail?.trim()) {
    const localPart = userEmail.split('@')[0]?.trim();
    if (localPart) return localPart;
    return userEmail.trim();
  }
  return 'Club Member';
}

function getTimeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Hey there';
  return 'Good evening';
}

/**
 * Relaxed, welcoming Team SPIRIT Student Lounge:
 * Prioritizes club announcements and live hangout chat (view-only for unauthenticated
 * visitors, interactive for logged-in members) while keeping attendance tools isolated.
 */
export function LoungeWorkspace({
  userId,
  userEmail,
  linkedMember = null,
  isAdmin,
  periodLabel,
  posts,
  comments,
  sessions,
  memberCanCommentOnPosts,
  contentDeletionMode,
  isPostsLoading,
  postsError,
  isPostsLiveConnected,
  isPublishingPost,
  onRefreshPostsAndSettings,
  onPublishPost,
  onEditPost,
  onTogglePinPost,
  onDeletePost,
  onAddComment,
  onDeleteComment,
  onOpenCloudSync,
  onNavigateGames,
  onNavigateIdeas,
  onNavigateAttendanceCalendar,
  onNotify,
}: LoungeWorkspaceProps) {
  const [mobileTab, setMobileTab] = useState<LoungeMobileTab>('announcements');
  const [activeRoom, setActiveRoom] = useState<LoungeRoomId>('general');

  const baseProfileName = resolveDisplayName(linkedMember, userEmail);

  const handleChatError = useCallback(
    (message: string) => {
      onNotify?.({
        tone: 'warning',
        tag: 'Chill Chat',
        message,
      });
    },
    [onNotify],
  );

  const {
    messages,
    onlineMembers,
    isLoading: isChatLoading,
    isLiveConnected: isChatLiveConnected,
    isDbBacked,
    vibe,
    setVibe,
    sendMessage,
    editMessage,
    toggleReaction,
    deleteMessage,
  } = useLoungeChat({
    userId,
    authorName: baseProfileName,
    isAdmin,
    activeRoom,
    onError: handleChatError,
  });

  const nextUpcomingSession = useMemo(() => {
    const todayIso = toIsoDateString(new Date());
    const upcoming = sessions
      .filter((session) => session.date >= todayIso)
      .sort((a, b) => {
        const byDate = a.date.localeCompare(b.date);
        if (byDate !== 0) return byDate;
        return (a.time || '').localeCompare(b.time || '');
      });
    return upcoming[0] ?? null;
  }, [sessions]);

  const greetingFirstName = useMemo(() => {
    if (!userId) return null;
    return baseProfileName.split(/\s+/)[0] || baseProfileName;
  }, [baseProfileName, userId]);

  return (
    <div className="lounge-workspace" data-tutorial-target="lounge-hub">
      <section className="lounge-welcome-banner" aria-label="Welcome to the Team SPIRIT Lounge">
        <div className="lounge-welcome-copy">
          <div className="lounge-welcome-kicker">
            <PixelLoungeIcon width={13} height={13} />
            <span>Team SPIRIT Student Lounge</span>
            <span className="lounge-welcome-dot" aria-hidden="true">
              ·
            </span>
            <span>{periodLabel}</span>
          </div>
          <h2 className="lounge-welcome-heading">
            {greetingFirstName
              ? `${getTimeGreeting()}, ${greetingFirstName}! Kick back and catch up.`
              : `${getTimeGreeting()}! Welcome to the Team SPIRIT hangout.`}
          </h2>
          <p className="lounge-welcome-subtitle">
            Read club announcements, swap project updates, and chill with the crew in live chat.
          </p>
        </div>

        <div className="lounge-welcome-actions">
          {nextUpcomingSession && (
            <button
              type="button"
              className="lounge-next-meetup-pill"
              onClick={onNavigateAttendanceCalendar}
              title="View upcoming club schedule in Attendance Calendar"
            >
              <PixelCalendarIcon width={13} height={13} />
              <span>
                Next: <strong>{nextUpcomingSession.name}</strong> ·{' '}
                {formatSessionDate(nextUpcomingSession.date)}
                {nextUpcomingSession.time
                  ? ` at ${formatSessionTime(nextUpcomingSession.time)}`
                  : ''}
              </span>
            </button>
          )}

          <button type="button" className="lounge-pitch-shortcut" onClick={onNavigateGames}>
            <PixelGamepadIcon width={13} height={13} />
            <span>Arcade Games</span>
          </button>

          <button type="button" className="lounge-pitch-shortcut" onClick={onNavigateIdeas}>
            <PixelIdeaIcon width={13} height={13} />
            <span>Pitch an Idea</span>
          </button>
        </div>
      </section>

      <div className="lounge-mobile-tabs" role="tablist" aria-label="Lounge sections">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'announcements'}
          className={`lounge-mobile-tab ${mobileTab === 'announcements' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('announcements')}
        >
          <PixelMegaphoneIcon width={13} height={13} />
          <span>Announcements ({posts.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'chat'}
          className={`lounge-mobile-tab ${mobileTab === 'chat' ? 'is-active' : ''}`}
          onClick={() => setMobileTab('chat')}
        >
          <PixelChatIcon width={13} height={13} />
          <span>Chill Chat ({messages.length})</span>
        </button>
      </div>

      <div className="lounge-split-layout" data-mobile-tab={mobileTab}>
        <div className="lounge-announcements-col">
          <PostsUpdatesFeed
            variant="lounge"
            userId={userId}
            posts={posts}
            comments={comments}
            isLoading={isPostsLoading}
            error={postsError}
            isLiveConnected={isPostsLiveConnected}
            isPublishing={isPublishingPost}
            isAdmin={isAdmin}
            memberCanCommentOnPosts={memberCanCommentOnPosts}
            contentDeletionMode={contentDeletionMode}
            authorDisplayName={baseProfileName}
            onRefresh={onRefreshPostsAndSettings}
            onPublishPost={onPublishPost}
            onEditPost={onEditPost}
            onTogglePinPost={onTogglePinPost}
            onDeletePost={onDeletePost}
            onAddComment={onAddComment}
            onDeleteComment={onDeleteComment}
            onOpenCloudSync={onOpenCloudSync}
            onNotify={onNotify}
          />
        </div>

        <div className="lounge-chat-col">
          <LoungeChatPanel
            activeRoom={activeRoom}
            messages={messages}
            onlineMembers={onlineMembers}
            isLoading={isChatLoading}
            isLiveConnected={isChatLiveConnected}
            isDbBacked={isDbBacked}
            userId={userId}
            isAdmin={isAdmin}
            displayName={baseProfileName}
            vibe={vibe}
            onSelectRoom={setActiveRoom}
            onChangeVibe={setVibe}
            onSendMessage={sendMessage}
            onEditMessage={editMessage}
            onToggleReaction={toggleReaction}
            onDeleteMessage={deleteMessage}
            onOpenCloudSync={onOpenCloudSync}
            onNotify={onNotify}
          />
        </div>
      </div>
    </div>
  );
}
