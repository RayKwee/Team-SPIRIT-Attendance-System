import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type {
  AttendanceSession,
  MeetingVisibility,
  SessionUpdateInput,
} from '../types/attendance';
import {
  MEETING_VISIBILITY_DESCRIPTIONS,
  MEETING_VISIBILITY_LABELS,
  MEETING_VISIBILITY_OPTIONS,
  canUserSetSessionPrivate,
  normalizeMeetingVisibility,
} from '../utils/attendance';
import {
  PixelCheckIcon,
  PixelCloseIcon,
  PixelLockIcon,
  PixelSettingsIcon,
  PixelShieldIcon,
  PixelUsersIcon,
} from './PixelIcons';

export const MEETING_EVENT_TYPE_OPTIONS = [
  'Practice',
  'Meeting',
  'Workshop',
  'Competition',
  'Social',
  'Other',
];

function VisibilityOptionIcon({ visibility }: { visibility: MeetingVisibility }) {
  if (visibility === 'admins_only') {
    return <PixelShieldIcon width={12} height={12} />;
  }
  if (visibility === 'private') {
    return <PixelLockIcon width={12} height={12} />;
  }
  return <PixelUsersIcon width={12} height={12} />;
}

/** Compact visibility pill shown only on restricted meetings (Admins Only / Private). */
export function MeetingVisibilityBadge({
  visibility,
}: {
  visibility?: MeetingVisibility;
}) {
  const normalized = normalizeMeetingVisibility(visibility);
  if (normalized === 'public') {
    return null;
  }

  return (
    <span
      className={`meeting-visibility-tag is-${normalized}`}
      title={MEETING_VISIBILITY_DESCRIPTIONS[normalized]}
    >
      <VisibilityOptionIcon visibility={normalized} />
      <span>{MEETING_VISIBILITY_LABELS[normalized]}</span>
    </span>
  );
}

interface MeetingVisibilityControlProps {
  value: MeetingVisibility;
  onChange: (next: MeetingVisibility) => void;
  allowPrivate?: boolean;
  labelId?: string;
}

/** Admin-only 3-way segmented visibility selector (Public / Admins Only / Private). */
export function MeetingVisibilityControl({
  value,
  onChange,
  allowPrivate = true,
  labelId,
}: MeetingVisibilityControlProps) {
  return (
    <div className="meeting-visibility-control">
      <div
        className="settings-segmented meeting-visibility-segmented"
        role="radiogroup"
        aria-labelledby={labelId}
      >
        {MEETING_VISIBILITY_OPTIONS.map((option) => {
          const isSelected = value === option;
          const isDisabled = option === 'private' && !allowPrivate && !isSelected;
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={isSelected}
              disabled={isDisabled}
              className={`settings-segmented-btn meeting-visibility-btn is-${option} ${
                isSelected ? 'is-active' : ''
              }`}
              title={
                isDisabled
                  ? 'Only the creator of this meeting can set visibility to Private'
                  : MEETING_VISIBILITY_DESCRIPTIONS[option]
              }
              onClick={() => {
                if (!isDisabled) {
                  onChange(option);
                }
              }}
            >
              <VisibilityOptionIcon visibility={option} />
              <span>{MEETING_VISIBILITY_LABELS[option]}</span>
            </button>
          );
        })}
      </div>

      <p className="meeting-visibility-hint">
        {MEETING_VISIBILITY_DESCRIPTIONS[value]}
        {!allowPrivate && value !== 'private' && (
          <span className="meeting-visibility-owner-note">
            {' '}
            Only the meeting creator can switch this to Private.
          </span>
        )}
      </p>
    </div>
  );
}

interface MeetingSettingsModalProps {
  isOpen: boolean;
  session: AttendanceSession | null;
  showVisibilityControls: boolean;
  currentUserId: string | null;
  onClose: () => void;
  onSave: (sessionId: string, input: SessionUpdateInput) => void;
  onBeginFieldEdit?: (fieldKey: string) => void;
  onEndFieldEdit?: (fieldKey: string) => void;
}

