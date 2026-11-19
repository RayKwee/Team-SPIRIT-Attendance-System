import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AttendanceSession, NewSessionInput } from '../types/attendance';
import { addDaysToDateKey, toIsoDateString } from '../utils/date';
import {
  PixelCalendarIcon,
  PixelCloseIcon,
  PixelCopyIcon,
  PixelPlusIcon,
} from './PixelIcons';

interface CreateSessionModalProps {
  isOpen: boolean;
  defaultDate?: string;
  duplicateSource?: AttendanceSession | null;
  duplicateMemberCount?: number;
  onClose: () => void;
  onCreateSession: (
    input: NewSessionInput,
    options?: { includeSourceMembers?: boolean },
  ) => void;
}

const EVENT_TYPE_OPTIONS = [
  'Practice',
  'Meeting',
  'Workshop',
  'Competition',
  'Social',
  'Other',
];

function getDefaultTimeValue(): string {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/** Compact voxel-styled pop-up dialog for creating or duplicating an attendance session. */
export function CreateSessionModal({
  isOpen,
  defaultDate,
  duplicateSource = null,
  duplicateMemberCount = 0,
  onClose,
  onCreateSession,
}: CreateSessionModalProps) {
  const titleId = useId();
  const nameInputId = useId();
  const dateInputId = useId();
  const timeInputId = useId();
  const locationInputId = useId();
  const eventTypeInputId = useId();
  const descriptionInputId = useId();
  const includeMembersId = useId();

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const isDuplicateMode = Boolean(duplicateSource);

  const [name, setName] = useState('');
  const [date, setDate] = useState(() => defaultDate || toIsoDateString(new Date()));
  const [time, setTime] = useState(getDefaultTimeValue);
  const [location, setLocation] = useState('');
  const [eventType, setEventType] = useState('');
  const [description, setDescription] = useState('');
  const [includeSourceMembers, setIncludeSourceMembers] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!isOpen) return;

    if (duplicateSource) {
      setName(duplicateSource.name);
      setDate(addDaysToDateKey(duplicateSource.date, 7));
      setTime(duplicateSource.time);
      setLocation(duplicateSource.location ?? '');
      setEventType(duplicateSource.eventType ?? '');
      setDescription(duplicateSource.description ?? '');
      setIncludeSourceMembers(true);
    } else {
      setName('');
      setDate(defaultDate || toIsoDateString(new Date()));
      setTime(getDefaultTimeValue());
      setLocation('');
      setEventType('');
      setDescription('');
      setIncludeSourceMembers(false);
    }
    setErrorMessage('');

    const focusTimer = window.setTimeout(() => {
      nameInputRef.current?.focus();
    }, 0);

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, defaultDate, duplicateSource, onClose]);

  if (!isOpen) {
    return null;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanedName = name.trim();
    if (!cleanedName) {
      setErrorMessage('Please enter a session name.');
      nameInputRef.current?.focus();
      return;
    }
    if (!date) {
      setErrorMessage('Please choose a session date.');
      return;
    }
    if (!time) {
      setErrorMessage('Please choose a session time.');
      return;
    }

    onCreateSession(
      {
        name: cleanedName,
        date,
        time,
        location: location.trim() || undefined,
        eventType: eventType.trim() || undefined,
        description: description.trim() || undefined,
      },
      isDuplicateMode ? { includeSourceMembers } : undefined,
    );
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
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="modal-header">
          <div className="modal-title-group">
            <span className="modal-badge">
              {isDuplicateMode ? <PixelCopyIcon /> : <PixelCalendarIcon />}
              <span>{isDuplicateMode ? 'Duplicate Session' : 'New Session'}</span>
            </span>
            <h2 id={titleId} className="modal-title">
              {isDuplicateMode ? 'Clone Recurring Session' : 'Record Attendance Session'}
            </h2>
          </div>

          <button
            type="button"
            className="modal-close-btn"
            onClick={onClose}
            aria-label="Close session window"
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
              Session Name <span className="required-mark">*</span>
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
                {EVENT_TYPE_OPTIONS.map((option) => (
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

          {isDuplicateMode && duplicateMemberCount > 0 && (
            <label className="cloud-sync-merge-option" htmlFor={includeMembersId}>
              <input
                id={includeMembersId}
                type="checkbox"
                checked={includeSourceMembers}
                onChange={(event) => setIncludeSourceMembers(event.target.checked)}
              />
              <span>
                Pre-assign {duplicateMemberCount}{' '}
                {duplicateMemberCount === 1 ? 'member' : 'members'} from the original session
                with fresh attendance marks
              </span>
            </label>
          )}

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              {isDuplicateMode ? <PixelCopyIcon /> : <PixelPlusIcon />}
              <span>{isDuplicateMode ? 'Create Duplicate' : 'Create Session'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
