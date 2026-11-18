import { useMemo, useState } from 'react';
import type { AttendanceSession, ClubMember } from '../types/attendance';
import { STATUS_LABELS, summarizeSessionAttendance } from '../utils/attendance';
import {
  buildMonthGrid,
  formatMonthYearLabel,
  formatSessionDate,
  formatSessionTime,
  toIsoDateString,
} from '../utils/date';
import {
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelClockIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelTerminalIcon,
} from './PixelIcons';

interface SessionCalendarWorkspaceProps {
  sessions: AttendanceSession[];
  members: ClubMember[];
  selectedDateKey: string;
  onSelectDate: (dateKey: string) => void;
  onOpenCreateSessionForDate: (dateKey: string) => void;
  onOpenSessionInTracker: (sessionId: string) => void;
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Interactive monthly calendar and day-detail summary backed by local session records. */
export function SessionCalendarWorkspace({
  sessions,
  members,
  selectedDateKey,
  onSelectDate,
  onOpenCreateSessionForDate,
  onOpenSessionInTracker,
}: SessionCalendarWorkspaceProps) {
  const now = new Date();
  const [viewYear, setViewYear] = useState(now.getFullYear());
  const [viewMonth, setViewMonth] = useState(now.getMonth());

  const sessionsByDate = useMemo(() => {
    const grouped = new Map<string, AttendanceSession[]>();
    for (const session of sessions) {
      const existing = grouped.get(session.date);
      if (existing) {
        existing.push(session);
      } else {
        grouped.set(session.date, [session]);
      }
    }
    for (const list of grouped.values()) {
      list.sort((a, b) => a.time.localeCompare(b.time));
    }
    return grouped;
  }, [sessions]);

  const monthCells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;
  const monthSessionCount = sessions.filter((session) => session.date.startsWith(monthPrefix)).length;
  const selectedDaySessions = sessionsByDate.get(selectedDateKey) ?? [];

  function handlePrevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function handleToday() {
    const today = new Date();
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    onSelectDate(toIsoDateString(today));
  }

  function handleCellClick(dateKey: string, inCurrentMonth: boolean) {
    onSelectDate(dateKey);
    if (!inCurrentMonth) {
      const [yStr, mStr] = dateKey.split('-');
      const year = Number(yStr);
      const month = Number(mStr) - 1;
      if (!Number.isNaN(year) && !Number.isNaN(month)) {
        setViewYear(year);
        setViewMonth(month);
      }
    }
  }

  return (
    <div className="calendar-layout">
      <section className="tracker-panel calendar-panel" aria-label="Monthly session calendar">
        <div className="tracker-panel-header">
          <div className="panel-title-group">
            <h2 className="panel-title">Session Calendar</h2>
            <span className="panel-count">{monthSessionCount} this month</span>
            <span className="sync-pill" title="Reads directly from local browser storage">
              <span className="sync-dot" aria-hidden="true" />
              Saved Locally
            </span>
          </div>

          <div className="calendar-nav-controls">
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={handlePrevMonth}
              aria-label="Previous month"
            >
              Prev
            </button>
            <button type="button" className="btn-secondary btn-compact" onClick={handleToday}>
              Today
            </button>
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={handleNextMonth}
              aria-label="Next month"
            >
              Next
            </button>
          </div>
        </div>

        <div className="calendar-month-bar">
          <h3 className="calendar-month-title">{formatMonthYearLabel(viewYear, viewMonth)}</h3>
          <div className="calendar-legend" aria-hidden="true">
            <span className="legend-item">
              <span className="legend-dot legend-dot-session" />
              Recorded Session
            </span>
            <span className="legend-item">
              <span className="legend-dot legend-dot-today" />
              Today
            </span>
          </div>
        </div>

        <div className="calendar-weekdays" role="row">
          {WEEKDAY_HEADERS.map((day) => (
            <div key={day} className="calendar-weekday" role="columnheader">
              {day}
            </div>
          ))}
        </div>

        <div className="calendar-grid" role="grid" aria-label={formatMonthYearLabel(viewYear, viewMonth)}>
          {monthCells.map((cell) => {
            const daySessions = sessionsByDate.get(cell.dateKey) ?? [];
            const hasSessions = daySessions.length > 0;
            const isSelected = cell.dateKey === selectedDateKey;
            const previewSessions = daySessions.slice(0, 2);
            const overflowCount = daySessions.length - previewSessions.length;

            const cellClasses = [
              'calendar-day-cell',
              !cell.inCurrentMonth ? 'is-outside' : '',
              cell.isToday ? 'is-today' : '',
              isSelected ? 'is-selected' : '',
              hasSessions ? 'has-sessions' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <button
                key={cell.dateKey}
                type="button"
                className={cellClasses}
                aria-pressed={isSelected}
                aria-label={`${formatSessionDate(cell.dateKey)}, ${daySessions.length} recorded ${
                  daySessions.length === 1 ? 'session' : 'sessions'
                }`}
                onClick={() => handleCellClick(cell.dateKey, cell.inCurrentMonth)}
              >
                <div className="calendar-day-top">
                  <span className="calendar-day-number">{cell.dayNumber}</span>
                  {hasSessions && (
                    <span className="calendar-session-count">{daySessions.length}</span>
                  )}
                </div>

                {hasSessions && (
                  <div className="calendar-day-tags">
                    {previewSessions.map((session) => (
                      <span key={session.id} className="calendar-day-tag" title={session.name}>
                        {session.name}
                      </span>
                    ))}
                    {overflowCount > 0 && (
                      <span className="calendar-day-more">+{overflowCount} more</span>
                    )}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <aside className="tracker-panel day-detail-panel" aria-label="Selected day session details">
        <div className="tracker-panel-header">
          <div className="panel-title-group">
            <h2 className="panel-title">Day Summary</h2>
            <span className="panel-count">
              {selectedDaySessions.length}{' '}
              {selectedDaySessions.length === 1 ? 'session' : 'sessions'}
            </span>
          </div>
          <span className="day-detail-date mono-cell">{formatSessionDate(selectedDateKey)}</span>
        </div>

        <div className="day-detail-body">
          {selectedDaySessions.length === 0 ? (
            <div className="reserved-empty-state day-detail-empty">
              <div className="empty-badge">
                <PixelTerminalIcon />
                <span>No Sessions</span>
              </div>
              <h3 className="empty-title">Nothing logged for this date</h3>
              <p className="empty-description">
                Click any highlighted date on the calendar to inspect recorded sessions, or log a new
                session for {formatSessionDate(selectedDateKey)}.
              </p>
              <button
                type="button"
                className="btn-primary"
                onClick={() => onOpenCreateSessionForDate(selectedDateKey)}
              >
                <PixelPlusIcon />
                <span>Record Session</span>
              </button>
            </div>
          ) : (
            <div className="day-session-list">
              {selectedDaySessions.map((session) => {
                const summary = summarizeSessionAttendance(session, members);

                return (
                  <article key={session.id} className="day-session-card">
                    <div className="day-session-card-head">
                      <div className="session-banner-title-row">
                        <h3 className="day-session-title">{session.name}</h3>
                        {session.eventType && (
                          <span className="session-type-tag">{session.eventType}</span>
                        )}
                      </div>

                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => onOpenSessionInTracker(session.id)}
                      >
                        <span>Open in Tracker</span>
                        <PixelChevronIcon width={11} height={11} />
                      </button>
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
                      <p className="session-banner-description">{session.description}</p>
                    )}

                    <div className="day-summary-metrics">
                      <div className="day-metric" data-accent="green">
                        <span className="day-metric-label">Present</span>
                        <span className="day-metric-value">{summary.presentCount}</span>
                      </div>
                      <div className="day-metric" data-accent="gold">
                        <span className="day-metric-label">Absent (Reason)</span>
                        <span className="day-metric-value">{summary.absentWithReasonCount}</span>
                      </div>
                      <div className="day-metric" data-accent="red">
                        <span className="day-metric-label">Absent (No Reason)</span>
                        <span className="day-metric-value">{summary.absentWithoutReasonCount}</span>
                      </div>
                      <div className="day-metric" data-accent="cyan">
                        <span className="day-metric-label">Rate</span>
                        <span className="day-metric-value">
                          {summary.rate !== null ? `${summary.rate}%` : '--%'}
                        </span>
                      </div>
                    </div>

                    <div className="day-member-breakdown">
                      <div className="day-breakdown-header">
                        <span>Attendance Breakdown</span>
                        <span className="mono-cell">{members.length} members</span>
                      </div>

                      {members.length === 0 ? (
                        <p className="day-breakdown-empty">
                          No members in roster yet. Open this session in the tracker to add members.
                        </p>
                      ) : (
                        <ul className="day-member-list">
                          {members.map((member) => {
                            const entry = session.attendance[member.id];
                            const status = entry?.status ?? 'unmarked';
                            const reason = entry?.reason?.trim();

                            return (
                              <li key={member.id} className="day-member-item">
                                <div className="day-member-main">
                                  <span className="day-member-name">{member.name}</span>
                                  <span className={`status-badge status-${status}`}>
                                    {STATUS_LABELS[status]}
                                  </span>
                                </div>
                                {status === 'absent_with_reason' && reason && (
                                  <p className="day-member-reason">Reason: {reason}</p>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