/** Focused modal for editing general meeting details and (for admins) meeting visibility. */
export function MeetingSettingsModal({
  isOpen,
  session,
  showVisibilityControls,
  currentUserId,
  onClose,
  onSave,
  onBeginFieldEdit,
  onEndFieldEdit,
}: MeetingSettingsModalProps) {
  const titleId = useId();
  const nameInputId = useId();
  const dateInputId = useId();
  const timeInputId = useId();
  const locationInputId = useId();
  const eventTypeInputId = useId();
  const descriptionInputId = useId();
  const visibilityLabelId = useId();

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const onBeginFieldEditRef = useRef(onBeginFieldEdit);
  const onEndFieldEditRef = useRef(onEndFieldEdit);
  onBeginFieldEditRef.current = onBeginFieldEdit;
  onEndFieldEditRef.current = onEndFieldEdit;

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [eventType, setEventType] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<MeetingVisibility>('public');
  const [errorMessage, setErrorMessage] = useState('');

  const sessionId = session?.id ?? null;

  useEffect(() => {
    if (!isOpen || !session) return;

    setName(session.name);
    setDate(session.date);
    setTime(session.time);
    setLocation(session.location ?? '');
    setEventType(session.eventType ?? '');
    setDescription(session.description ?? '');
    setVisibility(normalizeMeetingVisibility(session.visibility));
    setErrorMessage('');

    const focusTimer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimer);
    };
    // Intentionally sync form values when modal opens or switches to a different meeting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, sessionId]);

  useEffect(() => {
    if (!isOpen || !sessionId) return;
    const fieldKey = `session:${sessionId}`;
    onBeginFieldEditRef.current?.(fieldKey);
    return () => {
      onEndFieldEditRef.current?.(fieldKey);
    };
  }, [isOpen, sessionId]);

  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !session) {
    return null;
  }

  const initialVisibility = normalizeMeetingVisibility(session.visibility);
  const allowPrivate = canUserSetSessionPrivate(session, currentUserId);
  const customEventType =
    eventType && !MEETING_EVENT_TYPE_OPTIONS.includes(eventType) ? eventType : null;

  const hasChanges =
    name.trim() !== session.name ||
    date !== session.date ||
    time !== session.time ||
    (location.trim() || undefined) !== (session.location ?? undefined) ||
    (eventType.trim() || undefined) !== (session.eventType ?? undefined) ||
    (description.trim() || undefined) !== (session.description ?? undefined) ||
    (showVisibilityControls && visibility !== initialVisibility);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;

    const cleanedName = name.trim();
    if (!cleanedName) {
      setErrorMessage('Please enter a meeting name.');
      nameInputRef.current?.focus();
      return;
    }
    if (!date) {
      setErrorMessage('Please choose a meeting date.');
      return;
    }
    if (!time) {
      setErrorMessage('Please choose a meeting time.');
      return;
    }

    onSave(session.id, {
      name: cleanedName,
      date,
      time,
      location: location.trim() || undefined,
      eventType: eventType.trim() || undefined,
      description: description.trim() || undefined,
      ...(showVisibilityControls ? { visibility } : {}),
    });
    onClose();
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="modal-dialog meeting-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge">
              <PixelSettingsIcon />
              <span>Meeting Settings</span>
            </span>
            <h2 id={titleId} className="modal-title">
              Edit Meeting Details
            </h2>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close meeting settings"
            title="Close (Esc)"
          >
            <PixelCloseIcon />
          </button>
        </div>

        <form className="modal-form" onSubmit={handleSubmit} noValidate>
          {errorMessage && (
            <div className="modal-error" role="alert">
              {errorMessage}
            </div>
          )}

          <div className="form-field">
            <label htmlFor={nameInputId}>
              Meeting Name <span className="required-mark">*</span>
            </label>
            <input
              ref={nameInputRef}
              id={nameInputId}
              type="text"
              className="form-control"
              placeholder="e.g. Weekly Team Build"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (errorMessage) setErrorMessage('');
              }}
              required
            />
          </div>

          <div className="modal-grid-2">
            <div className="form-field">
              <label htmlFor={dateInputId}>
                Date <span className="required-mark">*</span>
              </label>
              <input
                id={dateInputId}
                type="date"
                className="form-control"
                value={date}
                onChange={(event) => {
                  setDate(event.target.value);
                  if (errorMessage) setErrorMessage('');
                }}
                required
              />
            </div>

            <div className="form-field">
              <label htmlFor={timeInputId}>
                Time <span className="required-mark">*</span>
              </label>
              <input
                id={timeInputId}
                type="time"
                className="form-control"
                value={time}
                onChange={(event) => {
                  setTime(event.target.value);
                  if (errorMessage) setErrorMessage('');
                }}
                required
              />
            </div>
          </div>

          <div className="modal-grid-2">
            <div className="form-field">
              <label htmlFor={locationInputId}>
                Location <span className="optional-mark">(Optional)</span>
              </label>
              <input
                id={locationInputId}
                type="text"
                className="form-control"
                placeholder="e.g. Lab 204 / Discord"
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>

            <div className="form-field">
              <label htmlFor={eventTypeInputId}>
                Event Type <span className="optional-mark">(Optional)</span>
              </label>
              <select
                id={eventTypeInputId}
                className="form-control"
                value={eventType}
                onChange={(event) => setEventType(event.target.value)}
              >
                <option value="">Unspecified</option>
                {customEventType && (
                  <option value={customEventType}>{customEventType}</option>
                )}
                {MEETING_EVENT_TYPE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-field">
            <label htmlFor={descriptionInputId}>
              Description <span className="optional-mark">(Optional)</span>
            </label>
            <textarea
              id={descriptionInputId}
              className="form-control form-textarea"
              rows={2}
              placeholder="Agenda, focus areas, or quick notes..."
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>

          {showVisibilityControls && (
            <div className="meeting-visibility-section">
              <div className="meeting-visibility-header">
                <span id={visibilityLabelId} className="meeting-visibility-label">
                  Visibility
                </span>
                <span className="meeting-visibility-admin-pill">Admin</span>
              </div>
              <MeetingVisibilityControl
                value={visibility}
                onChange={setVisibility}
                allowPrivate={allowPrivate}
                labelId={visibilityLabelId}
              />
            </div>
          )}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!hasChanges}>
              <PixelCheckIcon />
              <span>Save Changes</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
