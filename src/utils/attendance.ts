import type {
  AttendanceSession,
  AttendanceStatus,
  ClassLetter,
  ClassYear,
  ClubMember,
  MeetingVisibility,
  MemberProfileInput,
  MemberType,
} from '../types/attendance';

export const STATUS_LABELS: Record<AttendanceStatus, string> = {
  present: 'Present',
  absent_with_reason: 'Absent w/ Reason',
  absent_without_reason: 'Absent w/o Reason',
  unmarked: 'Unmarked',
};

export const MEETING_VISIBILITY_OPTIONS: readonly MeetingVisibility[] = [
  'public',
  'admins_only',
  'private',
];

export const MEETING_VISIBILITY_LABELS: Record<MeetingVisibility, string> = {
  public: 'Public',
  admins_only: 'Admins Only',
  private: 'Private',
};

export const MEETING_VISIBILITY_DESCRIPTIONS: Record<MeetingVisibility, string> = {
  public: 'Viewable by everyone in the club.',
  admins_only: 'Restricted to club administrators only.',
  private: 'Visible only to you as the creator.',
};

/** Normalizes any unknown or legacy session visibility value to a valid MeetingVisibility. */
export function normalizeMeetingVisibility(value: unknown): MeetingVisibility {
  if (value === 'admins_only' || value === 'private' || value === 'public') {
    return value;
  }
  return 'public';
}

/** Returns true when the current user is allowed to set a meeting's visibility to Private. */
export function canUserSetSessionPrivate(
  session: Pick<AttendanceSession, 'createdByUserId'>,
  currentUserId: string | null,
): boolean {
  if (!session.createdByUserId) return true;
  return Boolean(currentUserId && session.createdByUserId === currentUserId);
}

/** Client-side defense-in-depth visibility check mirroring Supabase attendance_sessions RLS. */
export function canUserViewSession(
  session: Pick<AttendanceSession, 'visibility' | 'createdByUserId'>,
  context: {
    isCloudConnected: boolean;
    isAdmin: boolean;
    currentUserId: string | null;
  },
): boolean {
  if (!context.isCloudConnected) return true;
  const visibility = normalizeMeetingVisibility(session.visibility);
  if (visibility === 'public') return true;
  if (visibility === 'admins_only') return context.isAdmin;
  return Boolean(context.currentUserId && session.createdByUserId === context.currentUserId);
}

export const MEMBER_TYPE_LABELS: Record<MemberType, string> = {
  student: 'Student',
  teacher: 'Teacher',
  visitor: 'Visitor',
};

export const MEMBER_TYPES: readonly MemberType[] = ['student', 'teacher', 'visitor'];

export const CLASS_YEARS: readonly ClassYear[] = [7, 8, 9, 10, 11];

export const STANDARD_CLASS_LETTERS: readonly Exclude<ClassLetter, 'N/A'>[] = ['T', 'E', 'N', 'B'];

export const CLASS_LETTERS: readonly ClassLetter[] = ['T', 'E', 'N', 'B', 'N/A'];

export const STREAK_HIGHLIGHT_THRESHOLD = 3;
export const CONSECUTIVE_ABSENCE_ALERT_THRESHOLD = 2;

/** Normalizes any unknown or legacy memberType value to a valid MemberType. */
export function normalizeMemberType(value: unknown): MemberType {
  if (value === 'teacher' || value === 'visitor' || value === 'student') {
    return value;
  }
  return 'student';
}

/** Normalizes a year value to a valid ClassYear (7..11) or undefined. */
export function normalizeClassYear(value: unknown): ClassYear | undefined {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  if (num === 7 || num === 8 || num === 9 || num === 10 || num === 11) {
    return num;
  }
  return undefined;
}

/** Normalizes a class letter to T, E, N, B, or N/A (case-insensitive) or undefined. */
export function normalizeClassLetter(value: unknown): ClassLetter | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase();
  if (upper === 'T' || upper === 'E' || upper === 'N' || upper === 'B') {
    return upper;
  }
  if (upper === 'N/A' || upper === 'NA') {
    return 'N/A';
  }
  return undefined;
}

