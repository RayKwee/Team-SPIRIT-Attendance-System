import type { AttendanceSession, AttendanceStatus, ClubMember } from '../types/attendance';

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent_with_reason: 'Absent w/ Reason',
  absent_without_reason: 'Absent w/o Reason',
  unmarked: 'Unmarked',
};

export interface SessionAttendanceSummary {
  totalMembers: number;
  presentCount: number;
  absentWithReasonCount: number;
  absentWithoutReasonCount: number;
  unmarkedCount: number;
  rate: number | null;
}

/** Generates a collision-resistant local primary ID. */
export function generateId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/** Summarizes a session's attendance marks across the current club roster. */
export function summarizeSessionAttendance(
  session: AttendanceSession | null,
  members: ClubMember[],
): SessionAttendanceSummary {
  const totalMembers = members.length;
  let presentCount = 0;
  let absentWithReasonCount = 0;
  let absentWithoutReasonCount = 0;
  let unmarkedCount = 0;

  if (session) {
    for (const member of members) {
      const status = session.attendance[member.id]?.status ?? 'unmarked';
      if (status === 'present') presentCount += 1;
      else if (status === 'absent_with_reason') absentWithReasonCount += 1;
      else if (status === 'absent_without_reason') absentWithoutReasonCount += 1;
      else unmarkedCount += 1;
    }
  } else {
    unmarkedCount = totalMembers;
  }

  const rate = session && totalMembers > 0 ? Math.round((presentCount / totalMembers) * 100) : null;

  return {
    totalMembers,
    presentCount,
    absentWithReasonCount,
    absentWithoutReasonCount,
    unmarkedCount,
    rate,
  };
}
