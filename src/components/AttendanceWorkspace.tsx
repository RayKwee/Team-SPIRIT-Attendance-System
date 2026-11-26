import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
  AccessScope,
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  FilterStatus,
  SessionAttendanceEntry,
  UserPreferences,
  ViewMode,
} from '../types/attendance';
import {
  MEMBER_TYPE_LABELS,
  STATUS_LABELS,
  compareStudentClassNames,
  getMemberInitials,
  getSessionAssignedMembers,
  isLegacyMember,
  normalizeMemberType,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp } from '../utils/date';
import {
  exportSessionAttendanceCsv,
  printSessionAttendanceReport,
} from '../utils/export';
import { ConfirmDialog } from './ConfirmDialog';
import { MeetingVisibilityBadge } from './MeetingSettingsModal';
import {
  PixelArrowLeftIcon,
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelClockIcon,
  PixelCloseIcon,
  PixelDownloadIcon,
  PixelGridIcon,
  PixelListIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelPrinterIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelSettingsIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface AttendanceWorkspaceProps {
  activeSession: AttendanceSession;
  members: ClubMember[];
  preferences: UserPreferences;
  accessScope?: AccessScope;
  linkedMember?: ClubMember | null;
  canViewAttendanceRates?: boolean;
  canBrowseFullRoster?: boolean;
  canManageClubRecords?: boolean;
  onBackToHub: () => void;
  onOpenMemberManager: () => void;
  onOpenMemberProfile: (memberId: string) => void;
  onEditSession?: (session: AttendanceSession) => void;
  onDeleteSession: (sessionId: string) => void;
  onAssignMemberToSession: (memberId: string) => void;
  onAssignMembersToSession: (memberIds: string[]) => void;
  onRemoveMemberFromSession: (memberId: string) => void;
  onToggleAttendanceStatus: (
    memberId: string,
    targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
  ) => void;
  onSetAbsenceReason: (memberId: string, reason: string) => void;
  onBeginFieldEdit?: (fieldKey: string) => void;
  onEndFieldEdit?: (fieldKey: string) => void;
  onResetSessionMarks: () => void;
  onUpdatePreferences: (patch: Partial<UserPreferences>) => void;
}

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'present', label: 'Present' },
  { value: 'absent_with_reason', label: 'Absent w/ Reason' },
  { value: 'absent_without_reason', label: 'Absent w/o Reason' },
  { value: 'unmarked', label: 'Unmarked' },
];

const STATUS_BUTTONS: {
  value: Exclude<AttendanceStatus, 'unmarked'>;
  label: string;
  accentClass: string;
}[] = [
  { value: 'present', label: 'Present', accentClass: 'option-present' },
  {
    value: 'absent_with_reason',
    label: 'Absent with reason',
    accentClass: 'option-reason',
  },
  {
    value: 'absent_without_reason',
    label: 'Absent without reason',
    accentClass: 'option-absent',
  },
];

interface MemberControlsProps {
  sessionId: string;
  member: ClubMember;
  entry: SessionAttendanceEntry;
  compact?: boolean;
  onToggleStatus: (memberId: string, target: Exclude<AttendanceStatus, 'unmarked'>) => void;
  onReasonChange: (memberId: string, reason: string) => void;
  onBeginFieldEdit?: (fieldKey: string) => void;
  onEndFieldEdit?: (fieldKey: string) => void;
}