/** Normalizes and validates a mandatory club role string, throwing if blank. */
export function normalizeRequiredRole(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('Club role is required.');
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error('Club role is required.');
  }
  return trimmed;
}

/** Formats a structured student Year + Class letter into the canonical display label (e.g. "Year 7 T" or "N/A"). */
export function formatStudentClassName(year: ClassYear, letter: ClassLetter): string {
  if (letter === 'N/A') {
    return 'N/A';
  }
  return `Year ${year} ${letter}`;
}

const STRUCTURED_CLASS_RE = /^(?:year\s*|yr\s*|y)?(7|8|9|10|11)\s*[-/]?\s*([tenb])$/i;

/** Parses a formatted class string (e.g. "Year 7 T" or "11B") into structured Year & Class fields. */
export function parseStudentClassName(
  value?: string | null,
): { year: ClassYear; letter: ClassLetter } | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = STRUCTURED_CLASS_RE.exec(trimmed);
  if (!match) return null;
  const year = normalizeClassYear(match[1]);
  const letter = normalizeClassLetter(match[2]);
  if (!year || !letter) return null;
  return { year, letter };
}

/** Resolves normalized structured class fields and canonical display label for a member. */
export function resolveStudentClassFields(input: {
  memberType: MemberType;
  classYear?: unknown;
  classLetter?: unknown;
  className?: string | null;
}): {
  classYear?: ClassYear;
  classLetter?: ClassLetter;
  className?: string;
} {
  const explicitLetter = normalizeClassLetter(input.classLetter);
  const rawClassNameUpper =
    typeof input.className === 'string' ? input.className.trim().toUpperCase() : '';

  if (explicitLetter === 'N/A' || rawClassNameUpper === 'N/A' || rawClassNameUpper === 'NA') {
    return {
      classYear: undefined,
      classLetter: 'N/A',
      className: 'N/A',
    };
  }

  const explicitYear = normalizeClassYear(input.classYear);
  if (explicitYear && explicitLetter) {
    return {
      classYear: explicitYear,
      classLetter: explicitLetter,
      className: formatStudentClassName(explicitYear, explicitLetter),
    };
  }

  const parsed = parseStudentClassName(input.className);
  if (parsed) {
    return {
      classYear: parsed.year,
      classLetter: parsed.letter,
      className: formatStudentClassName(parsed.year, parsed.letter),
    };
  }

  const fallbackClassName =
    input.memberType === 'student' &&
    typeof input.className === 'string' &&
    input.className.trim().length > 0
      ? input.className.trim()
      : undefined;

  return {
    classYear: undefined,
    classLetter: undefined,
    className: fallbackClassName,
  };
}

/** Sorts class labels numerically by Year (7..11) and then T, E, N, B order, with N/A and legacy names last. */
export function compareStudentClassNames(a: string, b: string): number {
  const parsedA = parseStudentClassName(a);
  const parsedB = parseStudentClassName(b);
  if (parsedA && parsedB) {
    if (parsedA.year !== parsedB.year) {
      return parsedA.year - parsedB.year;
    }
    return STANDARD_CLASS_LETTERS.indexOf(parsedA.letter as Exclude<ClassLetter, 'N/A'>) -
      STANDARD_CLASS_LETTERS.indexOf(parsedB.letter as Exclude<ClassLetter, 'N/A'>);
  }
  if (parsedA) return -1;
  if (parsedB) return 1;
  if (a === 'N/A' && b !== 'N/A') return 1;
  if (b === 'N/A' && a !== 'N/A') return -1;
  return a.localeCompare(b);
}

const LEAD_ROLE_WORD_RE = /\blead\b/;

/**
 * Returns the Club Role hierarchy tier for default sorting:
 * 0 = President, 1 = Vice President, 2 = Secretary, 3 = any Lead role, 4 = Member & custom roles.
 */
