import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
  AccessScope,
  AttendanceSession,
  ClubMember,
  ViewMode,
} from '../types/attendance';
import {
  STATUS_LABELS,
  sortSessionsNewestFirst,
  summarizeSessionAttendance,
  type SessionAttendanceSummary,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp } from '../utils/date';
import {
  shouldDeferContextMenu,
  useContextMenu,
  type ContextMenuItem,
} from './AppContextMenu';
import { ConfirmDialog } from './ConfirmDialog';
import { MeetingVisibilityBadge } from './MeetingSettingsModal';
import {
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelClockIcon,
  PixelCloseIcon,
  PixelCopyIcon,
  PixelGridIcon,
  PixelListIcon,
  PixelLockIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelSettingsIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
} from './PixelIcons';

interface SessionHubProps {
  sessions: AttendanceSession[];
  members: ClubMember[];
  viewMode: ViewMode;
  accessScope?: AccessScope;
  linkedMemberId?: string | null;
  canViewAttendanceRates?: boolean;
  canViewCalendarDetails?: boolean;
  userEmail?: string;
  canManageClubRecords?: boolean;
  onRefreshRole?: () => void;
  onChangeViewMode: (mode: ViewMode) => void;
  onSelectSession: (sessionId: string) => void;
  onEditSession: (session: AttendanceSession) => void;
  onDuplicateSession: (session: AttendanceSession) => void;
  onDeleteSession: (sessionId: string) => void;
  onOpenCreateSession: () => void;
}

