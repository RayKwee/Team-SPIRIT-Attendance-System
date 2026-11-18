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
  ClubMember,
  MemberProfileInput,
} from '../types/attendance';
import {
  STATUS_LABELS,
  getMemberInitials,
  summarizeMemberAttendance,
  type MemberAttendanceStats,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelArrowLeftIcon,
  PixelCalendarIcon,
  PixelCloseIcon,
  PixelEditIcon,
  PixelPlusIcon,
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
  onDeleteMember: (memberId: string) => void;
}

type SidebarViewMode = 'directory' | 'profile' | 'add' | 'edit';

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
    role: '',
    joinedDate: '',
    email: '',
    phone: '',
    handle: '',
    notes: '',
  };
}

function memberToFormValues(member: ClubMember): MemberFormValues {
  return {
    name: member.name,
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
  onDeleteMember,
}: MemberManagerSidebarProps) {
  const titleId = useId();
  const roleListId = useId();
  const nameInputId = useId();
  const roleInputId = useId();
  const joinedInputId = useId();
  const emailInputId = useId();
  const phoneInputId = useId();
  const handleInputId = useId();
  const notesInputId = useId();

  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [viewMode, setViewMode] = useState<SidebarViewMode>(() =>
    selectedMemberId && members.some((member) => member.id === selectedMemberId)
      ? 'profile'
      : 'directory',
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [formValues, setFormValues] = useState<MemberFormValues>(emptyFormValues);
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null);
  const [formError, setFormError] = useState('');
  const [absenceFilter, setAbsenceFilter] = useState<'reasons_only' | 'all'>('reasons_only');
  const [showAllAbsences, setShowAllAbsences] = useState(false);
  const [pendingDeleteMember, setPendingDeleteMember] = useState<ClubMember | null>(null);

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

  function handleSidebarKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && isOpen && !pendingDeleteMember) {
      event.stopPropagation();
      onClose();
    }
  }

  const distinctRoles = useMemo(() => {
    const roles = new Set<string>();
    for (const member of members) {
      if (member.role) roles.add(member.role);
    }
    return Array.from(roles).sort((a, b) => a.localeCompare(b));
  }, [members]);

  const memberStatsMap = useMemo(() => {
    const map = new Map<string, MemberAttendanceStats>();
    for (const member of members) {
      map.set(member.id, summarizeMemberAttendance(member.id, sessions));
    }
    return map;
  }, [members, sessions]);

  const filteredMembers = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return members.filter((member) => {
      const matchesRole =
        roleFilter === 'all' ||
        (roleFilter === '__unassigned__' ? !member.role : member.role === roleFilter);
      if (!matchesRole) return false;
      if (!query) return true;
      return [member.name, member.role, member.email, member.phone, member.handle]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });
  }, [members, roleFilter, searchQuery]);

  const activeProfileStats = selectedMember
    ? memberStatsMap.get(selectedMember.id) ?? summarizeMemberAttendance(selectedMember.id, sessions)
    : null;

  function openDirectory() {
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

  function openEditForm(member: ClubMember) {
    onSelectMember(member.id);
    setEditingTargetId(member.id);
    setFormValues(memberToFormValues(member));
    setFormError('');
    setViewMode('edit');
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

    const payload: MemberProfileInput = {
      name: cleanedName,
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
      onSelectMember(editingTargetId);
      setViewMode('profile');
    } else {
      const created = onAddMember(payload);
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
                  <span>Directory</span>
                </span>
                <span className="panel-count">{members.length}</span>
              </div>
              <h2 id={titleId} className="member-drawer-title">
                {viewMode === 'directory' && 'Member Manager'}
                {viewMode === 'profile' && (selectedMember?.name ?? 'Member Profile')}
                {viewMode === 'add' && 'Add Club Member'}
                {viewMode === 'edit' && 'Edit Member Profile'}
              </h2>
            </div>

            <div className="member-drawer-header-actions">
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
                <div className="member-directory-controls">
                  <div className="search-box member-search-box">
                    <span className="search-icon">
                      <PixelSearchIcon />
                    </span>
                    <input
                      type="search"
                      className="search-input member-search-input"
                      placeholder="Search name, role, contact..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      aria-label="Search member directory"
                    />
                  </div>

                  {members.length > 0 && (
                    <select
                      className="form-control member-role-filter"
                      value={roleFilter}
                      onChange={(event) => setRoleFilter(event.target.value)}
                      aria-label="Filter members by role"
                    >
                      <option value="all">All Roles</option>
                      {distinctRoles.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                      {members.some((member) => !member.role) && (
                        <option value="__unassigned__">No Role Set</option>
                      )}
                    </select>
                  )}
                </div>

                {filteredMembers.length === 0 ? (
                  <div className="reserved-empty-state member-empty-state">
                    <div className="empty-badge">
                      <PixelTerminalIcon />
                      <span>{members.length === 0 ? 'No Members' : 'No Matches'}</span>
                    </div>
                    <h3 className="empty-title">
                      {members.length === 0
                        ? 'Build your Team SPIRIT directory'
                        : 'No matching club members'}
                    </h3>
                    <p className="empty-description">
                      {members.length === 0
                        ? 'Add club members with optional role and contact details. Only a name is required.'
                        : 'Try clearing your search term or switching the role filter.'}
                    </p>
                    {members.length === 0 && (
                      <button type="button" className="btn-primary" onClick={openAddForm}>
                        <PixelPlusIcon />
                        <span>Add First Member</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <ul className="member-directory-list" aria-label="Club member directory">
                    {filteredMembers.map((member) => {
                      const stats = memberStatsMap.get(member.id);
                      const rateLabel =
                        stats && stats.markedRate !== null ? `${stats.markedRate}%` : '--%';

                      return (
                        <li key={member.id} className="member-directory-item">
                          <div
                            className="member-directory-row"
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
                    onClick={openDirectory}
                  >
                    <PixelArrowLeftIcon />
                    <span>All Members</span>
                  </button>

                  <div className="member-profile-topbar-actions">
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

                <section className="member-profile-card" aria-label="Member personal details">
                  <div className="member-profile-identity">
                    <div className="member-avatar-badge member-avatar-lg" aria-hidden="true">
                      {getMemberInitials(selectedMember.name)}
                    </div>
                    <div className="member-profile-heading">
                      <h3 className="member-profile-name">{selectedMember.name}</h3>
                      <div className="member-profile-badges">
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
                      </div>
                    </div>
                  </div>

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
                    <span>{viewMode === 'edit' ? 'Save Changes' : 'Add Member'}</span>
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