export function getClubRoleSortTier(role?: string | null): number {
  if (typeof role !== 'string') return 4;
  const normalized = role
    .trim()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

  if (!normalized) return 4;
  if (normalized === 'president') return 0;
  if (normalized === 'vice president') return 1;
  if (normalized === 'secretary') return 2;
  if (LEAD_ROLE_WORD_RE.test(normalized)) return 3;
  return 4;
}

/**
 * Compares two club members by role hierarchy tier (President -> Vice President -> Secretary ->
 * Lead roles -> Members/custom roles) and then strictly alphabetically (A-Z) by name.
 */
export function compareMembersByRoleAndName(
  a: Pick<ClubMember, 'id' | 'name' | 'role'>,
  b: Pick<ClubMember, 'id' | 'name' | 'role'>,
): number {
  const tierDiff = getClubRoleSortTier(a.role) - getClubRoleSortTier(b.role);
  if (tierDiff !== 0) return tierDiff;

  const nameA = a.name.trim().replace(/\s+/g, ' ');
  const nameB = b.name.trim().replace(/\s+/g, ' ');

  const caseInsensitiveCmp = nameA.localeCompare(nameB, undefined, { sensitivity: 'base' });
  if (caseInsensitiveCmp !== 0) return caseInsensitiveCmp;

  const exactNameCmp = nameA.localeCompare(nameB);
  if (exactNameCmp !== 0) return exactNameCmp;

  return a.id.localeCompare(b.id);
}

/** Returns a new array of members sorted by Club Role hierarchy and then alphabetically (A-Z). */
export function sortMembersByRoleAndName<T extends Pick<ClubMember, 'id' | 'name' | 'role'>>(
  members: readonly T[],
): T[] {
  return [...members].sort(compareMembersByRoleAndName);
}

/** Returns true when a club member belongs to the Legacy / Retired archive. */
export function isLegacyMember(member: Pick<ClubMember, 'isLegacy'> | null | undefined): boolean {
  return Boolean(member?.isLegacy);
}

/** Normalizes an academic year integer (e.g. 2026) or returns undefined. */
export function normalizeAcademicYear(value: unknown): number | undefined {
  const num =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim().length > 0
        ? Number(value.trim())
        : Number.NaN;
  if (Number.isInteger(num) && num >= 2000 && num <= 2200) {
    return num;
  }
  return undefined;
}

/**
 * Returns the active September 1st academic cycle year for `referenceDate`.
 * Dates from Sep 1 – Dec 31 of year Y return Y; dates from Jan 1 – Aug 31 of year Y return Y - 1.
 */
export function getPromotionCycleYear(referenceDate: Date = new Date()): number {
  const year = referenceDate.getFullYear();
  const monthIndex = referenceDate.getMonth();
  return monthIndex >= 8 ? year : year - 1;
}

/** Returns a formatted academic cycle span label such as "2026–2027". */
export function getAcademicCycleLabel(referenceDate: Date = new Date()): string {
  const cycleYear = getPromotionCycleYear(referenceDate);
  return `${cycleYear}–${cycleYear + 1}`;
}

/** Returns the formatted date label for the upcoming September 1st promotion boundary. */
export function getNextPromotionDateLabel(referenceDate: Date = new Date()): string {
  const nextCycleYear = getPromotionCycleYear(referenceDate) + 1;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(nextCycleYear, 8, 1));
}

function resolveMemberAnchorYear(
  member: Pick<ClubMember, 'lastPromotedYear' | 'updatedAt' | 'createdAt'>,
  fallbackDate: Date,
): number {
  const explicit = normalizeAcademicYear(member.lastPromotedYear);
  if (explicit !== undefined) return explicit;

  const rawStamp = member.updatedAt || member.createdAt;
  if (rawStamp) {
    const parsedMs = Date.parse(rawStamp);
    if (Number.isFinite(parsedMs)) {
      return getPromotionCycleYear(new Date(parsedMs));
    }
  }

  return getPromotionCycleYear(fallbackDate);
}

