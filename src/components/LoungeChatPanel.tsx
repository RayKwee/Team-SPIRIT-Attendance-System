import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import {
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
  shouldDeferContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from './AppContextMenu';
import { EmojiPickerPopup } from './EmojiPickerPopup';
import {
  PixelChatIcon,
  PixelCheckIcon,
  PixelCloseIcon,
  PixelCopyIcon,
  PixelEditIcon,
  PixelLockIcon,
  PixelPlusIcon,
  PixelSendIcon,
  PixelSmileIcon,
  PixelSparkleIcon,
  PixelTrashIcon,
  PixelUserIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface LoungeChatPanelProps {
  activeRoom: LoungeRoomId;
  messages: LoungeChatMessage[];
  onlineMembers: LoungeOnlineMember[];
  isLoading: boolean;
  isLiveConnected: boolean;
  isDbBacked: boolean;
  userId: string | null;
  isAdmin: boolean;
  displayName: string;
  vibe: LoungeVibe;
  onSelectRoom: (room: LoungeRoomId) => void;
  onChangeVibe: (vibe: LoungeVibe) => void;
  onSendMessage: (content: string, replyTo?: LoungeReplyRef) => Promise<LoungeChatMessage | null>;
  onEditMessage: (messageId: string, content: string) => Promise<LoungeChatMessage | null>;
  onToggleReaction: (messageId: string, emoji: string) => Promise<void>;
  onDeleteMessage: (messageId: string) => Promise<void>;
  onOpenCloudSync: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
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

type ActiveEmojiPicker =
  | { mode: 'composer'; anchorEl: HTMLElement }
  | { mode: 'reaction'; messageId: string; anchorEl: HTMLElement }
  | null;

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
 * Relaxed real-time student hangout chat panel:
 * - Unauthenticated visitors can read messages & emoji reactions live in view-only mode.
 * - Authenticated members can post, edit, reply, insert emojis, and add reactions via
 *   the streamlined add-emote (+) picker or sleek right-click context menu.
 */
export function LoungeChatPanel({
  activeRoom,
  messages,
  onlineMembers,
  isLoading,
  isLiveConnected,
  isDbBacked,
  userId,
  isAdmin,
  displayName,
  vibe,
  onSelectRoom,
  onChangeVibe,
  onSendMessage,
  onEditMessage,
  onToggleReaction,
  onDeleteMessage,
  onOpenCloudSync,
  onNotify,
}: LoungeChatPanelProps) {
  const { openContextMenu } = useContextMenu();
  const scrollListRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const editInputRef = useRef<HTMLTextAreaElement | null>(null);

  const [draft, setDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<LoungeReplyRef | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showOnlineList, setShowOnlineList] = useState(false);
  const [activePicker, setActivePicker] = useState<ActiveEmojiPicker>(null);
  const [isSending, setIsSending] = useState(false);

  const isAuthenticated = Boolean(userId);

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
    setActivePicker(null);
    setEditingMessageId(null);
    setEditDraft('');
  }, [activeRoom]);

  // Focus inline edit textarea whenever editing starts.
  useEffect(() => {
    if (!editingMessageId) return;
    const timer = window.setTimeout(() => {
      const el = editInputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [editingMessageId]);

  // Immediately close any open picker, edit draft, or reply draft if the user signs out.
  useEffect(() => {
    if (!isAuthenticated) {
      setActivePicker(null);
      setReplyTarget(null);
      setEditingMessageId(null);
      setEditDraft('');
      setDraft('');
    }
  }, [isAuthenticated]);

  async function submitDraft() {
    if (!isAuthenticated || isSending) return;
    const trimmed = draft.trim();
    if (!trimmed) return;
    setIsSending(true);
    try {
      const sent = await onSendMessage(trimmed, replyTarget ?? undefined);
      if (sent) {
        setDraft('');
        setReplyTarget(null);
        setActivePicker(null);
        inputRef.current?.focus();
      }
    } finally {
      setIsSending(false);
    }
  }

  function startEditingMessage(msg: LoungeChatMessage) {
    if (!isAuthenticated || !userId || msg.authorUserId !== userId) return;
    setActivePicker(null);
    setEditingMessageId(msg.id);
    setEditDraft(msg.content);
  }

  function cancelEditingMessage() {
    setEditingMessageId(null);
    setEditDraft('');
  }

  async function submitEditMessage(messageId: string) {
    if (!isAuthenticated || isSavingEdit) return;
    const trimmed = editDraft.trim();
    if (!trimmed) return;
    setIsSavingEdit(true);
    try {
      const saved = await onEditMessage(messageId, trimmed);
      if (saved) {
        setEditingMessageId(null);
        setEditDraft('');
      }
    } finally {
      setIsSavingEdit(false);
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitDraft();
  }

  function handleTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitDraft();
    }
  }

  function handleEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, messageId: string) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditingMessage();
    } else if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void submitEditMessage(messageId);
    }
  }

  function handleInsertEmojiIntoComposer(emoji: string) {
    const el = inputRef.current;
    if (!el) {
      setDraft((prev) => `${prev}${emoji}`.slice(0, 600));
      return;
    }
    const start = el.selectionStart ?? draft.length;
    const end = el.selectionEnd ?? draft.length;
    const nextValue = `${draft.slice(0, start)}${emoji}${draft.slice(end)}`.slice(0, 600);
    setDraft(nextValue);
    const nextCursor = Math.min(start + emoji.length, nextValue.length);
    window.requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(nextCursor, nextCursor);
    });
  }

  function handleEmojiSelected(emoji: string) {
    if (!isAuthenticated || !activePicker) return;
    if (activePicker.mode === 'composer') {
      handleInsertEmojiIntoComposer(emoji);
      return;
    }
    const targetMessageId = activePicker.messageId;
    setActivePicker(null);
    void onToggleReaction(targetMessageId, emoji);
  }

  function handleMessageContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    msg: LoungeChatMessage,
    bubbleEl: HTMLElement,
  ) {
    const isOwn = Boolean(userId && msg.authorUserId === userId);
    const canDelete = isAuthenticated && (isAdmin || isOwn);
    const items: ContextMenuItem[] = [];

    if (isAuthenticated) {
      items.push(
        {
          type: 'action',
          id: `msg-react-${msg.id}`,
          label: 'Add Reaction',
          icon: <PixelSmileIcon width={13} height={13} />,
          onSelect: () => {
            setActivePicker({ mode: 'reaction', messageId: msg.id, anchorEl: bubbleEl });
          },
        },
        {
          type: 'action',
          id: `msg-reply-${msg.id}`,
          label: 'Reply',
          icon: <PixelChatIcon width={13} height={13} />,
          onSelect: () => {
            setReplyTarget({
              id: msg.id,
              authorName: msg.authorName,
              snippet: msg.content.length > 72 ? `${msg.content.slice(0, 72)}…` : msg.content,
            });
            inputRef.current?.focus();
          },
        },
      );

      if (isOwn) {
        items.push({
          type: 'action',
          id: `msg-edit-${msg.id}`,
          label: 'Edit Message',
          icon: <PixelEditIcon width={13} height={13} />,
          onSelect: () => startEditingMessage(msg),
        });
      }

      items.push({ type: 'separator', id: `msg-sep-copy-${msg.id}` });
    }

    items.push({
      type: 'action',
      id: `msg-copy-${msg.id}`,
      label: 'Copy Message Text',
      icon: <PixelCopyIcon width={13} height={13} />,
      onSelect: () => {
        void navigator.clipboard?.writeText(msg.content).then(
          () => {
            onNotify?.({
              tone: 'success',
              tag: 'Copied',
              message: 'Copied message text to clipboard.',
            });
          },
          () => undefined,
        );
      },
    });

    if (canDelete) {
      items.push(
        { type: 'separator', id: `msg-sep-del-${msg.id}` },
        {
          type: 'action',
          id: `msg-delete-${msg.id}`,
          label: 'Delete Message',
          icon: <PixelTrashIcon width={13} height={13} />,
          danger: true,
          onSelect: () => void onDeleteMessage(msg.id),
        },
      );
    }

    openContextMenu(event, items, {
      header: `Message · ${msg.authorName}`,
      targetEl: bubbleEl,
    });
  }

  const onlineCount = onlineMembers.length;

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
                  ? 'Live real-time synchronization active'
                  : 'Reconnecting to live real-time channel...'
              }
            >
              <span className="lounge-live-dot" aria-hidden="true" />
              <span>{isLiveConnected ? 'Live' : 'Syncing'}</span>
            </span>
            {!isAuthenticated && (
              <span
                className="lounge-viewonly-pill"
                title="Sign in to post messages and add emoji reactions"
              >
                <PixelLockIcon width={10} height={10} />
                <span>View Only</span>
              </span>
            )}
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
          <span>{onlineCount > 0 ? `${onlineCount} online` : 'Online'}</span>
        </button>
      </div>

      {showOnlineList && (
        <div className="lounge-presence-drawer" aria-label="Members currently in the Lounge">
          {isAuthenticated && (
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
          )}

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
              <span className="lounge-online-empty">
                {isAuthenticated
                  ? `${displayName} · ${vibe}`
                  : 'No signed-in members hanging out right now.'}
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

      {isAdmin && !isDbBacked && (
        <div className="lounge-schema-hint" role="note">
          Live chat is streaming via Realtime Broadcast. Run the latest{' '}
          <code>supabase/schema.sql</code> Section 9 in Supabase SQL Editor to enable permanent
          cross-device history, editing &amp; DB-enforced reactions.
        </div>
      )}

      <div ref={scrollListRef} className="lounge-chat-stream" role="log" aria-live="polite">
        {isLoading && roomMessages.length === 0 ? (
          <div className="lounge-chat-empty">
            <div className="lounge-chat-empty-badge">
              <PixelChatIcon width={13} height={13} />
              <span>Loading {activeRoomMeta.label}...</span>
            </div>
          </div>
        ) : roomMessages.length === 0 ? (
          <div className="lounge-chat-empty">
            <div className="lounge-chat-empty-badge">
              <PixelSparkleIcon width={13} height={13} />
              <span>{activeRoomMeta.label} is cozy &amp; quiet</span>
            </div>
            {isAuthenticated ? (
              <>
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
                        void onSendMessage(prompt);
                        inputRef.current?.focus();
                      }}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <>
                <p className="lounge-chat-empty-text">
                  No messages in {activeRoomMeta.label} yet. Sign in with your club account to say
                  hi and join the hangout!
                </p>
                <button
                  type="button"
                  className="btn-primary btn-compact-primary"
                  onClick={onOpenCloudSync}
                >
                  <PixelUserIcon width={12} height={12} />
                  <span>Sign In to Chat</span>
                </button>
              </>
            )}
          </div>
        ) : (
          <ul className="lounge-message-list">
            {roomMessages.map((msg) => {
              const isOwn = Boolean(userId && msg.authorUserId === userId);
              const canDelete = isAuthenticated && (isAdmin || isOwn);
              const isEditingThis = editingMessageId === msg.id;
              const reactionEntries = Object.entries(msg.reactions).filter(
                ([, actors]) => actors.length > 0,
              );
              const isPickerOpenForMessage =
                activePicker?.mode === 'reaction' && activePicker.messageId === msg.id;

              return (
                <li
                  key={msg.id}
                  className={`lounge-message-item ${isOwn ? 'is-own' : ''}`}
                >
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
                        {msg.updatedAt && <span className="lounge-edited-tag"> (edited)</span>}
                      </span>
                    </div>

                    <div
                      className={`lounge-bubble ${isOwn ? 'is-own' : ''} ${
                        isEditingThis ? 'is-editing' : ''
                      }`}
                      onContextMenu={(event) => {
                        if (isEditingThis || shouldDeferContextMenu(event)) return;
                        handleMessageContextMenu(event, msg, event.currentTarget);
                      }}
                    >
                      {msg.replyTo && (
                        <div className="lounge-reply-quote">
                          <strong>{msg.replyTo.authorName}</strong>
                          <span>{msg.replyTo.snippet}</span>
                        </div>
                      )}

                      {isEditingThis ? (
                        <div className="lounge-inline-edit-box">
                          <textarea
                            ref={editInputRef}
                            className="form-control lounge-inline-edit-input"
                            rows={2}
                            maxLength={600}
                            value={editDraft}
                            onChange={(event) => setEditDraft(event.target.value)}
                            onKeyDown={(event) => handleEditKeyDown(event, msg.id)}
                            disabled={isSavingEdit}
                            aria-label="Edit chat message"
                          />
                          <div className="lounge-inline-edit-actions">
                            <span className="lounge-inline-edit-hint">
                              Enter to save · Esc to cancel
                            </span>
                            <div className="lounge-inline-edit-btns">
                              <button
                                type="button"
                                className="btn-secondary btn-compact"
                                onClick={cancelEditingMessage}
                                disabled={isSavingEdit}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="btn-primary btn-compact-primary"
                                onClick={() => void submitEditMessage(msg.id)}
                                disabled={isSavingEdit || editDraft.trim().length === 0}
                              >
                                <PixelCheckIcon width={11} height={11} />
                                <span>{isSavingEdit ? 'Saving...' : 'Save'}</span>
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <p className="lounge-bubble-text">{msg.content}</p>
                      )}
                    </div>

                    {(reactionEntries.length > 0 || isAuthenticated) && !isEditingThis && (
                      <div className="lounge-message-footer">
                        <div className="lounge-reactions-row">
                          {reactionEntries.map(([emoji, actors]) => {
                            const hasReacted = Boolean(userId && actors.includes(userId));
                            if (!isAuthenticated) {
                              return (
                                <span
                                  key={emoji}
                                  className="lounge-reaction-chip is-readonly"
                                  title="Sign in to react"
                                >
                                  <span>{emoji}</span>
                                  <span>{actors.length}</span>
                                </span>
                              );
                            }
                            return (
                              <button
                                key={emoji}
                                type="button"
                                className={`lounge-reaction-chip ${hasReacted ? 'is-mine' : ''}`}
                                onClick={() => void onToggleReaction(msg.id, emoji)}
                                title={hasReacted ? 'Remove reaction' : `React with ${emoji}`}
                              >
                                <span>{emoji}</span>
                                <span>{actors.length}</span>
                              </button>
                            );
                          })}

                          {isAuthenticated && (
                            <div
                              className={`lounge-hover-actions ${
                                isPickerOpenForMessage ? 'is-pinned-visible' : ''
                              }`}
                            >
                              <button
                                type="button"
                                className={`lounge-msg-action-btn lounge-add-emoji-btn ${
                                  isPickerOpenForMessage ? 'is-active' : ''
                                }`}
                                onClick={(event) => {
                                  const anchorEl = event.currentTarget;
                                  setActivePicker((prev) =>
                                    prev?.mode === 'reaction' && prev.messageId === msg.id
                                      ? null
                                      : { mode: 'reaction', messageId: msg.id, anchorEl },
                                  );
                                }}
                                aria-label="Add emoji reaction"
                                aria-expanded={isPickerOpenForMessage}
                                title="Add reaction"
                              >
                                <PixelSmileIcon width={12} height={12} />
                                <PixelPlusIcon width={9} height={9} />
                              </button>

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

                              {isOwn && (
                                <button
                                  type="button"
                                  className="lounge-msg-action-btn"
                                  onClick={() => startEditingMessage(msg)}
                                  aria-label="Edit message"
                                  title="Edit message"
                                >
                                  Edit
                                </button>
                              )}

                              {canDelete && (
                                <button
                                  type="button"
                                  className="lounge-msg-action-btn is-danger"
                                  onClick={() => void onDeleteMessage(msg.id)}
                                  aria-label="Delete message"
                                  title="Delete message"
                                >
                                  <PixelTrashIcon width={11} height={11} />
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="lounge-composer-wrap">
        {!isAuthenticated ? (
          <div className="lounge-readonly-bar" role="status">
            <div className="lounge-readonly-copy">
              <PixelLockIcon width={13} height={13} />
              <span>Viewing in read-only mode. Sign in to post messages or react.</span>
            </div>
            <button
              type="button"
              className="btn-primary btn-compact-primary lounge-readonly-signin-btn"
              onClick={onOpenCloudSync}
            >
              <PixelUserIcon width={12} height={12} />
              <span>Sign In</span>
            </button>
          </div>
        ) : (
          <>
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
              <button
                type="button"
                className={`lounge-composer-emoji-btn ${
                  activePicker?.mode === 'composer' ? 'is-active' : ''
                }`}
                onClick={(event) => {
                  const anchorEl = event.currentTarget;
                  setActivePicker((prev) =>
                    prev?.mode === 'composer' ? null : { mode: 'composer', anchorEl },
                  );
                }}
                aria-label="Insert emoji into message"
                aria-expanded={activePicker?.mode === 'composer'}
                title="Insert emoji"
              >
                <PixelSmileIcon width={16} height={16} />
              </button>

              <textarea
                ref={inputRef}
                className="form-control lounge-composer-input"
                rows={1}
                maxLength={600}
                placeholder={`Message ${activeRoomMeta.label} as ${displayName}...`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleTextareaKeyDown}
                disabled={isSending}
                aria-label={`Message ${activeRoomMeta.label}`}
              />

              <button
                type="submit"
                className="lounge-send-btn"
                disabled={isSending || draft.trim().length === 0}
                aria-label="Send message"
                title="Send (Enter)"
              >
                <PixelSendIcon width={14} height={14} />
              </button>
            </form>
          </>
        )}
      </div>

      {isAuthenticated && (
        <EmojiPickerPopup
          isOpen={activePicker !== null}
          anchorEl={activePicker?.anchorEl ?? null}
          title={
            activePicker?.mode === 'reaction' ? 'Add emoji reaction' : 'Insert emoji into message'
          }
          onSelect={handleEmojiSelected}
          onClose={() => setActivePicker(null)}
        />
      )}
    </section>
  );
}
