import { useMemo, useState } from 'react';
import type { AttendanceSession, ClubMember } from '../types/attendance';
import {
  STREAK_HIGHLIGHT_THRESHOLD,
  isLegacyMember,
  summarizeMemberAttendance,
} from '../utils/attendance';
import { PixelFlameIcon, PixelStarIcon, PixelUsersIcon } from './PixelIcons';

interface AttendanceLeaderboardProps {
  members: ClubMember[];
  sessions: AttendanceSession[];
  currentMemberId?: string | null;
  canOpenMemberProfile?: boolean;
  onOpenMemberProfile?: (memberId: string) => void;
}

interface LeaderboardEntry {
  member: ClubMember;
  rate: number;
  presentCount: number;
  markedSessionsCount: number;
  totalSessions: number;
  currentStreak: number;
}

/**
 * Ranked Club Attendance Leaderboard shown to Admins, Broad Viewers, and Members
 * when `member_can_view_attendance_rates` is enabled by club administrators.
 */
export function AttendanceLeaderboard({
  members,
  sessions,
  currentMemberId = null,
  canOpenMemberProfile = false,
  onOpenMemberProfile,
}: AttendanceLeaderboardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const rankedEntries = useMemo<LeaderboardEntry[]>(() => {
    const activeMembers = members.filter((member) => !isLegacyMember(member));
    const list: LeaderboardEntry[] = [];

    for (const member of activeMembers) {
      const stats = summarizeMemberAttendance(member.id, sessions);
      if (stats.markedSessionsCount === 0) continue;
      list.push({
        member,
        rate: stats.markedRate ?? 0,
        presentCount: stats.presentCount,
        markedSessionsCount: stats.markedSessionsCount,
        totalSessions: stats.totalSessions,
        currentStreak: stats.currentPresentStreak,
      });
    }

    return list.sort((a, b) => {
      if (b.rate !== a.rate) return b.rate - a.rate;
      if (b.presentCount !== a.presentCount) return b.presentCount - a.presentCount;
      if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
      return a.member.name.localeCompare(b.member.name);
    });
  }, [members, sessions]);

  const displayedEntries = isExpanded ? rankedEntries : rankedEntries.slice(0, 8);

  return (
    <section
      className="tracker-panel leaderboard-panel"
      aria-label="Club attendance rates and leaderboard"
    >
      <div className="tracker-panel-header">
        <div className="panel-title-group">
          <PixelStarIcon />
          <h2 className="panel-title">Attendance Leaderboard</h2>
          <span className="panel-count">{rankedEntries.length}</span>
          <span className="settings-mode-tag is-cloud">Active Members</span>
        </div>

        {rankedEntries.length > 8 && (
          <div className="panel-header-actions">
            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => setIsExpanded((prev) => !prev)}
            >
              <span>{isExpanded ? 'Show Top 8' : `View All (${rankedEntries.length})`}</span>
            </button>
          </div>
        )}
      </div>

      <div className="tracker-body leaderboard-body">
        {rankedEntries.length === 0 ? (
          <div className="reserved-empty-state leaderboard-empty">
            <div className="empty-badge">
              <PixelUsersIcon />
              <span>No Ranked Marks Yet</span>
            </div>
            <p className="empty-description">
              Members appear on the leaderboard once attendance marks are recorded in club
              sessions.
            </p>
          </div>
        ) : (
          <div className="leaderboard-list" role="list" aria-label="Member attendance rankings">
            {displayedEntries.map((entry, index) => {
              const rank = index + 1;
              const isSelf = Boolean(currentMemberId && entry.member.id === currentMemberId);
              const hasStreak = entry.currentStreak >= STREAK_HIGHLIGHT_THRESHOLD;

              return (
                <div
                  key={entry.member.id}
                  role="listitem"
                  className={`leaderboard-row ${rank <= 3 ? `is-top-${rank}` : ''} ${
                    isSelf ? 'is-self' : ''
                  }`}
                >
                  <div className="leaderboard-rank">#{rank}</div>

                  <div className="leaderboard-member">
                    {(canOpenMemberProfile || isSelf) && onOpenMemberProfile ? (
                      <button
                        type="button"
                        className="member-name-link leaderboard-name-btn"
                        onClick={() => onOpenMemberProfile(entry.member.id)}
                      >
                        {entry.member.name}
                      </button>
                    ) : (
                      <span className="leaderboard-name-text">{entry.member.name}</span>
                    )}
                    <div className="leaderboard-member-meta">
                      {entry.member.className && (
                        <span className="member-class-pill">{entry.member.className}</span>
                      )}
                      {isSelf && <span className="admin-self-tag">You</span>}
                      {hasStreak && (
                        <span className="member-streak-badge">
                          <PixelFlameIcon width={10} height={10} />
                          <span>{entry.currentStreak} Streak</span>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="leaderboard-stats">
                    <span className="mono-meta">
                      {entry.presentCount}/{entry.markedSessionsCount} present
                    </span>
                    <span className="member-rate-chip leaderboard-rate-chip">{entry.rate}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
