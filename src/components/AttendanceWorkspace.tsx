import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type {
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
  getMemberInitials,
  getSessionAssignedMembers,
  normalizeMemberType,
} from '../utils/attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelArrowLeftIcon,
  PixelCalendarIcon,
  PixelClockIcon,
  PixelCloseIcon,
  PixelGridIcon,
  PixelListIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface AttendanceWorkspaceProps {
  activeSession: AttendanceSession;
  members: ClubMember[];
  preferences: UserPreferences;
  onBackToHub: () => void;
  onOpenMemberManager: () => void;
  onOpenMemberProfile: (memberId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onAssignMemberToSession: (memberId: string) => void;
  onRemoveMemberFromSession: (memberId: string) => void;
  onToggleAttendanceStatus: (
    memberId: string,
    targetStatus: Exclude<AttendanceStatus, 'unmarked'>,
  ) => void;
  onSetAbsenceReason: (memberId: string, reason: string) => void;
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
  member: ClubMember;
  entry: SessionAttendanceEntry;
  compact?: boolean;
  onToggleStatus: (memberId: string, target: Exclude<AttendanceStatus, 'unmarked'>) => void;
  onReasonChange: (memberId: string, reason: string) => void;
}

/** Shared status buttons and conditional reason field used across both list and grid layouts. */
function MemberAttendanceControls({
  member,
  entry,
  compact = false,
  onToggleStatus,
  onReasonChange,
}: MemberControlsProps) {
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
            value={entry.reason ?? ''}
            onChange={(event) => onReasonChange(member.id, event.target.value)}
          />
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
  onBackToHub,
  onOpenMemberManager,
  onOpenMemberProfile,
  onDeleteSession,
  onAssignMemberToSession,
  onRemoveMemberFromSession,
  onToggleAttendanceStatus,
  onSetAbsenceReason,
  onResetSessionMarks,
  onUpdatePreferences,
}: AttendanceWorkspaceProps) {
  const suggestListboxId = useId();
  const suggestWrapRef = useRef<HTMLDivElement | null>(null);
  const suggestInputRef = useRef<HTMLInputElement | null>(null);

  const [suggestQuery, setSuggestQuery] = useState('');
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<
    | { kind: 'session'; session: AttendanceSession }
    | { kind: 'remove_from_session'; member: ClubMember }
    | null
  >(null);

  useEffect(() => {
    function handleDocumentMouseDown(event: MouseEvent) {
      if (
        suggestWrapRef.current &&
        event.target instanceof Node &&
        !suggestWrapRef.current.contains(event.target)
      ) {
        setIsSuggestOpen(false);
      }
    }

    document.addEventListener('mousedown', handleDocumentMouseDown);
    return () => document.removeEventListener('mousedown', handleDocumentMouseDown);
  }, []);

  const assignedMembers = useMemo(
    () => getSessionAssignedMembers(activeSession, members),
    [activeSession, members],
  );

  const assignedMemberIdSet = useMemo(
    () => new Set(assignedMembers.map((member) => member.id)),
    [assignedMembers],
  );

  const { availableSuggestions, alreadyAssignedSuggestions } = useMemo(() => {
    const query = suggestQuery.trim().toLowerCase();
    const matches = members.filter((member) => {
      if (!query) return true;
      const memberType = normalizeMemberType(member.memberType);
      return [
        member.name,
        memberType === 'student' ? member.className : undefined,
        MEMBER_TYPE_LABELS[memberType],
        member.role,
        member.handle,
      ]
        .filter((value): value is string => Boolean(value))
        .some((value) => value.toLowerCase().includes(query));
    });

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
    };
  }, [assignedMemberIdSet, members, suggestQuery]);

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

  const { filter, viewMode, searchQuery, confirmSessionMemberRemoval } = preferences;
  const trimmedQuery = searchQuery.trim().toLowerCase();

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
    const matchesStatus = filter === 'all' || entry.status === filter;
    const memberType = normalizeMemberType(member.memberType);
    const matchesQuery =
      trimmedQuery.length === 0 ||
      member.name.toLowerCase().includes(trimmedQuery) ||
      (memberType === 'student' && Boolean(member.className?.toLowerCase().includes(trimmedQuery))) ||
      MEMBER_TYPE_LABELS[memberType].toLowerCase().includes(trimmedQuery) ||
      Boolean(member.role?.toLowerCase().includes(trimmedQuery));
    return matchesStatus && matchesQuery;
  });

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

  return (
    <section className="tracker-panel" aria-label="Attendance session workspace">
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
          {assignedMembers.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onResetSessionMarks}
              disabled={!hasAnyMarked}
              title="Reset all assigned member statuses in this session to Unmarked"
            >
              <PixelRefreshIcon />
              <span>Reset Marks</span>
            </button>
          )}

          <button
            type="button"
            className="icon-btn icon-btn-danger"
            onClick={() => setPendingAction({ kind: 'session', session: activeSession })}
            title="Delete current session"
            aria-label={`Delete session ${activeSession.name}`}
          >
            <PixelTrashIcon />
            <span>Delete Session</span>
          </button>
        </div>
      </div>

      <div className="session-banner">
        <div className="session-banner-main">
          <div className="session-banner-title-row">
            <h3 className="session-banner-name">{activeSession.name}</h3>
            {activeSession.eventType && (
              <span className="session-type-tag">{activeSession.eventType}</span>
            )}
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

      <div className="session-assign-bar" ref={suggestWrapRef}>
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
              members.length === 0
                ? 'No members in Member Manager yet — open Members to create them...'
                : 'Search by name, class, type, or role to add member...'
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
              {members.length === 0 ? (
                <div className="session-suggest-empty">
                  <span>Your Member Manager directory is empty.</span>
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
                  <span>No member matching &ldquo;{suggestQuery.trim()}&rdquo; in Member Manager.</span>
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
                            {memberType === 'student'
                              ? member.className && (
                                  <span className="member-class-pill">{member.className}</span>
                                )
                              : (
                                  <span className={`member-type-pill is-${memberType}`}>
                                    {MEMBER_TYPE_LABELS[memberType]}
                                  </span>
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
                            {memberType === 'student'
                              ? member.className && (
                                  <span className="member-class-pill">{member.className}</span>
                                )
                              : (
                                  <span className={`member-type-pill is-${memberType}`}>
                                    {MEMBER_TYPE_LABELS[memberType]}
                                  </span>
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

      <div className="tracker-toolbar">
        <div className="filter-pills" role="tablist" aria-label="Filter session checklist by status">
          {FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={filter === option.value}
              className={`filter-pill ${filter === option.value ? 'is-active' : ''}`}
              onClick={() => onUpdatePreferences({ filter: option.value })}
            >
              {option.label}
            </button>
          ))}
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
                ? 'Assign members to this session'
                : 'No matching members in this session'}
            </h3>
            <p className="empty-description">
              {assignedMembers.length === 0
                ? members.length === 0
                  ? 'First add club members in the Member Manager, then search and click their names above to add them to this session.'
                  : 'Type a member name in the search bar above and click a suggestion to add them to this session’s attendance checklist.'
                : 'Try clearing your checklist filter or switching the status tab.'}
            </p>
            {assignedMembers.length === 0 && members.length === 0 && (
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
                    <MemberAttendanceControls
                      member={member}
                      entry={entry}
                      onToggleStatus={onToggleAttendanceStatus}
                      onReasonChange={onSetAbsenceReason}
                    />
                  </div>

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
                    {member.role && <span className="member-role-pill">{member.role}</span>}
                  </div>

                  <MemberAttendanceControls
                    member={member}
                    entry={entry}
                    compact
                    onToggleStatus={onToggleAttendanceStatus}
                    onReasonChange={onSetAbsenceReason}
                  />

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
