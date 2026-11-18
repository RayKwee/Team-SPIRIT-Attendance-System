import type { AttendanceSession, ClubMember } from '../types/attendance';
import { summarizeSessionAttendance } from '../utils/attendance';
import {
  PixelCalendarIcon,
  PixelCheckIcon,
  PixelFlameIcon,
  PixelTerminalIcon,
} from './PixelIcons';

interface StatsStripProps {
  members: ClubMember[];
  activeSession: AttendanceSession | null;
}

/** Compact 4-card HUD summary strip displaying live active-session attendance counts. */
export function StatsStrip({ members, activeSession }: StatsStripProps) {
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
        <div className="stat-meta">
          {activeSession ? 'Assigned to active session' : 'No active session'}
        </div>
      </article>

      <article className="stat-card" data-accent="green">
        <div className="stat-header">
          <span className="stat-label">Present</span>
          <span className="stat-icon">
            <PixelCheckIcon />
          </span>
        </div>
        <div className="stat-value">{summary.presentCount}</div>
        <div className="stat-meta">
          {activeSession ? 'Marked present in session' : 'Create a session to mark'}
        </div>
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
          {activeSession
            ? `${summary.absentWithoutReasonCount} absent w/o reason`
            : 'No active session'}
        </div>
      </article>
    </section>
  );
}
