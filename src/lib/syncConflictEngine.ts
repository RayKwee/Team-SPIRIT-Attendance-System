import type {
  SyncConflictEntityType,
  SyncConflictItem,
  SyncedAttendanceRecord,
  SyncedMemberRecord,
  SyncedSessionRecord,
} from '../types/attendance';

type BaseSyncFields = {
  updatedAt: string;
  deletedAt: string | null;
  syncVersion?: number;
  lastEditedBy?: string;
};

interface FieldSpec<T> {
  key: keyof T;
  label: string;
}

export const MEMBER_MERGE_FIELDS: FieldSpec<SyncedMemberRecord>[] = [
  { key: 'name', label: 'Name' },
  { key: 'memberType', label: 'Member Type' },
  { key: 'classYear', label: 'Class Year' },
  { key: 'classLetter', label: 'Class Letter' },
  { key: 'className', label: 'Class' },
  { key: 'isLegacy', label: 'Legacy Status' },
  { key: 'retiredAt', label: 'Retired Date' },
  { key: 'lastPromotedYear', label: 'Last Promoted Year' },
  { key: 'graduationYear', label: 'Graduation Year' },
  { key: 'role', label: 'Role' },
  { key: 'email', label: 'Email' },
  { key: 'phone', label: 'Phone' },
  { key: 'handle', label: 'Handle' },
  { key: 'joinedDate', label: 'Joined Date' },
  { key: 'notes', label: 'Notes' },
];

export const SESSION_MERGE_FIELDS: FieldSpec<SyncedSessionRecord>[] = [
  { key: 'name', label: 'Session Name' },
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'location', label: 'Location' },
  { key: 'description', label: 'Description' },
  { key: 'eventType', label: 'Event Type' },
  { key: 'visibility', label: 'Visibility' },
];

export const ATTENDANCE_MERGE_FIELDS: FieldSpec<SyncedAttendanceRecord>[] = [
  { key: 'status', label: 'Attendance Status' },
  { key: 'reason', label: 'Absence Reason' },
  { key: 'sortOrder', label: 'Order' },
];

function normalizeFieldValue(value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length === 0 ? undefined : trimmed;
  }
  return value;
}

export function isSyncFieldEqual(a: unknown, b: unknown): boolean {
  return normalizeFieldValue(a) === normalizeFieldValue(b);
}

function getChangedFieldLabels<T>(
  candidate: T,
  reference: T,
  fields: FieldSpec<T>[],
): string[] {
  const changed: string[] = [];
  for (const field of fields) {
    if (!isSyncFieldEqual(candidate[field.key], reference[field.key])) {
      changed.push(field.label);
    }
  }
  return changed;
}

export type ThreeWayMergeOutcome<T> =
  | { status: 'merged'; record: T; needsPush: boolean }
  | { status: 'conflict'; conflictingFields: string[] };

/**
 * Performs a field-level 3-way merge using `base` as the common ancestor.
 * Non-overlapping edits on distinct fields auto-merge cleanly; same-field or
 * edit-vs-delete collisions produce an explicit conflict list instead of silent data loss.
 */
export function mergeRecordThreeWay<T extends BaseSyncFields>(
  base: T | undefined,
  local: T,
  remote: T,
  fields: FieldSpec<T>[],
): ThreeWayMergeOutcome<T> {
  const localDeleted = Boolean(local.deletedAt);
  const remoteDeleted = Boolean(remote.deletedAt);

  if (localDeleted && remoteDeleted) {
    return { status: 'merged', record: remote, needsPush: false };
  }

  if (remoteDeleted && !localDeleted) {
    if (!base || base.deletedAt) {
      return { status: 'merged', record: remote, needsPush: false };
    }
    const localEdits = getChangedFieldLabels(local, base, fields);
    if (localEdits.length === 0) {
      return { status: 'merged', record: remote, needsPush: false };
    }
    return {
      status: 'conflict',
      conflictingFields: ['Deleted on Cloud', ...localEdits],
    };
  }

  if (localDeleted && !remoteDeleted) {
    if (!base) {
      return { status: 'merged', record: { ...local, syncVersion: remote.syncVersion }, needsPush: true };
    }
    const remoteEdits = getChangedFieldLabels(remote, base, fields);
    if (remoteEdits.length === 0) {
      return {
        status: 'merged',
        record: { ...local, syncVersion: remote.syncVersion },
        needsPush: true,
      };
    }
    return {
      status: 'conflict',
      conflictingFields: ['Deleted Locally', ...remoteEdits],
    };
  }

  const merged: T = { ...remote };
  const conflictingFields: string[] = [];
  let needsPush = false;

  for (const field of fields) {
    const localVal = local[field.key];
    const remoteVal = remote[field.key];

    if (base && !base.deletedAt) {
      const baseVal = base[field.key];
      const localChanged = !isSyncFieldEqual(localVal, baseVal);
      const remoteChanged = !isSyncFieldEqual(remoteVal, baseVal);

      if (localChanged && !remoteChanged) {
        merged[field.key] = localVal;
        needsPush = true;
      } else if (!localChanged && remoteChanged) {
        merged[field.key] = remoteVal;
      } else if (localChanged && remoteChanged) {
        if (isSyncFieldEqual(localVal, remoteVal)) {
          merged[field.key] = remoteVal;
        } else {
          conflictingFields.push(field.label);
        }
      }
    } else if (!isSyncFieldEqual(localVal, remoteVal)) {
      const normLocal = normalizeFieldValue(localVal);
      const normRemote = normalizeFieldValue(remoteVal);
      if (normLocal !== undefined && normRemote === undefined) {
        merged[field.key] = localVal;
        needsPush = true;
      } else if (normLocal === undefined && normRemote !== undefined) {
        merged[field.key] = remoteVal;
      } else {
        conflictingFields.push(field.label);
      }
    }
  }

  if (conflictingFields.length > 0) {
    return { status: 'conflict', conflictingFields };
  }

  return {
    status: 'merged',
    record: {
      ...merged,
      syncVersion: remote.syncVersion,
      updatedAt: remote.updatedAt,
    },
    needsPush,
  };
}

