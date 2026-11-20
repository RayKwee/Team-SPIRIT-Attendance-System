import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import type {
  AccessScope,
  AttendanceSession,
  CalendarViewMode,
  ClubMember,
} from '../types/attendance';
import {
  MEMBER_TYPE_LABELS,
  STATUS_LABELS,
  getSessionAssignedMembers,
  isLegacyMember,
  normalizeMemberType,
  summarizeSessionAttendance,
  summarizeSessionsAggregate,
  type SessionAttendanceSummary,
} from '../utils/attendance';
import {
  addDaysToDateKey,
  addMonthsToDateKey,
  addYearsToDateKey,
  buildMonthGrid,
  buildWeekDays,
  buildYearMonths,
  formatMonthYearLabel,
  formatSessionDate,
  formatSessionTime,
  formatShortMonthDay,
  formatWeekRangeLabel,
  parseIsoDateKey,
  parseJumpDateInput,
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
  viewMode: CalendarViewMode;
  accessScope?: AccessScope;
  linkedMemberId?: string | null;
  canViewAttendanceRates?: boolean;
  canViewCalendarDetails?: boolean;
  canBrowseFullRoster?: boolean;
  onChangeViewMode: (mode: CalendarViewMode) => void;
  onSelectDate: (dateKey: string) => void;
  onOpenCreateSessionForDate: (dateKey: string) => void;
  onOpenSessionInTracker: (sessionId: string) => void;
  onOpenMemberProfile: (memberId: string) => void;
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MINI_WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const CALENDAR_VIEW_OPTIONS: { value: CalendarViewMode; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

function getRateBadgeText(summary: SessionAttendanceSummary): string {
  if (summary.totalMembers === 0) return '0 assigned';
  return summary.rate !== null ? `${summary.rate}%` : '--%';
}

/** Interactive multi-view (Day, Week, Month, Year) calendar and day-detail summary. */
export function SessionCalendarWorkspace({
  sessions,
  members,
  selectedDateKey,
  viewMode,
  accessScope = 'local',
  linkedMemberId = null,
  canViewAttendanceRates = true,
  canViewCalendarDetails = true,
  canBrowseFullRoster = true,
  onChangeViewMode,
  onSelectDate,
  onOpenCreateSessionForDate,
  onOpenSessionInTracker,
  onOpenMemberProfile,
}: SessionCalendarWorkspaceProps) {
  const jumpInputId = useId();
  const jumpErrorId = useId();

  const [jumpInput, setJumpInput] = useState(selectedDateKey);
  const [isJumpFocused, setIsJumpFocused] = useState(false);
  const [jumpError, setJumpError] = useState('');

  useEffect(() => {
    if (!isJumpFocused) {
      setJumpInput(selectedDateKey);
      setJumpError('');
    }
  }, [selectedDateKey, isJumpFocused]);

  const anchorDate = useMemo(
    () => parseIsoDateKey(selectedDateKey) ?? new Date(),
    [selectedDateKey],
  );
  const viewYear = anchorDate.getFullYear();
  const viewMonth = anchorDate.getMonth();
  const todayKey = toIsoDateString(new Date());

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

  const sessionSummariesById = useMemo(() => {
    const map = new Map<string, SessionAttendanceSummary>();
    for (const session of sessions) {
      map.set(session.id, summarizeSessionAttendance(session, members));
    }
    return map;
  }, [sessions, members]);

  const weekDays = useMemo(() => buildWeekDays(selectedDateKey), [selectedDateKey]);
  const monthCells = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);
  const yearMonths = useMemo(() => buildYearMonths(viewYear), [viewYear]);

  const monthPrefix = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-`;
  const yearPrefix = `${viewYear}-`;

  const visiblePeriodSessions = useMemo(() => {
    if (viewMode === 'day') {
      return sessionsByDate.get(selectedDateKey) ?? [];
    }
    if (viewMode === 'week') {
      const weekKeySet = new Set(weekDays.map((day) => day.dateKey));
      return sessions.filter((session) => weekKeySet.has(session.date));
    }
    if (viewMode === 'month') {
      return sessions.filter((session) => session.date.startsWith(monthPrefix));
    }
    return sessions.filter((session) => session.date.startsWith(yearPrefix));
  }, [viewMode, sessionsByDate, selectedDateKey, weekDays, sessions, monthPrefix, yearPrefix]);

  const periodAggregate = useMemo(
    () => summarizeSessionsAggregate(visiblePeriodSessions, members),
    [visiblePeriodSessions, members],
  );

  const selectedDaySessions = sessionsByDate.get(selectedDateKey) ?? [];
  const selectedDayAggregate = useMemo(
    () => summarizeSessionsAggregate(selectedDaySessions, members),
    [selectedDaySessions, members],
  );

  function handleStepPeriod(direction: -1 | 1) {
    if (viewMode === 'day') {
      onSelectDate(addDaysToDateKey(selectedDateKey, direction));
    } else if (viewMode === 'week') {
      onSelectDate(addDaysToDateKey(selectedDateKey, direction * 7));
    } else if (viewMode === 'month') {
      onSelectDate(addMonthsToDateKey(selectedDateKey, direction));
    } else {
      onSelectDate(addYearsToDateKey(selectedDateKey, direction));
    }
  }

  function handleToday() {
    const today = toIsoDateString(new Date());
    onSelectDate(today);
    setJumpInput(today);
    setJumpError('');
  }

  function handleJumpInputChange(nextValue: string) {
    setJumpInput(nextValue);
    if (jumpError) setJumpError('');

    const parsed = parseJumpDateInput(nextValue, { allowPartial: false });
    if (parsed) {
      onSelectDate(parsed.dateKey);
    }
  }

  function handleJumpSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseJumpDateInput(jumpInput, { allowPartial: true });
    if (!parsed) {
      setJumpError('Enter a valid date (e.g. 2026-11-18, 11/18/2026, or 2026-11)');
      return;
    }

    setJumpError('');
    onSelectDate(parsed.dateKey);
    setJumpInput(parsed.dateKey);
  }

  function handleDrillToMonth(monthIndex: number) {
    const targetPrefix = `${viewYear}-${String(monthIndex + 1).padStart(2, '0')}`;
    const maxDay = new Date(viewYear, monthIndex + 1, 0).getDate();
    const clampedDay = Math.min(anchorDate.getDate(), maxDay);
    const targetDateKey = `${targetPrefix}-${String(clampedDay).padStart(2, '0')}`;
    onSelectDate(targetDateKey);
    onChangeViewMode('month');
  }

  const canCreateSessions = accessScope === 'local' || accessScope === 'admin';
  const showClubRateDetails =
    accessScope === 'local' ||
    accessScope === 'admin' ||
    accessScope === 'broad_viewer' ||
    canViewAttendanceRates;
  const canOpenPeerProfiles =
    accessScope === 'local' ||
    accessScope === 'admin' ||
    accessScope === 'broad_viewer' ||
    canBrowseFullRoster;
  void canViewCalendarDetails;

  const periodTitle =
    viewMode === 'day'
      ? formatSessionDate(selectedDateKey)
      : viewMode === 'week'
        ? formatWeekRangeLabel(weekDays)
        : viewMode === 'month'
          ? formatMonthYearLabel(viewYear, viewMonth)
          : String(viewYear);

  const periodCountLabel =
    viewMode === 'day'
      ? selectedDateKey === todayKey
        ? `${visiblePeriodSessions.length} today`
        : `${visiblePeriodSessions.length} ${
            visiblePeriodSessions.length === 1 ? 'session' : 'sessions'
          }`
      : viewMode === 'week'
        ? `${visiblePeriodSessions.length} this week`
        : viewMode === 'month'
          ? `${visiblePeriodSessions.length} this month`
          : `${visiblePeriodSessions.length} in ${viewYear}`;

  const periodUnitLabel =
    viewMode === 'day'
      ? 'day'
      : viewMode === 'week'
        ? 'week'
        : viewMode === 'month'
          ? 'month'
          : 'year';

  return (
    <div className="calendar-layout" data-tutorial-target="calendar-workspace">
      <section className="tracker-panel calendar-panel" aria-label="Session calendar">
        <div className="tracker-panel-header">
          <div className="panel-title-group">
            <h2 className="panel-title">Session Calendar</h2>
            <span className="panel-count">{periodCountLabel}</span>
            <span
              className="sync-pill"
              title={
                accessScope === 'local'
                  ? 'Reads directly from local browser storage'
                  : 'Synced live with Supabase Cloud Sync'
              }
            >
              <span className="sync-dot" aria-hidden="true" />
              {accessScope === 'local' ? 'Saved Locally' : 'Cloud Synced'}
            </span>
          </div>

          <div className="calendar-header-controls">
            <div className="calendar-view-switcher" role="tablist" aria-label="Calendar view mode">
              {CALENDAR_VIEW_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={viewMode === option.value}
                  className={`view-btn ${viewMode === option.value ? 'is-active' : ''}`}
                  onClick={() => onChangeViewMode(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="calendar-nav-controls">
              <button
                type="button"
                className="btn-secondary btn-compact"
                onClick={() => handleStepPeriod(-1)}
                aria-label={`Previous ${periodUnitLabel}`}
              >
                Prev
              </button>
              <button type="button" className="btn-secondary btn-compact" onClick={handleToday}>
                Today
              </button>
              <button
                type="button"
                className="btn-secondary btn-compact"
                onClick={() => handleStepPeriod(1)}
                aria-label={`Next ${periodUnitLabel}`}
              >
                Next
              </button>
            </div>
          </div>
        </div>

        <div className="calendar-month-bar">
          <div className="calendar-period-summary">
            <h3 className="calendar-month-title">{periodTitle}</h3>
            {periodAggregate.sessionCount > 0 && (
              <span
                className="calendar-period-rate-pill"
                title={
                  showClubRateDetails
                    ? `${periodAggregate.presentCount} present out of ${periodAggregate.totalAssignments} assigned marks`
                    : `${periodAggregate.sessionCount} scheduled sessions`
                }
              >
                {showClubRateDetails && periodAggregate.rate !== null
                  ? `${periodAggregate.rate}% attendance (${periodAggregate.presentCount}/${periodAggregate.totalAssignments})`
                  : `${periodAggregate.sessionCount} ${
                      periodAggregate.sessionCount === 1 ? 'session' : 'sessions'
                    }`}
              </span>
            )}
          </div>

          <div className="calendar-bar-tools">
            <form className="calendar-jump-form" onSubmit={handleJumpSubmit} noValidate>
              <label className="calendar-jump-label" htmlFor={jumpInputId}>
                Jump to Date
              </label>
              <div className="calendar-jump-input-row">
                <input
                  id={jumpInputId}
                  type="text"
                  className={`form-control calendar-jump-input ${jumpError ? 'has-error' : ''}`}
                  placeholder="YYYY-MM-DD"
                  value={jumpInput}
                  onFocus={() => setIsJumpFocused(true)}
                  onBlur={() => setIsJumpFocused(false)}
                  onChange={(event) => handleJumpInputChange(event.target.value)}
                  aria-invalid={jumpError ? true : undefined}
                  aria-describedby={jumpError ? jumpErrorId : undefined}
                />
                <button type="submit" className="btn-secondary btn-compact calendar-jump-btn">
                  Go
                </button>
              </div>
              {jumpError && (
                <span id={jumpErrorId} className="calendar-jump-error" role="alert">
                  {jumpError}
                </span>
              )}
            </form>

            <div className="calendar-legend" aria-hidden="true">
              <span className="legend-item">
                <span className="legend-dot legend-dot-session" />
                Session
              </span>
              <span className="legend-item">
                <span className="legend-dot legend-dot-today" />
                Today
              </span>
            </div>
          </div>
        </div>

        {viewMode === 'day' && (
          <div className="calendar-day-view">
            <div className="calendar-day-hero">
              <div className="calendar-day-hero-info">
                <div className="calendar-day-hero-badges">
                  <span className="modal-badge">
                    <PixelCalendarIcon />
                    <span>Day View</span>
                  </span>
                  {selectedDateKey === todayKey && (
                    <span className="calendar-today-badge">Today</span>
                  )}
                </div>
                <p className="calendar-day-hero-sub">
                  {selectedDaySessions.length === 0
                    ? 'No sessions recorded for this date.'
                    : `${selectedDaySessions.length} recorded ${
                        selectedDaySessions.length === 1 ? 'session' : 'sessions'
                      } ordered chronologically.`}
                </p>
              </div>

              {canCreateSessions && (
                <button
                  type="button"
                  className="btn-primary btn-compact-primary"
                  onClick={() => onOpenCreateSessionForDate(selectedDateKey)}
                >
                  <PixelPlusIcon />
                  <span>Record Session</span>
                </button>
              )}
            </div>

            {selectedDaySessions.length > 0 && showClubRateDetails && (
              <div className="day-summary-metrics calendar-day-rollup">
                <div className="day-metric" data-accent="cyan">
                  <span className="day-metric-label">Sessions</span>
                  <span className="day-metric-value">{selectedDayAggregate.sessionCount}</span>
                </div>
                <div className="day-metric" data-accent="green">
                  <span className="day-metric-label">Present Marks</span>
                  <span className="day-metric-value">{selectedDayAggregate.presentCount}</span>
                </div>
                <div className="day-metric" data-accent="gold">
                  <span className="day-metric-label">Total Absences</span>
                  <span className="day-metric-value">
                    {selectedDayAggregate.absentWithReasonCount +
                      selectedDayAggregate.absentWithoutReasonCount}
                  </span>
                </div>
                <div className="day-metric" data-accent="cyan">
                  <span className="day-metric-label">Day Rate</span>
                  <span className="day-metric-value">
                    {selectedDayAggregate.rate !== null ? `${selectedDayAggregate.rate}%` : '--%'}
                  </span>
                </div>
              </div>
            )}

            {selectedDaySessions.length === 0 ? (
              <div className="reserved-empty-state day-detail-empty">
                <div className="empty-badge">
                  <PixelTerminalIcon />
                  <span>Day Clear</span>
                </div>
                <h3 className="empty-title">No sessions on {formatSessionDate(selectedDateKey)}</h3>
                <p className="empty-description">
                  {canCreateSessions
                    ? 'Log a session for this day or use Prev / Next or Jump to Date to inspect other recorded sessions.'
                    : 'Use Prev / Next or Jump to Date to inspect other scheduled sessions.'}
                </p>
                {canCreateSessions && (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => onOpenCreateSessionForDate(selectedDateKey)}
                  >
                    <PixelPlusIcon />
                    <span>Record Session for This Day</span>
                  </button>
                )}
              </div>
            ) : (
              <ul className="calendar-day-agenda" aria-label="Chronological day sessions">
                {selectedDaySessions.map((session) => {
                  const summary =
                    sessionSummariesById.get(session.id) ??
                    summarizeSessionAttendance(session, members);
                  const fillPercent = summary.rate ?? 0;

                  return (
                    <li key={session.id} className="calendar-agenda-card">
                      <div className="calendar-agenda-time-col">
                        <span className="calendar-agenda-time">
                          <PixelClockIcon />
                          <span>{formatSessionTime(session.time)}</span>
                        </span>
                        <span className="calendar-agenda-rate">
                          {!showClubRateDetails
                            ? linkedMemberId
                              ? session.memberIds.includes(linkedMemberId) ||
                                Boolean(session.attendance[linkedMemberId])
                                ? STATUS_LABELS[
                                    session.attendance[linkedMemberId]?.status ?? 'unmarked'
                                  ]
                                : 'Not Assigned'
                              : 'Scheduled'
                            : getRateBadgeText(summary)}
                        </span>
                      </div>

                      <div className="calendar-agenda-main">
                        <div className="calendar-agenda-head">
                          <div className="session-banner-title-row">
                            <h4 className="day-session-title">{session.name}</h4>
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

                        {session.location && (
                          <div className="calendar-agenda-location">
                            <PixelPinIcon />
                            <span>{session.location}</span>
                          </div>
                        )}

                        {session.description && (
                          <p className="session-banner-description">{session.description}</p>
                        )}

                        {showClubRateDetails && (
                          <div className="calendar-agenda-summary">
                            <div className="calendar-agenda-chips">
                              <span className="agenda-stat-chip is-present">
                                Present {summary.presentCount}
                              </span>
                              <span className="agenda-stat-chip is-reason">
                                Excused {summary.absentWithReasonCount}
                              </span>
                              <span className="agenda-stat-chip is-absent">
                                Unexcused {summary.absentWithoutReasonCount}
                              </span>
                              <span className="agenda-stat-chip is-unmarked">
                                Unmarked {summary.unmarkedCount}
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
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {viewMode === 'week' && (
          <div className="calendar-week-grid" role="grid" aria-label={periodTitle}>
            {weekDays.map((day, index) => {
              const daySessions = sessionsByDate.get(day.dateKey) ?? [];
              const isSelected = day.dateKey === selectedDateKey;
              const weekdayLabel = WEEKDAY_HEADERS[index];
              const showShortMonth =
                index === 0 || day.dayNumber === 1 || !day.inCurrentMonth;
              const dayDateLabel = showShortMonth
                ? formatShortMonthDay(day.dateKey)
                : String(day.dayNumber);

              const colClasses = [
                'calendar-week-col',
                day.isToday ? 'is-today' : '',
                isSelected ? 'is-selected' : '',
                daySessions.length > 0 ? 'has-sessions' : '',
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div key={day.dateKey} className={colClasses} role="gridcell">
                  <div className="calendar-week-col-header">
                    <button
                      type="button"
                      className="calendar-week-day-btn"
                      onClick={() => onSelectDate(day.dateKey)}
                      aria-pressed={isSelected}
                      aria-label={`${formatSessionDate(day.dateKey)}, ${daySessions.length} recorded ${
                        daySessions.length === 1 ? 'session' : 'sessions'
                      }`}
                    >
                      <span className="calendar-week-weekday">{weekdayLabel}</span>
                      <span className="calendar-week-date-num">{dayDateLabel}</span>
                    </button>

                    <div className="calendar-week-col-actions">
                      {daySessions.length > 0 && (
                        <span className="calendar-session-count">{daySessions.length}</span>
                      )}
                      {canCreateSessions && (
                        <button
                          type="button"
                          className="calendar-week-add-btn"
                          onClick={() => {
                            onSelectDate(day.dateKey);
                            onOpenCreateSessionForDate(day.dateKey);
                          }}
                          aria-label={`Record session on ${formatSessionDate(day.dateKey)}`}
                          title="Record session on this day"
                        >
                          <PixelPlusIcon width={10} height={10} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div
                    className="calendar-week-col-body"
                    onClick={() => onSelectDate(day.dateKey)}
                  >
                    {daySessions.length === 0 ? (
                      <span className="calendar-week-empty">—</span>
                    ) : (
                      daySessions.map((session) => {
                        const summary =
                          sessionSummariesById.get(session.id) ??
                          summarizeSessionAttendance(session, members);

                        return (
                          <button
                            key={session.id}
                            type="button"
                            className="calendar-week-session-card"
                            onClick={(event) => {
                              event.stopPropagation();
                              onSelectDate(day.dateKey);
                            }}
                            title={
                              showClubRateDetails
                                ? `${session.name} (${formatSessionTime(session.time)}) — ${getRateBadgeText(summary)}`
                                : `${session.name} (${formatSessionTime(session.time)})`
                            }
                          >
                            <span className="calendar-week-session-time">
                              {formatSessionTime(session.time)}
                            </span>
                            <span className="calendar-week-session-name">{session.name}</span>
                            <div className="calendar-week-session-foot">
                              {showClubRateDetails ? (
                                <>
                                  <span className="calendar-week-session-stat">
                                    {summary.totalMembers > 0
                                      ? `${summary.presentCount}/${summary.totalMembers}`
                                      : '0 mem'}
                                  </span>
                                  <span className="calendar-tag-rate">
                                    {summary.rate !== null ? `${summary.rate}%` : '--%'}
                                  </span>
                                </>
                              ) : linkedMemberId ? (
                                <span className="calendar-week-session-stat">
                                  {session.memberIds.includes(linkedMemberId) ||
                                  Boolean(session.attendance[linkedMemberId])
                                    ? STATUS_LABELS[
                                        session.attendance[linkedMemberId]?.status ?? 'unmarked'
                                      ]
                                    : 'Not Assigned'}
                                </span>
                              ) : (
                                <span className="calendar-week-session-stat">
                                  {session.eventType || 'Scheduled'}
                                </span>
                              )}
                            </div>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {viewMode === 'month' && (
          <>
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
                    onClick={() => onSelectDate(cell.dateKey)}
                  >
                    <div className="calendar-day-top">
                      <span className="calendar-day-number">{cell.dayNumber}</span>
                      {hasSessions && (
                        <span className="calendar-session-count">{daySessions.length}</span>
                      )}
                    </div>

                    {hasSessions && (
                      <div className="calendar-day-tags">
                        {previewSessions.map((session) => {
                          const summary =
                            sessionSummariesById.get(session.id) ??
                            summarizeSessionAttendance(session, members);
                          const rateChip =
                            summary.rate !== null
                              ? `${summary.rate}%`
                              : summary.totalMembers === 0
                                ? '0'
                                : '--%';

                          return (
                            <span
                              key={session.id}
                              className="calendar-day-tag"
                              title={
                                showClubRateDetails
                                  ? `${session.name} (${formatSessionTime(session.time)}) — ${summary.presentCount}/${summary.totalMembers} present`
                                  : `${session.name} (${formatSessionTime(session.time)})`
                              }
                            >
                              <span className="calendar-day-tag-name">{session.name}</span>
                              {showClubRateDetails && (
                                <span className="calendar-tag-rate">{rateChip}</span>
                              )}
                            </span>
                          );
                        })}
                        {overflowCount > 0 && (
                          <span className="calendar-day-more">+{overflowCount} more</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {viewMode === 'year' && (
          <div className="calendar-year-grid" aria-label={`Year ${viewYear} overview`}>
            {yearMonths.map((month) => {
              const monthKeyPrefix = `${month.year}-${String(month.monthIndex + 1).padStart(2, '0')}-`;
              const monthSessions = sessions.filter((session) =>
                session.date.startsWith(monthKeyPrefix),
              );
              const monthAggregate = summarizeSessionsAggregate(monthSessions, members);
              const isActiveMonth = month.monthIndex === viewMonth;

              return (
                <section
                  key={month.monthIndex}
                  className={`calendar-year-month-card ${isActiveMonth ? 'is-active-month' : ''} ${
                    monthSessions.length > 0 ? 'has-sessions' : ''
                  }`}
                  aria-label={`${month.label} ${month.year}`}
                >
                  <div className="calendar-year-month-head">
                    <button
                      type="button"
                      className="calendar-year-month-link"
                      onClick={() => handleDrillToMonth(month.monthIndex)}
                      title={`Open ${month.label} ${month.year} in Month view`}
                    >
                      <span>{month.label}</span>
                      <PixelChevronIcon width={10} height={10} />
                    </button>

                    <div className="calendar-year-month-badges">
                      {monthSessions.length > 0 ? (
                        <>
                          <span
                            className="calendar-session-count"
                            title={`${monthSessions.length} recorded ${
                              monthSessions.length === 1 ? 'session' : 'sessions'
                            }`}
                          >
                            {monthSessions.length}
                          </span>
                          {showClubRateDetails && monthAggregate.rate !== null && (
                            <span
                              className="calendar-year-rate-pill"
                              title={`${monthAggregate.presentCount}/${monthAggregate.totalAssignments} present`}
                            >
                              {monthAggregate.rate}%
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="calendar-year-empty-pill">0</span>
                      )}
                    </div>
                  </div>

                  <div className="calendar-mini-weekdays" aria-hidden="true">
                    {MINI_WEEKDAY_INITIALS.map((initial, idx) => (
                      <span key={idx} className="calendar-mini-weekday">
                        {initial}
                      </span>
                    ))}
                  </div>

                  <div className="calendar-mini-days">
                    {month.cells.map((cell) => {
                      if (!cell.inCurrentMonth) {
                        return (
                          <span
                            key={cell.dateKey}
                            className="calendar-mini-spacer"
                            aria-hidden="true"
                          />
                        );
                      }

                      const daySessions = sessionsByDate.get(cell.dateKey) ?? [];
                      const hasSessions = daySessions.length > 0;
                      const isSelected = cell.dateKey === selectedDateKey;
                      const dayAggregate = hasSessions
                        ? summarizeSessionsAggregate(daySessions, members)
                        : null;

                      const miniClasses = [
                        'calendar-mini-day',
                        cell.isToday ? 'is-today' : '',
                        isSelected ? 'is-selected' : '',
                        hasSessions ? 'has-sessions' : '',
                      ]
                        .filter(Boolean)
                        .join(' ');

                      const tooltip = hasSessions
                        ? `${formatSessionDate(cell.dateKey)}: ${daySessions.length} ${
                            daySessions.length === 1 ? 'session' : 'sessions'
                          }${
                            showClubRateDetails && dayAggregate && dayAggregate.rate !== null
                              ? ` (${dayAggregate.rate}% present)`
                              : ''
                          }`
                        : formatSessionDate(cell.dateKey);

                      return (
                        <button
                          key={cell.dateKey}
                          type="button"
                          className={miniClasses}
                          aria-pressed={isSelected}
                          aria-label={tooltip}
                          title={tooltip}
                          onClick={() => onSelectDate(cell.dateKey)}
                        >
                          {cell.dayNumber}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
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
                {canCreateSessions
                  ? `Click any highlighted date on the calendar to inspect recorded sessions, or log a new session for ${formatSessionDate(selectedDateKey)}.`
                  : 'Click any highlighted date on the calendar to inspect scheduled sessions.'}
              </p>
              {canCreateSessions && (
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => onOpenCreateSessionForDate(selectedDateKey)}
                >
                  <PixelPlusIcon />
                  <span>Record Session</span>
                </button>
              )}
            </div>
          ) : (
            <div className="day-session-list">
              {selectedDaySessions.map((session) => {
                const summary =
                  sessionSummariesById.get(session.id) ??
                  summarizeSessionAttendance(session, members);
                const assignedMembers = getSessionAssignedMembers(session, members);

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

                    {!showClubRateDetails ? (
                      linkedMemberId ? (
                        (() => {
                          const myEntry = session.attendance[linkedMemberId];
                          const isAssignedToSession =
                            session.memberIds.includes(linkedMemberId) || Boolean(myEntry);
                          const myStatus = myEntry?.status ?? 'unmarked';
                          const myReason = myEntry?.reason?.trim();
                          return (
                            <div className="day-member-breakdown">
                              <div className="day-member-main">
                                <span className="day-breakdown-header">My Attendance Status</span>
                                {isAssignedToSession ? (
                                  <span className={`status-badge status-${myStatus}`}>
                                    {STATUS_LABELS[myStatus]}
                                  </span>
                                ) : (
                                  <span className="session-type-tag">Not Assigned</span>
                                )}
                              </div>
                              {isAssignedToSession && myStatus === 'absent_with_reason' && myReason && (
                                <p className="day-member-reason">Reason: {myReason}</p>
                              )}
                            </div>
                          );
                        })()
                      ) : (
                        <div className="day-member-breakdown">
                          <span className="day-breakdown-header">
                            Club Attendance Rates Restricted
                          </span>
                          <p className="day-breakdown-empty">
                            Session schedule details are visible; peer attendance breakdowns are
                            hidden by club admins.
                          </p>
                        </div>
                      )
                    ) : (
                      <>
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
                            <span className="mono-cell">{assignedMembers.length} assigned</span>
                          </div>

                          {assignedMembers.length === 0 ? (
                            <p className="day-breakdown-empty">
                              {canCreateSessions
                                ? 'No members assigned to this session yet. Open it in the tracker to add members.'
                                : 'No members assigned to this session yet.'}
                            </p>
                          ) : (
                            <ul className="day-member-list">
                              {assignedMembers.map((member) => {
                                const entry = session.attendance[member.id];
                                const status = entry?.status ?? 'unmarked';
                                const reason = entry?.reason?.trim();
                                const memberType = normalizeMemberType(member.memberType);

                                return (
                                  <li key={member.id} className="day-member-item">
                                    <div className="day-member-main">
                                      <div className="day-member-identity">
                                        {canOpenPeerProfiles || member.id === linkedMemberId ? (
                                          <button
                                            type="button"
                                            className="day-member-name roster-member-profile-btn"
                                            onClick={() => onOpenMemberProfile(member.id)}
                                            title={`View ${member.name}'s profile & stats`}
                                          >
                                            {member.name}
                                          </button>
                                        ) : (
                                          <span className="day-member-name">{member.name}</span>
                                        )}
                                        {isLegacyMember(member) && (
                                          <span className="member-legacy-pill" title="Legacy / Retired member">
                                            Legacy
                                          </span>
                                        )}
                                        {memberType !== 'student' && (
                                          <span className={`member-type-pill is-${memberType}`}>
                                            {MEMBER_TYPE_LABELS[memberType]}
                                          </span>
                                        )}
                                        {member.className && (
                                          <span
                                            className="member-class-pill"
                                            title={`Class: ${member.className}`}
                                          >
                                            {member.className}
                                          </span>
                                        )}
                                      </div>
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
                      </>
                    )}
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
