import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  LOUNGE_QUICK_REACTIONS,
  LOUNGE_ROOMS,
  LOUNGE_VIBES,
  type LoungeChatMessage,
  type LoungeOnlineMember,
  type LoungeReplyRef,
  type LoungeRoomId,
  type LoungeVibe,
} from '../hooks/useLoungeChat';
import { getMemberInitials } from '../utils/attendance';
import { formatTimestamp } from '../utils/date';
import {
  PixelChatIcon,
  PixelCloseIcon,
  PixelEditIcon,
  PixelSendIcon,
  PixelSparkleIcon,
  PixelTrashIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface LoungeChatPanelProps {
  activeRoom: LoungeRoomId;
  messages: LoungeChatMessage[];
  onlineMembers: LoungeOnlineMember[];
  isLiveConnected: boolean;
  actorKey: string;
  userId: string | null;
  isAdmin: boolean;
  displayName: string;
  guestNickname: string;
  vibe: LoungeVibe;
  onSelectRoom: (room: LoungeRoomId) => void;
  onChangeGuestNickname: (name: string) => void;
  onChangeVibe: (vibe: LoungeVibe) => void;
  onSendMessage: (content: string, replyTo?: LoungeReplyRef) => LoungeChatMessage | null;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string) => void;
  onOpenCloudSync: () => void;
}

const ICEBREAKER_PROMPTS: Record<LoungeRoomId, string[]> = {
  general: [
    'Hey everyone! Who is around today?',
    'Drop a song you have on repeat right now 🎵',
    'How is everyone’s week going so far?',
  ],
  'build-talk': [
    'Anyone working on a cool project this week?',
    'Looking for feedback on a build idea!',
    'What tools or languages are you messing with lately?',
  ],
  'off-topic': [
    'Hot take: best after-school snack?',
    'What games is everyone playing lately?',
    'Taking a quick study break here ☕',
  ],
};

function getAvatarToneClass(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 4;
  }
  if (hash === 0) return 'is-cyan';
  if (hash === 1) return 'is-gold';
  if (hash === 2) return 'is-green';
  return 'is-red';
}

/**
 * Relaxed real-time student hangout chat panel with chill rooms, live presence,
 * quick emoji reactions, replies, and zero attendance-tool clutter.
 */