export interface AnnualProgressionSummary {
  cycleYear: number;
  promotedCount: number;
  graduatedCount: number;
  changedIds: string[];
}

/**
 * Advances a single active student member by one year per elapsed September 1st cycle,
 * keeping class letter (T, E, N, B) intact and graduating Year 11 students into Legacy.
 */
export function applyAnnualProgressionToMember<T extends ClubMember>(
  member: T,
  referenceDate: Date = new Date(),
): { member: T; outcome: 'none' | 'promoted' | 'graduated' } {
  if (isLegacyMember(member)) {
    return { member, outcome: 'none' };
  }

  const memberType = normalizeMemberType(member.memberType);
  if (memberType !== 'student') {
    return { member, outcome: 'none' };
  }

  const resolvedClass = resolveStudentClassFields({
    memberType,
    classYear: member.classYear,
    classLetter: member.classLetter,
    className: member.className,
  });

  if (!resolvedClass.classYear || !resolvedClass.classLetter || resolvedClass.classLetter === 'N/A') {
    return { member, outcome: 'none' };
  }

  const currentCycleYear = getPromotionCycleYear(referenceDate);
  const anchorYear = resolveMemberAnchorYear(member, referenceDate);

  if (anchorYear >= currentCycleYear) {
    return { member, outcome: 'none' };
  }

  let currentYear: ClassYear = resolvedClass.classYear;
  const classLetter = resolvedClass.classLetter;
  let graduatedYear: number | undefined;

  for (let cycle = anchorYear + 1; cycle <= currentCycleYear; cycle += 1) {
    if (currentYear < 11) {
      currentYear = (currentYear + 1) as ClassYear;
    } else {
      graduatedYear = cycle;
      break;
    }
  }

  const nowIso = referenceDate.toISOString();

  if (graduatedYear !== undefined) {
    return {
      member: {
        ...member,
        classYear: 11,
        classLetter,
        className: formatStudentClassName(11, classLetter),
        isLegacy: true,
        graduationYear: graduatedYear,
        retiredAt: member.retiredAt || nowIso,
        lastPromotedYear: currentCycleYear,
        updatedAt: nowIso,
      },
      outcome: 'graduated',
    };
  }

  return {
    member: {
      ...member,
      classYear: currentYear,
      classLetter,
      className: formatStudentClassName(currentYear, classLetter),
      lastPromotedYear: currentCycleYear,
      updatedAt: nowIso,
    },
    outcome: 'promoted',
  };
}

/**
 * Evaluates a map of member records and applies idempotent September 1st annual progression
 * across all active, non-deleted students who have not yet been promoted in the current cycle.
 */
export function runAnnualClassProgression<T extends ClubMember & { deletedAt?: string | null }>(
  members: Record<string, T>,
  referenceDate: Date = new Date(),
): {
  nextMembers: Record<string, T>;
  summary: AnnualProgressionSummary;
} {
  const currentCycleYear = getPromotionCycleYear(referenceDate);
  const changedIds: string[] = [];
  let promotedCount = 0;
  let graduatedCount = 0;
  let nextMembers: Record<string, T> | null = null;

  for (const [id, member] of Object.entries(members)) {
    if (!member || member.deletedAt) continue;
    const result = applyAnnualProgressionToMember(member, referenceDate);
    if (result.outcome === 'none') continue;

    if (!nextMembers) {
      nextMembers = { ...members };
    }
    nextMembers[id] = result.member;
    changedIds.push(id);
    if (result.outcome === 'graduated') {
      graduatedCount += 1;
    } else {
      promotedCount += 1;
    }
  }

  return {
    nextMembers: nextMembers ?? members,
    summary: {
      cycleYear: currentCycleYear,
      promotedCount,
      graduatedCount,
      changedIds,
    },
  };
}

