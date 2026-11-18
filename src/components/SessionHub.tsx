import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AttendanceSession, ClubMember, ViewMode } from '../types/attendance';
import {
  sortSessionsNewestFirst,
  summarizeSessionAttendance,
  type SessionAttendanceSummary,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelClockIcon,
  PixelCloseIcon,
  PixelGridIcon,
  PixelListIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelSearchIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
} from './PixelIcons';

interface SessionHubProps {
  sessions: AttendanceSession[];
  members: ClubMember[];
  viewMode: ViewMode;
  onChangeViewMode: (mode: ViewMode) => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenCreateSession: () => void;
}

/** Primary session selection hub displaying all recorded meetings/events with live search & filtering. */
export function SessionHub({
  sessions,
  members,
  viewMode,
  onChangeViewMode,
  onSelectSession,
  onDeleteSession,
  onOpenCreateSession,
}: SessionHubProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [pendingDeleteSession, setPendingDeleteSession] = useState<AttendanceSession | null>(null);

  const orderedSessions = useMemo(() => sortSessionsNewestFirst(sessions), [sessions]);

  const distinctEventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const session of sessions) {
      if (session.eventType) {
        types.add(session.eventType);
      }
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [sessions]);

  const activeTypeFilter =
    typeFilter !== 'all' && !distinctEventTypes.includes(typeFilter) ? 'all' : typeFilter;

  const sessionSummaries = useMemo(() => {
    const map = new Map<string, SessionAttendanceSummary>();
    for (const session of orderedSessions) {
      map.set(session.id, summarizeSessionAttendance(session, members));
    }
    return map;
  }, [orderedSessions, members]);

  const filteredSessions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return orderedSessions.filter((session) => {
      if (activeTypeFilter !== 'all' && session.eventType !== activeTypeFilter) {
        return false;
      }
      if (!query) return true;

      const formattedDate = formatSessionDate(session.date);
      return [
        session.name,
        session.date,
        formattedDate,
        session.eventType,
        session.location,
        session.description,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [orderedSessions, activeTypeFilter, searchQuery]);

  const activePendingDelete =
    pendingDeleteSession && sessions.some((session) => session.id === pendingDeleteSession.id)
      ? pendingDeleteSession
      : null;

  const hasActiveFilters = searchQuery.trim().length > 0 || activeTypeFilter !== 'all';

  function handleClearFilters() {
    setSearchQuery('');
    setTypeFilter('all');
    searchInputRef.current?.focus();
  }

  function handleCardKeyDown(event: ReactKeyboardEvent<HTMLElement>, sessionId: string) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectSession(sessionId);
    }
  }

  function handleConfirmDelete() {
    if (!activePendingDelete) return;
    onDeleteSession(activePendingDelete.id);
    setPendingDeleteSession(null);
  }

  return (
    <section className="tracker-panel session-hub-panel" aria-label="Session selection hub">
      <div className="tracker-panel-header">
        <div className="panel-title-group">
          <h2 className="panel-title">Sessions Hub</h2>
          <span className="panel-count">
            {hasActiveFilters
              ? `${filteredSessions.length} / ${sessions.length}`
              : sessions.length}
          </span>
        </div>

        <div className="panel-header-actions">
          {sessions.length > 0 && (
            <div className="view-toggle" role="group" aria-label="Sessions hub layout">
              <button
                type="button"
                className={`view-btn ${viewMode === 'grid' ? 'is-active' : ''}`}
                onClick={() => onChangeViewMode('grid')}
              >
                <PixelGridIcon />
                <span>Cards</span>
              </button>
              <button
                type="button"
                className={`view-btn ${viewMode === 'list' ? 'is-active' : ''}`}
                onClick={() => onChangeViewMode('list')}
              >
                <PixelListIcon />
                <span>List</span>
              </button>
            </div>
          )}

          <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
            <PixelPlusIcon />
            <span>Record Session</span>
          </button>
        </div>
      </div>

      {sessions.length > 0 && (
        <div className="session-hub-toolbar">
          <div className="session-hub-search-wrap">
            <span className="session-suggest-icon" aria-hidden="true">
              <PixelSearchIcon />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              className="form-control session-hub-search-input"
              placeholder="Search sessions by name, date, type, or location..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search recorded sessions by name, date, type, or location"
            />
            {searchQuery.length > 0 && (
              <button
                type="button"
                className="session-suggest-clear"
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                aria-label="Clear session search"
                title="Clear search"
              >
                <PixelCloseIcon width={11} height={11} />
              </button>
            )}
          </div>

          {distinctEventTypes.length > 0 && (
            <div className="filter-pills session-hub-type-pills" role="tablist" aria-label="Filter sessions by event type">
              <button
                type="button"
                role="tab"
                aria-selected={activeTypeFilter === 'all'}
                className={`filter-pill ${activeTypeFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setTypeFilter('all')}
              >
                All Types
              </button>
              {distinctEventTypes.map((eventType) => (
                <button
                  key={eventType}
                  type="button"
                  role="tab"
                  aria-selected={activeTypeFilter === eventType}
                  className={`filter-pill ${activeTypeFilter === eventType ? 'is-active' : ''}`}
                  onClick={() => setTypeFilter(eventType)}
                >
                  {eventType}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="tracker-body session-hub-body">
        {sessions.length === 0 ? (
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelTerminalIcon />
              <span>No Sessions Logged</span>
            </div>
            <h3 className="empty-title">Start your first Team SPIRIT session</h3>
            <p className="empty-description">
              Record a meeting, practice, workshop, or event with its date, time, and optional
              details. Click any session card here to open its attendance checklist.
            </p>
            <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
              <PixelPlusIcon />
              <span>Record First Session</span>
            </button>
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelTerminalIcon />
              <span>No Matches</span>
            </div>
            <h3 className="empty-title">No sessions match your search</h3>
            <p className="empty-description">
              Try searching a different session name, date, event type, or location, or reset your
              filters to view all {sessions.length}{' '}
              {sessions.length === 1 ? 'recorded session' : 'recorded sessions'}.
            </p>
            <button type="button" className="btn-secondary" onClick={handleClearFilters}>
              Clear Filters
            </button>
          </div>
        ) : viewMode === 'grid' ? (
          <div className="session-hub-grid" role="list" aria-label="Recorded sessions">
            {filteredSessions.map((session) => {
              const summary =
                sessionSummaries.get(session.id) ?? summarizeSessionAttendance(session, members);
              const fillPercent = summary.rate ?? 0;

              return (
                <article
                  key={session.id}
                  role="listitem"
                  className="session-hub-card"
                >
                  <div
                    className="session-hub-card-surface"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSession(session.id)}
                    onKeyDown={(event) => handleCardKeyDown(event, session.id)}
                    aria-label={`Open attendance checklist for ${session.name} on ${formatSessionDate(session.date)}`}
                  >
                    <div className="session-hub-card-head">
                      <div className="session-banner-title-row">
                        <h3 className="session-hub-card-title">{session.name}</h3>
                        {session.eventType && (
                          <span className="session-type-tag">{session.eventType}</span>
                        )}
                      </div>

                      <div
                        className="session-hub-card-actions"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger session-hub-delete-btn"
                          onClick={() => setPendingDeleteSession(session)}
                          aria-label={`Delete session ${session.name}`}
                          title="Delete session"
                        >
                          <PixelTrashIcon width={12} height={12} />
                        </button>
                      </div>
                    </div>

                    <div className="session-meta-pills">
                      <span className="session-meta-pill">
                        <PixelCalendarIcon />
                        <span>{formatSessionDate(session.date)}</span>
                      </span>
                      <span className="session-meta-pill">
                        <PixelClockIcon />
                        <span>{formatSessionTime(session.time)}</span>
                      </span>
                      {session.location && (
                        <span className="session-meta-pill">
                          <PixelPinIcon />
                          <span>{session.location}</span>
                        </span>
                      )}
                    </div>

                    {session.description && (
                      <p className="session-hub-card-desc">{session.description}</p>
                    )}

                    <div className="session-hub-card-stats">
                      <div className="session-hub-stat-row">
                        <span className="mono-meta">
                          {summary.totalMembers > 0
                            ? `${summary.presentCount}/${summary.totalMembers} present`
                            : '0 members assigned'}
                        </span>
                        <span className="member-rate-chip" title="Session attendance rate">
                          {summary.rate !== null ? `${summary.rate}%` : '--%'}
                        </span>
                      </div>

                      <div
                        className="calendar-mini-meter"
                        aria-hidden="true"
                        title={`${summary.presentCount}/${summary.totalMembers} present`}
                      >
                        <div
                          className="calendar-mini-meter-fill"
                          style={{ width: `${fillPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="session-hub-card-footer">
                      <div className="session-hub-mini-chips">
                        <span className="agenda-stat-chip is-present">
                          Present {summary.presentCount}
                        </span>
                        <span className="agenda-stat-chip is-reason">
                          Excused {summary.absentWithReasonCount}
                        </span>
                        <span className="agenda-stat-chip is-absent">
                          Unexcused {summary.absentWithoutReasonCount}
                        </span>
                      </div>

                      <span className="session-hub-open-cue" aria-hidden="true">
                        <span>Open</span>
                        <PixelChevronIcon width={11} height={11} />
                      </span>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="session-hub-list" role="list" aria-label="Recorded sessions">
            {filteredSessions.map((session) => {
              const summary =
                sessionSummaries.get(session.id) ?? summarizeSessionAttendance(session, members);
              const fillPercent = summary.rate ?? 0;

              return (
                <article key={session.id} role="listitem" className="session-hub-row">
                  <div
                    className="session-hub-row-surface"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSession(session.id)}
                    onKeyDown={(event) => handleCardKeyDown(event, session.id)}
                    aria-label={`Open attendance checklist for ${session.name} on ${formatSessionDate(session.date)}`}
                  >
                    <div className="session-hub-row-main">
                      <div className="session-banner-title-row">
                        <h3 className="session-hub-card-title">{session.name}</h3>
                        {session.eventType && (
                          <span className="session-type-tag">{session.eventType}</span>
                        )}
                      </div>

                      <div className="session-meta-pills">
                        <span className="session-meta-pill">
                          <PixelCalendarIcon />
                          <span>{formatSessionDate(session.date)}</span>
                        </span>
                        <span className="session-meta-pill">
                          <PixelClockIcon />
                          <span>{formatSessionTime(session.time)}</span>
                        </span>
                        {session.location && (
                          <span className="session-meta-pill">
                            <PixelPinIcon />
                            <span>{session.location}</span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="session-hub-row-metrics">
                      <div className="session-hub-stat-row">
                        <span className="mono-meta">
                          {summary.totalMembers > 0
                            ? `${summary.presentCount}/${summary.totalMembers} present`
                            : '0 assigned'}
                        </span>
                        <span className="member-rate-chip">
                          {summary.rate !== null ? `${summary.rate}%` : '--%'}
                        </span>
                      </div>
                      <div className="calendar-mini-meter" aria-hidden="true">
                        <div
                          className="calendar-mini-meter-fill"
                          style={{ width: `${fillPercent}%` }}
                        />
                      </div>
                    </div>

                    <div className="session-hub-row-right">
                      <span className="session-hub-open-cue" aria-hidden="true">
                        <span>Checklist</span>
                        <PixelChevronIcon width={11} height={11} />
                      </span>

                      <div
                        className="session-hub-card-actions"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger session-hub-delete-btn"
                          onClick={() => setPendingDeleteSession(session)}
                          aria-label={`Delete session ${session.name}`}
                          title="Delete session"
                        >
                          <PixelTrashIcon width={12} height={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={activePendingDelete !== null}
        badgeLabel="Delete Session"
        title={activePendingDelete ? `Delete "${activePendingDelete.name}"?` : ''}
        message={
          activePendingDelete
            ? `Are you sure you want to permanently delete the session "${activePendingDelete.name}" and all of its recorded attendance marks? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete Session"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteSession(null)}
      />
    </section>
  );
}