export function LoungeChatPanel({
  activeRoom,
  messages,
  onlineMembers,
  isLiveConnected,
  actorKey,
  userId,
  isAdmin,
  displayName,
  guestNickname,
  vibe,
  onSelectRoom,
  onChangeGuestNickname,
  onChangeVibe,
  onSendMessage,
  onToggleReaction,
  onDeleteMessage,
  onOpenCloudSync,
}: LoungeChatPanelProps) {
  const scrollListRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<LoungeReplyRef | null>(null);
  const [isEditingNickname, setIsEditingNickname] = useState(false);
  const [nicknameDraft, setNicknameDraft] = useState(guestNickname);
  const [showOnlineList, setShowOnlineList] = useState(false);

  const activeRoomMeta = useMemo(
    () => LOUNGE_ROOMS.find((room) => room.id === activeRoom) ?? LOUNGE_ROOMS[0],
    [activeRoom],
  );

  const roomMessages = useMemo(
    () => messages.filter((msg) => msg.room === activeRoom),
    [activeRoom, messages],
  );

  const roomCounts = useMemo(() => {
    const counts: Record<LoungeRoomId, number> = {
      general: 0,
      'build-talk': 0,
      'off-topic': 0,
    };
    for (const msg of messages) {
      counts[msg.room] += 1;
    }
    return counts;
  }, [messages]);

  // Keep newest messages visible whenever the active room receives a message.
  useEffect(() => {
    const el = scrollListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [activeRoom, roomMessages.length]);

  useEffect(() => {
    setReplyTarget(null);
  }, [activeRoom]);

  useEffect(() => {
    setNicknameDraft(guestNickname);
  }, [guestNickname]);

  function submitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    const sent = onSendMessage(trimmed, replyTarget ?? undefined);
    if (sent) {
      setDraft('');
      setReplyTarget(null);
      inputRef.current?.focus();
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitDraft();
    }
  }

  function handleSaveNickname(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onChangeGuestNickname(nicknameDraft.trim());
    setIsEditingNickname(false);
  }

  const onlineCount = Math.max(onlineMembers.length, isLiveConnected ? 1 : 0);

  return (
    <section className="lounge-card lounge-chat-panel" aria-label="Student Lounge casual chat">
      <div className="lounge-chat-header">
        <div className="lounge-chat-title-block">
          <div className="lounge-chat-title-row">
            <span className="lounge-chat-icon">
              <PixelChatIcon width={15} height={15} />
            </span>
            <h2 className="lounge-section-title">Chill Chat</h2>
            <span
              className={`lounge-live-pill ${isLiveConnected ? 'is-live' : ''}`}
              title={
                isLiveConnected
                  ? 'Live Realtime hangout channel connected'
                  : 'Local hangout mode — messages save on this browser'
              }
            >
              <span className="lounge-live-dot" aria-hidden="true" />
              <span>{isLiveConnected ? 'Live' : 'Local'}</span>
            </span>
          </div>
          <p className="lounge-chat-tagline">{activeRoomMeta.tagline}</p>
        </div>

        <button
          type="button"
          className={`lounge-presence-btn ${showOnlineList ? 'is-active' : ''}`}
          onClick={() => setShowOnlineList((prev) => !prev)}
          aria-expanded={showOnlineList}
          title="See who is hanging out right now"
        >
          <PixelUsersIcon width={13} height={13} />
          <span>{onlineCount > 0 ? `${onlineCount} online` : 'Just you'}</span>
        </button>
      </div>

      {showOnlineList && (
        <div className="lounge-presence-drawer" aria-label="Members currently in the Lounge">
          <div className="lounge-presence-vibe-row">
            <span className="lounge-presence-label">Your vibe:</span>
            <div className="lounge-vibe-pills">
              {LOUNGE_VIBES.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={`lounge-vibe-pill ${vibe === item ? 'is-active' : ''}`}
                  onClick={() => onChangeVibe(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="lounge-online-list">
            {onlineMembers.length > 0 ? (
              onlineMembers.map((member) => (
                <span key={`${member.key}-${member.name}`} className="lounge-online-chip">
                  <span className="lounge-live-dot" aria-hidden="true" />
                  <strong>{member.name}</strong>
                  <span className="lounge-online-vibe">· {member.vibe}</span>
                </span>
              ))
            ) : (
              <span className="lounge-online-chip">
                <span className="lounge-live-dot" aria-hidden="true" />
                <strong>{displayName}</strong>
                <span className="lounge-online-vibe">· {vibe}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="lounge-room-tabs" role="tablist" aria-label="Chat rooms">
        {LOUNGE_ROOMS.map((room) => {
          const isCurrent = room.id === activeRoom;
          const count = roomCounts[room.id];
          return (
            <button
              key={room.id}
              type="button"
              role="tab"
              aria-selected={isCurrent}
              className={`lounge-room-tab ${isCurrent ? 'is-active' : ''}`}
              onClick={() => onSelectRoom(room.id)}
            >
              <span>{room.label}</span>
              {count > 0 && <span className="lounge-room-count">{count}</span>}
            </button>
          );
        })}
      </div>

      <div ref={scrollListRef} className="lounge-chat-stream" role="log" aria-live="polite">
        {roomMessages.length === 0 ? (
          <div className="lounge-chat-empty">
            <div className="lounge-chat-empty-badge">
              <PixelSparkleIcon width={13} height={13} />
              <span>{activeRoomMeta.label} is cozy &amp; quiet</span>
            </div>
            <p className="lounge-chat-empty-text">
              Start a casual conversation! Pick a quick prompt or type anything below.
            </p>
            <div className="lounge-icebreakers">
              {ICEBREAKER_PROMPTS[activeRoom].map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  className="lounge-icebreaker-btn"
                  onClick={() => {
                    onSendMessage(prompt);
                    inputRef.current?.focus();
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ul className="lounge-message-list">
            {roomMessages.map((msg) => {
              const isOwn =
                (Boolean(userId) && msg.authorUserId === userId) ||
                msg.senderClientId === actorKey ||
                (!userId && msg.authorName === displayName && msg.authorRole === 'guest');
              const canDelete = isAdmin || isOwn;
              const reactionEntries = Object.entries(msg.reactions).filter(
                ([, actors]) => actors.length > 0,
              );

              return (
                <li key={msg.id} className={`lounge-message-item ${isOwn ? 'is-own' : ''}`}>
                  {!isOwn && (
                    <span
                      className={`lounge-avatar ${getAvatarToneClass(msg.authorName)}`}
                      aria-hidden="true"
                    >
                      {getMemberInitials(msg.authorName)}
                    </span>
                  )}

                  <div className="lounge-message-body-col">
                    <div className="lounge-message-meta">
                      <span className="lounge-message-author">{msg.authorName}</span>
                      {msg.authorRole === 'admin' && (
                        <span className="lounge-role-pill is-admin">Lead</span>
                      )}
                      <span className="lounge-message-time">
                        {formatTimestamp(msg.createdAt)}
                      </span>
                    </div>

                    <div className={`lounge-bubble ${isOwn ? 'is-own' : ''}`}>
                      {msg.replyTo && (
                        <div className="lounge-reply-quote">
                          <strong>{msg.replyTo.authorName}</strong>
                          <span>{msg.replyTo.snippet}</span>
                        </div>
                      )}
                      <p className="lounge-bubble-text">{msg.content}</p>
                    </div>

                    <div className="lounge-message-footer">
                      <div className="lounge-reactions-row">
                        {reactionEntries.map(([emoji, actors]) => {
                          const hasReacted = actors.includes(actorKey);
                          return (
                            <button
                              key={emoji}
                              type="button"
                              className={`lounge-reaction-chip ${hasReacted ? 'is-mine' : ''}`}
                              onClick={() => onToggleReaction(msg.id, emoji)}
                              title={hasReacted ? 'Remove reaction' : `React with ${emoji}`}
                            >
                              <span>{emoji}</span>
                              <span>{actors.length}</span>
                            </button>
                          );
                        })}

                        <div className="lounge-hover-actions">
                          {LOUNGE_QUICK_REACTIONS.slice(0, 3).map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              className="lounge-quick-react-btn"
                              onClick={() => onToggleReaction(msg.id, emoji)}
                              aria-label={`React with ${emoji}`}
                              title={`React ${emoji}`}
                            >
                              {emoji}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="lounge-msg-action-btn"
                            onClick={() => {
                              setReplyTarget({
                                id: msg.id,
                                authorName: msg.authorName,
                                snippet:
                                  msg.content.length > 72
                                    ? `${msg.content.slice(0, 72)}…`
                                    : msg.content,
                              });
                              inputRef.current?.focus();
                            }}
                          >
                            Reply
                          </button>
                          {canDelete && (
                            <button
                              type="button"
                              className="lounge-msg-action-btn is-danger"
                              onClick={() => onDeleteMessage(msg.id)}
                              aria-label="Delete message"
                              title="Delete message"
                            >
                              <PixelTrashIcon width={11} height={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lounge-composer-wrap">
        {!userId && (
          <div className="lounge-guest-bar">
            {isEditingNickname ? (
              <form className="lounge-nickname-form" onSubmit={handleSaveNickname}>
                <input
                  type="text"
                  className="form-control lounge-nickname-input"
                  value={nicknameDraft}
                  maxLength={32}
                  placeholder="Pick a hangout display name..."
                  onChange={(event) => setNicknameDraft(event.target.value)}
                  autoFocus
                />
                <button type="submit" className="btn-secondary btn-compact">
                  Save
                </button>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={() => setIsEditingNickname(false)}
                >
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="lounge-guest-label">
                  Chatting as <strong>{displayName}</strong>
                </span>
                <div className="lounge-guest-actions">
                  <button
                    type="button"
                    className="ideas-inline-link"
                    onClick={() => setIsEditingNickname(true)}
                  >
                    <PixelEditIcon width={11} height={11} /> Name
                  </button>
                  <span aria-hidden="true">·</span>
                  <button
                    type="button"
                    className="ideas-inline-link"
                    onClick={onOpenCloudSync}
                  >
                    Sign in
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {replyTarget && (
          <div className="lounge-composer-reply">
            <div className="lounge-composer-reply-text">
              Replying to <strong>{replyTarget.authorName}</strong>: {replyTarget.snippet}
            </div>
            <button
              type="button"
              className="lounge-composer-reply-cancel"
              onClick={() => setReplyTarget(null)}
              aria-label="Cancel reply"
            >
              <PixelCloseIcon width={11} height={11} />
            </button>
          </div>
        )}

        <form className="lounge-composer-form" onSubmit={handleFormSubmit}>
          <textarea
            ref={inputRef}
            className="form-control lounge-composer-input"
            rows={1}
            maxLength={600}
            placeholder={`Message ${activeRoomMeta.label} as ${displayName}...`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleTextareaKeyDown}
            aria-label={`Message ${activeRoomMeta.label}`}
          />
          <button
            type="submit"
            className="lounge-send-btn"
            disabled={draft.trim().length === 0}
            aria-label="Send message"
            title="Send (Enter)"
          >
            <PixelSendIcon width={14} height={14} />
          </button>
        </form>
      </div>
    </section>
  );
}