/** Primary session selection hub displaying club sessions or personal participated sessions. */
export function SessionHub({
  sessions,
  members,
  viewMode,
  accessScope = 'local',
  linkedMemberId = null,
  canViewAttendanceRates = true,
  canViewCalendarDetails = true,
  userEmail,
  canManageClubRecords = true,
  onRefreshRole,
  onChangeViewMode,
  onSelectSession,
  onEditSession,
  onDuplicateSession,
  onDeleteSession,
  onOpenCreateSession,
}: SessionHubProps) {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { openContextMenu } = useContextMenu();
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

  function handleSessionContextMenu(
    event: ReactMouseEvent<HTMLElement>,
    session: AttendanceSession,
  ) {
    if (shouldDeferContextMenu(event)) return;
    const canEdit = accessScope === 'local' || accessScope === 'admin';
    const items: ContextMenuItem[] = [
      {
        type: 'action',
        id: `session-open-${session.id}`,
        label: 'Open Attendance Checklist',
        icon: <PixelListIcon width={13} height={13} />,
        onSelect: () => onSelectSession(session.id),
      },
      {
        type: 'action',
        id: `session-copy-${session.id}`,
        label: 'Copy Session Details',
        icon: <PixelCopyIcon width={13} height={13} />,
        onSelect: () => {
          const details = [
            session.name,
            `${formatSessionDate(session.date)} at ${formatSessionTime(session.time)}`,
            session.location ? `Location: ${session.location}` : null,
            session.description ? session.description : null,
          ]
            .filter(Boolean)
            .join('\n');
          void navigator.clipboard?.writeText(details).catch(() => undefined);
        },
      },
    ];

    if (canEdit) {
      items.push(
        { type: 'separator', id: `session-edit-sep-${session.id}` },
        {
          type: 'action',
          id: `session-edit-${session.id}`,
          label: 'Edit Meeting Settings',
          icon: <PixelSettingsIcon width={13} height={13} />,
          onSelect: () => onEditSession(session),
        },
        {
          type: 'action',
          id: `session-dup-${session.id}`,
          label: 'Duplicate Session',
          icon: <PixelCopyIcon width={13} height={13} />,
          onSelect: () => onDuplicateSession(session),
        },
        { type: 'separator', id: `session-del-sep-${session.id}` },
        {
          type: 'action',
          id: `session-del-${session.id}`,
          label: 'Delete Session',
          icon: <PixelTrashIcon width={13} height={13} />,
          danger: true,
          disabled: !canManageClubRecords,
          onSelect: () => setPendingDeleteSession(session),
        },
      );
    }

    openContextMenu(event, items, {
      header: `Session · ${formatSessionDate(session.date)}`,
      targetEl: event.currentTarget,
    });
  }

  const isMemberSelfScope = accessScope === 'member_self';
  const isUnlinkedMember = accessScope === 'member_unlinked';
  const canCreateOrEditSessions = accessScope === 'local' || accessScope === 'admin';
  const showPendingLinkEmptyState =
    isUnlinkedMember &&
    sessions.length === 0 &&
    !canViewCalendarDetails &&
    !canViewAttendanceRates;
  const showClubRateStats =
    accessScope === 'local' ||
    accessScope === 'admin' ||
    accessScope === 'broad_viewer' ||
    canViewAttendanceRates;

  if (showPendingLinkEmptyState) {
    return (
      <section
        className="tracker-panel session-hub-panel"
        aria-label="Account pending profile link"
        data-tutorial-target="session-hub"
      >
        <div className="tracker-panel-header">
          <div className="panel-title-group">
            <h2 className="panel-title">My Attendance</h2>
          </div>
        </div>
        <div className="tracker-body session-hub-body">
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelLockIcon />
              <span>Pending Profile Link</span>
            </div>
            <h3 className="empty-title">Your login is not linked to a club roster profile yet</h3>
            <p className="empty-description">
              You are signed in as <strong>{userEmail || 'a Member account'}</strong>. Ask a club
              administrator to link your account to your Member Manager profile in{' '}
              <strong>Settings → Admin Management</strong> so your personal attendance records and
              sessions appear here.
            </p>
            {onRefreshRole && (
              <button type="button" className="btn-primary" onClick={onRefreshRole}>
                <PixelRefreshIcon />
                <span>Check Again</span>
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="tracker-panel session-hub-panel"
      aria-label="Session selection hub"
      data-tutorial-target="session-hub"
    >
      <div className="tracker-panel-header">
        <div className="panel-title-group">
          <h2 className="panel-title">{isMemberSelfScope ? 'My Sessions' : 'Sessions Hub'}</h2>
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

          {canCreateOrEditSessions && (
            <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
              <PixelPlusIcon />
              <span>Record Session</span>
            </button>
          )}
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
            <h3 className="empty-title">
              {isMemberSelfScope
                ? 'No sessions assigned to your profile yet'
                : 'Start your first Team SPIRIT session'}
            </h3>
            <p className="empty-description">
              {isMemberSelfScope
                ? 'Sessions that include your roster profile will appear here automatically once an administrator assigns you.'
                : 'Record a meeting, practice, workshop, or event with its date, time, and optional details. Click any session card here to open its attendance checklist.'}
            </p>
            {canCreateOrEditSessions && (
              <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
                <PixelPlusIcon />
                <span>Record First Session</span>
              </button>
            )}
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
                    onContextMenu={(event) => handleSessionContextMenu(event, session)}
                    aria-label={`Open attendance checklist for ${session.name} on ${formatSessionDate(session.date)}`}
                  >
                    <div className="session-hub-card-head">
                      <div className="session-banner-title-row">
                        <h3 className="session-hub-card-title">{session.name}</h3>
                        {session.eventType && (
                          <span className="session-type-tag">{session.eventType}</span>
                        )}
                        <MeetingVisibilityBadge visibility={session.visibility} />
                      </div>

                      {canCreateOrEditSessions && (
                        <div
                          className="session-hub-card-actions"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="icon-btn session-hub-edit-btn"
                            onClick={() => onEditSession(session)}
                            aria-label={`Edit meeting settings for ${session.name}`}
                            title="Edit meeting settings"
                          >
                            <PixelSettingsIcon width={12} height={12} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn session-hub-duplicate-btn"
                            onClick={() => onDuplicateSession(session)}
                            aria-label={`Duplicate session ${session.name}`}
                            title="Duplicate session for a new date"
                          >
                            <PixelCopyIcon width={12} height={12} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger session-hub-delete-btn"
                            disabled={!canManageClubRecords}
                            onClick={() => setPendingDeleteSession(session)}
                            aria-label={`Delete session ${session.name}`}
                            title={
                              canManageClubRecords
                                ? 'Delete session'
                                : 'Admin privileges required to delete synced sessions'
                            }
                          >
                            <PixelTrashIcon width={12} height={12} />
                          </button>
                        </div>
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

                    {session.description && (
                      <p className="session-hub-card-desc">{session.description}</p>
                    )}

                    {!showClubRateStats ? (
                      (() => {
                        const myEntry = linkedMemberId
                          ? session.attendance[linkedMemberId]
                          : undefined;
                        const isAssignedToSession = Boolean(
                          linkedMemberId &&
                            (session.memberIds.includes(linkedMemberId) || myEntry),
                        );
                        const myStatus = myEntry?.status ?? 'unmarked';
                        return (
                          <div className="session-hub-card-footer">
                            <div className="session-hub-mini-chips">
                              {linkedMemberId ? (
                                isAssignedToSession ? (
                                  <span className={`status-badge status-${myStatus}`}>
                                    {STATUS_LABELS[myStatus]}
                                  </span>
                                ) : (
                                  <span className="session-type-tag">Not Assigned</span>
                                )
                              ) : (
                                <span className="session-type-tag">Scheduled Session</span>
                              )}
                              {isAssignedToSession && myEntry?.updatedAt && (
                                <span className="mono-meta">
                                  {formatTimestamp(myEntry.updatedAt)}
                                </span>
                              )}
                            </div>

                            <span className="session-hub-open-cue" aria-hidden="true">
                              <span>Details</span>
                              <PixelChevronIcon width={11} height={11} />
                            </span>
                          </div>
                        );
                      })()
                    ) : (
                      <>
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
                      </>
                    )}
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
                <article
                  key={session.id}
                  role="listitem"
                  className="session-hub-row"
                >
                  <div
                    className="session-hub-row-surface"
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectSession(session.id)}
                    onKeyDown={(event) => handleCardKeyDown(event, session.id)}
                    onContextMenu={(event) => handleSessionContextMenu(event, session)}
                    aria-label={`Open attendance checklist for ${session.name} on ${formatSessionDate(session.date)}`}
                  >
                    <div className="session-hub-row-main">
                      <div className="session-banner-title-row">
                        <h3 className="session-hub-card-title">{session.name}</h3>
                        {session.eventType && (
                          <span className="session-type-tag">{session.eventType}</span>
                        )}
                        <MeetingVisibilityBadge visibility={session.visibility} />
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

                    {!showClubRateStats ? (
                      <div className="session-hub-row-metrics">
                        {linkedMemberId ? (
                          (() => {
                            const myEntry = session.attendance[linkedMemberId];
                            const isAssignedToSession =
                              session.memberIds.includes(linkedMemberId) || Boolean(myEntry);
                            if (!isAssignedToSession) {
                              return <span className="session-type-tag">Not Assigned</span>;
                            }
                            const myStatus = myEntry?.status ?? 'unmarked';
                            return (
                              <span className={`status-badge status-${myStatus}`}>
                                {STATUS_LABELS[myStatus]}
                              </span>
                            );
                          })()
                        ) : (
                          <span className="session-type-tag">Scheduled</span>
                        )}
                      </div>
                    ) : (
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
                    )}

                    <div className="session-hub-row-right">
                      <span className="session-hub-open-cue" aria-hidden="true">
                        <span>{!showClubRateStats ? 'Details' : 'Checklist'}</span>
                        <PixelChevronIcon width={11} height={11} />
                      </span>

                      {canCreateOrEditSessions && (
                        <div
                          className="session-hub-card-actions"
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          <button
                            type="button"
                            className="icon-btn session-hub-edit-btn"
                            onClick={() => onEditSession(session)}
                            aria-label={`Edit meeting settings for ${session.name}`}
                            title="Edit meeting settings"
                          >
                            <PixelSettingsIcon width={12} height={12} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn session-hub-duplicate-btn"
                            onClick={() => onDuplicateSession(session)}
                            aria-label={`Duplicate session ${session.name}`}
                            title="Duplicate session for a new date"
                          >
                            <PixelCopyIcon width={12} height={12} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn icon-btn-danger session-hub-delete-btn"
                            disabled={!canManageClubRecords}
                            onClick={() => setPendingDeleteSession(session)}
                            aria-label={`Delete session ${session.name}`}
                            title={
                              canManageClubRecords
                                ? 'Delete session'
                                : 'Admin privileges required to delete synced sessions'
                            }
                          >
                            <PixelTrashIcon width={12} height={12} />
                          </button>
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
