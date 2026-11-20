import type { AccessScope, AttendanceSession, ClubMember } from '../types/attendance';
import {
  STATUS_LABELS,
  isLegacyMember,
  summarizeMemberAttendance,
  summarizeSessionAttendance,
  summarizeSessionsAggregate,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime } from '../utils/date';
import {
  PixelCalendarIcon,
  PixelCheckIcon,
  PixelFlameIcon,
  PixelTerminalIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface StatsStripProps {
  members: ClubMember[];
  sessions: AttendanceSession[];
  activeSession: AttendanceSession | null;
  accessScope?: AccessScope;
  linkedMember?: ClubMember | null;
  canViewAttendanceRates?: boolean;
}

/** Compact 4-card HUD summary strip adapting to Admin/Club totals or personal Member telemetry. */
export function StatsStrip({
  members,
  sessions,
  activeSession,
  accessScope = 'local',
  linkedMember = null,
  canViewAttendanceRates = true,
}: StatsStripProps) {
  if (!canViewAttendanceRates && accessScope === 'member_unlinked') {
    return (
      <section
        className="stats-strip"
        aria-label="Account linking status"
        data-tutorial-target="stats-strip"
      >
        <article className="stat-card" data-accent="gold">
          <div className="stat-header">
            <span className="stat-label">Roster Link</span>
            <span className="stat-icon">
              <PixelUsersIcon />
            </span>
          </div>
          <div className="stat-value">Pending</div>
          <div className="stat-meta">Waiting for admin profile assignment</div>
        </article>
      </section>
    );
  }

  if (!canViewAttendanceRates && accessScope === 'member_self' && !linkedMember) {
    return (
      <section
        className="stats-strip"
        aria-label="Personal attendance status"
        data-tutorial-target="stats-strip"
      >
        <article className="stat-card" data-accent="cyan">
          <div className="stat-header">
            <span className="stat-label">My Profile</span>
            <span className="stat-icon">
              <PixelUsersIcon />
            </span>
          </div>
          <div className="stat-value">Syncing</div>
          <div className="stat-meta">Loading your linked personal attendance record</div>
        </article>
      </section>
    );
  }

  if (!canViewAttendanceRates && accessScope === 'member_self' && linkedMember) {
    const personalStats = summarizeMemberAttendance(linkedMember.id, sessions);

    if (!activeSession) {
      const totalAbsences =
        personalStats.absentWithReasonCount + personalStats.absentWithoutReasonCount;
      return (
        <section
          className="stats-strip"
          aria-label="My personal attendance summary"
          data-tutorial-target="stats-strip"
        >
          <article className="stat-card" data-accent="cyan">
            <div className="stat-header">
              <span className="stat-label">My Sessions</span>
              <span className="stat-icon">
                <PixelCalendarIcon />
              </span>
            </div>
            <div className="stat-value">{personalStats.totalSessions}</div>
            <div className="stat-meta">Sessions you participated in</div>
          </article>

          <article className="stat-card" data-accent="green">
            <div className="stat-header">
              <span className="stat-label">Present</span>
              <span className="stat-icon">
                <PixelCheckIcon />
              </span>
            </div>
            <div className="stat-value">{personalStats.presentCount}</div>
            <div className="stat-meta">
              {personalStats.currentPresentStreak > 0
                ? `${personalStats.currentPresentStreak} session streak`
                : 'Confirmed present marks'}
            </div>
          </article>

          <article className="stat-card" data-accent="gold">
            <div className="stat-header">
              <span className="stat-label">Absences</span>
              <span className="stat-icon">
                <PixelFlameIcon />
              </span>
            </div>
            <div className="stat-value">{totalAbsences}</div>
            <div className="stat-meta">
              {`${personalStats.absentWithReasonCount} excused • ${personalStats.absentWithoutReasonCount} unexcused`}
            </div>
          </article>

          <article className="stat-card" data-accent="red">
            <div className="stat-header">
              <span className="stat-label">My Attendance Rate</span>
              <span className="stat-icon">
                <PixelTerminalIcon />
              </span>
            </div>
            <div className="stat-value">
              {personalStats.markedRate !== null ? `${personalStats.markedRate}%` : '--%'}
            </div>
            <div className="stat-meta">
              {personalStats.unmarkedCount > 0
                ? `${personalStats.unmarkedCount} unmarked`
                : 'All assigned sessions marked'}
            </div>
          </article>
        </section>
      );
    }

    const entry = activeSession.attendance[linkedMember.id];
    const isAssignedToSession =
      activeSession.memberIds.includes(linkedMember.id) || Boolean(entry);
    const myStatus = entry?.status ?? 'unmarked';
    return (
      <section
        className="stats-strip"
        aria-label="My session attendance summary"
        data-tutorial-target="stats-strip"
      >
        <article className="stat-card" data-accent="cyan">
          <div className="stat-header">
            <span className="stat-label">Session Date</span>
            <span className="stat-icon">
              <PixelCalendarIcon />
            </span>
          </div>
          <div className="stat-value">{formatSessionDate(activeSession.date)}</div>
          <div className="stat-meta">{formatSessionTime(activeSession.time)}</div>
        </article>

        <article className="stat-card" data-accent="green">
          <div className="stat-header">
            <span className="stat-label">My Status</span>
            <span className="stat-icon">
              <PixelCheckIcon />
            </span>
          </div>
          <div className="stat-value">
            {isAssignedToSession ? STATUS_LABELS[myStatus] : 'Not Assigned'}
          </div>
          <div className="stat-meta">
            {isAssignedToSession
              ? `Recorded for ${linkedMember.name}`
              : `${linkedMember.name} is not on this session roster`}
          </div>
        </article>

        <article className="stat-card" data-accent="gold">
          <div className="stat-header">
            <span className="stat-label">Excused / Note</span>
            <span className="stat-icon">
              <PixelFlameIcon />
            </span>
          </div>
          <div className="stat-value">
            {myStatus === 'absent_with_reason' ? 'Yes' : '—'}
          </div>
          <div className="stat-meta">
            {myStatus === 'absent_with_reason'
              ? entry?.reason || 'No note entered'
              : 'Personal status detail'}
          </div>
        </article>

        <article className="stat-card" data-accent="red">
          <div className="stat-header">
            <span className="stat-label">My Overall Rate</span>
            <span className="stat-icon">
              <PixelTerminalIcon />
            </span>
          </div>
          <div className="stat-value">
            {personalStats.markedRate !== null ? `${personalStats.markedRate}%` : '--%'}
          </div>
          <div className="stat-meta">Across {personalStats.totalSessions} sessions</div>
        </article>
      </section>
    );
  }

  if (!activeSession) {
    const aggregate = summarizeSessionsAggregate(sessions, members);
    const activeMemberCount = members.filter((member) => !isLegacyMember(member)).length;
    const legacyMemberCount = members.length - activeMemberCount;

    return (
      <section
        className="stats-strip"
        aria-label="Sessions overview summary"
        data-tutorial-target="stats-strip"
      >
        <article className="stat-card" data-accent="cyan">
          <div className="stat-header">
            <span className="stat-label">Recorded Sessions</span>
            <span className="stat-icon">
              <PixelCalendarIcon />
            </span>
          </div>
          <div className="stat-value">{aggregate.sessionCount}</div>
          <div className="stat-meta">
            {aggregate.sessionCount === 0
              ? 'Record a session to begin'
              : 'Meetings & events logged'}
          </div>
        </article>

        <article className="stat-card" data-accent="green">
          <div className="stat-header">
            <span className="stat-label">Active Roster</span>
            <span className="stat-icon">
              <PixelUsersIcon />
            </span>
          </div>
          <div className="stat-value">{activeMemberCount}</div>
          <div className="stat-meta">
            {legacyMemberCount > 0
              ? `${activeMemberCount === 1 ? 'Active member' : 'Active members'} • ${legacyMemberCount} legacy`
              : activeMemberCount === 1
                ? 'Registered club member'
                : 'Registered club members'}
          </div>
        </article>

        <article className="stat-card" data-accent="gold">
          <div className="stat-header">
            <span className="stat-label">Present Marks</span>
            <span className="stat-icon">
              <PixelCheckIcon />
            </span>
          </div>
          <div className="stat-value">{aggregate.presentCount}</div>
          <div className="stat-meta">
            {aggregate.totalAssignments > 0
              ? `of ${aggregate.totalAssignments} assigned marks`
              : 'No attendance marked yet'}
          </div>
        </article>

        <article className="stat-card" data-accent="red">
          <div className="stat-header">
            <span className="stat-label">Overall Rate</span>
            <span className="stat-icon">
              <PixelTerminalIcon />
            </span>
          </div>
          <div className="stat-value">
            {aggregate.rate !== null ? `${aggregate.rate}%` : '--%'}
          </div>
          <div className="stat-meta">
            {aggregate.sessionCount > 0
              ? `${aggregate.absentWithReasonCount + aggregate.absentWithoutReasonCount} total absences`
              : 'No sessions recorded'}
          </div>
        </article>
      </section>
    );
  }

  const summary = summarizeSessionAttendance(activeSession, members);

  return (
    <section
      className="stats-strip"
      aria-label="Attendance summary"
      data-tutorial-target="stats-strip"
    >
      <article className="stat-card" data-accent="cyan">
        <div className="stat-header">
          <span className="stat-label">Session Roster</span>
          <span className="stat-icon">
            <PixelCalendarIcon />
          </span>
        </div>
        <div className="stat-value">{summary.totalMembers}</div>
        <div className="stat-meta">Assigned to active session</div>
      </article>

      <article className="stat-card" data-accent="green">
        <div className="stat-header">
          <span className="stat-label">Present</span>
          <span className="stat-icon">
            <PixelCheckIcon />
          </span>
        </div>
        <div className="stat-value">{summary.presentCount}</div>
        <div className="stat-meta">Marked present in session</div>
      </article>

      <article className="stat-card" data-accent="gold">
        <div className="stat-header">
          <span className="stat-label">Absent (Reason)</span>
          <span className="stat-icon">
            <PixelFlameIcon />
          </span>
        </div>
        <div className="stat-value">{summary.absentWithReasonCount}</div>
        <div className="stat-meta">Excused / noted absences</div>
      </article>

      <article className="stat-card" data-accent="red">
        <div className="stat-header">
          <span className="stat-label">Attendance Rate</span>
          <span className="stat-icon">
            <PixelTerminalIcon />
          </span>
        </div>
        <div className="stat-value">
          {summary.rate !== null ? `${summary.rate}%` : '--%'}
        </div>
        <div className="stat-meta">
          {`${summary.absentWithoutReasonCount} absent w/o reason`}
        </div>
      </article>
    </section>
  );
}
