import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  AttendanceSession,
  AttendanceStatus,
  ClassLetter,
  ClassYear,
  ClubMember,
  MemberProfileInput,
  MemberType,
} from '../types/attendance';
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
  resolveStudentClassFields,
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
import {
  PixelAlertIcon,
  PixelArchiveIcon,
  PixelArrowLeftIcon,
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelCloseIcon,
  PixelDownloadIcon,
  PixelEditIcon,
  PixelFlameIcon,
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
  onSelectMember: (memberId: string | null) => void;
  onClose: () => void;
  onAddMember: (input: MemberProfileInput) => ClubMember;
  onUpdateMember: (memberId: string, input: MemberProfileInput) => void;
  onSetMemberLegacyStatus: (memberId: string, isLegacy: boolean) => void;
  onDeleteMember: (memberId: string) => void;
}

type SidebarViewMode = 'directory' | 'profile' | 'add' | 'edit';
type DirectoryScope = 'active' | 'legacy';

const ROLE_SUGGESTIONS = [
  'Captain',
  'Vice Captain',
  'Secretary',
  'Treasurer',
  'Coach',
  'Coordinator',
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
  const hasStructuredClass = Boolean(resolvedClass.classYear && resolvedClass.classLetter);

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
  onSelectMember,
  onClose,
  onAddMember,
  onUpdateMember,
  onSetMemberLegacyStatus,
  onDeleteMember,
}: MemberManagerSidebarProps) {
  const titleId = useId();
  const roleListId = useId();
  const nameInputId = useId();
  const memberTypeLabelId = useId();
  const classYearInputId = useId();
  const classLetterLabelId = useId();
  const roleInputId = useId();
  const joinedInputId = useId();
  const emailInputId = useId();
  const phoneInputId = useId();
  const handleInputId = useId();
  const notesInputId = useId();

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const classYearSelectRef = useRef<HTMLSelectElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

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
  const [formError, setFormError] = useState('');
  const [absenceFilter, setAbsenceFilter] = useState<'reasons_only' | 'all'>('reasons_only');
  const [showAllAbsences, setShowAllAbsences] = useState(false);
  const [pendingDeleteMember, setPendingDeleteMember] = useState<ClubMember | null>(null);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedMemberId) ?? null,
    [members, selectedMemberId],
  );

  // Sync external member selection (e.g. clicking a member in the main roster) into profile view.
  useEffect(() => {
    if (selectedMemberId && selectedMember) {
      setViewMode((current) =>
        current === 'edit' && editingTargetId === selectedMemberId ? current : 'profile',
      );
      setShowAllAbsences(false);
    } else if (viewMode === 'profile') {
      setViewMode('directory');
      if (selectedMemberId && !selectedMember) {
        onSelectMember(null);
      }
    }
  }, [selectedMemberId, selectedMember, viewMode, editingTargetId, onSelectMember]);

  useEffect(() => {
    if (isOpen && (viewMode === 'add' || viewMode === 'edit')) {
      const timer = window.setTimeout(() => {
        nameInputRef.current?.focus({ preventScroll: true });
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

  function handleSidebarKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && isExportMenuOpen) {
      event.stopPropagation();
      setIsExportMenuOpen(false);
      return;
    }
    if (event.key === 'Escape' && isOpen && !pendingDeleteMember) {
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
      if (normalizeMemberType(member.memberType) === 'student' && member.className) {
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
    return scopedMembers.filter((member) => {
      const memberType = normalizeMemberType(member.memberType);
      const matchesRole =
        effectiveRoleFilter === 'all' ||
        (effectiveRoleFilter === '__unassigned__'
          ? !member.role
          : member.role === effectiveRoleFilter);
      if (!matchesRole) return false;

      const matchesClass =
        effectiveClassFilter === 'all' ||
        (memberType === 'student' && member.className === effectiveClassFilter);
      if (!matchesClass) return false;

      if (!query) return true;
      return [
        member.name,
        memberType === 'student' ? member.className : undefined,
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
  }, [effectiveClassFilter, effectiveRoleFilter, scopedMembers, searchQuery]);

  const activeProfileStats = selectedMember
    ? memberStatsMap.get(selectedMember.id) ?? summarizeMemberAttendance(selectedMember.id, sessions)
    : null;

  function openDirectory(targetScope?: DirectoryScope) {
    if (targetScope) {
      setDirectoryScope(targetScope);
    } else if (selectedMember) {
      setDirectoryScope(isLegacyMember(selectedMember) ? 'legacy' : 'active');
    }
    onSelectMember(null);
    setEditingTargetId(null);
    setFormError('');
    setViewMode('directory');
  }

  function openMemberProfile(memberId: string) {
    onSelectMember(memberId);
    setEditingTargetId(null);
    setFormError('');
    setShowAllAbsences(false);
    setViewMode('profile');
  }

  function openAddForm() {
    setEditingTargetId(null);
    setFormValues(emptyFormValues());
    setFormError('');
    setViewMode('add');
  }

  function openEditForm(
    member: ClubMember,
    options?: { overrideIsLegacy?: boolean; noticeMessage?: string },
  ) {
    onSelectMember(member.id);
    setEditingTargetId(member.id);
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
      if (!resolved.classYear || !resolved.classLetter) {
        openEditForm(member, {
          overrideIsLegacy: false,
          noticeMessage:
            'Select a Year (7–11) and Class (T, E, N, B) to restore this student to the Active Roster.',
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
    const cleanedName = formValues.name.trim();
    if (!cleanedName) {
      setFormError('Member name is required.');
      nameInputRef.current?.focus();
      return;
    }

    const isStudent = formValues.memberType === 'student';
    const hasYear = formValues.classYear !== '';
    const hasLetter = formValues.classLetter !== '';
    let resolvedClassYear: ClassYear | undefined;
    let resolvedClassLetter: ClassLetter | undefined;
    let resolvedClassName: string | undefined;

    if (isStudent) {
      if (hasYear && hasLetter) {
        resolvedClassYear = formValues.classYear as ClassYear;
        resolvedClassLetter = formValues.classLetter as ClassLetter;
        resolvedClassName = formatStudentClassName(resolvedClassYear, resolvedClassLetter);
      } else if (!hasYear && !hasLetter && formValues.isLegacy && formValues.legacyClassFallback) {
        resolvedClassName = formValues.legacyClassFallback;
      } else {
        setFormError(
          !hasYear && !hasLetter
            ? 'Select both Year (7–11) and Class (T, E, N, B) for student members.'
            : !hasYear
              ? 'Select a Year (Year 7 – Year 11) for this student.'
              : 'Select a Class letter (T, E, N, or B) for this student.',
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
      classYear: isStudent ? resolvedClassYear : undefined,
      classLetter: isStudent ? resolvedClassLetter : undefined,
      className: isStudent ? resolvedClassName : undefined,
      isLegacy: formValues.isLegacy,
      role: formValues.role.trim() || undefined,
      joinedDate: formValues.joinedDate.trim() || undefined,
      email: formValues.email.trim() || undefined,
      phone: formValues.phone.trim() || undefined,
      handle: formValues.handle.trim() || undefined,
      notes: formValues.notes.trim() || undefined,
    };

    if (viewMode === 'edit' && editingTargetId) {
      onUpdateMember(editingTargetId, payload);
      setEditingTargetId(null);
      setDirectoryScope(payload.isLegacy ? 'legacy' : 'active');
      onSelectMember(editingTargetId);
      setViewMode('profile');
    } else {
      const created = onAddMember(payload);
      setDirectoryScope('active');
      onSelectMember(created.id);
      setViewMode('profile');
    }
    setFormError('');
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
                  <span>{directoryScope === 'legacy' && viewMode === 'directory' ? 'Legacy' : 'Directory'}</span>
                </span>
                <span
                  className="panel-count"
                  title={`${activeMembers.length} active • ${legacyMembers.length} legacy`}
                >
                  {directoryScope === 'legacy' && viewMode === 'directory'
                    ? legacyMembers.length
                    : activeMembers.length}
                </span>
              </div>
              <h2 id={titleId} className="member-drawer-title">
                {viewMode === 'directory' && 'Member Manager'}
                {viewMode === 'profile' && (selectedMember?.name ?? 'Member Profile')}
                {viewMode === 'add' && 'Add Club Member'}
                {viewMode === 'edit' && 'Edit Member Profile'}
              </h2>
            </div>

            <div className="member-drawer-header-actions">
              {(viewMode === 'directory' || (viewMode === 'profile' && selectedMember)) && (
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

              {viewMode === 'directory' && (
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
            {viewMode === 'directory' && (
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
                          : 'Add students (Year 7–11, Class T/E/N/B), teachers, or visitors with optional role and contact details.'
                        : 'Try clearing your search term or switching the class/role filters.'}
                    </p>
                    {scopedMembers.length === 0 && directoryScope === 'active' && (
                      <button type="button" className="btn-primary" onClick={openAddForm}>
                        <PixelPlusIcon />
                        <span>Add First Member</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <ul
                    className="member-directory-list"
                    aria-label={
                      directoryScope === 'legacy'
                        ? 'Legacy and retired member archive'
                        : 'Active club member directory'
                    }
                  >
                    {filteredMembers.map((member) => {
                      const stats = memberStatsMap.get(member.id);
                      const rateLabel =
                        stats && stats.markedRate !== null ? `${stats.markedRate}%` : '--%';
                      const memberType = normalizeMemberType(member.memberType);
                      const memberIsLegacy = isLegacyMember(member);
                      const hasStreakHighlight = Boolean(
                        !memberIsLegacy &&
                          stats &&
                          stats.currentPresentStreak >= STREAK_HIGHLIGHT_THRESHOLD,
                      );
                      const hasAbsenceFlag = Boolean(
                        !memberIsLegacy &&
                          stats &&
                          stats.consecutiveUnexcusedAbsences >= CONSECUTIVE_ABSENCE_ALERT_THRESHOLD,
                      );

                      return (
                        <li key={member.id} className="member-directory-item">
                          <div
                            className={`member-directory-row ${
                              memberIsLegacy
                                ? 'is-legacy'
                                : hasStreakHighlight
                                  ? 'is-streak-highlight'
                                  : hasAbsenceFlag
                                    ? 'is-absence-flag'
                                    : ''
                            }`}
                            role="button"
                            tabIndex={0}
                            onClick={() => openMemberProfile(member.id)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                openMemberProfile(member.id);
                              }
                            }}
                          >
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
                                {memberType === 'student'
                                  ? member.className && (
                                      <span
                                        className="member-class-pill"
                                        title={`Class: ${member.className}`}
                                      >
                                        {member.className}
                                      </span>
                                    )
                                  : (
                                      <span className={`member-type-pill is-${memberType}`}>
                                        {MEMBER_TYPE_LABELS[memberType]}
                                      </span>
                                    )}
                                {member.role && (
                                  <span className="member-role-pill">{member.role}</span>
                                )}
                              </div>

                              <div className="member-directory-meta">
                                <span className="mono-meta">
                                  {stats ? `${stats.presentCount}/${stats.totalSessions} present` : '0 sessions'}
                                </span>
                                <span className="member-rate-chip" title="Marked attendance rate">
                                  {rateLabel}
                                </span>
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
                              </div>
                            </div>

                            <div
                              className="member-directory-actions"
                              onClick={(event) => event.stopPropagation()}
                              onKeyDown={(event) => event.stopPropagation()}
                            >
                              {memberIsLegacy ? (
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-restore"
                                  onClick={() => handleRestoreMember(member)}
                                  aria-label={`Restore ${member.name} to Active Roster`}
                                  title="Restore to Active Roster"
                                >
                                  <PixelRestoreIcon />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="icon-btn icon-btn-archive"
                                  onClick={() => handleArchiveMember(member)}
                                  aria-label={`Move ${member.name} to Legacy`}
                                  title="Move to Legacy / Retired"
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
                                onClick={() => handleRequestDeleteMember(member)}
                                aria-label={`Delete ${member.name}`}
                                title="Delete member"
                              >
                                <PixelTrashIcon />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {viewMode === 'profile' && selectedMember && activeProfileStats && (
              <div className="member-profile-view">
                <div className="member-profile-topbar">
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => openDirectory(isLegacyMember(selectedMember) ? 'legacy' : 'active')}
                  >
                    <PixelArrowLeftIcon />
                    <span>{isLegacyMember(selectedMember) ? 'Legacy List' : 'Active Roster'}</span>
                  </button>

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
                        {selectedMemberType === 'student' ? (
                          <>
                            {selectedMember.className ? (
                              <span className="member-class-pill">
                                Class: {selectedMember.className}
                              </span>
                            ) : (
                              <span className="member-muted-pill">
                                <span>No class set</span>
                              </span>
                            )}
                            <span className="member-type-pill is-student">Student</span>
                          </>
                        ) : (
                          <span className={`member-type-pill is-${selectedMemberType}`}>
                            {MEMBER_TYPE_LABELS[selectedMemberType]}
                          </span>
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
                        {activeProfileStats.currentPresentStreak >= STREAK_HIGHLIGHT_THRESHOLD && (
                          <span
                            className="member-streak-badge"
                            title={`Active attendance streak: ${activeProfileStats.currentPresentStreak} consecutive sessions present`}
                          >
                            <PixelFlameIcon width={11} height={11} />
                            <span>{activeProfileStats.currentPresentStreak} Session Streak</span>
                          </span>
                        )}
                        {activeProfileStats.consecutiveUnexcusedAbsences >=
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

                  {activeProfileStats.consecutiveUnexcusedAbsences >=
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

                  {activeProfileStats.currentPresentStreak >= STREAK_HIGHLIGHT_THRESHOLD && (
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
              </div>
            )}

            {(viewMode === 'add' || viewMode === 'edit') && (
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
                </div>

                {formError && (
                  <div className="modal-error" role="alert">
                    {formError}
                  </div>
                )}

                <div className="form-field">
                  <label htmlFor={nameInputId}>
                    Full Name <span className="required-mark">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    id={nameInputId}
                    type="text"
                    className="form-control"
                    placeholder="e.g. Alex Tan"
                    value={formValues.name}
                    onChange={(event) => {
                      setFormValues((prev) => ({ ...prev, name: event.target.value }));
                      if (formError) setFormError('');
                    }}
                    required
                  />
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
                            setFormValues((prev) => ({ ...prev, memberType: typeOption }));
                            if (formError) setFormError('');
                          }}
                        >
                          {MEMBER_TYPE_LABELS[typeOption]}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {formValues.memberType === 'student' && (
                  <div className="form-field">
                    <div className="member-class-field-header">
                      <label htmlFor={classYearInputId}>
                        Year &amp; Class <span className="required-mark">*</span>
                      </label>
                      {formValues.classYear !== '' && formValues.classLetter !== '' && (
                        <span className="member-class-pill member-class-preview" aria-live="polite">
                          {formatStudentClassName(formValues.classYear, formValues.classLetter)}
                        </span>
                      )}
                    </div>

                    {formValues.legacyClassFallback &&
                      formValues.classYear === '' &&
                      formValues.classLetter === '' && (
                        <p className="member-class-legacy-hint">
                          Previous class: <strong>{formValues.legacyClassFallback}</strong> — choose
                          a Year (7–11) and Class (T, E, N, B) below.
                        </p>
                      )}

                    <div className="member-class-builder">
                      <select
                        ref={classYearSelectRef}
                        id={classYearInputId}
                        className="form-control member-class-year-select"
                        value={formValues.classYear}
                        aria-label="Student Year (Year 7 to Year 11)"
                        onChange={(event) => {
                          const raw = event.target.value;
                          const nextYear = raw ? (Number(raw) as ClassYear) : '';
                          setFormValues((prev) => ({
                            ...prev,
                            classYear: nextYear,
                          }));
                          if (formError) setFormError('');
                        }}
                        required={!formValues.isLegacy}
                      >
                        <option value="">Select Year...</option>
                        {CLASS_YEARS.map((year) => (
                          <option key={year} value={year}>
                            Year {year}
                          </option>
                        ))}
                      </select>

                      <div
                        className="member-class-letter-group"
                        role="radiogroup"
                        aria-labelledby={classLetterLabelId}
                      >
                        <span id={classLetterLabelId} className="sr-only">
                          Class letter T, E, N, or B
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
                                setFormValues((prev) => ({ ...prev, classLetter: letter }));
                                if (formError) setFormError('');
                              }}
                              title={`Class ${letter}`}
                            >
                              {letter}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}

                <div className="modal-grid-2">
                  <div className="form-field">
                    <label htmlFor={roleInputId}>
                      Club Role <span className="optional-mark">(Optional)</span>
                    </label>
                    <input
                      id={roleInputId}
                      type="text"
                      list={roleListId}
                      className="form-control"
                      placeholder="e.g. Captain, Member"
                      value={formValues.role}
                      onChange={(event) =>
                        setFormValues((prev) => ({ ...prev, role: event.target.value }))
                      }
                    />
                    <datalist id={roleListId}>
                      {ROLE_SUGGESTIONS.map((role) => (
                        <option key={role} value={role} />
                      ))}
                    </datalist>
                  </div>

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
                      placeholder="name@example.com"
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
                  <label htmlFor={handleInputId}>
                    Handle / Member ID <span className="optional-mark">(Optional)</span>
                  </label>
                  <input
                    id={handleInputId}
                    type="text"
                    className="form-control"
                    placeholder="e.g. @alextan or TS-014"
                    value={formValues.handle}
                    onChange={(event) =>
                      setFormValues((prev) => ({ ...prev, handle: event.target.value }))
                    }
                  />
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
          </div>
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
    </>
  );
}