export interface BulkMemberParseResult {
  namesToAdd: string[];
  skippedActiveDuplicates: string[];
  skippedBatchDuplicates: string[];
  blankLineCount: number;
}

function normalizeBulkNameLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

/**
 * Parses a multi-line member list (one full name per line, preserving spaces like "John Doe"),
 * ignoring blank lines and filtering out duplicates already present in the active roster or batch.
 */
export function parseBulkMemberInput(
  rawText: string,
  members: readonly Pick<ClubMember, 'name' | 'isLegacy'>[],
): BulkMemberParseResult {
  const activeNameSet = new Set<string>();
  for (const member of members) {
    if (isLegacyMember(member)) continue;
    const normalized = normalizeBulkNameLine(member.name).toLowerCase();
    if (normalized) {
      activeNameSet.add(normalized);
    }
  }

  const seenBatchSet = new Set<string>();
  const namesToAdd: string[] = [];
  const skippedActiveDuplicates: string[] = [];
  const skippedBatchDuplicates: string[] = [];
  let blankLineCount = 0;

  for (const rawLine of rawText.split(/\r?\n/)) {
    const cleaned = normalizeBulkNameLine(rawLine);
    if (!cleaned) {
      blankLineCount += 1;
      continue;
    }

    const key = cleaned.toLowerCase();
    if (activeNameSet.has(key)) {
      skippedActiveDuplicates.push(cleaned);
      continue;
    }

    if (seenBatchSet.has(key)) {
      skippedBatchDuplicates.push(cleaned);
      continue;
    }

    seenBatchSet.add(key);
    namesToAdd.push(cleaned);
  }

  return {
    namesToAdd,
    skippedActiveDuplicates,
    skippedBatchDuplicates,
    blankLineCount,
  };
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
    typeof input === 'string' ? { name: input, role: 'Member' } : input;
  const role = normalizeRequiredRole(normalized.role);
  const memberType = normalizeMemberType(normalized.memberType);
  const classFields = resolveStudentClassFields({
    memberType,
    classYear: normalized.classYear,
    classLetter: normalized.classLetter,
    className: normalized.className,
  });
  const isLegacy = Boolean(normalized.isLegacy);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const lastPromotedYear =
    normalizeAcademicYear(normalized.lastPromotedYear) ?? getPromotionCycleYear(nowDate);
  const graduationYear = isLegacy ? normalizeAcademicYear(normalized.graduationYear) : undefined;
  return {
    id: generateId('member'),
    name: normalized.name.trim(),
    memberType,
    ...classFields,
    isLegacy,
    retiredAt: isLegacy ? (normalized.retiredAt?.trim() || now) : undefined,
    lastPromotedYear,
    graduationYear,
    role,
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
  const role = normalizeRequiredRole(input.role);
  const prevMemberType = normalizeMemberType(member.memberType);
  const memberType = normalizeMemberType(input.memberType ?? member.memberType);
  const classFields = resolveStudentClassFields({
    memberType,
    classYear: input.classYear,
    classLetter: input.classLetter,
    className: input.className,
  });
  const nextIsLegacy = input.isLegacy !== undefined ? Boolean(input.isLegacy) : Boolean(member.isLegacy);
  const nowDate = new Date();
  const now = nowDate.toISOString();
  const nextRetiredAt = nextIsLegacy
    ? (input.retiredAt?.trim() || member.retiredAt || now)
    : undefined;
  const nextGraduationYear = nextIsLegacy
    ? (normalizeAcademicYear(input.graduationYear) ?? normalizeAcademicYear(member.graduationYear))
    : undefined;
  const classYearChanged = classFields.classYear !== member.classYear;
  const restoredToActive = Boolean(member.isLegacy) && !nextIsLegacy;
  const switchedToStudent = prevMemberType !== 'student' && memberType === 'student';
  const nextLastPromotedYear =
    normalizeAcademicYear(input.lastPromotedYear) ??
    (classYearChanged || restoredToActive || switchedToStudent
      ? getPromotionCycleYear(nowDate)
      : normalizeAcademicYear(member.lastPromotedYear));

  return {
    ...member,
    name: input.name.trim(),
    memberType,
    ...classFields,
    isLegacy: nextIsLegacy,
    retiredAt: nextRetiredAt,
    lastPromotedYear: nextLastPromotedYear,
    graduationYear: nextGraduationYear,
    role,
    email: input.email?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    handle: input.handle?.trim() || undefined,
    joinedDate: input.joinedDate?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    updatedAt: now,
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

  return assigned.sort(compareMembersByRoleAndName);
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
  currentPresentStreak: number;
  consecutiveUnexcusedAbsences: number;
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

  // Evaluate current streak / consecutive unexcused absences starting from the newest marked session.
  let currentPresentStreak = 0;
  let consecutiveUnexcusedAbsences = 0;
  const firstMarkedIndex = assignedSessions.findIndex(
    (session) => (session.attendance[memberId]?.status ?? 'unmarked') !== 'unmarked',
  );

  if (firstMarkedIndex !== -1) {
    const newestMarkedStatus = assignedSessions[firstMarkedIndex].attendance[memberId]?.status;
    if (newestMarkedStatus === 'present') {
      for (let index = firstMarkedIndex; index < assignedSessions.length; index += 1) {
        if ((assignedSessions[index].attendance[memberId]?.status ?? 'unmarked') === 'present') {
          currentPresentStreak += 1;
        } else {
          break;
        }
      }
    } else if (newestMarkedStatus === 'absent_without_reason') {
      for (let index = firstMarkedIndex; index < assignedSessions.length; index += 1) {
        if (
          (assignedSessions[index].attendance[memberId]?.status ?? 'unmarked') ===
          'absent_without_reason'
        ) {
          consecutiveUnexcusedAbsences += 1;
        } else {
          break;
        }
      }
    }
  }

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
    currentPresentStreak,
    consecutiveUnexcusedAbsences,
    absenceRecords,
    recentAbsenceReasons,
  };
}

export const CLUB_LOGIN_EMAIL_DOMAIN = 'teamspirit.club';

/**
 * Formats a member's display name into the canonical Team SPIRIT login email:
 * all lowercase, whitespace collapsed and replaced by dots, followed by `@teamspirit.club`.
 * Example: `"Jun Yuen"` -> `"jun.yuen@teamspirit.club"`.
 */
export function formatClubLoginEmail(memberName: string): string {
  const normalized = memberName
    .trim()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, '.')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+|\.+$/g, '');

  if (!normalized) {
    return '';
  }

  return `${normalized}@${CLUB_LOGIN_EMAIL_DOMAIN}`;
}

