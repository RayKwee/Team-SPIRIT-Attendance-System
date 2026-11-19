import type { AttendanceSession, ClubMember } from '../types/attendance';
import {
  isLegacyMember,
  summarizeSessionAttendance,
  summarizeSessionsAggregate,
} from '../utils/attendance';
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
}

/** Compact 4-card HUD summary strip showing hub overview stats or active-session attendance counts. */
export function StatsStrip({ members, sessions, activeSession }: StatsStripProps) {
  if (!activeSession) {
    const aggregate = summarizeSessionsAggregate(sessions, members);
    const activeMemberCount = members.filter((member) => !isLegacyMember(member)).length;
    const legacyMemberCount = members.length - activeMemberCount;

    return (
      <section className="stats-strip" aria-label="Sessions overview summary">
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
    <section className="stats-strip" aria-label="Attendance summary">
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