export function normalizeMergedAttendance(record: SyncedAttendanceRecord): SyncedAttendanceRecord {
  if (record.status !== 'absent_with_reason') {
    return { ...record, reason: undefined };
  }
  return record;
}

export function makeConflictId(entityType: SyncConflictEntityType, entityId: string): string {
  return `${entityType}:${entityId}`;
}

export function upsertConflictItem(
  existingConflicts: SyncConflictItem[],
  nextConflict: SyncConflictItem,
): SyncConflictItem[] {
  const filtered = existingConflicts.filter((item) => item.id !== nextConflict.id);
  return [...filtered, nextConflict];
}

export function removeConflictByEntity(
  existingConflicts: SyncConflictItem[],
  entityType: SyncConflictEntityType,
  entityId: string,
): SyncConflictItem[] {
  const targetId = makeConflictId(entityType, entityId);
  return existingConflicts.filter((item) => item.id !== targetId);
}

export function buildMemberConflictItem(
  memberId: string,
  baseRecord: SyncedMemberRecord | undefined,
  localRecord: SyncedMemberRecord,
  remoteRecord: SyncedMemberRecord,
  conflictingFields: string[],
): SyncConflictItem {
  return {
    id: makeConflictId('member', memberId),
    entityType: 'member',
    entityId: memberId,
    label: localRecord.name || remoteRecord.name,
    sublabel: [localRecord.className ?? remoteRecord.className, localRecord.role ?? remoteRecord.role]
      .filter(Boolean)
      .join(' • ') || 'Member Profile',
    conflictingFields,
    baseRecord,
    localRecord,
    remoteRecord,
    detectedAt: new Date().toISOString(),
  };
}

export function buildSessionConflictItem(
  sessionId: string,
  baseRecord: SyncedSessionRecord | undefined,
  localRecord: SyncedSessionRecord,
  remoteRecord: SyncedSessionRecord,
  conflictingFields: string[],
): SyncConflictItem {
  return {
    id: makeConflictId('session', sessionId),
    entityType: 'session',
    entityId: sessionId,
    label: localRecord.name || remoteRecord.name,
    sublabel: `${localRecord.date || remoteRecord.date} • ${localRecord.time || remoteRecord.time}`,
    conflictingFields,
    baseRecord,
    localRecord,
    remoteRecord,
    detectedAt: new Date().toISOString(),
  };
}

export function buildAttendanceConflictItem(
  attendanceKey: string,
  baseRecord: SyncedAttendanceRecord | undefined,
  localRecord: SyncedAttendanceRecord,
  remoteRecord: SyncedAttendanceRecord,
  conflictingFields: string[],
  context?: { memberName?: string; sessionName?: string },
): SyncConflictItem {
  const memberLabel = context?.memberName || localRecord.memberId;
  const sessionLabel = context?.sessionName || localRecord.sessionId;
  return {
    id: makeConflictId('attendance', attendanceKey),
    entityType: 'attendance',
    entityId: attendanceKey,
    label: `${memberLabel} — Attendance`,
    sublabel: sessionLabel,
    conflictingFields,
    baseRecord,
    localRecord,
    remoteRecord,
    detectedAt: new Date().toISOString(),
  };
}

/**
 * Reconciles a single incoming remote/sibling record against local state without wiping
 * dirty local edits, returning merged state or an explicit conflict item.
 */
export function reconcileIncomingEntity<T extends BaseSyncFields>(options: {
  local: T | undefined;
  base: T | undefined;
  remote: T;
  isDirty: boolean;
  fields: FieldSpec<T>[];
  normalizeMerged?: (record: T) => T;
}):
  | { action: 'accept_remote'; record: T; base: T }
  | { action: 'merged'; record: T; base: T; needsPush: boolean }
  | { action: 'keep_local'; record: T; base: T; needsPush: boolean }
  | { action: 'conflict'; base: T; conflictingFields: string[] } {
  const { local, base, remote, isDirty, fields, normalizeMerged } = options;

  if (!local || !isDirty) {
    return { action: 'accept_remote', record: remote, base: remote };
  }

  // If remote still matches our base version, local dirty edit is strictly ahead.
  if (
    base?.syncVersion !== undefined &&
    remote.syncVersion !== undefined &&
    remote.syncVersion === base.syncVersion
  ) {
    return { action: 'keep_local', record: local, base: remote, needsPush: true };
  }

  const outcome = mergeRecordThreeWay(base, local, remote, fields);
  if (outcome.status === 'conflict') {
    return {
      action: 'conflict',
      base: remote,
      conflictingFields: outcome.conflictingFields,
    };
  }

  const finalRecord = normalizeMerged ? normalizeMerged(outcome.record) : outcome.record;
  return {
    action: 'merged',
    record: finalRecord,
    base: remote,
    needsPush: outcome.needsPush,
  };
}
