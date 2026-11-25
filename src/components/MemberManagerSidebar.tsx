import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type {
  AccessScope,
  AttendanceSession,
  AttendanceStatus,
  ClassLetter,
  ClassYear,
  ClubMember,
  MemberProfileInput,
  MemberType,
  UserProfileRecord,
} from '../types/attendance';
import type { AdminCreateAccountResult } from '../lib/adminApi';
import {
  CLASS_LETTERS,
  CLASS_YEARS,
  CONSECUTIVE_ABSENCE_ALERT_THRESHOLD,
  MEMBER_TYPES,
  MEMBER_TYPE_LABELS,
  STATUS_LABELS,
  STREAK_HIGHLIGHT_THRESHOLD,
  compareStudentClassNames,
  formatStudentClassName,
  getAcademicCycleLabel,
  getMemberInitials,
  getNextPromotionDateLabel,
  isLegacyMember,
  normalizeMemberType,
  parseBulkMemberInput,
  resolveStudentClassFields,
  sortMembersByRoleAndName,
  summarizeMemberAttendance,
  type MemberAttendanceStats,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp } from '../utils/date';
import {
  exportMemberDirectoryCsv,
  exportMemberProfileCsv,
  printMemberDirectoryReport,
  printMemberProfileReport,
} from '../utils/export';
import { ConfirmDialog } from './ConfirmDialog';
import { MemberAccountCard } from './MemberAccountCard';
import {
  PixelAlertIcon,
  PixelArchiveIcon,
  PixelArrowLeftIcon,
  PixelCalendarIcon,
  PixelCheckSquareIcon,
  PixelChevronIcon,
  PixelCloseIcon,
  PixelDownloadIcon,
  PixelEditIcon,
  PixelFlameIcon,
  PixelKeyIcon,
  PixelPlusIcon,
  PixelPrinterIcon,
  PixelRestoreIcon,
  PixelSearchIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
  PixelUserIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface MemberManagerSidebarProps {
  id?: string;
  isOpen: boolean;
  members: ClubMember[];
  sessions: AttendanceSession[];
  selectedMemberId: string | null;
  confirmDeleteMember: boolean;
  canManageClubRecords?: boolean;
  accessScope?: AccessScope;
  linkedMemberId?: string | null;
  canBrowseFullRoster?: boolean;
  canViewAttendanceRates?: boolean;
  isCloudConnected?: boolean;
  isAdmin?: boolean;
  adminProfiles?: UserProfileRecord[];
  isProfilesLoading?: boolean;
  onEnsureMemberSynced?: () => Promise<boolean>;
  onSyncAdminProfiles?: () => Promise<UserProfileRecord[]>;
  onCreateAndLinkMemberAccount?: (params: {
    memberId: string;
    memberName: string;
    email: string;
    password: string;
  }) => Promise<AdminCreateAccountResult>;
  onSyncAndLinkMemberAccount?: (params: {
    memberId: string;
    email?: string;
    userId?: string;
  }) => Promise<UserProfileRecord>;
  onLinkUserToMember?: (
    targetUserId: string,
    targetMemberId: string | null,
  ) => Promise<UserProfileRecord>;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
  onSelectMember: (memberId: string | null) => void;
  onClose: () => void;
  onAddMember: (input: MemberProfileInput) => ClubMember;
  onAddMembersBulk: (inputs: MemberProfileInput[]) => ClubMember[];
  onUpdateMember: (memberId: string, input: MemberProfileInput) => void;
  onUpdateMembersClass: (
    memberIds: string[],
    patch: { classYear?: ClassYear; classLetter?: ClassLetter },
  ) => void;
  onSetMemberLegacyStatus: (memberId: string, isLegacy: boolean) => void;
  onSetMembersLegacyStatus: (
    memberIds: string[],
    isLegacy: boolean,
    options?: { fallbackClassYear?: ClassYear; fallbackClassLetter?: ClassLetter },
  ) => void;
  onDeleteMember: (memberId: string) => void;
  onDeleteMembers: (memberIds: string[]) => void;
  onBeginFieldEdit?: (fieldKey: string) => void;
  onEndFieldEdit?: (fieldKey: string) => void;
}

type SidebarViewMode = 'directory' | 'profile' | 'add' | 'edit' | 'bulk_add';
type DirectoryScope = 'active' | 'legacy';

const ROLE_SUGGESTIONS = [
  'President',
  'Vice President',
  'Secretary',
  'Lead',
  'Captain',
  'Vice Captain',
  'Treasurer',
  'Coach',
  'Coordinator',
  'Advisor',
  'Member',
];

const RING_CATEGORIES: {
  status: AttendanceStatus;
  label: string;
  shortLabel: string;
  color: string;
  chipClass: string;
}[] = [
  {
    status: 'present',
    label: 'Present',
    shortLabel: 'Present',
    color: '#22c55e',
    chipClass: 'ring-toggle-present',
  },
  {
    status: 'absent_with_reason',
    label: 'Absent w/ Reason',
    shortLabel: 'Excused',
    color: '#f5b82e',
    chipClass: 'ring-toggle-reason',
  },
  {
    status: 'absent_without_reason',
    label: 'Absent w/o Reason',
    shortLabel: 'Unexcused',
    color: '#ef4444',
    chipClass: 'ring-toggle-absent',
  },
  {
    status: 'unmarked',
    label: 'Unmarked',
    shortLabel: 'Unmarked',
    color: '#64748b',
    chipClass: 'ring-toggle-unmarked',
  },
];

interface MemberFormValues {
  name: string;
  memberType: MemberType;
  classYear: ClassYear | '';
  classLetter: ClassLetter | '';
  legacyClassFallback: string;
  isLegacy: boolean;
  role: string;
  joinedDate: string;
  email: string;
  phone: string;
  handle: string;
  notes: string;
}

function emptyFormValues(): MemberFormValues {
  return {
    name: '',
    memberType: 'student',
    classYear: '',
    classLetter: '',
    legacyClassFallback: '',
    isLegacy: false,
    role: '',
    joinedDate: '',
    email: '',
    phone: '',
    handle: '',
    notes: '',
  };
}

function memberToFormValues(member: ClubMember, overrideIsLegacy?: boolean): MemberFormValues {
  const memberType = normalizeMemberType(member.memberType);
  const resolvedClass = resolveStudentClassFields({
    memberType,
    classYear: member.classYear,
    classLetter: member.classLetter,
    className: member.className,
  });
  const hasStructuredClass = Boolean(
    resolvedClass.classLetter === 'N/A' ||
      (resolvedClass.classYear && resolvedClass.classLetter),
  );

  return {
    name: member.name,
    memberType,
    classYear: resolvedClass.classYear ?? '',
    classLetter: resolvedClass.classLetter ?? '',
    legacyClassFallback:
      memberType === 'student' && !hasStructuredClass ? (resolvedClass.className ?? '') : '',
    isLegacy: overrideIsLegacy !== undefined ? overrideIsLegacy : isLegacyMember(member),
    role: member.role ?? '',
    joinedDate: member.joinedDate ?? '',
    email: member.email ?? '',
    phone: member.phone ?? '',
    handle: member.handle ?? '',
    notes: member.notes ?? '',
  };
}

function getStatusCount(stats: MemberAttendanceStats, status: AttendanceStatus): number {
  switch (status) {
    case 'present':
      return stats.presentCount;
    case 'absent_with_reason':
      return stats.absentWithReasonCount;
    case 'absent_without_reason':
      return stats.absentWithoutReasonCount;
    case 'unmarked':
      return stats.unmarkedCount;
  }
}

interface MemberAttendanceRingProps {
  stats: MemberAttendanceStats;
}

/** Interactive circular donut chart with per-status toggles for member attendance breakdown. */
function MemberAttendanceRing({ stats }: MemberAttendanceRingProps) {
  const [visibleStatuses, setVisibleStatuses] = useState<Record<AttendanceStatus, boolean>>({
    present: true,
    absent_with_reason: true,
    absent_without_reason: true,
    unmarked: true,
  });

  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  const activeTotal = RING_CATEGORIES.reduce(
    (sum, category) =>
      visibleStatuses[category.status] ? sum + getStatusCount(stats, category.status) : sum,
    0,
  );

  const allEnabled = RING_CATEGORIES.every((category) => visibleStatuses[category.status]);

  function handleToggleStatus(status: AttendanceStatus) {
    setVisibleStatuses((prev) => ({
      ...prev,
      [status]: !prev[status],
    }));
  }

  function handleResetToggles() {
    setVisibleStatuses({
      present: true,
      absent_with_reason: true,
      absent_without_reason: true,
      unmarked: true,
    });
  }

  const segments = useMemo(() => {
    if (activeTotal <= 0) return [];
    const result: {
      status: AttendanceStatus;
      label: string;
      color: string;
      count: number;
      dashArray: string;
      dashOffset: number;
    }[] = [];

    let cumulativeLength = 0;
    for (const category of RING_CATEGORIES) {
      if (!visibleStatuses[category.status]) continue;
      const count = getStatusCount(stats, category.status);
      if (count <= 0) continue;

      const segmentLength = (count / activeTotal) * circumference;
      result.push({
        status: category.status,
        label: category.label,
        color: category.color,
        count,
        dashArray: `${segmentLength} ${Math.max(0, circumference - segmentLength)}`,
        dashOffset: -cumulativeLength,
      });
      cumulativeLength += segmentLength;
    }
    return result;
  }, [activeTotal, circumference, stats, visibleStatuses]);

  let centerPercent = '--%';
  let centerCaption = 'NO SESSIONS';
  let centerDetail = '0 / 0 sessions';

  if (stats.totalSessions === 0) {
    centerPercent = '--%';
    centerCaption = 'NO SESSIONS';
    centerDetail = 'Record a session first';
  } else if (activeTotal === 0) {
    const anyEnabled = RING_CATEGORIES.some((category) => visibleStatuses[category.status]);
    centerPercent = anyEnabled ? '0%' : '--%';
    centerCaption = anyEnabled ? '0 MATCHING' : 'NONE TOGGLED';
    centerDetail = anyEnabled ? '0 sessions in filter' : 'Toggle a status below';
  } else if (visibleStatuses.present) {
    const rate = Math.round((stats.presentCount / activeTotal) * 100);
    centerPercent = `${rate}%`;
    centerCaption = visibleStatuses.unmarked ? 'OVERALL RATE' : 'MARKED RATE';
    centerDetail = `${stats.presentCount} / ${activeTotal} shown`;
  } else {
    const share = Math.round((activeTotal / stats.totalSessions) * 100);
    centerPercent = `${share}%`;
    centerCaption = 'SELECTED SHARE';
    centerDetail = `${activeTotal} / ${stats.totalSessions} total`;
  }

  return (
    <div className="member-ring-panel">
      <div className="member-ring-header">
        <span className="member-section-label">Attendance Ring</span>
        {!allEnabled && (
          <button
            type="button"
            className="ring-reset-btn"
            onClick={handleResetToggles}
            title="Show all 4 attendance statuses in the ring"
          >
            Show All
          </button>
        )}
      </div>

      <div className="member-ring-layout">
        <div className="member-ring-chart" aria-label="Interactive member attendance breakdown chart">
          <svg className="member-ring-svg" viewBox="0 0 140 140" role="img" aria-label={centerDetail}>
            <circle
              className="member-ring-track"
              cx="70"
              cy="70"
              r={radius}
              fill="none"
              strokeWidth="14"
            />
            {segments.map((segment) => (
              <circle
                key={segment.status}
                className="member-ring-segment"
                cx="70"
                cy="70"
                r={radius}
                fill="none"
                stroke={segment.color}
                strokeWidth="14"
                strokeDasharray={segment.dashArray}
                strokeDashoffset={segment.dashOffset}
                transform="rotate(-90 70 70)"
                onClick={() => handleToggleStatus(segment.status)}
              >
                <title>{`${segment.label}: ${segment.count} (click to hide)`}</title>
              </circle>
            ))}
          </svg>

          <div className="member-ring-center">
            <span className="member-ring-percent">{centerPercent}</span>
            <span className="member-ring-caption">{centerCaption}</span>
            <span className="member-ring-detail">{centerDetail}</span>
          </div>
        </div>

        <div className="member-ring-toggles" role="group" aria-label="Toggle attendance categories">
          {RING_CATEGORIES.map((category) => {
            const isEnabled = visibleStatuses[category.status];
            const count = getStatusCount(stats, category.status);
            const pct =
              activeTotal > 0 && isEnabled ? Math.round((count / activeTotal) * 100) : null;

            return (
              <button
                key={category.status}
                type="button"
                aria-pressed={isEnabled}
                className={`ring-toggle-chip ${category.chipClass} ${isEnabled ? 'is-active' : 'is-muted'}`}
                onClick={() => handleToggleStatus(category.status)}
                title={
                  isEnabled
                    ? `Hide ${category.label} from ring`
                    : `Include ${category.label} in ring`
                }
              >
                <span
                  className="ring-toggle-dot"
                  style={{ backgroundColor: category.color }}
                  aria-hidden="true"
                />
                <span className="ring-toggle-label">{category.label}</span>
                <span className="ring-toggle-count">
                  {count}
                  {pct !== null ? ` (${pct}%)` : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Collapsible right-hand Member Manager directory, profile viewer, and CRUD panel. */
export function MemberManagerSidebar({
  id,
  isOpen,
  members,
  sessions,
  selectedMemberId,
  confirmDeleteMember,
  canManageClubRecords = true,
  accessScope = 'local',
  linkedMemberId = null,
  canBrowseFullRoster = true,
  canViewAttendanceRates = true,
  isCloudConnected = false,
  isAdmin = false,
  adminProfiles = [],
  isProfilesLoading = false,
  onEnsureMemberSynced,
  onSyncAdminProfiles,
  onCreateAndLinkMemberAccount,
  onSyncAndLinkMemberAccount,
  onLinkUserToMember,
  onNotify,
  onSelectMember,
  onClose,
  onAddMember,
  onAddMembersBulk,
  onUpdateMember,
  onUpdateMembersClass,
  onSetMemberLegacyStatus,
  onSetMembersLegacyStatus,
  onDeleteMember,
  onDeleteMembers,
  onBeginFieldEdit,
  onEndFieldEdit,
}: MemberManagerSidebarProps) {
  const titleId = useId();
  const roleListId = useId();
  const nameInputId = useId();
  const memberTypeLabelId = useId();
  const classYearInputId = useId();
  const classLetterLabelId = useId();
  const bulkTextareaId = useId();
  const bulkClassYearInputId = useId();
  const bulkClassLetterLabelId = useId();
  const bulkRoleInputId = useId();
  const bulkJoinedInputId = useId();
  const bulkNotesInputId = useId();
  const roleInputId = useId();
  const joinedInputId = useId();
  const emailInputId = useId();
  const phoneInputId = useId();
  const handleInputId = useId();
  const notesInputId = useId();

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const roleInputRef = useRef<HTMLInputElement | null>(null);
  const classYearSelectRef = useRef<HTMLSelectElement | null>(null);
  const bulkTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const bulkRoleInputRef = useRef<HTMLInputElement | null>(null);
  const bulkClassYearSelectRef = useRef<HTMLSelectElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);
  const selectAllCheckboxRef = useRef<HTMLInputElement | null>(null);
  const lastAnchorIndexRef = useRef<number | null>(null);
  const suppressNextRowClickRef = useRef(false);
  const suppressResetTimerRef = useRef<number | null>(null);
  const dragStateRef = useRef<{
    active: boolean;
    targetState: boolean;
    startIndex: number;
    initialSelection: Set<string>;
    moved: boolean;
  } | null>(null);

  const [viewMode, setViewMode] = useState<SidebarViewMode>(() =>
    selectedMemberId && members.some((member) => member.id === selectedMemberId)
      ? 'profile'
      : 'directory',
  );
  const [directoryScope, setDirectoryScope] = useState<DirectoryScope>('active');
  const [searchQuery, setSearchQuery] = useState('');
  const [classFilter, setClassFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [formValues, setFormValues] = useState<MemberFormValues>(emptyFormValues);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [editingBaselineMember, setEditingBaselineMember] = useState<ClubMember | null>(null);
  const [formError, setFormError] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [bulkClassYear, setBulkClassYear] = useState<ClassYear | ''>('');
  const [bulkClassLetter, setBulkClassLetter] = useState<ClassLetter | ''>('');
  const [bulkRole, setBulkRole] = useState('');
  const [bulkJoinedDate, setBulkJoinedDate] = useState('');
  const [bulkNotes, setBulkNotes] = useState('');
  const [bulkError, setBulkError] = useState('');
  const [absenceFilter, setAbsenceFilter] = useState<'reasons_only' | 'all'>('reasons_only');
  const [showAllAbsences, setShowAllAbsences] = useState(false);
  const [pendingDeleteMember, setPendingDeleteMember] = useState<ClubMember | null>(null);
  const [pendingBulkDeleteIds, setPendingBulkDeleteIds] = useState<string[] | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [bulkPanelMode, setBulkPanelMode] = useState<'none' | 'change_class' | 'restore_class'>(
    'none',
  );
  const [bulkTargetYear, setBulkTargetYear] = useState<ClassYear | ''>('');
  const [bulkTargetLetter, setBulkTargetLetter] = useState<ClassLetter | ''>('');
  const [bulkActionError, setBulkActionError] = useState('');

  const isRestrictedMemberAccount =
    accessScope === 'member_self' || accessScope === 'member_unlinked';
  const isSelfOnlyScope = !canBrowseFullRoster && accessScope === 'member_self';
  const isUnlinkedMemberScope = !canBrowseFullRoster && accessScope === 'member_unlinked';
  const canEditRoster =
    canManageClubRecords && accessScope !== 'broad_viewer' && !isRestrictedMemberAccount;
  const canManageMemberAccounts = Boolean(
    isCloudConnected &&
      isAdmin &&
      accessScope === 'admin' &&
      onCreateAndLinkMemberAccount &&
      onSyncAndLinkMemberAccount &&
      onLinkUserToMember,
  );
  const canViewPeerAttendanceStats =
    accessScope === 'local' ||
    accessScope === 'admin' ||
    accessScope === 'broad_viewer' ||
    canViewAttendanceRates;

  const linkedProfileByMemberId = useMemo(() => {
    const map = new Map<string, UserProfileRecord>();
    if (!canManageMemberAccounts) return map;
    for (const profile of adminProfiles) {
      if (profile.linkedMemberId) {
        map.set(profile.linkedMemberId, profile);
      }
    }
    return map;
  }, [adminProfiles, canManageMemberAccounts]);

  const handleSyncMemberEmailToRoster = useCallback(
    (targetMember: ClubMember, nextEmail: string) => {
      const normalizedEmail = nextEmail.trim().toLowerCase();
      if (!normalizedEmail) return;
      onUpdateMember(targetMember.id, {
        name: targetMember.name,
        memberType: targetMember.memberType,
        classYear: targetMember.classYear,
        classLetter: targetMember.classLetter,
        className: targetMember.className,
        isLegacy: targetMember.isLegacy,
        retiredAt: targetMember.retiredAt,
        lastPromotedYear: targetMember.lastPromotedYear,
        graduationYear: targetMember.graduationYear,
        role: targetMember.role,
        email: normalizedEmail,
        phone: targetMember.phone,
        handle: targetMember.handle,
        joinedDate: targetMember.joinedDate,
        notes: targetMember.notes,
      });
    },
    [onUpdateMember],
  );

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  );
  const canShowSelectedMemberRates = Boolean(
    selectedMember &&
      (canViewPeerAttendanceStats || (linkedMemberId && selectedMember.id === linkedMemberId)),
  );

  const prevSelectedMemberIdRef = useRef<string | null>(selectedMemberId);

  // Sync external member selection (e.g. clicking a member in the main roster) into profile view.
  useEffect(() => {
    const selectedMemberChanged = prevSelectedMemberIdRef.current !== selectedMemberId;
    prevSelectedMemberIdRef.current = selectedMemberId;

    if (isUnlinkedMemberScope) {
      if (viewMode !== 'directory') {
        setViewMode('directory');
      }
      if (selectedMemberId !== null) {
        onSelectMember(null);
      }
      return;
    }

    if (isSelfOnlyScope) {
      if (linkedMemberId && selectedMemberId !== linkedMemberId) {
        onSelectMember(linkedMemberId);
      }
      if (linkedMemberId && members.some((member) => member.id === linkedMemberId)) {
        if (viewMode !== 'profile') {
          setViewMode('profile');
          setShowAllAbsences(false);
        } else if (selectedMemberChanged) {
          setShowAllAbsences(false);
        }
      } else if (viewMode !== 'directory') {
        setViewMode('directory');
      }
      return;
    }

    if (!canEditRoster && (viewMode === 'add' || viewMode === 'edit' || viewMode === 'bulk_add')) {
      setEditingTargetId(null);
      setEditingBaselineMember(null);
      setFormError('');
      setBulkError('');
      setViewMode(selectedMemberId && selectedMember ? 'profile' : 'directory');
      return;
    }

    if (selectedMemberId && selectedMember) {
      setViewMode((current) =>
        current === 'edit' && editingTargetId === selectedMemberId ? current : 'profile',
      );
      if (selectedMemberChanged) {
        setShowAllAbsences(false);
      }
    } else if (viewMode === 'profile') {
      setViewMode('directory');
      if (selectedMemberId && !selectedMember) {
        onSelectMember(null);
      }
    }
  }, [
    canEditRoster,
    isUnlinkedMemberScope,
    isSelfOnlyScope,
    linkedMemberId,
    members,
    selectedMemberId,
    selectedMember,
    viewMode,
    editingTargetId,
    onSelectMember,
  ]);

  useEffect(() => {
    if (!isOpen || viewMode !== 'edit' || !editingTargetId) return;
    const key = `member:${editingTargetId}`;
    onBeginFieldEdit?.(key);
    return () => {
      onEndFieldEdit?.(key);
    };
  }, [editingTargetId, isOpen, onBeginFieldEdit, onEndFieldEdit, viewMode]);

  useEffect(() => {
    if (isOpen && (viewMode === 'add' || viewMode === 'edit')) {
      const timer = window.setTimeout(() => {
        nameInputRef.current?.focus({ preventScroll: true });
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (isOpen && viewMode === 'bulk_add') {
      const timer = window.setTimeout(() => {
        bulkTextareaRef.current?.focus({ preventScroll: true });
      }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, viewMode]);

  useEffect(() => {
    if (!isExportMenuOpen) return;

    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        exportMenuRef.current &&
        event.target instanceof Node &&
        !exportMenuRef.current.contains(event.target)
      ) {
        setIsExportMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, [isExportMenuOpen]);

  const exitSelectionMode = useCallback(() => {
    setIsSelectionMode(false);
    setSelectedIds(new Set());
    setBulkPanelMode('none');
    setBulkTargetYear('');
    setBulkTargetLetter('');
    setBulkActionError('');
    setIsDragSelecting(false);
    dragStateRef.current = null;
    lastAnchorIndexRef.current = null;
  }, []);

  function handleSidebarKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && isExportMenuOpen) {
      event.stopPropagation();
      setIsExportMenuOpen(false);
      return;
    }
    if (event.key === 'Escape' && (pendingDeleteMember || pendingBulkDeleteIds)) {
      return;
    }
    if (event.key === 'Escape' && bulkPanelMode !== 'none') {
      event.stopPropagation();
      setBulkPanelMode('none');
      setBulkActionError('');
      return;
    }
    if (event.key === 'Escape' && viewMode === 'directory' && isSelectionMode) {
      event.stopPropagation();
      exitSelectionMode();
      return;
    }
    if (event.key === 'Escape' && isOpen) {
      event.stopPropagation();
      onClose();
    }
  }

  const activeMembers = useMemo(
    () => members.filter((member) => !isLegacyMember(member)),
    [members],
  );

  const legacyMembers = useMemo(
    () => members.filter((member) => isLegacyMember(member)),
    [members],
  );

  const scopedMembers = directoryScope === 'legacy' ? legacyMembers : activeMembers;

  const distinctRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const member of scopedMembers) {
      if (member.role) roles.add(member.role);
    }
    return Array.from(roles).sort((a, b) => a.localeCompare(b));
  }, [scopedMembers]);

  const distinctClasses = useMemo(() => {
    const classes = new Set<string>();
    for (const member of scopedMembers) {
      if (member.className) {
        classes.add(member.className);
      }
    }
    return Array.from(classes).sort(compareStudentClassNames);
  }, [scopedMembers]);

  const effectiveRoleFilter =
    roleFilter === 'all' ||
    (roleFilter === '__unassigned__'
      ? scopedMembers.some((member) => !member.role)
      : distinctRoles.includes(roleFilter))
      ? roleFilter
      : 'all';

  const effectiveClassFilter =
    classFilter === 'all' || distinctClasses.includes(classFilter) ? classFilter : 'all';

  const memberStatsMap = useMemo(() => {
    const map = new Map<string, MemberAttendanceStats>();
    for (const member of members) {
      map.set(member.id, summarizeMemberAttendance(member.id, sessions));
    }
    return map;
  }, [members, sessions]);

  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const filtered = scopedMembers.filter((member) => {
      const memberType = normalizeMemberType(member.memberType);
      const matchesRole =
        effectiveRoleFilter === 'all' ||
        (effectiveRoleFilter === '__unassigned__'
          ? !member.role
          : member.role === effectiveRoleFilter);
      if (!matchesRole) return false;

      const matchesClass =
        effectiveClassFilter === 'all' || member.className === effectiveClassFilter;
      if (!matchesClass) return false;

      if (!query) return true;
      return [
        member.name,
        member.className,
        member.graduationYear ? String(member.graduationYear) : undefined,
        member.graduationYear ? `Graduated ${member.graduationYear}` : undefined,
        MEMBER_TYPE_LABELS[memberType],
        member.role,
        member.email,
        member.phone,
        member.handle,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
    return sortMembersByRoleAndName(filtered);
  }, [effectiveClassFilter, effectiveRoleFilter, scopedMembers, searchQuery]);

  const activeProfileStats = selectedMember
    ? memberStatsMap.get(selectedMember.id) ?? summarizeMemberAttendance(selectedMember.id, sessions)
    : null;

  const bulkParseResult = useMemo(
    () => parseBulkMemberInput(bulkText, activeMembers),
    [activeMembers, bulkText],
  );
  const bulkReadyCount = bulkParseResult.namesToAdd.length;

  // Prune selection when scoped members change (e.g. external delete/archive/realtime sync).
  useEffect(() => {
    const validIds = new Set(scopedMembers.map((member) => member.id));
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Set<string>();
      for (const memberId of prev) {
        if (validIds.has(memberId)) {
          next.add(memberId);
        } else {
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [scopedMembers]);

  // Clear selection when leaving directory view or switching Active <-> Legacy tabs.
  useEffect(() => {
    if (viewMode !== 'directory') {
      exitSelectionMode();
    }
  }, [viewMode, exitSelectionMode]);

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkPanelMode('none');
    setBulkTargetYear('');
    setBulkTargetLetter('');
    setBulkActionError('');
    lastAnchorIndexRef.current = null;
  }, [directoryScope]);

  // Global mouseup/blur cleanup for click-and-drag mass selection.
  useEffect(() => {
    function finishDragSelection() {
      if (!dragStateRef.current) return;
      dragStateRef.current = null;
      setIsDragSelecting(false);
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
      suppressResetTimerRef.current = window.setTimeout(() => {
        suppressNextRowClickRef.current = false;
        suppressResetTimerRef.current = null;
      }, 0);
    }

    window.addEventListener('mouseup', finishDragSelection);
    window.addEventListener('blur', finishDragSelection);
    return () => {
      window.removeEventListener('mouseup', finishDragSelection);
      window.removeEventListener('blur', finishDragSelection);
      if (suppressResetTimerRef.current !== null) {
        window.clearTimeout(suppressResetTimerRef.current);
      }
    };
  }, []);

  const selectedMembersList = useMemo(
    () => scopedMembers.filter((member) => selectedIds.has(member.id)),
    [scopedMembers, selectedIds],
  );

  const selectedVisibleCount = useMemo(
    () => filteredMembers.reduce((count, member) => count + (selectedIds.has(member.id) ? 1 : 0), 0),
    [filteredMembers, selectedIds],
  );

  const allVisibleSelected =
    filteredMembers.length > 0 && selectedVisibleCount === filteredMembers.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < filteredMembers.length;
  const hiddenSelectedCount = Math.max(0, selectedIds.size - selectedVisibleCount);

  useEffect(() => {
    if (selectAllCheckboxRef.current) {
      selectAllCheckboxRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const selectedStudentMembers = useMemo(
    () =>
      selectedMembersList.filter(
        (member) => normalizeMemberType(member.memberType) === 'student',
      ),
    [selectedMembersList],
  );

  const selectedLegacyStudentsMissingClass = useMemo(
    () =>
      selectedStudentMembers.filter((member) => {
        const resolved = resolveStudentClassFields({
          memberType: 'student',
          classYear: member.classYear,
          classLetter: member.classLetter,
          className: member.className,
        });
        if (resolved.classLetter === 'N/A') return false;
        return !resolved.classYear || !resolved.classLetter;
      }),
    [selectedStudentMembers],
  );

  const classUpdatePreview = useMemo(() => {
    if (bulkTargetLetter === 'N/A') {
      return { eligibleCount: selectedMembersList.length, missingComplementCount: 0 };
    }
    if (bulkTargetYear === '' && bulkTargetLetter === '') {
      return { eligibleCount: 0, missingComplementCount: 0 };
    }
    let eligibleCount = 0;
    let missingComplementCount = 0;
    for (const student of selectedStudentMembers) {
      const resolved = resolveStudentClassFields({
        memberType: 'student',
        classYear: student.classYear,
        classLetter: student.classLetter,
        className: student.className,
      });
      const existingLetter =
        resolved.classLetter && resolved.classLetter !== 'N/A' ? resolved.classLetter : undefined;
      const nextYear = bulkTargetYear !== '' ? bulkTargetYear : resolved.classYear;
      const nextLetter = bulkTargetLetter !== '' ? bulkTargetLetter : existingLetter;
      if (nextYear && nextLetter) {
        eligibleCount += 1;
      } else {
        missingComplementCount += 1;
      }
    }
    return { eligibleCount, missingComplementCount };
  }, [bulkTargetLetter, bulkTargetYear, selectedMembersList.length, selectedStudentMembers]);

  function handleToggleSelectionMode() {
    if (isSelectionMode) {
      exitSelectionMode();
    } else {
      setIsSelectionMode(true);
      setSelectedIds(new Set());
      setBulkPanelMode('none');
      setBulkActionError('');
    }
  }

  function handleToggleSelectAll() {
    if (filteredMembers.length === 0) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const member of filteredMembers) {
          next.delete(member.id);
        }
      } else {
        for (const member of filteredMembers) {
          next.add(member.id);
        }
      }
      return next;
    });
    setBulkActionError('');
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
    setBulkPanelMode('none');
    setBulkActionError('');
    lastAnchorIndexRef.current = null;
  }

  function applyRangeSelection(
    baseSelection: Set<string>,
    startIndex: number,
    endIndex: number,
    targetState: boolean,
  ): Set<string> {
    const next = new Set(baseSelection);
    const min = Math.min(startIndex, endIndex);
    const max = Math.max(startIndex, endIndex);
    for (let i = min; i <= max; i += 1) {
      const targetMember = filteredMembers[i];
      if (!targetMember) continue;
      if (targetState) {
        next.add(targetMember.id);
      } else {
        next.delete(targetMember.id);
      }
    }
    return next;
  }

  function handleSelectableRowMouseDown(
    event: ReactMouseEvent<HTMLDivElement>,
    member: ClubMember,
    index: number,
  ) {
    if (!isSelectionMode || event.button !== 0) return;

    const targetState = !selectedIds.has(member.id);
    if (event.shiftKey && lastAnchorIndexRef.current !== null) {
      suppressNextRowClickRef.current = true;
      setSelectedIds((prev) =>
        applyRangeSelection(prev, lastAnchorIndexRef.current as number, index, targetState),
      );
      lastAnchorIndexRef.current = index;
      setBulkActionError('');
      return;
    }

    const initialSelection = new Set(selectedIds);
    dragStateRef.current = {
      active: true,
      targetState,
      startIndex: index,
      initialSelection,
      moved: false,
    };
    setIsDragSelecting(true);
    suppressNextRowClickRef.current = true;
    setSelectedIds(applyRangeSelection(initialSelection, index, index, targetState));
    lastAnchorIndexRef.current = index;
    setBulkActionError('');
  }

  function handleSelectableRowMouseEnter(index: number) {
    const drag = dragStateRef.current;
    if (!drag || !drag.active) return;
    drag.moved = true;
    setSelectedIds(
      applyRangeSelection(drag.initialSelection, drag.startIndex, index, drag.targetState),
    );
    lastAnchorIndexRef.current = index;
  }

  function handleSelectableRowClick(
    event: ReactMouseEvent<HTMLDivElement>,
    member: ClubMember,
    index: number,
  ) {
    if (suppressNextRowClickRef.current) {
      suppressNextRowClickRef.current = false;
      return;
    }

    const targetState = !selectedIds.has(member.id);
    if (event.shiftKey && lastAnchorIndexRef.current !== null) {
      setSelectedIds((prev) =>
        applyRangeSelection(prev, lastAnchorIndexRef.current as number, index, targetState),
      );
    } else {
      setSelectedIds((prev) => applyRangeSelection(prev, index, index, targetState));
    }
    lastAnchorIndexRef.current = index;
    setBulkActionError('');
  }

  function handleSelectableRowKeyDown(
    event: ReactKeyboardEvent<HTMLDivElement>,
    member: ClubMember,
    index: number,
  ) {
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      const targetState = !selectedIds.has(member.id);
      if (event.shiftKey && lastAnchorIndexRef.current !== null) {
        setSelectedIds((prev) =>
          applyRangeSelection(prev, lastAnchorIndexRef.current as number, index, targetState),
        );
      } else {
        setSelectedIds((prev) => applyRangeSelection(prev, index, index, targetState));
      }
      lastAnchorIndexRef.current = index;
      setBulkActionError('');
    }
  }

  function handleBulkArchiveSelected() {
    if (selectedMembersList.length === 0) return;
    onSetMembersLegacyStatus(
      selectedMembersList.map((member) => member.id),
      true,
    );
    exitSelectionMode();
  }

  function handleBulkRestoreSelected() {
    if (selectedMembersList.length === 0) return;
    if (selectedLegacyStudentsMissingClass.length > 0) {
      setBulkTargetYear('');
      setBulkTargetLetter('');
      setBulkActionError('');
      setBulkPanelMode('restore_class');
      return;
    }
    onSetMembersLegacyStatus(
      selectedMembersList.map((member) => member.id),
      false,
    );
    exitSelectionMode();
  }

  function handleConfirmBulkRestoreWithClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bulkTargetLetter !== 'N/A' && (bulkTargetYear === '' || bulkTargetLetter === '')) {
      setBulkActionError(
        'Select both Year (7–11) and Class (T, E, N, B), or choose N/A for students without a saved class.',
      );
      return;
    }
    onSetMembersLegacyStatus(
      selectedMembersList.map((member) => member.id),
      false,
      bulkTargetLetter === 'N/A'
        ? { fallbackClassLetter: 'N/A' }
        : {
            fallbackClassYear: bulkTargetYear as ClassYear,
            fallbackClassLetter: bulkTargetLetter as ClassLetter,
          },
    );
    exitSelectionMode();
  }

  function handleOpenChangeClassPanel() {
    if (bulkPanelMode === 'change_class') {
      setBulkPanelMode('none');
      setBulkActionError('');
      return;
    }
    setBulkTargetYear('');
    setBulkTargetLetter('');
    setBulkActionError('');
    setBulkPanelMode('change_class');
  }

  function handleApplyBulkClassUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (bulkTargetLetter === 'N/A') {
      if (selectedMembersList.length === 0) {
        setBulkActionError('Select at least one member to assign Class N/A.');
        return;
      }
      onUpdateMembersClass(
        selectedMembersList.map((member) => member.id),
        { classLetter: 'N/A' },
      );
      setBulkPanelMode('none');
      setBulkTargetYear('');
      setBulkTargetLetter('');
      setBulkActionError('');
      return;
    }
    if (selectedStudentMembers.length === 0) {
      setBulkActionError(
        'Select at least one Student member to set a standard Year/Class, or choose N/A.',
      );
      return;
    }
    if (bulkTargetYear === '' && bulkTargetLetter === '') {
      setBulkActionError('Choose a new Year, a new Class letter, or N/A.');
      return;
    }
    if (classUpdatePreview.eligibleCount === 0) {
      setBulkActionError(
        'Selected students do not have a standard class yet. Choose both Year and Class, or select N/A.',
      );
      return;
    }
    onUpdateMembersClass(
      selectedStudentMembers.map((member) => member.id),
      {
        classYear: bulkTargetYear !== '' ? bulkTargetYear : undefined,
        classLetter: bulkTargetLetter !== '' ? bulkTargetLetter : undefined,
      },
    );
    setBulkPanelMode('none');
    setBulkTargetYear('');
    setBulkTargetLetter('');
    setBulkActionError('');
  }

  function handleRequestBulkDelete() {
    if (selectedMembersList.length === 0) return;
    setPendingBulkDeleteIds(selectedMembersList.map((member) => member.id));
  }

  function handleConfirmBulkDelete() {
    if (!pendingBulkDeleteIds || pendingBulkDeleteIds.length === 0) return;
    const idsToDelete = pendingBulkDeleteIds;
    setPendingBulkDeleteIds(null);
    onDeleteMembers(idsToDelete);
    exitSelectionMode();
  }

  function openDirectory(targetScope?: DirectoryScope) {
    if (isSelfOnlyScope) return;
    if (targetScope) {
      setDirectoryScope(targetScope);
    } else if (selectedMember) {
      setDirectoryScope(isLegacyMember(selectedMember) ? 'legacy' : 'active');
    }
    onSelectMember(null);
    setEditingTargetId(null);
    setFormError('');
    setBulkError('');
    setViewMode('directory');
  }

  function openMemberProfile(memberId: string) {
    if (isUnlinkedMemberScope) return;
    if (isSelfOnlyScope && linkedMemberId && memberId !== linkedMemberId) return;
    onSelectMember(memberId);
    setEditingTargetId(null);
    setFormError('');
    setBulkError('');
    setShowAllAbsences(false);
    setViewMode('profile');
  }

  function openAddForm() {
    if (!canEditRoster) return;
    setEditingTargetId(null);
    setFormValues(emptyFormValues());
    setFormError('');
    setBulkError('');
    setViewMode('add');
  }

  function openBulkAddForm() {
    if (!canEditRoster) return;
    setEditingTargetId(null);
    setFormError('');
    setBulkText('');
    setBulkClassYear('');
    setBulkClassLetter('');
    setBulkRole('');
    setBulkJoinedDate('');
    setBulkNotes('');
    setBulkError('');
    setViewMode('bulk_add');
  }

  function openEditForm(
    member: ClubMember,
    options?: { overrideIsLegacy?: boolean; noticeMessage?: string },
  ) {
    if (!canEditRoster) return;
    onSelectMember(member.id);
    setEditingTargetId(member.id);
    setEditingBaselineMember(member);
    setFormValues(memberToFormValues(member, options?.overrideIsLegacy));
    setFormError(options?.noticeMessage ?? '');
    setViewMode('edit');
  }

  function handleRestoreMember(member: ClubMember) {
    const memberType = normalizeMemberType(member.memberType);
    if (memberType === 'student') {
      const resolved = resolveStudentClassFields({
        memberType,
        classYear: member.classYear,
        classLetter: member.classLetter,
        className: member.className,
      });
      if (resolved.classLetter !== 'N/A' && (!resolved.classYear || !resolved.classLetter)) {
        openEditForm(member, {
          overrideIsLegacy: false,
          noticeMessage:
            'Select a Year (7–11) and Class (T, E, N, B) — or N/A — to restore this student to the Active Roster.',
        });
        return;
      }
    }
    onSetMemberLegacyStatus(member.id, false);
  }

  function handleArchiveMember(member: ClubMember) {
    onSetMemberLegacyStatus(member.id, true);
  }

  function handleFormCancel() {
    setFormError('');
    if (viewMode === 'edit' && selectedMember) {
      setViewMode('profile');
    } else {
      setViewMode('directory');
    }
  }

  function handleFormSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEditRoster) return;
    const cleanedName = formValues.name.trim();
    if (!cleanedName) {
      setFormError('Member name is required.');
      nameInputRef.current?.focus();
      return;
    }

    const cleanedRole = formValues.role.trim();
    if (!cleanedRole) {
      setFormError('Club role is required.');
      roleInputRef.current?.focus();
      return;
    }

    const isStudent = formValues.memberType === 'student';
    const isNaClass = formValues.classLetter === 'N/A';
    const hasYear = formValues.classYear !== '';
    const hasLetter = formValues.classLetter !== '';
    let resolvedClassYear: ClassYear | undefined;
    let resolvedClassLetter: ClassLetter | undefined;
    let resolvedClassName: string | undefined;

    if (isNaClass) {
      resolvedClassYear = undefined;
      resolvedClassLetter = 'N/A';
      resolvedClassName = 'N/A';
    } else if (isStudent) {
      if (hasYear && hasLetter) {
        resolvedClassYear = formValues.classYear as ClassYear;
        resolvedClassLetter = formValues.classLetter as ClassLetter;
        resolvedClassName = formatStudentClassName(resolvedClassYear, resolvedClassLetter);
      } else if (!hasYear && !hasLetter && formValues.isLegacy && formValues.legacyClassFallback) {
        resolvedClassName = formValues.legacyClassFallback;
      } else {
        setFormError(
          !hasYear && !hasLetter
            ? 'Select both Year (7–11) and Class (T, E, N, B), or choose N/A for non-standard students.'
            : !hasYear
              ? 'Select a Year (Year 7 – Year 11) or choose N/A.'
              : 'Select a Class letter (T, E, N, B) or choose N/A.',
        );
        if (!hasYear) {
          classYearSelectRef.current?.focus();
        }
        return;
      }
    } else if (hasYear || hasLetter) {
      if (hasYear && hasLetter) {
        resolvedClassYear = formValues.classYear as ClassYear;
        resolvedClassLetter = formValues.classLetter as ClassLetter;
        resolvedClassName = formatStudentClassName(resolvedClassYear, resolvedClassLetter);
      } else {
        setFormError(
          'Select N/A, or pick both Year (7–11) and Class (T, E, N, B).',
        );
        if (!hasYear) {
          classYearSelectRef.current?.focus();
        }
        return;
      }
    }

    const payload: MemberProfileInput = {
      name: cleanedName,
      memberType: formValues.memberType,
      classYear: resolvedClassYear,
      classLetter: resolvedClassLetter,
      className: resolvedClassName,
      isLegacy: formValues.isLegacy,
      role: cleanedRole,
      joinedDate: formValues.joinedDate.trim() || undefined,
      email: formValues.email.trim() || undefined,
      phone: formValues.phone.trim() || undefined,
      handle: formValues.handle.trim() || undefined,
      notes: formValues.notes.trim() || undefined,
    };

    if (viewMode === 'edit' && editingTargetId) {
      const stillExists = members.some((member) => member.id === editingTargetId);
      if (stillExists) {
        onUpdateMember(editingTargetId, payload);
        setEditingTargetId(null);
        setEditingBaselineMember(null);
        setDirectoryScope(payload.isLegacy ? 'legacy' : 'active');
        onSelectMember(editingTargetId);
        setViewMode('profile');
      } else {
        const recreated = onAddMember(payload);
        setEditingTargetId(null);
        setEditingBaselineMember(null);
        setDirectoryScope(payload.isLegacy ? 'legacy' : 'active');
        onSelectMember(recreated.id);
        setViewMode('profile');
      }
    } else {
      const created = onAddMember(payload);
      setDirectoryScope('active');
      onSelectMember(created.id);
      setViewMode('profile');
    }
    setFormError('');
  }

  function handleBulkSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canEditRoster) return;

    if (bulkReadyCount === 0) {
      setBulkError(
        bulkParseResult.skippedActiveDuplicates.length > 0
          ? 'All entered names already exist in the active roster.'
          : 'Enter at least one member name (one per line).',
      );
      bulkTextareaRef.current?.focus();
      return;
    }

    const cleanedRole = bulkRole.trim();
    if (!cleanedRole) {
      setBulkError('Club role is required for bulk import.');
      bulkRoleInputRef.current?.focus();
      return;
    }

    const isNaClass = bulkClassLetter === 'N/A';
    const hasYear = bulkClassYear !== '';
    const hasLetter = bulkClassLetter !== '';
    if (!isNaClass && hasYear !== hasLetter) {
      setBulkError(
        'Select both Year (7–11) and Class (T, E, N, B), choose N/A, or click Clear to add without a class.',
      );
      if (!hasYear) {
        bulkClassYearSelectRef.current?.focus();
      }
      return;
    }

    const batchClassFields = isNaClass
      ? {
          classYear: undefined,
          classLetter: 'N/A' as ClassLetter,
          className: 'N/A',
        }
      : hasYear && hasLetter
        ? {
            classYear: bulkClassYear as ClassYear,
            classLetter: bulkClassLetter as ClassLetter,
            className: formatStudentClassName(
              bulkClassYear as ClassYear,
              bulkClassLetter as ClassLetter,
            ),
          }
        : {};

    const cleanedJoinedDate = bulkJoinedDate.trim() || undefined;
    const cleanedNotes = bulkNotes.trim() || undefined;

    const inputs: MemberProfileInput[] = bulkParseResult.namesToAdd.map((name) => ({
      name,
      memberType: 'student',
      ...batchClassFields,
      role: cleanedRole,
      joinedDate: cleanedJoinedDate,
      notes: cleanedNotes,
    }));

    onAddMembersBulk(inputs);
    setBulkText('');
    setBulkClassYear('');
    setBulkClassLetter('');
    setBulkRole('');
    setBulkJoinedDate('');
    setBulkNotes('');
    setBulkError('');
    onSelectMember(null);
    setDirectoryScope('active');
    setViewMode('directory');
  }

  function executeDeleteMember(deletingId: string) {
    onDeleteMember(deletingId);
    if (selectedMemberId === deletingId || editingTargetId === deletingId) {
      onSelectMember(null);
      setEditingTargetId(null);
      setViewMode('directory');
    }
  }

  function handleRequestDeleteMember(member: ClubMember) {
    if (confirmDeleteMember) {
      setPendingDeleteMember(member);
    } else {
      executeDeleteMember(member.id);
    }
  }

  function handleConfirmDelete() {
    if (!pendingDeleteMember) return;
    const deletingId = pendingDeleteMember.id;
    setPendingDeleteMember(null);
    executeDeleteMember(deletingId);
  }

  const selectedMemberType = selectedMember
    ? normalizeMemberType(selectedMember.memberType)
    : 'student';

  const displayedAbsences = activeProfileStats
    ? (absenceFilter === 'reasons_only'
        ? activeProfileStats.recentAbsenceReasons
        : activeProfileStats.absenceRecords)
    : [];
  const visibleAbsences = showAllAbsences ? displayedAbsences : displayedAbsences.slice(0, 5);

  return (
    <>
      <aside
        id={id}
        className={`member-drawer ${isOpen ? 'is-open' : 'is-closed'}`}
        data-tutorial-target="member-sidebar"
        aria-labelledby={titleId}
        aria-hidden={!isOpen}
        inert={!isOpen || undefined}
        onKeyDown={handleSidebarKeyDown}
      >
          <div className="member-drawer-header">
            <div className="member-drawer-title-group">
              <div className="member-drawer-title-row">
                <span className="modal-badge">
                  <PixelUsersIcon />
                  <span>
                    {isUnlinkedMemberScope
                      ? 'Profile Link'
                      : isSelfOnlyScope
                        ? 'My Profile'
                        : directoryScope === 'legacy' && viewMode === 'directory'
                          ? 'Legacy'
                          : 'Directory'}
                  </span>
                </span>
                {!isUnlinkedMemberScope && !isSelfOnlyScope && (
                  <span
                    className="panel-count"
                    title={`${activeMembers.length} active • ${legacyMembers.length} legacy`}
                  >
                    {directoryScope === 'legacy' && viewMode === 'directory'
                      ? legacyMembers.length
                      : activeMembers.length}
                  </span>
                )}
              </div>
              <h2 id={titleId} className="member-drawer-title">
                {isUnlinkedMemberScope
                  ? 'My Member Profile'
                  : isSelfOnlyScope
                    ? (selectedMember?.name ?? 'My Member Profile')
                    : (
                      <>
                        {viewMode === 'directory' && 'Member Manager'}
                        {viewMode === 'profile' && (selectedMember?.name ?? 'Member Profile')}
                        {viewMode === 'add' && 'Add Club Member'}
                        {viewMode === 'bulk_add' && 'Bulk Add Members'}
                        {viewMode === 'edit' && 'Edit Member Profile'}
                      </>
                    )}
              </h2>
            </div>

            <div className="member-drawer-header-actions">
              {!isUnlinkedMemberScope &&
                (viewMode === 'profile' && selectedMember
                  ? canShowSelectedMemberRates
                  : !isSelfOnlyScope &&
                    viewMode === 'directory' &&
                    canViewPeerAttendanceStats) && (
                <div className="export-menu-wrap" ref={exportMenuRef}>
                  <button
                    type="button"
                    className={`btn-secondary btn-compact ${isExportMenuOpen ? 'is-active' : ''}`}
                    aria-expanded={isExportMenuOpen}
                    aria-haspopup="menu"
                    disabled={viewMode === 'directory' && filteredMembers.length === 0}
                    onClick={() => setIsExportMenuOpen((prev) => !prev)}
                    title={
                      viewMode === 'profile' && selectedMember
                        ? `Export attendance report for ${selectedMember.name}`
                        : 'Export member directory stats as CSV or printable report'
                    }
                  >
                    <PixelDownloadIcon />
                    <span>Export</span>
                    <PixelChevronIcon width={10} height={10} className="export-chevron-icon" />
                  </button>

                  {isExportMenuOpen && (
                    <div
                      className="export-menu-dropdown export-menu-dropdown-right"
                      role="menu"
                      aria-label="Export member report"
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="export-menu-item"
                        onClick={() => {
                          if (viewMode === 'profile' && selectedMember && activeProfileStats) {
                            exportMemberProfileCsv(selectedMember, activeProfileStats, sessions);
                          } else {
                            exportMemberDirectoryCsv(
                              filteredMembers,
                              memberStatsMap,
                              sessions,
                              directoryScope === 'legacy' ? 'legacy-members' : 'active-members',
                            );
                          }
                          setIsExportMenuOpen(false);
                        }}
                      >
                        <PixelDownloadIcon />
                        <span>Download CSV (.csv)</span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="export-menu-item"
                        onClick={() => {
                          if (viewMode === 'profile' && selectedMember && activeProfileStats) {
                            printMemberProfileReport(selectedMember, activeProfileStats, sessions);
                          } else {
                            const scopeLabel =
                              directoryScope === 'legacy'
                                ? 'Legacy / Retired Members'
                                : 'Active Club Roster';
                            const activeFilterParts: string[] = [];
                            if (effectiveClassFilter !== 'all') {
                              activeFilterParts.push(`Class: ${effectiveClassFilter}`);
                            }
                            if (effectiveRoleFilter !== 'all') {
                              activeFilterParts.push(
                                effectiveRoleFilter === '__unassigned__'
                                  ? 'Role: Unassigned'
                                  : `Role: ${effectiveRoleFilter}`,
                              );
                            }
                            if (searchQuery.trim()) {
                              activeFilterParts.push(`Search: "${searchQuery.trim()}"`);
                            }
                            printMemberDirectoryReport(
                              filteredMembers,
                              memberStatsMap,
                              sessions,
                              activeFilterParts.length > 0
                                ? `${scopeLabel} (${activeFilterParts.join(' • ')})`
                                : scopeLabel,
                            );
                          }
                          setIsExportMenuOpen(false);
                        }}
                      >
                        <PixelPrinterIcon />
                        <span>Print / Save PDF Report</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {!isSelfOnlyScope &&
                !isUnlinkedMemberScope &&
                viewMode === 'directory' &&
                canEditRoster && (
                <button type="button" className="btn-primary btn-compact-primary" onClick={openAddForm}>
                  <PixelPlusIcon />
                  <span>Add</span>
                </button>
              )}
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                aria-label="Collapse Member Manager"
                title="Close (Esc)"
              >
                <PixelCloseIcon />
              </button>
            </div>
          </div>

          <div className="member-drawer-body">
            <datalist id={roleListId}>
              {ROLE_SUGGESTIONS.map((role) => (
                <option key={role} value={role} />
              ))}
            </datalist>

            {isUnlinkedMemberScope && (
              <div className="member-empty-state" role="status">
                <strong>Profile Not Linked Yet</strong>
                <span>
                  Your login is active, but an administrator has not linked your account to a Team
                  SPIRIT roster profile yet. Ask a club admin in Settings → Admin Management to link
                  your account.
                </span>
              </div>
            )}

            {!isUnlinkedMemberScope && isSelfOnlyScope && !selectedMember && (
              <div className="member-empty-state" role="status">
                <strong>Loading Linked Profile</strong>
                <span>
                  Fetching your personal roster profile and attendance history from Supabase...
                </span>
              </div>
            )}

            {!isUnlinkedMemberScope && !isSelfOnlyScope && viewMode === 'directory' && (
              <div className="member-directory-view">
                <div
                  className="member-directory-tabs"
                  role="tablist"
                  aria-label="Roster status sections"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={directoryScope === 'active'}
                    className={`member-directory-tab ${directoryScope === 'active' ? 'is-active' : ''}`}
                    onClick={() => setDirectoryScope('active')}
                  >
                    <span>Active Roster</span>
                    <span className="member-directory-tab-count">{activeMembers.length}</span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={directoryScope === 'legacy'}
                    className={`member-directory-tab is-legacy ${directoryScope === 'legacy' ? 'is-active' : ''}`}
                    onClick={() => setDirectoryScope('legacy')}
                  >
                    <PixelArchiveIcon width={12} height={12} />
                    <span>Legacy / Retired</span>
                    <span className="member-directory-tab-count">{legacyMembers.length}</span>
                  </button>
                </div>

                {directoryScope === 'legacy' ? (
                  <div className="member-legacy-banner" role="note">
                    <PixelArchiveIcon width={13} height={13} />
                    <span>
                      Graduated &amp; retired members are excluded from active session bulk-adds
                      while preserving all historical attendance records and stats.
                    </span>
                  </div>
                ) : (
                  <div className="member-cycle-notice" role="note">
                    <PixelCalendarIcon width={12} height={12} />
                    <span>
                      Academic Cycle <strong>{getAcademicCycleLabel()}</strong> • Auto-promotes{' '}
                      <strong>{getNextPromotionDateLabel()}</strong> (Year 11 → Legacy)
                    </span>
                  </div>
                )}

                {canEditRoster && (directoryScope === 'active' || scopedMembers.length > 0) && (
                  <div className="member-bulk-entry-row">
                    {directoryScope === 'active' && (
                      <button
                        type="button"
                        className="btn-secondary btn-compact member-bulk-entry-btn"
                        onClick={openBulkAddForm}
                      >
                        <PixelUsersIcon />
                        <span>Bulk Add Members</span>
                      </button>
                    )}

                    {scopedMembers.length > 0 && (
                      <button
                        type="button"
                        className={`btn-secondary btn-compact member-select-toggle-btn ${
                          isSelectionMode ? 'is-active' : ''
                        }`}
                        aria-pressed={isSelectionMode}
                        onClick={handleToggleSelectionMode}
                        title={
                          isSelectionMode
                            ? 'Exit selection mode (Esc)'
                            : 'Select multiple members at once'
                        }
                      >
                        <PixelCheckSquareIcon />
                        <span>{isSelectionMode ? 'Done Selecting' : 'Select'}</span>
                      </button>
                    )}
                  </div>
                )}

                <div className="member-directory-controls">
                  <div className="search-box member-search-box">
                    <span className="search-icon">
                      <PixelSearchIcon />
                    </span>
                    <input
                      type="search"
                      className="search-input member-search-input"
                      placeholder="Search name, class, type, role..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Search member directory"
                    />
                  </div>

                  {scopedMembers.length > 0 && (
                    <div className="member-directory-filters">
                      {distinctClasses.length > 0 && (
                        <select
                          className="form-control member-class-filter"
                          value={effectiveClassFilter}
                          onChange={(event) => setClassFilter(event.target.value)}
                          aria-label="Filter members by class"
                        >
                          <option value="all">All Classes</option>
                          {distinctClasses.map((cls) => (
                            <option key={cls} value={cls}>
                              {cls}
                            </option>
                          ))}
                        </select>
                      )}

                      <select
                        className="form-control member-role-filter"
                        value={effectiveRoleFilter}
                        onChange={(event) => setRoleFilter(event.target.value)}
                        aria-label="Filter members by role"
                      >
                        <option value="all">All Roles</option>
                        {distinctRoles.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                        {scopedMembers.some((member) => !member.role) && (
                          <option value="__unassigned__">No Role Set</option>
                        )}
                      </select>
                    </div>
                  )}
                </div>

                {isSelectionMode && filteredMembers.length > 0 && (
                  <div
                    className="member-selection-toolbar"
                    role="region"
                    aria-label="Bulk selection controls"
                  >
                    <label className="select-all-label member-select-all-label">
                      <input
                        ref={selectAllCheckboxRef}
                        type="checkbox"
                        className="selection-checkbox"
                        checked={allVisibleSelected}
                        onChange={handleToggleSelectAll}
                        aria-label={
                          allVisibleSelected
                            ? 'Deselect all visible members'
                            : 'Select all visible members'
                        }
                      />
                      <span>{allVisibleSelected ? 'Deselect All' : 'Select All'}</span>
                    </label>

                    <div className="member-selection-toolbar-right">
                      <span className="selection-count-pill">
                        {selectedIds.size} selected
                        {hiddenSelectedCount > 0 ? ` (${hiddenSelectedCount} filtered)` : ''}
                      </span>
                      {selectedIds.size > 0 && (
                        <button
                          type="button"
                          className="ring-reset-btn"
                          onClick={handleClearSelection}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {filteredMembers.length === 0 ? (
                  <div className="reserved-empty-state member-empty-state">
                    <div className="empty-badge">
                      <PixelTerminalIcon />
                      <span>
                        {scopedMembers.length === 0
                          ? directoryScope === 'legacy'
                            ? 'No Legacy Members'
                            : 'No Active Members'
                          : 'No Matches'}
                      </span>
                    </div>
                    <h3 className="empty-title">
                      {scopedMembers.length === 0
                        ? directoryScope === 'legacy'
                          ? 'No retired or graduated members yet'
                          : 'Build your Team SPIRIT roster'
                        : 'No matching club members'}
                    </h3>
                    <p className="empty-description">
                      {scopedMembers.length === 0
                        ? directoryScope === 'legacy'
                          ? 'Use the Archive button on any active member to move them here while keeping their full attendance history.'
                          : 'Add students (Year 7–11, Class T/E/N/B or N/A), teachers, or visitors with a required club role.'
                        : 'Try clearing your search term or switching the class/role filters.'}
                    </p>
                    {canEditRoster && scopedMembers.length === 0 && directoryScope === 'active' && (
                      <div className="member-empty-actions">
                        <button type="button" className="btn-primary" onClick={openAddForm}>
                          <PixelPlusIcon />
                          <span>Add First Member</span>
                        </button>
                        <button type="button" className="btn-secondary" onClick={openBulkAddForm}>
                          <PixelUsersIcon />
                          <span>Bulk Add Members</span>
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <ul
                    className={`member-directory-list ${
                      isDragSelecting ? 'is-drag-selecting' : ''
                    }`}
                    aria-label={
                      directoryScope === 'legacy'
                        ? 'Legacy and retired member archive'
                        : 'Active club member directory'
                    }
                  >
                    {filteredMembers.map((member, index) => {
                      const stats = memberStatsMap.get(member.id);
                      const canShowRowRates =
                        canViewPeerAttendanceStats ||
                        (Boolean(linkedMemberId) && member.id === linkedMemberId);
                      const rateLabel =
                        stats && stats.markedRate !== null ? `${stats.markedRate}%` : '--%';
                      const memberType = normalizeMemberType(member.memberType);
                      const memberIsLegacy = isLegacyMember(member);
                      const isRowSelected = isSelectionMode && selectedIds.has(member.id);
                      const hasStreakHighlight = Boolean(
                        canShowRowRates &&
                          !memberIsLegacy &&
                          stats &&
                          stats.currentPresentStreak >= STREAK_HIGHLIGHT_THRESHOLD,
                      );
                      const hasAbsenceFlag = Boolean(
                        canShowRowRates &&
                          !memberIsLegacy &&
                          stats &&
                          stats.consecutiveUnexcusedAbsences >= CONSECUTIVE_ABSENCE_ALERT_THRESHOLD,
                      );

                      return (
                        <li key={member.id} className="member-directory-item">
                          <div
                            data-member-index={index}
                            className={`member-directory-row ${
                              memberIsLegacy
                                ? 'is-legacy'
                                : hasStreakHighlight
                                  ? 'is-streak-highlight'
                                  : hasAbsenceFlag
                                    ? 'is-absence-flag'
                                    : ''
                            } ${isSelectionMode ? 'is-selectable' : ''} ${
                              isRowSelected ? 'is-selected' : ''
                            }`}
                            role={isSelectionMode ? 'checkbox' : 'button'}
                            aria-checked={isSelectionMode ? isRowSelected : undefined}
                            aria-label={isSelectionMode ? `Select ${member.name}` : undefined}
                            tabIndex={0}
                            onMouseDown={
                              isSelectionMode
                                ? (event) => handleSelectableRowMouseDown(event, member, index)
                                : undefined
                            }
                            onMouseEnter={
                              isSelectionMode
                                ? () => handleSelectableRowMouseEnter(index)
                                : undefined
                            }
                            onClick={
                              isSelectionMode
                                ? (event) => handleSelectableRowClick(event, member, index)
                                : () => openMemberProfile(member.id)
                            }
                            onKeyDown={(event) => {
                              if (isSelectionMode) {
                                handleSelectableRowKeyDown(event, member, index);
                                return;
                              }
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openMemberProfile(member.id);
                              }
                            }}
                          >
                            {isSelectionMode && (
                              <input
                                type="checkbox"
                                className="selection-checkbox member-row-checkbox"
                                checked={isRowSelected}
                                readOnly
                                tabIndex={-1}
                                aria-hidden="true"
                              />
                            )}

                            <div className="member-avatar-badge" aria-hidden="true">
                              {getMemberInitials(member.name)}
                            </div>

                            <div className="member-directory-main">
                              <div className="member-directory-name-row">
                                <span className="member-directory-name">{member.name}</span>
                                {memberIsLegacy && (
                                  <span className="member-legacy-pill" title="Legacy / Retired member">
                                    Legacy
                                  </span>
                                )}
                                {memberIsLegacy && member.graduationYear && (
                                  <span
                                    className="member-graduation-pill"
                                    title={`Graduated in ${member.graduationYear}`}
                                  >
                                    Graduated {member.graduationYear}
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
                                {member.role && (
                                  <span className="member-role-pill">{member.role}</span>
                                )}
                              </div>

                              <div className="member-directory-meta">
                                {canShowRowRates ? (
                                  <>
                                    <span className="mono-meta">
                                      {stats
                                        ? `${stats.presentCount}/${stats.totalSessions} present`
                                        : '0 sessions'}
                                    </span>
                                    <span
                                      className="member-rate-chip"
                                      title="Marked attendance rate"
                                    >
                                      {rateLabel}
                                    </span>
                                  </>
                                ) : (
                                  <span className="mono-meta">Attendance stats hidden</span>
                                )}
                                {hasStreakHighlight && stats && (
                                  <span
                                    className="member-streak-badge"
                                    title={`Active attendance streak: ${stats.currentPresentStreak} consecutive sessions present`}
                                  >
                                    <PixelFlameIcon width={11} height={11} />
                                    <span>{stats.currentPresentStreak} Streak</span>
                                  </span>
                                )}
                                {hasAbsenceFlag && stats && (
                                  <span
                                    className="member-absence-alert-badge"
                                    title={`Flagged: missed ${stats.consecutiveUnexcusedAbsences} consecutive sessions without a reason`}
                                  >
                                    <PixelAlertIcon width={11} height={11} />
                                    <span>{stats.consecutiveUnexcusedAbsences} Unexcused</span>
                                  </span>
                                )}
                                {member.handle && (
                                  <span className="member-contact-chip">{member.handle}</span>
                                )}
                                {canManageMemberAccounts && linkedProfileByMemberId.has(member.id) && (
                                  <span
                                    className="member-account-linked-pill"
                                    title={`Login linked: ${linkedProfileByMemberId.get(member.id)?.email ?? ''}`}
                                  >
                                    <PixelKeyIcon width={10} height={10} />
                                    <span>Login Linked</span>
                                  </span>
                                )}
                              </div>
                            </div>

                            {!isSelectionMode && canEditRoster && (
                              <div
                                className="member-directory-actions"
                                onClick={(event) => event.stopPropagation()}
                                onKeyDown={(event) => event.stopPropagation()}
                              >
                                {memberIsLegacy ? (
                                  <button
                                    type="button"
                                    className="icon-btn icon-btn-restore"
                                    disabled={!canManageClubRecords}
                                    onClick={() => handleRestoreMember(member)}
                                    aria-label={`Restore ${member.name} to Active Roster`}
                                    title={
                                      canManageClubRecords
                                        ? 'Restore to Active Roster'
                                        : 'Admin privileges required'
                                    }
                                  >
                                    <PixelRestoreIcon />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    className="icon-btn icon-btn-archive"
                                    disabled={!canManageClubRecords}
                                    onClick={() => handleArchiveMember(member)}
                                    aria-label={`Move ${member.name} to Legacy`}
                                    title={
                                      canManageClubRecords
                                        ? 'Move to Legacy / Retired'
                                        : 'Admin privileges required'
                                    }
                                  >
                                    <PixelArchiveIcon />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={() => openEditForm(member)}
                                  aria-label={`Edit ${member.name}`}
                                  title="Edit member"
                                >
                                  <PixelEditIcon />
                                </button>
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-danger"
                                  disabled={!canManageClubRecords}
                                  onClick={() => handleRequestDeleteMember(member)}
                                  aria-label={`Delete ${member.name}`}
                                  title={
                                    canManageClubRecords
                                      ? 'Delete member'
                                      : 'Admin privileges required to delete members'
                                  }
                                >
                                  <PixelTrashIcon />
                                </button>
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

            {!isUnlinkedMemberScope && viewMode === 'profile' && selectedMember && activeProfileStats && (
              <div className="member-profile-view">
                <div className="member-profile-topbar">
                  {!isSelfOnlyScope ? (
                    <button
                      type="button"
                      className="btn-secondary btn-compact"
                      onClick={() => openDirectory(isLegacyMember(selectedMember) ? 'legacy' : 'active')}
                    >
                      <PixelArrowLeftIcon />
                      <span>{isLegacyMember(selectedMember) ? 'Legacy List' : 'Active Roster'}</span>
                    </button>
                  ) : (
                    <span className="settings-mode-tag is-cloud">
                      Linked Roster Profile • Read-only
                    </span>
                  )}

                  {canEditRoster && (
                    <div className="member-profile-topbar-actions">
                      {isLegacyMember(selectedMember) ? (
                        <button
                          type="button"
                          className="btn-secondary btn-compact btn-restore-inline"
                          onClick={() => handleRestoreMember(selectedMember)}
                          title="Restore this member to the active club roster"
                        >
                          <PixelRestoreIcon />
                          <span>Restore</span>
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-secondary btn-compact btn-archive-inline"
                          onClick={() => handleArchiveMember(selectedMember)}
                          title="Move this graduated or retired member to the Legacy archive"
                        >
                          <PixelArchiveIcon />
                          <span>Retire</span>
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={() => openEditForm(selectedMember)}
                      >
                        <PixelEditIcon />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => handleRequestDeleteMember(selectedMember)}
                        aria-label={`Delete ${selectedMember.name}`}
                        title="Delete member permanently"
                      >
                        <PixelTrashIcon />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>

                <section
                  className={`member-profile-card ${isLegacyMember(selectedMember) ? 'is-legacy' : ''}`}
                  aria-label="Member personal details"
                >
                  <div className="member-profile-identity">
                    <div className="member-avatar-badge member-avatar-lg" aria-hidden="true">
                      {getMemberInitials(selectedMember.name)}
                    </div>
                    <div className="member-profile-heading">
                      <h3 className="member-profile-name">{selectedMember.name}</h3>
                      <div className="member-profile-badges">
                        {isLegacyMember(selectedMember) && (
                          <span className="member-legacy-pill">
                            <PixelArchiveIcon width={10} height={10} />
                            <span>
                              {selectedMember.retiredAt
                                ? `Legacy • ${formatTimestamp(selectedMember.retiredAt)}`
                                : 'Legacy / Retired'}
                            </span>
                          </span>
                        )}
                        {isLegacyMember(selectedMember) && selectedMember.graduationYear && (
                          <span className="member-graduation-pill">
                            Graduated {selectedMember.graduationYear}
                          </span>
                        )}
                        <span className={`member-type-pill is-${selectedMemberType}`}>
                          {MEMBER_TYPE_LABELS[selectedMemberType]}
                        </span>
                        {selectedMember.className ? (
                          <span className="member-class-pill">
                            Class: {selectedMember.className}
                          </span>
                        ) : (
                          selectedMemberType === 'student' && (
                            <span className="member-muted-pill">
                              <span>No class set</span>
                            </span>
                          )
                        )}
                        {selectedMember.role ? (
                          <span className="member-role-pill">{selectedMember.role}</span>
                        ) : (
                          <span className="member-muted-pill">
                            <PixelUserIcon />
                            <span>No role assigned</span>
                          </span>
                        )}
                        <span className="member-joined-pill">
                          <PixelCalendarIcon />
                          <span>
                            {selectedMember.joinedDate
                              ? `Joined ${formatSessionDate(selectedMember.joinedDate)}`
                              : `Added ${formatTimestamp(selectedMember.createdAt)}`}
                          </span>
                        </span>
                        {canShowSelectedMemberRates &&
                          activeProfileStats.currentPresentStreak >= STREAK_HIGHLIGHT_THRESHOLD && (
                          <span
                            className="member-streak-badge"
                            title={`Active attendance streak: ${activeProfileStats.currentPresentStreak} consecutive sessions present`}
                          >
                            <PixelFlameIcon width={11} height={11} />
                            <span>{activeProfileStats.currentPresentStreak} Session Streak</span>
                          </span>
                        )}
                        {canShowSelectedMemberRates &&
                          activeProfileStats.consecutiveUnexcusedAbsences >=
                            CONSECUTIVE_ABSENCE_ALERT_THRESHOLD && (
                          <span
                            className="member-absence-alert-badge"
                            title={`Flagged: missed ${activeProfileStats.consecutiveUnexcusedAbsences} consecutive sessions without a reason`}
                          >
                            <PixelAlertIcon width={11} height={11} />
                            <span>
                              {activeProfileStats.consecutiveUnexcusedAbsences} Consecutive Unexcused
                            </span>
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {canShowSelectedMemberRates &&
                    activeProfileStats.consecutiveUnexcusedAbsences >=
                      CONSECUTIVE_ABSENCE_ALERT_THRESHOLD && (
                    <div className="member-tracking-banner is-warning" role="status">
                      <PixelAlertIcon width={14} height={14} />
                      <span>
                        Attention: {selectedMember.name} has missed{' '}
                        {activeProfileStats.consecutiveUnexcusedAbsences} consecutive sessions
                        without a recorded reason.
                      </span>
                    </div>
                  )}

                  {canShowSelectedMemberRates &&
                    activeProfileStats.currentPresentStreak >= STREAK_HIGHLIGHT_THRESHOLD && (
                    <div className="member-tracking-banner is-streak" role="status">
                      <PixelFlameIcon width={14} height={14} />
                      <span>
                        High Attendance: {selectedMember.name} is on a{' '}
                        {activeProfileStats.currentPresentStreak}-session attendance streak.
                      </span>
                    </div>
                  )}

                  {(selectedMember.email ||
                    selectedMember.phone ||
                    selectedMember.handle ||
                    selectedMember.notes) && (
                    <dl className="member-details-grid">
                      {selectedMember.email && (
                        <div className="member-detail-item">
                          <dt>Email</dt>
                          <dd>{selectedMember.email}</dd>
                        </div>
                      )}
                      {selectedMember.phone && (
                        <div className="member-detail-item">
                          <dt>Phone</dt>
                          <dd>{selectedMember.phone}</dd>
                        </div>
                      )}
                      {selectedMember.handle && (
                        <div className="member-detail-item">
                          <dt>Handle / ID</dt>
                          <dd>{selectedMember.handle}</dd>
                        </div>
                      )}
                      {selectedMember.notes && (
                        <div className="member-detail-item member-detail-notes">
                          <dt>Notes</dt>
                          <dd>{selectedMember.notes}</dd>
                        </div>
                      )}
                    </dl>
                  )}
                </section>

                {canManageMemberAccounts &&
                  onCreateAndLinkMemberAccount &&
                  onSyncAndLinkMemberAccount &&
                  onLinkUserToMember && (
                    <MemberAccountCard
                      member={selectedMember}
                      members={members}
                      adminProfiles={adminProfiles}
                      isProfilesLoading={isProfilesLoading}
                      onEnsureMemberSynced={onEnsureMemberSynced}
                      onSyncAdminProfiles={onSyncAdminProfiles}
                      onCreateAndLinkAccount={onCreateAndLinkMemberAccount}
                      onSyncAndLinkAccount={onSyncAndLinkMemberAccount}
                      onLinkUserToMember={onLinkUserToMember}
                      onSyncMemberEmailToRoster={handleSyncMemberEmailToRoster}
                      onNotify={onNotify}
                    />
                  )}

                {canShowSelectedMemberRates ? (
                  <>
                    <MemberAttendanceRing stats={activeProfileStats} />

                <section className="member-stats-grid" aria-label="Attendance summary metrics">
                  <article className="day-metric" data-accent="green">
                    <span className="day-metric-label">Attended</span>
                    <span className="day-metric-value">{activeProfileStats.presentCount}</span>
                    <span className="member-metric-sub">
                      of {activeProfileStats.totalSessions} saved
                    </span>
                  </article>

                  <article className="day-metric" data-accent="cyan">
                    <span className="day-metric-label">Marked Rate</span>
                    <span className="day-metric-value">
                      {activeProfileStats.markedRate !== null
                        ? `${activeProfileStats.markedRate}%`
                        : '--%'}
                    </span>
                    <span className="member-metric-sub">
                      {activeProfileStats.markedSessionsCount} marked
                    </span>
                  </article>

                  <article className="day-metric" data-accent="gold">
                    <span className="day-metric-label">Excused</span>
                    <span className="day-metric-value">
                      {activeProfileStats.absentWithReasonCount}
                    </span>
                    <span className="member-metric-sub">w/ reason</span>
                  </article>

                  <article className="day-metric" data-accent="red">
                    <span className="day-metric-label">Unexcused</span>
                    <span className="day-metric-value">
                      {activeProfileStats.absentWithoutReasonCount}
                    </span>
                    <span className="member-metric-sub">
                      {activeProfileStats.unmarkedCount} unmarked
                    </span>
                  </article>
                </section>

                <section className="member-absences-section" aria-label="Recent absence reasons">
                  <div className="member-absences-header">
                    <span className="member-section-label">Recent Absence Reasons</span>
                    {activeProfileStats.absentWithoutReasonCount > 0 && (
                      <div className="member-absence-filter-group" role="group" aria-label="Filter absences">
                        <button
                          type="button"
                          className={`ring-reset-btn ${absenceFilter === 'reasons_only' ? 'is-active' : ''}`}
                          onClick={() => setAbsenceFilter('reasons_only')}
                        >
                          With Reason ({activeProfileStats.absentWithReasonCount})
                        </button>
                        <button
                          type="button"
                          className={`ring-reset-btn ${absenceFilter === 'all' ? 'is-active' : ''}`}
                          onClick={() => setAbsenceFilter('all')}
                        >
                          All ({activeProfileStats.totalAbsentCount})
                        </button>
                      </div>
                    )}
                  </div>

                  {displayedAbsences.length === 0 ? (
                    <div className="member-absences-empty">
                      {activeProfileStats.totalSessions === 0
                        ? 'No sessions recorded yet.'
                        : absenceFilter === 'reasons_only'
                          ? 'No absences with reasons recorded.'
                          : 'No absences recorded across saved sessions.'}
                    </div>
                  ) : (
                    <>
                      <ul className="member-absence-list">
                        {visibleAbsences.map((record) => (
                          <li key={record.sessionId} className="member-absence-item">
                            <div className="member-absence-top">
                              <div className="member-absence-title-wrap">
                                <span className="member-absence-session">{record.sessionName}</span>
                                {record.eventType && (
                                  <span className="session-type-tag">{record.eventType}</span>
                                )}
                              </div>
                              <span className={`status-badge status-${record.status}`}>
                                {STATUS_LABELS[record.status]}
                              </span>
                            </div>

                            <div className="member-absence-meta">
                              <span>{formatSessionDate(record.date)}</span>
                              <span>•</span>
                              <span>{formatSessionTime(record.time)}</span>
                            </div>

                            <p
                              className={`member-absence-reason ${
                                record.reason ? '' : 'is-empty'
                              }`}
                            >
                              {record.reason ??
                                (record.status === 'absent_with_reason'
                                  ? 'No reason text provided'
                                  : 'Marked absent without reason')}
                            </p>
                          </li>
                        ))}
                      </ul>

                      {displayedAbsences.length > 5 && (
                        <button
                          type="button"
                          className="btn-secondary btn-compact member-show-more-btn"
                          onClick={() => setShowAllAbsences((prev) => !prev)}
                        >
                          {showAllAbsences
                            ? 'Show Fewer'
                            : `Show All (${displayedAbsences.length})`}
                        </button>
                      )}
                    </>
                  )}
                </section>
                  </>
                ) : (
                  <div className="member-tracking-banner" role="status">
                    <PixelAlertIcon width={14} height={14} />
                    <span>
                      Attendance rates, streaks, and absence history are currently hidden under
                      Club Member Visibility Permissions.
                    </span>
                  </div>
                )}
              </div>
            )}

            {canEditRoster && (viewMode === 'add' || viewMode === 'edit') && (
              <form className="member-form" onSubmit={handleFormSubmit} noValidate>
                <div className="member-profile-topbar">
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={handleFormCancel}
                  >
                    <PixelArrowLeftIcon />
                    <span>{viewMode === 'edit' ? 'Back to Profile' : 'All Members'}</span>
                  </button>

                  {viewMode === 'add' && (
                    <button
                      type="button"
                      className="btn-secondary btn-compact"
                      onClick={openBulkAddForm}
                    >
                      <PixelUsersIcon />
                      <span>Bulk Add</span>
                    </button>
                  )}
                </div>

                {formError && (
                  <div className="modal-error" role="alert">
                    {formError}
                  </div>
                )}

                {viewMode === 'edit' &&
                  editingTargetId &&
                  editingBaselineMember &&
                  (() => {
                    const liveMember =
                      members.find((member) => member.id === editingTargetId) ?? null;
                    if (!liveMember) {
                      return (
                        <div className="concurrent-edit-banner is-danger" role="alert">
                          <div className="concurrent-edit-copy">
                            <PixelAlertIcon width={14} height={14} />
                            <div>
                              <strong>Member removed on another device</strong>
                              <p>
                                Saving will re-create this profile as a new member so your edits are
                                not lost.
                              </p>
                            </div>
                          </div>
                          <div className="concurrent-edit-actions">
                            <button
                              type="button"
                              className="btn-secondary btn-compact"
                              onClick={() => {
                                setEditingTargetId(null);
                                setEditingBaselineMember(null);
                                onSelectMember(null);
                                setViewMode('directory');
                              }}
                            >
                              Return to Directory
                            </button>
                          </div>
                        </div>
                      );
                    }

                    const baseForm = memberToFormValues(editingBaselineMember);
                    const remoteForm = memberToFormValues(liveMember);
                    const hasRemoteProfileChanges =
                      JSON.stringify(baseForm) !== JSON.stringify(remoteForm);

                    if (!hasRemoteProfileChanges) {
                      return null;
                    }

                    const handleMergeUnchanged = () => {
                      setFormValues((current) => ({
                        name: current.name === baseForm.name ? remoteForm.name : current.name,
                        memberType:
                          current.memberType === baseForm.memberType
                            ? remoteForm.memberType
                            : current.memberType,
                        classYear:
                          current.classYear === baseForm.classYear
                            ? remoteForm.classYear
                            : current.classYear,
                        classLetter:
                          current.classLetter === baseForm.classLetter
                            ? remoteForm.classLetter
                            : current.classLetter,
                        legacyClassFallback:
                          current.legacyClassFallback === baseForm.legacyClassFallback
                            ? remoteForm.legacyClassFallback
                            : current.legacyClassFallback,
                        isLegacy:
                          current.isLegacy === baseForm.isLegacy
                            ? remoteForm.isLegacy
                            : current.isLegacy,
                        role: current.role === baseForm.role ? remoteForm.role : current.role,
                        joinedDate:
                          current.joinedDate === baseForm.joinedDate
                            ? remoteForm.joinedDate
                            : current.joinedDate,
                        email: current.email === baseForm.email ? remoteForm.email : current.email,
                        phone: current.phone === baseForm.phone ? remoteForm.phone : current.phone,
                        handle:
                          current.handle === baseForm.handle ? remoteForm.handle : current.handle,
                        notes: current.notes === baseForm.notes ? remoteForm.notes : current.notes,
                      }));
                      setEditingBaselineMember(liveMember);
                    };

                    return (
                      <div className="concurrent-edit-banner" role="status">
                        <div className="concurrent-edit-copy">
                          <PixelAlertIcon width={14} height={14} />
                          <div>
                            <strong>Updated elsewhere while editing</strong>
                            <p>
                              Another tab or device updated this profile. Load the latest version or
                              merge unchanged fields.
                            </p>
                          </div>
                        </div>
                        <div className="concurrent-edit-actions">
                          <button
                            type="button"
                            className="btn-secondary btn-compact"
                            onClick={() => {
                              setFormValues(remoteForm);
                              setEditingBaselineMember(liveMember);
                            }}
                          >
                            Load Latest
                          </button>
                          <button
                            type="button"
                            className="btn-primary btn-compact"
                            onClick={handleMergeUnchanged}
                          >
                            Merge Unchanged Fields
                          </button>
                        </div>
                      </div>
                    );
                  })()}

                <div className="modal-grid-2">
                  <div className="form-field">
                    <label htmlFor={nameInputId}>
                      Full Name <span className="required-mark">*</span>
                    </label>
                    <input
                      ref={nameInputRef}
                      id={nameInputId}
                      type="text"
                      className="form-control"
                      placeholder="e.g. John Doe"
                      value={formValues.name}
                      onChange={(event) => {
                        setFormValues((prev) => ({ ...prev, name: event.target.value }));
                        if (formError) setFormError('');
                      }}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={roleInputId}>
                      Club Role <span className="required-mark">*</span>
                    </label>
                    <input
                      ref={roleInputRef}
                      id={roleInputId}
                      type="text"
                      list={roleListId}
                      className="form-control"
                      placeholder="e.g. Captain, Advisor, Member"
                      value={formValues.role}
                      onChange={(event) => {
                        setFormValues((prev) => ({ ...prev, role: event.target.value }));
                        if (formError) setFormError('');
                      }}
                      required
                    />
                  </div>
                </div>

                <div className="form-field">
                  <span id={memberTypeLabelId} className="form-field-label">
                    Member Type <span className="required-mark">*</span>
                  </span>
                  <div
                    className="member-type-segmented"
                    role="radiogroup"
                    aria-labelledby={memberTypeLabelId}
                  >
                    {MEMBER_TYPES.map((typeOption) => {
                      const isSelected = formValues.memberType === typeOption;
                      return (
                        <button
                          key={typeOption}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          className={`member-type-option is-${typeOption} ${isSelected ? 'is-selected' : ''}`}
                          onClick={() => {
                            setFormValues((prev) => {
                              if (typeOption !== 'student') {
                                return {
                                  ...prev,
                                  memberType: typeOption,
                                  classYear: '',
                                  classLetter: 'N/A',
                                };
                              }
                              return {
                                ...prev,
                                memberType: typeOption,
                                classLetter:
                                  prev.memberType !== 'student' && prev.classLetter === 'N/A'
                                    ? ''
                                    : prev.classLetter,
                              };
                            });
                            if (formError) setFormError('');
                          }}
                        >
                          {MEMBER_TYPE_LABELS[typeOption]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="form-field">
                  <div className="member-class-field-header">
                    <label htmlFor={classYearInputId}>
                      Year &amp; Class{' '}
                      {formValues.memberType === 'student' ? (
                        <span className="required-mark">*</span>
                      ) : (
                        <span className="optional-mark">(N/A by default)</span>
                      )}
                    </label>
                    {(formValues.classLetter === 'N/A' ||
                      (formValues.classYear !== '' && formValues.classLetter !== '')) && (
                      <span className="member-class-pill member-class-preview" aria-live="polite">
                        {formValues.classLetter === 'N/A'
                          ? 'N/A'
                          : formatStudentClassName(
                              formValues.classYear as ClassYear,
                              formValues.classLetter as ClassLetter,
                            )}
                      </span>
                    )}
                  </div>

                  {formValues.legacyClassFallback &&
                    formValues.classYear === '' &&
                    formValues.classLetter === '' && (
                      <p className="member-class-legacy-hint">
                        Previous class: <strong>{formValues.legacyClassFallback}</strong> — choose
                        a Year (7–11) and Class (T, E, N, B) or N/A below.
                      </p>
                    )}

                  <div className="member-class-builder">
                    <select
                      ref={classYearSelectRef}
                      id={classYearInputId}
                      className="form-control member-class-year-select"
                      value={formValues.classLetter === 'N/A' ? 'N/A' : formValues.classYear}
                      aria-label="Member Year (Year 7 to Year 11, or N/A)"
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === 'N/A') {
                          setFormValues((prev) => ({
                            ...prev,
                            classYear: '',
                            classLetter: 'N/A',
                          }));
                        } else {
                          const nextYear = raw ? (Number(raw) as ClassYear) : '';
                          setFormValues((prev) => ({
                            ...prev,
                            classYear: nextYear,
                            classLetter: prev.classLetter === 'N/A' ? '' : prev.classLetter,
                          }));
                        }
                        if (formError) setFormError('');
                      }}
                      required={formValues.memberType === 'student' && !formValues.isLegacy}
                    >
                      <option value="">Select Year...</option>
                      {CLASS_YEARS.map((year) => (
                        <option key={year} value={year}>
                          Year {year}
                        </option>
                      ))}
                      <option value="N/A">N/A (No Class)</option>
                    </select>

                    <div
                      className="member-class-letter-group"
                      role="radiogroup"
                      aria-labelledby={classLetterLabelId}
                    >
                      <span id={classLetterLabelId} className="sr-only">
                        Class letter T, E, N, B, or N/A
                      </span>
                      {CLASS_LETTERS.map((letter) => {
                        const isSelected = formValues.classLetter === letter;
                        return (
                          <button
                            key={letter}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className={`member-class-letter-btn ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => {
                              setFormValues((prev) => ({
                                ...prev,
                                classYear: letter === 'N/A' ? '' : prev.classYear,
                                classLetter: letter,
                              }));
                              if (formError) setFormError('');
                            }}
                            title={letter === 'N/A' ? 'No standard class (N/A)' : `Class ${letter}`}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="modal-grid-2">
                  <div className="form-field">
                    <label htmlFor={joinedInputId}>
                      Joined Date <span className="optional-mark">(Optional)</span>
                    </label>
                    <input
                      id={joinedInputId}
                      type="date"
                      className="form-control"
                      value={formValues.joinedDate}
                      onChange={(event) =>
                        setFormValues((prev) => ({ ...prev, joinedDate: event.target.value }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={handleInputId}>
                      Handle / Member ID <span className="optional-mark">(Optional)</span>
                    </label>
                    <input
                      id={handleInputId}
                      type="text"
                      className="form-control"
                      placeholder="e.g. @johndoe or TS-014"
                      value={formValues.handle}
                      onChange={(event) =>
                        setFormValues((prev) => ({ ...prev, handle: event.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="modal-grid-2">
                  <div className="form-field">
                    <label htmlFor={emailInputId}>
                      Email <span className="optional-mark">(Optional)</span>
                    </label>
                    <input
                      id={emailInputId}
                      type="email"
                      className="form-control"
                      placeholder="john.doe@example.com"
                      value={formValues.email}
                      onChange={(event) =>
                        setFormValues((prev) => ({ ...prev, email: event.target.value }))
                      }
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={phoneInputId}>
                      Phone <span className="optional-mark">(Optional)</span>
                    </label>
                    <input
                      id={phoneInputId}
                      type="tel"
                      className="form-control"
                      placeholder="+65 9123 4567"
                      value={formValues.phone}
                      onChange={(event) =>
                        setFormValues((prev) => ({ ...prev, phone: event.target.value }))
                      }
                    />
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor={notesInputId}>
                    Notes <span className="optional-mark">(Optional)</span>
                  </label>
                  <textarea
                    id={notesInputId}
                    className="form-control form-textarea"
                    rows={3}
                    placeholder="Team division, skills, availability, or admin notes..."
                    value={formValues.notes}
                    onChange={(event) =>
                      setFormValues((prev) => ({ ...prev, notes: event.target.value }))
                    }
                  />
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn-secondary" onClick={handleFormCancel}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary">
                    <PixelPlusIcon />
                    <span>
                      {viewMode === 'edit'
                        ? !formValues.isLegacy &&
                          editingTargetId &&
                          isLegacyMember(members.find((m) => m.id === editingTargetId))
                          ? 'Restore & Save'
                          : 'Save Changes'
                        : 'Add Member'}
                    </span>
                  </button>
                </div>
              </form>
            )}

            {canEditRoster && viewMode === 'bulk_add' && (
              <form className="member-form member-bulk-form" onSubmit={handleBulkSubmit} noValidate>
                <div className="member-profile-topbar">
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => openDirectory('active')}
                  >
                    <PixelArrowLeftIcon />
                    <span>Active Roster</span>
                  </button>

                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={openAddForm}
                  >
                    <PixelPlusIcon />
                    <span>Single Member</span>
                  </button>
                </div>

                {bulkError && (
                  <div className="modal-error" role="alert">
                    {bulkError}
                  </div>
                )}

                <div className="form-field">
                  <div className="member-class-field-header">
                    <label htmlFor={bulkTextareaId}>
                      Member Names (One Per Line) <span className="required-mark">*</span>
                    </label>
                    <span className="member-bulk-line-hint">Spaces kept intact</span>
                  </div>
                  <textarea
                    ref={bulkTextareaRef}
                    id={bulkTextareaId}
                    className="form-control form-textarea member-bulk-textarea"
                    rows={7}
                    placeholder="John Doe"
                    value={bulkText}
                    onChange={(event) => {
                      setBulkText(event.target.value);
                      if (bulkError) setBulkError('');
                    }}
                  />
                  <p className="member-bulk-helper">
                    Paste or type one full name per line. Blank lines and duplicate names already in
                    the active roster are automatically skipped.
                  </p>
                </div>

                <div className="modal-grid-2">
                  <div className="form-field">
                    <label htmlFor={bulkRoleInputId}>
                      Club Role <span className="required-mark">*</span>
                    </label>
                    <input
                      ref={bulkRoleInputRef}
                      id={bulkRoleInputId}
                      type="text"
                      list={roleListId}
                      className="form-control"
                      placeholder="e.g. Captain, Advisor, Member"
                      value={bulkRole}
                      onChange={(event) => {
                        setBulkRole(event.target.value);
                        if (bulkError) setBulkError('');
                      }}
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label htmlFor={bulkJoinedInputId}>
                      Joined Date <span className="optional-mark">(Optional)</span>
                    </label>
                    <input
                      id={bulkJoinedInputId}
                      type="date"
                      className="form-control"
                      value={bulkJoinedDate}
                      onChange={(event) => setBulkJoinedDate(event.target.value)}
                    />
                  </div>
                </div>

                <div className="form-field">
                  <div className="member-class-field-header">
                    <label htmlFor={bulkClassYearInputId}>
                      Default Year &amp; Class <span className="optional-mark">(Optional)</span>
                    </label>
                    <div className="member-bulk-class-actions">
                      {(bulkClassLetter === 'N/A' ||
                        (bulkClassYear !== '' && bulkClassLetter !== '')) && (
                        <span className="member-class-pill member-class-preview" aria-live="polite">
                          {bulkClassLetter === 'N/A'
                            ? 'N/A'
                            : formatStudentClassName(
                                bulkClassYear as ClassYear,
                                bulkClassLetter as ClassLetter,
                              )}
                        </span>
                      )}
                      {(bulkClassYear !== '' || bulkClassLetter !== '') && (
                        <button
                          type="button"
                          className="ring-reset-btn"
                          onClick={() => {
                            setBulkClassYear('');
                            setBulkClassLetter('');
                            if (bulkError) setBulkError('');
                          }}
                        >
                          Clear
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="member-class-builder">
                    <select
                      ref={bulkClassYearSelectRef}
                      id={bulkClassYearInputId}
                      className="form-control member-class-year-select"
                      value={bulkClassLetter === 'N/A' ? 'N/A' : bulkClassYear}
                      aria-label="Optional default Year (Year 7 to Year 11, or N/A)"
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === 'N/A') {
                          setBulkClassYear('');
                          setBulkClassLetter('N/A');
                        } else {
                          setBulkClassYear(raw ? (Number(raw) as ClassYear) : '');
                          if (bulkClassLetter === 'N/A') {
                            setBulkClassLetter('');
                          }
                        }
                        if (bulkError) setBulkError('');
                      }}
                    >
                      <option value="">No Year (Optional)</option>
                      {CLASS_YEARS.map((year) => (
                        <option key={year} value={year}>
                          Year {year}
                        </option>
                      ))}
                      <option value="N/A">N/A (No Class)</option>
                    </select>

                    <div
                      className="member-class-letter-group"
                      role="radiogroup"
                      aria-labelledby={bulkClassLetterLabelId}
                    >
                      <span id={bulkClassLetterLabelId} className="sr-only">
                        Optional batch class letter T, E, N, B, or N/A
                      </span>
                      {CLASS_LETTERS.map((letter) => {
                        const isSelected = bulkClassLetter === letter;
                        return (
                          <button
                            key={letter}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className={`member-class-letter-btn ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => {
                              if (letter === 'N/A') {
                                setBulkClassYear('');
                                setBulkClassLetter((prev) => (prev === 'N/A' ? '' : 'N/A'));
                              } else {
                                setBulkClassLetter((prev) => (prev === letter ? '' : letter));
                              }
                              if (bulkError) setBulkError('');
                            }}
                            title={
                              isSelected
                                ? `Clear class ${letter}`
                                : letter === 'N/A'
                                  ? 'Apply N/A class to batch'
                                  : `Apply class ${letter} to batch`
                            }
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="form-field">
                  <label htmlFor={bulkNotesInputId}>
                    Notes <span className="optional-mark">(Optional)</span>
                  </label>
                  <textarea
                    id={bulkNotesInputId}
                    className="form-control form-textarea"
                    rows={2}
                    placeholder="Team division, skills, availability, or admin notes..."
                    value={bulkNotes}
                    onChange={(event) => setBulkNotes(event.target.value)}
                  />
                </div>

                <section className="member-bulk-preview-box" aria-label="Bulk add preview">
                  <div className="member-bulk-stats-row">
                    <span
                      className={`member-bulk-stat-chip ${
                        bulkReadyCount > 0 ? 'is-ready' : ''
                      }`}
                    >
                      {bulkReadyCount} ready to add
                    </span>

                    {!bulkRole.trim() && (
                      <span className="member-bulk-stat-chip is-skipped">
                        Club role required
                      </span>
                    )}

                    {bulkParseResult.skippedActiveDuplicates.length +
                      bulkParseResult.skippedBatchDuplicates.length >
                      0 && (
                      <span className="member-bulk-stat-chip is-skipped">
                        {bulkParseResult.skippedActiveDuplicates.length +
                          bulkParseResult.skippedBatchDuplicates.length}{' '}
                        duplicate
                        {bulkParseResult.skippedActiveDuplicates.length +
                          bulkParseResult.skippedBatchDuplicates.length ===
                        1
                          ? ''
                          : 's'}{' '}
                        skipped
                      </span>
                    )}

                    {bulkParseResult.blankLineCount > 0 && bulkText.trim().length > 0 && (
                      <span className="member-bulk-stat-chip">
                        {bulkParseResult.blankLineCount} blank ignored
                      </span>
                    )}
                  </div>

                  {(bulkRole.trim() || bulkJoinedDate.trim() || bulkNotes.trim()) && (
                    <div className="member-bulk-batch-meta" aria-label="Batch metadata applied to all queued members">
                      {bulkRole.trim() && (
                        <span className="member-role-pill">Role: {bulkRole.trim()}</span>
                      )}
                      {bulkJoinedDate.trim() && (
                        <span className="member-joined-pill">
                          Joined: {formatSessionDate(bulkJoinedDate.trim())}
                        </span>
                      )}
                      {bulkNotes.trim() && (
                        <span className="member-bulk-stat-chip" title={bulkNotes.trim()}>
                          Notes attached
                        </span>
                      )}
                    </div>
                  )}

                  {bulkReadyCount > 0 ? (
                    <ul className="member-bulk-name-list" aria-label="Members queued to be added">
                      {bulkParseResult.namesToAdd.map((name, index) => (
                        <li key={`${name}-${index}`} className="member-bulk-name-chip">
                          <span>{name}</span>
                          {(bulkClassLetter === 'N/A' ||
                            (bulkClassYear !== '' && bulkClassLetter !== '')) && (
                            <span className="member-bulk-chip-class">
                              {bulkClassLetter === 'N/A'
                                ? 'N/A'
                                : formatStudentClassName(
                                    bulkClassYear as ClassYear,
                                    bulkClassLetter as ClassLetter,
                                  )}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="member-bulk-preview-empty">
                      {bulkText.trim().length === 0
                        ? 'Preview will appear here as you paste or type names above.'
                        : 'No new unique names to add yet.'}
                    </p>
                  )}

                  {(bulkParseResult.skippedActiveDuplicates.length > 0 ||
                    bulkParseResult.skippedBatchDuplicates.length > 0) && (
                    <div className="member-bulk-skipped-note">
                      {bulkParseResult.skippedActiveDuplicates.length > 0 && (
                        <span>
                          Already in active roster:{' '}
                          {bulkParseResult.skippedActiveDuplicates.join(', ')}
                        </span>
                      )}
                      {bulkParseResult.skippedBatchDuplicates.length > 0 && (
                        <span>
                          Repeated in list: {bulkParseResult.skippedBatchDuplicates.join(', ')}
                        </span>
                      )}
                    </div>
                  )}
                </section>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => openDirectory('active')}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={bulkReadyCount === 0}
                    aria-label={
                      bulkReadyCount === 0
                        ? 'Add Members'
                        : `Add ${bulkReadyCount} ${bulkReadyCount === 1 ? 'Member' : 'Members'}`
                    }
                  >
                    <PixelPlusIcon />
                    <span>
                      {bulkReadyCount === 0 ? (
                        'Add Members'
                      ) : (
                        <>
                          Add <span className="btn-primary-count">{bulkReadyCount}</span>{' '}
                          {bulkReadyCount === 1 ? 'Member' : 'Members'}
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </form>
            )}
          </div>

          {canEditRoster &&
            viewMode === 'directory' &&
            isSelectionMode &&
            selectedMembersList.length > 0 && (
            <div className="member-bulk-action-bar" role="region" aria-label="Bulk member actions">
              {bulkPanelMode === 'change_class' && (
                <form className="member-bulk-class-popover" onSubmit={handleApplyBulkClassUpdate}>
                  <div className="member-bulk-popover-header">
                    <span className="member-section-label">Change Year / Class</span>
                    <button
                      type="button"
                      className="ring-reset-btn"
                      onClick={() => {
                        setBulkPanelMode('none');
                        setBulkActionError('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>

                  <p className="member-bulk-popover-note">
                    {bulkTargetLetter === 'N/A' ? (
                      <>
                        Applies <strong>Class N/A</strong> to all{' '}
                        <strong>
                          {selectedMembersList.length}{' '}
                          {selectedMembersList.length === 1 ? 'member' : 'members'}
                        </strong>
                        .
                      </>
                    ) : (
                      <>
                        Applies to{' '}
                        <strong>
                          {selectedStudentMembers.length}{' '}
                          {selectedStudentMembers.length === 1 ? 'student' : 'students'}
                        </strong>
                        {selectedMembersList.length > selectedStudentMembers.length &&
                          ` (${selectedMembersList.length - selectedStudentMembers.length} non-student skipped unless N/A is chosen)`}
                        . Leave Year or Class unchanged to update only the other.
                      </>
                    )}
                  </p>

                  {bulkActionError && (
                    <div className="modal-error" role="alert">
                      {bulkActionError}
                    </div>
                  )}

                  {bulkTargetLetter !== 'N/A' &&
                    classUpdatePreview.missingComplementCount > 0 &&
                    (bulkTargetYear !== '' || bulkTargetLetter !== '') && (
                      <p className="member-bulk-popover-warning">
                        {classUpdatePreview.missingComplementCount}{' '}
                        {classUpdatePreview.missingComplementCount === 1
                          ? 'student has'
                          : 'students have'}{' '}
                        no standard class — select both Year and Class to update them too.
                      </p>
                    )}

                  <div className="member-class-builder">
                    <select
                      className="form-control member-class-year-select"
                      value={bulkTargetLetter === 'N/A' ? 'N/A' : bulkTargetYear}
                      aria-label="Target Year for selected members"
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === 'N/A') {
                          setBulkTargetYear('');
                          setBulkTargetLetter('N/A');
                        } else {
                          setBulkTargetYear(raw ? (Number(raw) as ClassYear) : '');
                          if (bulkTargetLetter === 'N/A') {
                            setBulkTargetLetter('');
                          }
                        }
                        if (bulkActionError) setBulkActionError('');
                      }}
                    >
                      <option value="">Keep Year</option>
                      {CLASS_YEARS.map((year) => (
                        <option key={year} value={year}>
                          Year {year}
                        </option>
                      ))}
                      <option value="N/A">N/A (No Class)</option>
                    </select>

                    <div
                      className="member-class-letter-group"
                      role="radiogroup"
                      aria-label="Target Class letter"
                    >
                      {CLASS_LETTERS.map((letter) => {
                        const isSelected = bulkTargetLetter === letter;
                        return (
                          <button
                            key={letter}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className={`member-class-letter-btn ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => {
                              if (letter === 'N/A') {
                                setBulkTargetYear('');
                                setBulkTargetLetter((prev) => (prev === 'N/A' ? '' : 'N/A'));
                              } else {
                                setBulkTargetLetter((prev) => (prev === letter ? '' : letter));
                              }
                              if (bulkActionError) setBulkActionError('');
                            }}
                            title={
                              isSelected
                                ? `Keep existing class`
                                : letter === 'N/A'
                                  ? 'Set Class N/A'
                                  : `Set Class ${letter}`
                            }
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="member-bulk-popover-footer">
                    <button
                      type="submit"
                      className="btn-primary btn-compact-primary"
                      disabled={
                        bulkTargetLetter === 'N/A'
                          ? selectedMembersList.length === 0
                          : selectedStudentMembers.length === 0
                      }
                    >
                      Apply to{' '}
                      <span className="btn-primary-count">
                        {classUpdatePreview.eligibleCount > 0
                          ? classUpdatePreview.eligibleCount
                          : bulkTargetLetter === 'N/A'
                            ? selectedMembersList.length
                            : selectedStudentMembers.length}
                      </span>
                    </button>
                  </div>
                </form>
              )}

              {bulkPanelMode === 'restore_class' && (
                <form
                  className="member-bulk-class-popover"
                  onSubmit={handleConfirmBulkRestoreWithClass}
                >
                  <div className="member-bulk-popover-header">
                    <span className="member-section-label">Assign Class to Restore</span>
                    <button
                      type="button"
                      className="ring-reset-btn"
                      onClick={() => {
                        setBulkPanelMode('none');
                        setBulkActionError('');
                      }}
                    >
                      Cancel
                    </button>
                  </div>

                  <p className="member-bulk-popover-note">
                    {selectedLegacyStudentsMissingClass.length} selected legacy{' '}
                    {selectedLegacyStudentsMissingClass.length === 1 ? 'student lacks' : 'students lack'}{' '}
                    a structured Year &amp; Class. Choose one to restore all{' '}
                    {selectedMembersList.length} selected members to the Active Roster.
                  </p>

                  {bulkActionError && (
                    <div className="modal-error" role="alert">
                      {bulkActionError}
                    </div>
                  )}

                  <div className="member-class-builder">
                    <select
                      className="form-control member-class-year-select"
                      value={bulkTargetLetter === 'N/A' ? 'N/A' : bulkTargetYear}
                      aria-label="Fallback Year for restoring students"
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === 'N/A') {
                          setBulkTargetYear('');
                          setBulkTargetLetter('N/A');
                        } else {
                          setBulkTargetYear(raw ? (Number(raw) as ClassYear) : '');
                          if (bulkTargetLetter === 'N/A') {
                            setBulkTargetLetter('');
                          }
                        }
                        if (bulkActionError) setBulkActionError('');
                      }}
                    >
                      <option value="">Select Year...</option>
                      {CLASS_YEARS.map((year) => (
                        <option key={year} value={year}>
                          Year {year}
                        </option>
                      ))}
                      <option value="N/A">N/A (No Class)</option>
                    </select>

                    <div
                      className="member-class-letter-group"
                      role="radiogroup"
                      aria-label="Fallback Class letter"
                    >
                      {CLASS_LETTERS.map((letter) => {
                        const isSelected = bulkTargetLetter === letter;
                        return (
                          <button
                            key={letter}
                            type="button"
                            role="radio"
                            aria-checked={isSelected}
                            className={`member-class-letter-btn ${isSelected ? 'is-selected' : ''}`}
                            onClick={() => {
                              if (letter === 'N/A') {
                                setBulkTargetYear('');
                              }
                              setBulkTargetLetter(letter);
                              if (bulkActionError) setBulkActionError('');
                            }}
                          >
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="member-bulk-popover-footer">
                    <button type="submit" className="btn-primary btn-compact-primary">
                      Restore &amp; Save
                    </button>
                  </div>
                </form>
              )}

              <div className="member-bulk-action-summary">
                <span className="selection-count-pill">
                  {selectedMembersList.length} selected
                </span>
                <span className="member-bulk-action-hint">Click or drag rows</span>
              </div>

              <div className="member-bulk-action-buttons">
                {directoryScope === 'legacy' ? (
                  <button
                    type="button"
                    className="btn-secondary btn-compact btn-restore-inline"
                    disabled={!canManageClubRecords}
                    onClick={handleBulkRestoreSelected}
                    title={
                      canManageClubRecords
                        ? 'Restore selected members to Active Roster'
                        : 'Admin privileges required for bulk actions'
                    }
                  >
                    <PixelRestoreIcon />
                    <span>Restore</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary btn-compact btn-archive-inline"
                    disabled={!canManageClubRecords}
                    onClick={handleBulkArchiveSelected}
                    title={
                      canManageClubRecords
                        ? 'Move selected members to Legacy / Retired'
                        : 'Admin privileges required for bulk actions'
                    }
                  >
                    <PixelArchiveIcon />
                    <span>Archive</span>
                  </button>
                )}

                <button
                  type="button"
                  className={`btn-secondary btn-compact ${
                    bulkPanelMode === 'change_class' ? 'is-active' : ''
                  }`}
                  onClick={handleOpenChangeClassPanel}
                  disabled={!canManageClubRecords || selectedMembersList.length === 0}
                  title={
                    canManageClubRecords
                      ? 'Change Year or Class (including N/A) for selected members'
                      : 'Admin privileges required for bulk class updates'
                  }
                >
                  <PixelEditIcon />
                  <span>Year / Class</span>
                </button>

                <button
                  type="button"
                  className="btn-danger btn-compact"
                  disabled={!canManageClubRecords}
                  onClick={handleRequestBulkDelete}
                  title={
                    canManageClubRecords
                      ? 'Permanently delete selected members'
                      : 'Admin privileges required to delete members'
                  }
                >
                  <PixelTrashIcon />
                  <span>Delete ({selectedMembersList.length})</span>
                </button>
              </div>
            </div>
          )}
        </aside>

      <ConfirmDialog
        isOpen={pendingDeleteMember !== null}
        badgeLabel="Delete Member"
        title={pendingDeleteMember ? `Remove "${pendingDeleteMember.name}"?` : ''}
        message={
          pendingDeleteMember
            ? `Are you sure you want to permanently delete "${pendingDeleteMember.name}" from the locally saved Team SPIRIT roster? Their profile details and attendance marks across all saved sessions will also be removed.`
            : ''
        }
        confirmLabel="Delete Member"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDeleteMember(null)}
      />

      <ConfirmDialog
        isOpen={pendingBulkDeleteIds !== null && pendingBulkDeleteIds.length > 0}
        badgeLabel="Bulk Delete"
        title={
          pendingBulkDeleteIds
            ? pendingBulkDeleteIds.length === 1
              ? `Permanently delete "${
                  members.find((m) => m.id === pendingBulkDeleteIds[0])?.name ?? '1 member'
                }"?`
              : `Permanently delete ${pendingBulkDeleteIds.length} selected members?`
            : ''
        }
        message={(() => {
          if (!pendingBulkDeleteIds || pendingBulkDeleteIds.length === 0) return '';
          const names = pendingBulkDeleteIds
            .map((memberId) => members.find((m) => m.id === memberId)?.name)
            .filter((name): name is string => Boolean(name));
          const preview =
            names.length <= 3
              ? names.join(', ')
              : `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
          return `This will permanently delete ${
            names.length > 0 ? preview : `${pendingBulkDeleteIds.length} members`
          } along with all their attendance records across every saved session, both locally and in Supabase Cloud Sync.`;
        })()}
        confirmLabel={
          pendingBulkDeleteIds
            ? `Delete ${pendingBulkDeleteIds.length} ${
                pendingBulkDeleteIds.length === 1 ? 'Member' : 'Members'
              }`
            : 'Delete Selected'
        }
        onConfirm={handleConfirmBulkDelete}
        onCancel={() => setPendingBulkDeleteIds(null)}
      />
    </>
  );
}