/** Shared status buttons and conditional reason field with focus-protected draft state. */
function MemberAttendanceControls({
  sessionId,
  member,
  entry,
  compact = false,
  onToggleStatus,
  onReasonChange,
  onBeginFieldEdit,
  onEndFieldEdit,
}: MemberControlsProps) {
  const fieldKey = `attendance:${sessionId}::${member.id}`;
  const [isFocused, setIsFocused] = useState(false);
  const [draftReason, setDraftReason] = useState(entry.reason ?? '');
  const [hasRemoteChangeWhileFocused, setHasRemoteChangeWhileFocused] = useState(false);
  const isFocusedRef = useRef(false);
  const fieldKeyRef = useRef(fieldKey);
  const onEndFieldEditRef = useRef(onEndFieldEdit);
  fieldKeyRef.current = fieldKey;
  onEndFieldEditRef.current = onEndFieldEdit;

  useEffect(() => {
    if (!isFocused) {
      setDraftReason(entry.reason ?? '');
      setHasRemoteChangeWhileFocused(false);
    } else if ((entry.reason ?? '').trim() !== draftReason.trim()) {
      setHasRemoteChangeWhileFocused(true);
    }
  }, [entry.reason, isFocused, draftReason]);

  useEffect(() => {
    return () => {
      if (isFocusedRef.current) {
        isFocusedRef.current = false;
        onEndFieldEditRef.current?.(fieldKeyRef.current);
      }
    };
  }, []);

  return (
    <div className="member-controls-stack">
      <div
        className={`status-segmented ${compact ? 'status-segmented-card' : ''}`}
        role="group"
        aria-label={`Mark attendance for ${member.name}`}
      >
        {STATUS_BUTTONS.map((btn) => {
          const isSelected = entry.status === btn.value;
          return (
            <button
              key={btn.value}
              type="button"
              aria-pressed={isSelected}
              className={`status-option ${btn.accentClass} ${isSelected ? 'is-selected' : ''}`}
              title={isSelected ? `Click again to unmark ${btn.label}` : `Mark as ${btn.label}`}
              onClick={() => onToggleStatus(member.id, btn.value)}
            >
              {btn.label}
            </button>
          );
        })}
      </div>

      {entry.status === 'absent_with_reason' && (
        <div className="absence-reason-wrap">
          <label className="sr-only" htmlFor={`reason-${member.id}`}>
            Optional absence reason for {member.name}
          </label>
          <input
            id={`reason-${member.id}`}
            type="text"
            className="form-control absence-reason-input"
            placeholder="Optional reason (e.g. sick, class conflict, transit)..."
            value={isFocused ? draftReason : (entry.reason ?? '')}
            onFocus={() => {
              isFocusedRef.current = true;
              setIsFocused(true);
              setDraftReason(entry.reason ?? '');
              setHasRemoteChangeWhileFocused(false);
              onBeginFieldEdit?.(fieldKey);
            }}
            onChange={(event) => {
              const nextValue = event.target.value;
              setDraftReason(nextValue);
              onReasonChange(member.id, nextValue);
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              setIsFocused(false);
              setHasRemoteChangeWhileFocused(false);
              onEndFieldEdit?.(fieldKey);
            }}
          />
          {hasRemoteChangeWhileFocused && (
            <span className="draft-paused-hint" role="status">
              Live update paused while typing
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Focused session attendance workspace with directory search-and-suggest assignment. */
export function AttendanceWorkspace({
  activeSession,
  members,
  preferences,
  accessScope = 'local',
  linkedMember = null,
  canViewAttendanceRates = true,
  canBrowseFullRoster = true,
  canManageClubRecords = true,
  onBackToHub,
  onOpenMemberManager,
  onOpenMemberProfile,
  onEditSession,
  onDeleteSession,
  onAssignMemberToSession,
  onAssignMembersToSession,
  onRemoveMemberFromSession,
  onToggleAttendanceStatus,
  onSetAbsenceReason,
  onBeginFieldEdit,
  onEndFieldEdit,
  onResetSessionMarks,
  onUpdatePreferences,
}: AttendanceWorkspaceProps) {
  const suggestListboxId = useId();
  const suggestWrapRef = useRef<HTMLDivElement | null>(null);
  const suggestInputRef = useRef<HTMLInputElement | null>(null);
  const classMenuRef = useRef<HTMLDivElement | null>(null);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  const [suggestQuery, setSuggestQuery] = useState('');
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [isClassMenuOpen, setIsClassMenuOpen] = useState(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<
    | { kind: 'session'; session: AttendanceSession }
    | { kind: 'remove_from_session'; member: ClubMember }
    | null
  >(null);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      if (!(event.target instanceof Node)) return;
      if (suggestWrapRef.current && !suggestWrapRef.current.contains(event.target)) {
        setIsSuggestOpen(false);
      }
      if (classMenuRef.current && !classMenuRef.current.contains(event.target)) {
        setIsClassMenuOpen(false);
      }
      if (exportMenuRef.current && !exportMenuRef.current.contains(event.target)) {
        setIsExportMenuOpen(false);
      }
    }

    function handleDocumentKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsClassMenuOpen(false);
        setIsExportMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    document.addEventListener('keydown', handleDocumentKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleDocumentMouseDown);
      document.removeEventListener('keydown', handleDocumentKeyDown);
    };
  }, []);

  const activeMembers = useMemo(
    () => members.filter((member) => !isLegacyMember(member)),
    [members],
  );

  const assignedMembers = useMemo(
    () => getSessionAssignedMembers(activeSession, members),
    [activeSession, members],
  );

  const assignedMemberIdSet = useMemo(
    () => new Set(assignedMembers.map((member) => member.id)),
    [assignedMembers],
  );

  const unassignedMembers = useMemo(
    () => activeMembers.filter((member) => !assignedMemberIdSet.has(member.id)),
    [activeMembers, assignedMemberIdSet],
  );

  const unassignedClassGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const member of unassignedMembers) {
      const cls = member.className?.trim();
      if (!cls) continue;
      const list = groups.get(cls);
      if (list) {
        list.push(member.id);
      } else {
        groups.set(cls, [member.id]);
      }
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => compareStudentClassNames(a, b))
      .map(([className, memberIds]) => ({ className, memberIds }));
  }, [unassignedMembers]);

  const { availableSuggestions, alreadyAssignedSuggestions, legacyMatchCount } = useMemo(() => {
    const query = suggestQuery.trim().toLowerCase();
    const matchesQuery = (member: ClubMember) => {
      if (!query) return true;
      const memberType = normalizeMemberType(member.memberType);
      return [
        member.name,
        member.className,
        MEMBER_TYPE_LABELS[memberType],
        member.role,
        member.handle,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    };

    const matches = activeMembers.filter(matchesQuery);
    const legacyMatches = query
      ? members.filter((member) => isLegacyMember(member) && matchesQuery(member)).length
      : 0;

    const available: ClubMember[] = [];
    const alreadyAssigned: ClubMember[] = [];
    for (const member of matches) {
      if (assignedMemberIdSet.has(member.id)) {
        alreadyAssigned.push(member);
      } else {
        available.push(member);
      }
    }

    return {
      availableSuggestions: available.slice(0, 8),
      alreadyAssignedSuggestions: query ? alreadyAssigned.slice(0, 4) : [],
      legacyMatchCount: legacyMatches,
    };
  }, [activeMembers, assignedMemberIdSet, members, suggestQuery]);

  useEffect(() => {
    setHighlightedIndex(0);
  }, [suggestQuery, activeSession.id]);

  const activePendingAction =
    pendingAction?.kind === 'session'
      ? activeSession.id === pendingAction.session.id
        ? pendingAction
        : null
      : pendingAction?.kind === 'remove_from_session'
        ? assignedMemberIdSet.has(pendingAction.member.id)
          ? pendingAction
          : null
        : null;

  const { statusFilters, viewMode, searchQuery, confirmSessionMemberRemoval } = preferences;
  const trimmedQuery = searchQuery.trim().toLowerCase();
  const selectedStatusSet = useMemo(() => new Set(statusFilters), [statusFilters]);
  const isAllStatusesSelected = selectedStatusSet.size === 0;

  function getEntry(memberId: string): SessionAttendanceEntry {
    return (
      activeSession.attendance[memberId] ?? {
        status: 'unmarked',
        updatedAt: '',
      }
    );
  }

  const filteredMembers = assignedMembers.filter((member) => {
    const entry = getEntry(member.id);
    const matchesStatus = isAllStatusesSelected || selectedStatusSet.has(entry.status);
    const memberType = normalizeMemberType(member.memberType);
    const matchesQuery =
      trimmedQuery.length === 0 ||
      member.name.toLowerCase().includes(trimmedQuery) ||
      Boolean(member.className?.toLowerCase().includes(trimmedQuery)) ||
      MEMBER_TYPE_LABELS[memberType].toLowerCase().includes(trimmedQuery) ||
      Boolean(member.role?.toLowerCase().includes(trimmedQuery));
    return matchesStatus && matchesQuery;
  });

  function handleSelectAllStatuses() {
    if (!isAllStatusesSelected) {
      onUpdatePreferences({ statusFilters: [] });
    }
  }

  function handleToggleStatusFilter(status: AttendanceStatus) {
    if (isAllStatusesSelected) {
      onUpdatePreferences({ statusFilters: [status] });
      return;
    }

    const nextFilters = selectedStatusSet.has(status)
      ? statusFilters.filter((item) => item !== status)
      : [...statusFilters, status];

    onUpdatePreferences({ statusFilters: nextFilters });
  }

  const hasAnyMarked = assignedMembers.some((member) => getEntry(member.id).status !== 'unmarked');

  function handleSelectSuggestion(member: ClubMember) {
    onAssignMemberToSession(member.id);
    setSuggestQuery('');
    setHighlightedIndex(0);
    setIsSuggestOpen(true);
    suggestInputRef.current?.focus();
  }

  function handleSuggestKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setIsSuggestOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isSuggestOpen) {
        setIsSuggestOpen(true);
        return;
      }
      if (availableSuggestions.length > 0) {
        setHighlightedIndex((prev) => (prev + 1) % availableSuggestions.length);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (availableSuggestions.length > 0) {
        setHighlightedIndex((prev) =>
          prev <= 0 ? availableSuggestions.length - 1 : prev - 1,
        );
      }
      return;
    }

    if (event.key === 'Enter' && isSuggestOpen) {
      const targetMember = availableSuggestions[highlightedIndex] ?? availableSuggestions[0];
      if (targetMember) {
        event.preventDefault();
        handleSelectSuggestion(targetMember);
      }
    }
  }

  function handleRequestRemoveMember(member: ClubMember) {
    if (confirmSessionMemberRemoval) {
      setPendingAction({ kind: 'remove_from_session', member });
    } else {
      onRemoveMemberFromSession(member.id);
    }
  }

  function handleConfirmPendingAction() {
    if (!activePendingAction) return;
    if (activePendingAction.kind === 'session') {
      onDeleteSession(activePendingAction.session.id);
    } else {
      onRemoveMemberFromSession(activePendingAction.member.id);
    }
    setPendingAction(null);
  }

  function handleViewChange(nextView: ViewMode) {
    onUpdatePreferences({ viewMode: nextView });
  }

  const isReadOnlyBroadViewer =
    accessScope === 'broad_viewer' ||
    (accessScope !== 'local' &&
      accessScope !== 'admin' &&
      canViewAttendanceRates &&
      canBrowseFullRoster);
  const canEditSessionChecklist = accessScope === 'local' || accessScope === 'admin';

  if (!canEditSessionChecklist && !isReadOnlyBroadViewer) {
    if (!linkedMember) {
      return (
        <section
          className="tracker-panel"
          aria-label="Session overview"
          data-tutorial-target="attendance-checklist"
        >
          <div className="tracker-panel-header">
            <div className="panel-title-group">
              <button
                type="button"
                className="btn-secondary btn-compact checklist-back-btn"
                onClick={onBackToHub}
                title="Return to Sessions Hub"
              >
                <PixelArrowLeftIcon />
                <span>All Sessions</span>
              </button>
              <h2 className="panel-title">Session Overview</h2>
            </div>
          </div>

          <div className="session-banner">
            <div className="session-banner-main">
              <div className="session-banner-title-row">
                <h3 className="session-banner-name">{activeSession.name}</h3>
                {activeSession.eventType && (
                  <span className="session-type-tag">{activeSession.eventType}</span>
                )}
                <MeetingVisibilityBadge visibility={activeSession.visibility} />
              </div>
              {activeSession.description && (
                <p className="session-banner-description">{activeSession.description}</p>
              )}
            </div>

            <div className="session-meta-pills">
              <span className="session-meta-pill">
                <PixelCalendarIcon />
                <span>{formatSessionDate(activeSession.date)}</span>
              </span>
              <span className="session-meta-pill">
                <PixelClockIcon />
                <span>{formatSessionTime(activeSession.time)}</span>
              </span>
              {activeSession.location && (
                <span className="session-meta-pill">
                  <PixelPinIcon />
                  <span>{activeSession.location}</span>
                </span>
              )}
            </div>
          </div>

          <div className="tracker-body">
            <div className="personal-attendance-card">
              <div className="personal-attendance-head">
                <div>
                  <span className="personal-attendance-label">Read-Only Schedule View</span>
                  <h3 className="personal-attendance-name">Member Attendance Hidden</h3>
                </div>
              </div>
              <span className="personal-attendance-hint">
                Club roster &amp; peer attendance marks are restricted under current Member
                Visibility Permissions.
              </span>
            </div>
          </div>
        </section>
      );
    }

    const personalEntry = activeSession.attendance[linkedMember.id];
    const isAssignedToSession =
      activeSession.memberIds.includes(linkedMember.id) || Boolean(personalEntry);
    const personalStatus = personalEntry?.status ?? 'unmarked';
    const personalReason = personalEntry?.reason?.trim();

    return (
      <section
        className="tracker-panel"
        aria-label="Personal session attendance record"
        data-tutorial-target="attendance-checklist"
      >
        <div className="tracker-panel-header">
          <div className="panel-title-group">
            <button
              type="button"
              className="btn-secondary btn-compact checklist-back-btn"
              onClick={onBackToHub}
              title="Return to My Sessions"
            >
              <PixelArrowLeftIcon />
              <span>All My Sessions</span>
            </button>
            <h2 className="panel-title">My Attendance Record</h2>
          </div>
        </div>

        <div className="session-banner">
          <div className="session-banner-main">
            <div className="session-banner-title-row">
              <h3 className="session-banner-name">{activeSession.name}</h3>
              {activeSession.eventType && (
                <span className="session-type-tag">{activeSession.eventType}</span>
              )}
              <MeetingVisibilityBadge visibility={activeSession.visibility} />
            </div>
            {activeSession.description && (
              <p className="session-banner-description">{activeSession.description}</p>
            )}
          </div>

          <div className="session-meta-pills">
            <span className="session-meta-pill">
              <PixelCalendarIcon />
              <span>{formatSessionDate(activeSession.date)}</span>
            </span>
            <span className="session-meta-pill">
              <PixelClockIcon />
              <span>{formatSessionTime(activeSession.time)}</span>
            </span>
            {activeSession.location && (
              <span className="session-meta-pill">
                <PixelPinIcon />
                <span>{activeSession.location}</span>
              </span>
            )}
          </div>
        </div>

        <div className="tracker-body">
          <div className="personal-attendance-card">
            <div className="personal-attendance-head">
              <div>
                <span className="personal-attendance-label">Recorded Member</span>
                <h3 className="personal-attendance-name">{linkedMember.name}</h3>
                {linkedMember.className && (
                  <span className="member-class-pill">{linkedMember.className}</span>
                )}
              </div>
              {isAssignedToSession ? (
                <span className={`status-badge status-${personalStatus}`}>
                  {STATUS_LABELS[personalStatus]}
                </span>
              ) : (
                <span className="session-type-tag">Not Assigned</span>
              )}
            </div>

            {isAssignedToSession && personalStatus === 'absent_with_reason' && (
              <div className="personal-attendance-reason">
                <strong>Absence Reason / Note:</strong>{' '}
                <span>{personalReason || 'No reason note recorded.'}</span>
              </div>
            )}

            <div className="personal-attendance-meta">
              <span className="mono-meta">
                {!isAssignedToSession
                  ? 'You are not assigned to this session’s roster.'
                  : personalEntry?.updatedAt
                    ? `Last updated: ${formatTimestamp(personalEntry.updatedAt)}`
                    : 'Attendance not yet marked for this session.'}
              </span>
              <span className="personal-attendance-hint">
                Read-only student view — attendance marks are managed by club administrators.
              </span>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="tracker-panel"
      aria-label="Attendance session workspace"
      data-tutorial-target="attendance-checklist"
    >
      <div className="tracker-panel-header">
        <div className="panel-title-group">
          <button
            type="button"
            className="btn-secondary btn-compact checklist-back-btn"
            onClick={onBackToHub}
            title="Return to Sessions Hub"
          >
            <PixelArrowLeftIcon />
            <span>All Sessions</span>
          </button>
          <h2 className="panel-title">Session Checklist</h2>
          <span className="panel-count">
            {filteredMembers.length} / {assignedMembers.length}
          </span>
        </div>

        <div className="panel-header-actions">
          {canEditSessionChecklist && onEditSession && (
            <button
              type="button"
              className="btn-secondary"
              disabled={!canManageClubRecords}
              onClick={() => onEditSession(activeSession)}
              title="Edit meeting details and visibility"
              aria-label={`Edit meeting settings for ${activeSession.name}`}
            >
              <PixelSettingsIcon />
              <span>Settings</span>
            </button>
          )}

          {canEditSessionChecklist && assignedMembers.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onResetSessionMarks}
              disabled={!hasAnyMarked || !canManageClubRecords}
              title={
                canManageClubRecords
                  ? 'Reset all assigned member statuses in this session to Unmarked'
                  : 'Admin privileges required to reset all session marks'
              }
            >
              <PixelRefreshIcon />
              <span>Reset Marks</span>
            </button>
          )}

          <div className="export-menu-wrap" ref={exportMenuRef}>
            <button
              type="button"
              className={`btn-secondary ${isExportMenuOpen ? 'is-active' : ''}`}
              aria-expanded={isExportMenuOpen}
              aria-haspopup="menu"
              onClick={() => setIsExportMenuOpen((prev) => !prev)}
              title="Export session attendance as CSV or printable report"
            >
              <PixelDownloadIcon />
              <span>Export</span>
              <PixelChevronIcon width={11} height={11} className="export-chevron-icon" />
            </button>

            {isExportMenuOpen && (
              <div className="export-menu-dropdown" role="menu" aria-label="Export session report">
                <button
                  type="button"
                  role="menuitem"
                  className="export-menu-item"
                  onClick={() => {
                    exportSessionAttendanceCsv(activeSession, members);
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
                    printSessionAttendanceReport(activeSession, members);
                    setIsExportMenuOpen(false);
                  }}
                >
                  <PixelPrinterIcon />
                  <span>Print / Save PDF Report</span>
                </button>
              </div>
            )}
          </div>

          {canEditSessionChecklist && (
            <button
              type="button"
              className="icon-btn icon-btn-danger"
              disabled={!canManageClubRecords}
              onClick={() => setPendingAction({ kind: 'session', session: activeSession })}
              title={
                canManageClubRecords
                  ? 'Delete current session'
                  : 'Admin privileges required to delete synced sessions'
              }
              aria-label={`Delete session ${activeSession.name}`}
            >
              <PixelTrashIcon />
              <span>Delete Session</span>
            </button>
          )}
        </div>
      </div>

      <div className="session-banner">
        <div className="session-banner-main">
          <div className="session-banner-title-row">
            <h3 className="session-banner-name">{activeSession.name}</h3>
            {activeSession.eventType && (
              <span className="session-type-tag">{activeSession.eventType}</span>
            )}
            <MeetingVisibilityBadge visibility={activeSession.visibility} />
          </div>
          {activeSession.description && (
            <p className="session-banner-description">{activeSession.description}</p>
          )}
        </div>

        <div className="session-meta-pills">
          <span className="session-meta-pill">
            <PixelCalendarIcon />
            <span>{formatSessionDate(activeSession.date)}</span>
          </span>
          <span className="session-meta-pill">
            <PixelClockIcon />
            <span>{formatSessionTime(activeSession.time)}</span>
          </span>
          {activeSession.location && (
            <span className="session-meta-pill">
              <PixelPinIcon />
              <span>{activeSession.location}</span>
            </span>
          )}
        </div>
      </div>

      {canEditSessionChecklist && (
        <div
          className="session-assign-bar"
          ref={suggestWrapRef}
          data-tutorial-target="attendance-assign-bar"
        >
        <div className="session-suggest-combobox">
          <span className="session-suggest-icon" aria-hidden="true">
            <PixelSearchIcon />
          </span>
          <input
            ref={suggestInputRef}
            type="text"
            role="combobox"
            aria-expanded={isSuggestOpen}
            aria-controls={suggestListboxId}
            aria-autocomplete="list"
            className="form-control session-suggest-input"
            placeholder={
              activeMembers.length === 0
                ? 'No active members in Member Manager — open Members to add or restore...'
                : 'Search active members by name, class, type, or role...'
            }
            value={suggestQuery}
            onFocus={() => setIsSuggestOpen(true)}
            onChange={(event) => {
              setSuggestQuery(event.target.value);
              setIsSuggestOpen(true);
            }}
            onKeyDown={handleSuggestKeyDown}
            aria-label="Search Member Manager directory to add member to session"
          />

          {suggestQuery.length > 0 && (
            <button
              type="button"
              className="session-suggest-clear"
              onClick={() => {
                setSuggestQuery('');
                suggestInputRef.current?.focus();
              }}
              aria-label="Clear member search"
            >
              <PixelCloseIcon width={11} height={11} />
            </button>
          )}

          {isSuggestOpen && (
            <div
              id={suggestListboxId}
              className="session-suggest-dropdown"
              role="listbox"
              aria-label="Member Manager suggestions"
            >
              {activeMembers.length === 0 ? (
                <div className="session-suggest-empty">
                  <span>
                    {members.length === 0
                      ? 'Your Member Manager directory is empty.'
                      : 'No active members available (all members are in Legacy / Retired).'}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => {
                      setIsSuggestOpen(false);
                      onOpenMemberManager();
                    }}
                  >
                    <PixelUsersIcon />
                    <span>Open Member Manager</span>
                  </button>
                </div>
              ) : availableSuggestions.length === 0 && alreadyAssignedSuggestions.length === 0 ? (
                <div className="session-suggest-empty">
                  <span>
                    {legacyMatchCount > 0
                      ? `No active match for “${suggestQuery.trim()}” (${legacyMatchCount} ${legacyMatchCount === 1 ? 'match' : 'matches'} in Legacy / Retired).`
                      : `No active member matching “${suggestQuery.trim()}” in Member Manager.`}
                  </span>
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => {
                      setIsSuggestOpen(false);
                      onOpenMemberManager();
                    }}
                  >
                    <PixelUsersIcon />
                    <span>Manage Members</span>
                  </button>
                </div>
              ) : (
                <>
                  {availableSuggestions.map((member, index) => {
                    const isHighlighted = index === highlightedIndex;
                    const memberType = normalizeMemberType(member.memberType);
                    return (
                      <button
                        key={member.id}
                        type="button"
                        role="option"
                        aria-selected={isHighlighted}
                        className={`session-suggest-option ${isHighlighted ? 'is-highlighted' : ''}`}
                        onMouseEnter={() => setHighlightedIndex(index)}
                        onClick={() => handleSelectSuggestion(member)}
                      >
                        <span className="session-suggest-avatar" aria-hidden="true">
                          {getMemberInitials(member.name)}
                        </span>
                        <span className="session-suggest-info">
                          <span className="session-suggest-name-row">
                            <span className="session-suggest-name">{member.name}</span>
                            {memberType !== 'student' && (
                              <span className={`member-type-pill is-${memberType}`}>
                                {MEMBER_TYPE_LABELS[memberType]}
                              </span>
                            )}
                            {member.className && (
                              <span className="member-class-pill">{member.className}</span>
                            )}
                          </span>
                          {(member.role || member.handle) && (
                            <span className="session-suggest-sub">
                              {[member.role, member.handle].filter(Boolean).join(' • ')}
                            </span>
                          )}
                        </span>
                        <span className="session-suggest-action">
                          <PixelPlusIcon width={11} height={11} />
                          <span>Add</span>
                        </span>
                      </button>
                    );
                  })}

                  {alreadyAssignedSuggestions.map((member) => {
                    const memberType = normalizeMemberType(member.memberType);
                    return (
                      <div
                        key={member.id}
                        className="session-suggest-option is-assigned"
                        aria-disabled="true"
                      >
                        <span className="session-suggest-avatar" aria-hidden="true">
                          {getMemberInitials(member.name)}
                        </span>
                        <span className="session-suggest-info">
                          <span className="session-suggest-name-row">
                            <span className="session-suggest-name">{member.name}</span>
                            {memberType !== 'student' && (
                              <span className={`member-type-pill is-${memberType}`}>
                                {MEMBER_TYPE_LABELS[memberType]}
                              </span>
                            )}
                            {member.className && (
                              <span className="member-class-pill">{member.className}</span>
                            )}
                          </span>
                          {member.role && <span className="session-suggest-sub">{member.role}</span>}
                        </span>
                        <span className="session-assigned-badge">In session</span>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>

        <div className="session-bulk-assign-controls">
          <button
            type="button"
            className="btn-secondary"
            disabled={unassignedMembers.length === 0}
            onClick={() => {
              onAssignMembersToSession(unassignedMembers.map((member) => member.id));
              setIsClassMenuOpen(false);
            }}
            title={
              unassignedMembers.length === 0
                ? 'All active members in the directory are already assigned'
                : `Assign all ${unassignedMembers.length} remaining directory members to this session`
            }
          >
            <PixelPlusIcon />
            <span>
              Add All Active Members
              {unassignedMembers.length > 0 ? ` (${unassignedMembers.length})` : ''}
            </span>
          </button>

          <div className="class-assign-wrap" ref={classMenuRef}>
            <button
              type="button"
              className={`btn-secondary ${isClassMenuOpen ? 'is-active' : ''}`}
              aria-expanded={isClassMenuOpen}
              aria-haspopup="menu"
              disabled={unassignedMembers.length === 0 || unassignedClassGroups.length === 0}
              onClick={() => setIsClassMenuOpen((prev) => !prev)}
              title={
                unassignedClassGroups.length === 0
                  ? 'No unassigned student members with a class assigned'
                  : 'Assign all unassigned students in a specific class'
              }
            >
              <PixelUsersIcon />
              <span>Add by Class</span>
              <PixelChevronIcon width={11} height={11} className="export-chevron-icon" />
            </button>

            {isClassMenuOpen && (
              <div
                className="class-assign-popover"
                role="menu"
                aria-label="Assign unassigned members by class"
              >
                <div className="class-assign-popover-header">
                  <span>Select Class to Add</span>
                </div>
                {unassignedClassGroups.length === 0 ? (
                  <div className="class-assign-empty">
                    All students with classes are already assigned.
                  </div>
                ) : (
                  <div className="class-assign-list">
                    {unassignedClassGroups.map((group) => (
                      <button
                        key={group.className}
                        type="button"
                        role="menuitem"
                        className="class-assign-item"
                        onClick={() => {
                          onAssignMembersToSession(group.memberIds);
                        }}
                      >
                        <span className="class-assign-name">{group.className}</span>
                        <span className="class-assign-count">+{group.memberIds.length}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn-secondary"
            onClick={onOpenMemberManager}
            title="Open central Member Manager directory"
          >
            <PixelUsersIcon />
            <span>Member Directory</span>
          </button>
        </div>
      </div>
      )}

      <div className="tracker-toolbar">
        <div
          className="filter-pills status-filter-pills"
          role="group"
          aria-label="Filter session checklist by attendance status"
        >
          {FILTER_OPTIONS.map((option) => {
            const isActive =
              option.value === 'all'
                ? isAllStatusesSelected
                : selectedStatusSet.has(option.value);
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={isActive}
                className={`filter-pill ${isActive ? 'is-active' : ''}`}
                title={
                  option.value === 'all'
                    ? 'Show all attendance statuses'
                    : isActive
                      ? `Hide ${option.label} members`
                      : `Show ${option.label} members`
                }
                onClick={() => {
                  if (option.value === 'all') {
                    handleSelectAllStatuses();
                  } else {
                    handleToggleStatusFilter(option.value);
                  }
                }}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <div className="toolbar-right">
          <div className="search-box">
            <span className="search-icon">
              <PixelSearchIcon />
            </span>
            <input
              type="search"
              className="search-input"
              placeholder="Filter by name, class, role..."
              value={searchQuery}
              onChange={(event) => onUpdatePreferences({ searchQuery: event.target.value })}
              aria-label="Filter assigned session members"
            />
          </div>

          <div className="view-toggle" role="group" aria-label="Workspace view mode">
            <button
              type="button"
              className={`view-btn ${viewMode === 'list' ? 'is-active' : ''}`}
              onClick={() => handleViewChange('list')}
            >
              <PixelListIcon />
              <span>List</span>
            </button>
            <button
              type="button"
              className={`view-btn ${viewMode === 'grid' ? 'is-active' : ''}`}
              onClick={() => handleViewChange('grid')}
            >
              <PixelGridIcon />
              <span>Grid</span>
            </button>
          </div>
        </div>
      </div>

      <div className="tracker-body">
        {filteredMembers.length === 0 ? (
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelTerminalIcon />
              <span>{assignedMembers.length === 0 ? 'Session Empty' : 'No Matches'}</span>
            </div>
            <h3 className="empty-title">
              {assignedMembers.length === 0
                ? canEditSessionChecklist
                  ? 'Assign members to this session'
                  : 'No members assigned yet'
                : 'No matching members in this session'}
            </h3>
            <p className="empty-description">
              {assignedMembers.length === 0
                ? !canEditSessionChecklist
                  ? 'No club members have been assigned to this session by an administrator yet.'
                  : activeMembers.length === 0
                    ? 'First add or restore active club members in the Member Manager, then search and click their names above to add them to this session.'
                    : 'Type an active member name in the search bar above and click a suggestion to add them to this session’s attendance checklist.'
                : 'Try clearing your search query or adjusting the active status filters.'}
            </p>
            {assignedMembers.length > 0 && (!isAllStatusesSelected || trimmedQuery.length > 0) && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() =>
                  onUpdatePreferences({
                    statusFilters: [],
                    searchQuery: '',
                  })
                }
              >
                <span>
                  {!isAllStatusesSelected && trimmedQuery.length > 0
                    ? 'Reset Filters'
                    : !isAllStatusesSelected
                      ? 'Show All Statuses'
                      : 'Clear Search'}
                </span>
              </button>
            )}
            {canEditSessionChecklist && assignedMembers.length === 0 && activeMembers.length === 0 && (
              <button type="button" className="btn-primary" onClick={onOpenMemberManager}>
                <PixelUsersIcon />
                <span>Open Member Manager</span>
              </button>
            )}
          </div>
        ) : viewMode === 'list' ? (
          <div className="roster-line-list" role="list" aria-label="Session attendance checklist">
            {filteredMembers.map((member) => {
              const entry = getEntry(member.id);
              const memberType = normalizeMemberType(member.memberType);

              return (
                <article key={member.id} className="roster-line-row" role="listitem">
                  <div className="roster-line-member">
                    <div className="roster-member-identity">
                      <button
                        type="button"
                        className="roster-member-name roster-member-profile-btn"
                        onClick={() => onOpenMemberProfile(member.id)}
                        title={`View ${member.name}'s profile & stats`}
                      >
                        {member.name}
                      </button>
                      {isLegacyMember(member) && (
                        <span className="member-legacy-pill" title="Legacy / Retired member">
                          Legacy
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
                      {member.role && <span className="member-role-pill">{member.role}</span>}
                      <span className={`status-badge status-${entry.status}`}>
                        {STATUS_LABELS[entry.status]}
                      </span>
                      <span className="roster-updated-meta mono-cell">
                        {formatTimestamp(entry.updatedAt)}
                      </span>
                    </div>
                  </div>

                  <div className="roster-line-controls">
                    {isReadOnlyBroadViewer ? (
                      <div className="personal-attendance-readonly-pill">
                        <span className={`status-badge status-${entry.status}`}>
                          {STATUS_LABELS[entry.status]}
                        </span>
                        {entry.status === 'absent_with_reason' && entry.reason && (
                          <span className="mono-meta">({entry.reason})</span>
                        )}
                      </div>
                    ) : (
                      <MemberAttendanceControls
                        sessionId={activeSession.id}
                        member={member}
                        entry={entry}
                        onToggleStatus={onToggleAttendanceStatus}
                        onReasonChange={onSetAbsenceReason}
                        onBeginFieldEdit={onBeginFieldEdit}
                        onEndFieldEdit={onEndFieldEdit}
                      />
                    )}
                  </div>

                  {canEditSessionChecklist && (
                    <div className="roster-line-manage">
                      <button
                        type="button"
                        className="icon-btn icon-btn-danger"
                        onClick={() => handleRequestRemoveMember(member)}
                        aria-label={`Remove ${member.name} from this session`}
                        title="Remove from this session"
                      >
                        <PixelCloseIcon width={12} height={12} />
                        <span>Remove</span>
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="block-grid">
            {filteredMembers.map((member) => {
              const entry = getEntry(member.id);
              const memberType = normalizeMemberType(member.memberType);

              return (
                <article key={member.id} className="block-card">
                  <div className="block-card-top">
                    <div className="block-card-top-left">
                      <span className={`status-badge status-${entry.status}`}>
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </div>
                    {canEditSessionChecklist && (
                      <div className="block-card-actions">
                        <button
                          type="button"
                          className="icon-btn icon-btn-danger"
                          onClick={() => handleRequestRemoveMember(member)}
                          aria-label={`Remove ${member.name} from this session`}
                          title="Remove from this session"
                        >
                          <PixelCloseIcon width={12} height={12} />
                        </button>
                      </div>
                    )}
                  </div>

                  <div className="block-card-identity">
                    <h3 className="block-card-title">
                      <button
                        type="button"
                        className="roster-member-profile-btn"
                        onClick={() => onOpenMemberProfile(member.id)}
                        title={`View ${member.name}'s profile & stats`}
                      >
                        {member.name}
                      </button>
                    </h3>
                    {isLegacyMember(member) && (
                      <span className="member-legacy-pill" title="Legacy / Retired member">
                        Legacy
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
                    {member.role && <span className="member-role-pill">{member.role}</span>}
                  </div>

                  {isReadOnlyBroadViewer ? (
                    entry.status === 'absent_with_reason' && entry.reason ? (
                      <p className="day-member-reason">Reason: {entry.reason}</p>
                    ) : null
                  ) : (
                    <MemberAttendanceControls
                      sessionId={activeSession.id}
                      member={member}
                      entry={entry}
                      compact
                      onToggleStatus={onToggleAttendanceStatus}
                      onReasonChange={onSetAbsenceReason}
                      onBeginFieldEdit={onBeginFieldEdit}
                      onEndFieldEdit={onEndFieldEdit}
                    />
                  )}

                  <div className="block-card-meta mono-cell">
                    {formatTimestamp(entry.updatedAt)}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {(() => {
        const dialogCopy =
          activePendingAction?.kind === 'session'
            ? {
                badgeLabel: 'Delete Session',
                title: `Delete "${activePendingAction.session.name}"?`,
                message: `Are you sure you want to permanently delete the session "${activePendingAction.session.name}" and all of its recorded attendance marks? This action cannot be undone.`,
                confirmLabel: 'Delete Session',
              }
            : activePendingAction?.kind === 'remove_from_session'
              ? {
                  badgeLabel: 'Remove from Session',
                  title: `Remove "${activePendingAction.member.name}" from this session?`,
                  message: `Remove "${activePendingAction.member.name}" from "${activeSession.name}"? Their attendance mark for this session will be cleared, while their Member Manager profile and other sessions remain intact.`,
                  confirmLabel: 'Remove Member',
                }
              : {
                  badgeLabel: 'Confirm',
                  title: '',
                  message: '',
                  confirmLabel: 'Confirm',
                };

        return (
          <ConfirmDialog
            isOpen={activePendingAction !== null}
            badgeLabel={dialogCopy.badgeLabel}
            title={dialogCopy.title}
            message={dialogCopy.message}
            confirmLabel={dialogCopy.confirmLabel}
            onConfirm={handleConfirmPendingAction}
            onCancel={() => setPendingAction(null)}
          />
        );
      })()}
    </section>
  );
}