const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_LOWER = 'abcdefghjkmnpqrstuvwxyz';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_ALL = `${PASSWORD_UPPER}${PASSWORD_LOWER}${PASSWORD_DIGITS}`;

/** Generates a readable, cryptographically random initial password (default 10 characters). */
export function generateInitialPassword(length = 10): string {
  const targetLength = Math.max(8, Math.min(32, Math.floor(length)));
  const bytes = new Uint32Array(targetLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < targetLength; i += 1) {
      bytes[i] = Math.floor(Math.random() * 0xffffffff);
    }
  }

  const chars: string[] = [
    PASSWORD_UPPER[bytes[0] % PASSWORD_UPPER.length],
    PASSWORD_LOWER[bytes[1] % PASSWORD_LOWER.length],
    PASSWORD_DIGITS[bytes[2] % PASSWORD_DIGITS.length],
  ];

  for (let i = 3; i < targetLength; i += 1) {
    chars.push(PASSWORD_ALL[bytes[i] % PASSWORD_ALL.length]);
  }

  // Fisher-Yates shuffle using remaining randomness so required character classes aren't always upfront.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = bytes[i] % (i + 1);
    const tmp = chars[i];
    chars[i] = chars[j];
    chars[j] = tmp;
  }

  return chars.join('');
}
