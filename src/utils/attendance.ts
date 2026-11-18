import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  MemberProfileInput,
  MemberType,
} from '../types/attendance';

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent_with_reason: 'Absent w/ Reason',
  absent_without_reason: 'Absent w/o Reason',
  unmarked: 'Unmarked',
};

export const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  student: 'Student',
  teacher: 'Teacher',
  visitor: 'Visitor',
};

export const MEMBER_TYPES: readonly MemberType[] = ['student', 'teacher', 'visitor'];

/** Normalizes any unknown or legacy memberType value to a valid MemberType. */
export function normalizeMemberType(value: unknown): MemberType {
  if (value === 'teacher' || value === 'visitor' || value === 'student') {
    return value;
  }
  return 'student';
}

export interface SessionAttendanceSummary {
  totalMembers: number;
  presentCount: number;
  absentWithReasonCount: number;
  absentWithoutReasonCount: number;
  unmarkedCount: number;
  rate: number | null;
}

export interface PeriodAttendanceSummary {
  sessionCount: number;
  totalAssignments: number;
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

/** Builds a normalized ClubMember record from a quick-add name or full profile payload. */
export function buildClubMember(input: string | MemberProfileInput): ClubMember {
  const normalized: MemberProfileInput =
    typeof input === 'string' ? { name: input } : input;
  const memberType = normalizeMemberType(normalized.memberType);
  const now = new Date().toISOString();
  return {
    id: generateId('member'),
    name: normalized.name.trim(),
    memberType,
    className: memberType === 'student' ? normalized.className?.trim() || undefined : undefined,
    role: normalized.role?.trim() || undefined,
    email: normalized.email?.trim() || undefined,
    phone: normalized.phone?.trim() || undefined,
    handle: normalized.handle?.trim() || undefined,
    joinedDate: normalized.joinedDate?.trim() || undefined,
    notes: normalized.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

/** Merges updated profile fields into an existing ClubMember record. */
export function applyMemberProfileUpdate(
  member: ClubMember,
  input: MemberProfileInput,
): ClubMember {
  const memberType = normalizeMemberType(input.memberType ?? member.memberType);
  return {
    ...member,
    name: input.name.trim(),
    memberType,
    className: memberType === 'student' ? input.className?.trim() || undefined : undefined,
    role: input.role?.trim() || undefined,
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    handle: input.handle?.trim() || undefined,
    joinedDate: input.joinedDate?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    updatedAt: new Date().toISOString(),
  };
}

/** Strips deleted member IDs from every session's assigned checklist and attendance map. */
export function removeMembersFromSessions(
  sessions: AttendanceSession[],
  idsToDelete: ReadonlySet<string>,
): AttendanceSession[] {
  return sessions.map((session) => {
    const hasDeletedInList = session.memberIds.some((id) => idsToDelete.has(id));
    const hasDeletedInAttendance = Object.keys(session.attendance).some((id) =>
      idsToDelete.has(id),
    );
    if (!hasDeletedInList && !hasDeletedInAttendance) return session;

    const nextMemberIds = hasDeletedInList
      ? session.memberIds.filter((id) => !idsToDelete.has(id))
      : session.memberIds;

    let nextAttendance = session.attendance;
    if (hasDeletedInAttendance) {
      nextAttendance = { ...session.attendance };
      for (const id of idsToDelete) {
        delete nextAttendance[id];
      }
    }

    return {
      ...session,
      memberIds: nextMemberIds,
      attendance: nextAttendance,
    };
  });
}

/** Resolves the ordered list of club members assigned to a given session. */
export function getSessionAssignedMembers(
  session: AttendanceSession | null,
  members: ClubMember[],
): ClubMember[] {
  if (!session) return [];
  const memberById = new Map<string, ClubMember>();
  for (const member of members) {
    memberById.set(member.id, member);
  }

  const seen = new Set<string>();
  const assigned: ClubMember[] = [];

  for (const id of session.memberIds) {
    if (seen.has(id)) continue;
    const member = memberById.get(id);
    if (member) {
      seen.add(id);
      assigned.push(member);
    }
  }

  for (const id of Object.keys(session.attendance)) {
    if (seen.has(id)) continue;
    const member = memberById.get(id);
    if (member) {
      seen.add(id);
      assigned.push(member);
    }
  }

  return assigned;
}

/** Summarizes a session's attendance marks across the members assigned to that session. */
export function summarizeSessionAttendance(
  session: AttendanceSession | null,
  members: ClubMember[],
): SessionAttendanceSummary {
  const assignedMembers = getSessionAssignedMembers(session, members);
  const totalMembers = assignedMembers.length;
  let presentCount = 0;
  let absentWithReasonCount = 0;
  let absentWithoutReasonCount = 0;
  let unmarkedCount = 0;

  if (session) {
    for (const member of assignedMembers) {
      const status = session.attendance[member.id]?.status ?? 'unmarked';
      if (status === 'present') presentCount += 1;
      else if (status === 'absent_with_reason') absentWithReasonCount += 1;
      else if (status === 'absent_without_reason') absentWithoutReasonCount += 1;
      else unmarkedCount += 1;
    }
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

/** Aggregates attendance counts and overall rate across a collection of sessions. */
export function summarizeSessionsAggregate(
  sessions: AttendanceSession[],
  members: ClubMember[],
): PeriodAttendanceSummary {
  let totalAssignments = 0;
  let presentCount = 0;
  let absentWithReasonCount = 0;
  let absentWithoutReasonCount = 0;
  let unmarkedCount = 0;

  for (const session of sessions) {
    const summary = summarizeSessionAttendance(session, members);
    totalAssignments += summary.totalMembers;
    presentCount += summary.presentCount;
    absentWithReasonCount += summary.absentWithReasonCount;
    absentWithoutReasonCount += summary.absentWithoutReasonCount;
    unmarkedCount += summary.unmarkedCount;
  }

  const rate = totalAssignments > 0 ? Math.round((presentCount / totalAssignments) * 100) : null;

  return {
    sessionCount: sessions.length,
    totalAssignments,
    presentCount,
    absentWithReasonCount,
    absentWithoutReasonCount,
    unmarkedCount,
    rate,
  };
}

export interface MemberAbsenceRecord {
  sessionId: string;
  sessionName: string;
  date: string;
  time: string;
  eventType?: string;
  status: 'absent_with_reason' | 'absent_without_reason';
  reason?: string;
  updatedAt: string;
}

export interface MemberAttendanceStats {
  totalSessions: number;
  presentCount: number;
  absentWithReasonCount: number;
  absentWithoutReasonCount: number;
  unmarkedCount: number;
  markedSessionsCount: number;
  totalAbsentCount: number;
  overallRate: number | null;
  markedRate: number | null;
  absenceRecords: MemberAbsenceRecord[];
  recentAbsenceReasons: MemberAbsenceRecord[];
}

/** Sorts sessions chronologically from newest to oldest by session date, time, and creation time. */
export function sortSessionsNewestFirst(sessions: AttendanceSession[]): AttendanceSession[] {
  return [...sessions].sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    const timeCompare = b.time.localeCompare(a.time);
    if (timeCompare !== 0) return timeCompare;
    return b.createdAt.localeCompare(a.createdAt);
  });
}

/** Extracts 1-2 uppercase initials from a member's name for compact avatar badges. */
export function getMemberInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/** Calculates an individual member's attendance counts, rates, and absence history across assigned sessions. */
export function summarizeMemberAttendance(
  memberId: string,
  sessions: AttendanceSession[],
): MemberAttendanceStats {
  const assignedSessions = sortSessionsNewestFirst(sessions).filter(
    (session) => session.memberIds.includes(memberId) || Boolean(session.attendance[memberId]),
  );
  const totalSessions = assignedSessions.length;

  let presentCount = 0;
  let absentWithReasonCount = 0;
  let absentWithoutReasonCount = 0;
  let unmarkedCount = 0;

  const absenceRecords: MemberAbsenceRecord[] = [];
  const recentAbsenceReasons: MemberAbsenceRecord[] = [];

  for (const session of assignedSessions) {
    const entry = session.attendance[memberId];
    const status = entry?.status ?? 'unmarked';

    if (status === 'present') {
      presentCount += 1;
    } else if (status === 'absent_with_reason') {
      absentWithReasonCount += 1;
      const cleanedReason = entry?.reason?.trim();
      const record: MemberAbsenceRecord = {
        sessionId: session.id,
        sessionName: session.name,
        date: session.date,
        time: session.time,
        eventType: session.eventType,
        status: 'absent_with_reason',
        reason: cleanedReason && cleanedReason.length > 0 ? cleanedReason : undefined,
        updatedAt: entry?.updatedAt ?? session.createdAt,
      };
      absenceRecords.push(record);
      recentAbsenceReasons.push(record);
    } else if (status === 'absent_without_reason') {
      absentWithoutReasonCount += 1;
      absenceRecords.push({
        sessionId: session.id,
        sessionName: session.name,
        date: session.date,
        time: session.time,
        eventType: session.eventType,
        status: 'absent_without_reason',
        updatedAt: entry?.updatedAt ?? session.createdAt,
      });
    } else {
      unmarkedCount += 1;
    }
  }

  const markedSessionsCount = presentCount + absentWithReasonCount + absentWithoutReasonCount;
  const totalAbsentCount = absentWithReasonCount + absentWithoutReasonCount;
  const overallRate = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 100) : null;
  const markedRate =
    markedSessionsCount > 0 ? Math.round((presentCount / markedSessionsCount) * 100) : null;

  return {
    totalSessions,
    presentCount,
    absentWithReasonCount,
    absentWithoutReasonCount,
    unmarkedCount,
    markedSessionsCount,
    totalAbsentCount,
    overallRate,
    markedRate,
    absenceRecords,
    recentAbsenceReasons,
  };
}
