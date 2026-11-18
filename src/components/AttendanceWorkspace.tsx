import { useCallback, useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type {
  AttendanceSession,
  AttendanceStatus,
  ClubMember,
  FilterStatus,
  SessionAttendanceEntry,
  UserPreferences,
  ViewMode,
} from '../types/attendance';
import { STATUS_LABELS } from '../utils/attendance';
import { formatSessionDate, formatSessionTime, formatTimestamp } from '../utils/date';
import { ConfirmDialog } from './ConfirmDialog';
import {
  PixelCalendarIcon,
  PixelCheckIcon,
  PixelClockIcon,
  PixelEditIcon,
  PixelGridIcon,
  PixelListIcon,
  PixelPinIcon,
  PixelPlusIcon,
  PixelRefreshIcon,
  PixelSearchIcon,
  PixelTerminalIcon,
  PixelTrashIcon,
} from './PixelIcons';

interface AttendanceWorkspaceProps {
  sessions: AttendanceSession[];
  activeSession: AttendanceSession | null;
  members: ClubMember[];
  preferences: UserPreferences;
  onOpenCreateSession: () => void;
  onSelectSession: (sessionId: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onAddMember: (name: string) => void;
  onRenameMember: (memberId: string, nextName: string) => void;
  onDeleteMembers: (memberIds: string[]) => void;
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

interface DragSelectionState {
  startIndex: number;
  lastAppliedIndex: number;
  baseSelectedIds: Set<string>;
  action: 'select' | 'deselect';
  startedOnCheckbox: boolean;
  startMemberId: string;
  hasDraggedAcrossRows: boolean;
}

function isInteractiveChildTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest('button, input, select, textarea, a, form'));
}

function findMemberIndexAtPoint(
  container: HTMLElement | null,
  clientX: number,
  clientY: number,
  viewMode: ViewMode,
): number | null {
  if (!container) return null;
  const hitElement = document
    .elementFromPoint(clientX, clientY)
    ?.closest<HTMLElement>('[data-member-index]');
  if (hitElement && container.contains(hitElement)) {
    const parsed = Number(hitElement.dataset.memberIndex);
    if (!Number.isNaN(parsed)) return parsed;
  }

  const items = Array.from(container.querySelectorAll<HTMLElement>('[data-member-index]'));
  if (items.length === 0) return null;

  if (viewMode === 'list') {
    const firstRect = items[0].getBoundingClientRect();
    const firstIdx = Number(items[0].dataset.memberIndex);
    if (clientY < firstRect.top && !Number.isNaN(firstIdx)) return firstIdx;

    const lastItem = items[items.length - 1];
    const lastRect = lastItem.getBoundingClientRect();
    const lastIdx = Number(lastItem.dataset.memberIndex);
    if (clientY > lastRect.bottom && !Number.isNaN(lastIdx)) return lastIdx;

    let closestIndex: number | null = null;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const item of items) {
      const idx = Number(item.dataset.memberIndex);
      if (Number.isNaN(idx)) continue;
      const rect = item.getBoundingClientRect();
      if (clientY >= rect.top && clientY <= rect.bottom) {
        return idx;
      }
      const midY = (rect.top + rect.bottom) / 2;
      const distance = Math.abs(clientY - midY);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = idx;
      }
    }
    return closestIndex;
  }

  let closestIndex: number | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const item of items) {
    const idx = Number(item.dataset.memberIndex);
    if (Number.isNaN(idx)) continue;
    const rect = item.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      return idx;
    }
    const midX = (rect.left + rect.right) / 2;
    const midY = (rect.top + rect.bottom) / 2;
    const distance = Math.hypot(clientX - midX, clientY - midY);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = idx;
    }
  }
  return closestIndex;
}

function buildMembersDeleteDialogCopy(targetMembers: ClubMember[]): {
  badgeLabel: string;
  title: string;
  message: string;
  confirmLabel: string;
} {
  if (targetMembers.length === 1) {
    const [member] = targetMembers;
    return {
      badgeLabel: 'Delete Member',
      title: `Remove "${member.name}"?`,
      message: `Are you sure you want to permanently delete "${member.name}" from the locally saved Team SPIRIT roster? Their attendance marks across all saved sessions will also be removed.`,
      confirmLabel: 'Delete Member',
    };
  }

  const previewNames = targetMembers
    .slice(0, 4)
    .map((member) => member.name)
    .join(', ');
  const remainder = targetMembers.length - 4;
  const namesSummary =
    remainder > 0 ? `${previewNames}, and ${remainder} more` : previewNames;

  return {
    badgeLabel: 'Delete Members',
    title: `Delete ${targetMembers.length} selected members?`,
    message: `Are you sure you want to permanently delete ${targetMembers.length} selected members (${namesSummary}) from the locally saved Team SPIRIT roster? Their attendance marks across all saved sessions will also be removed.`,
    confirmLabel: `Delete ${targetMembers.length} Members`,
  };
}

/** Primary workspace housing session details, member management, and line-by-line attendance. */
export function AttendanceWorkspace({
  sessions,
  activeSession,
  members,
  preferences,
  onOpenCreateSession,
  onSelectSession,
  onDeleteSession,
  onAddMember,
  onRenameMember,
  onDeleteMembers,
  onToggleAttendanceStatus,
  onSetAbsenceReason,
  onResetSessionMarks,
  onUpdatePreferences,
}: AttendanceWorkspaceProps) {
  const [newMemberName, setNewMemberName] = useState('');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editingMemberName, setEditingMemberName] = useState('');
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [isDragSelecting, setIsDragSelecting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: 'members'; members: ClubMember[] }
    | { kind: 'session'; session: AttendanceSession }
    | null
  >(null);

  const rosterContainerRef = useRef<HTMLDivElement | null>(null);
  const selectAllRef = useRef<HTMLInputElement | null>(null);
  const filteredMembersRef = useRef<ClubMember[]>([]);
  const viewModeRef = useRef<ViewMode>(preferences.viewMode);
  const dragSessionRef = useRef<DragSelectionState | null>(null);
  const suppressCheckboxClickMemberIdRef = useRef<string | null>(null);

  const memberIdSet = new Set(members.map((member) => member.id));
  const selectionModeActive = isSelectionMode && members.length > 0;
  const validSelectedIds = selectionModeActive
    ? selectedMemberIds.filter((id) => memberIdSet.has(id))
    : [];
  const selectedSet = new Set(validSelectedIds);
  const selectedMembers = members.filter((member) => selectedSet.has(member.id));

  const activePendingDelete =
    pendingDelete?.kind === 'members'
      ? (() => {
          const remaining = pendingDelete.members.filter((member) =>
            memberIdSet.has(member.id),
          );
          return remaining.length > 0 ? { kind: 'members' as const, members: remaining } : null;
        })()
      : pendingDelete?.kind === 'session'
        ? sessions.some((session) => session.id === pendingDelete.session.id)
          ? pendingDelete
          : null
        : null;

  const { filter, viewMode, searchQuery } = preferences;
  const trimmedQuery = searchQuery.trim().toLowerCase();

  function getEntry(memberId: string): SessionAttendanceEntry {
    return (
      activeSession?.attendance[memberId] ?? {
        status: 'unmarked',
        updatedAt: '',
      }
    );
  }

  const filteredMembers = activeSession
    ? members.filter((member) => {
        const entry = getEntry(member.id);
        const matchesStatus = filter === 'all' || entry.status === filter;
        const matchesQuery =
          trimmedQuery.length === 0 || member.name.toLowerCase().includes(trimmedQuery);
        return matchesStatus && matchesQuery;
      })
    : [];

  filteredMembersRef.current = filteredMembers;
  viewModeRef.current = viewMode;

  const visibleSelectedCount = filteredMembers.filter((member) =>
    selectedSet.has(member.id),
  ).length;
  const allVisibleSelected =
    filteredMembers.length > 0 && visibleSelectedCount === filteredMembers.length;
  const someVisibleSelected = visibleSelectedCount > 0 && !allVisibleSelected;

  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = someVisibleSelected;
    }
  }, [someVisibleSelected]);

  const applyDragRange = useCallback(
    (startIndex: number, endIndex: number, baseIds: Set<string>, action: 'select' | 'deselect') => {
      const currentMembers = filteredMembersRef.current;
      const rangeStart = Math.max(0, Math.min(startIndex, endIndex));
      const rangeEnd = Math.min(currentMembers.length - 1, Math.max(startIndex, endIndex));
      const next = new Set(baseIds);

      for (let i = rangeStart; i <= rangeEnd; i += 1) {
        const id = currentMembers[i]?.id;
        if (!id) continue;
        if (action === 'select') {
          next.add(id);
        } else {
          next.delete(id);
        }
      }

      setSelectedMemberIds(Array.from(next));
    },
    [],
  );

  const endDragSelection = useCallback(() => {
    const activeDrag = dragSessionRef.current;
    if (!activeDrag) return;
    if (activeDrag.hasDraggedAcrossRows) {
      window.setTimeout(() => {
        suppressCheckboxClickMemberIdRef.current = null;
      }, 0);
    } else {
      suppressCheckboxClickMemberIdRef.current = null;
    }
    dragSessionRef.current = null;
    setIsDragSelecting(false);
  }, []);

  useEffect(() => {
    function handleWindowPointerMove(event: globalThis.PointerEvent) {
      const activeDrag = dragSessionRef.current;
      if (!activeDrag) return;

      const nextIndex = findMemberIndexAtPoint(
        rosterContainerRef.current,
        event.clientX,
        event.clientY,
        viewModeRef.current,
      );
      if (nextIndex === null) return;

      if (activeDrag.startedOnCheckbox && !activeDrag.hasDraggedAcrossRows) {
        if (nextIndex === activeDrag.startIndex) {
          return;
        }
        activeDrag.hasDraggedAcrossRows = true;
        suppressCheckboxClickMemberIdRef.current = activeDrag.startMemberId;
        setIsDragSelecting(true);
      }

      if (nextIndex !== activeDrag.lastAppliedIndex || !activeDrag.hasDraggedAcrossRows) {
        activeDrag.lastAppliedIndex = nextIndex;
        applyDragRange(
          activeDrag.startIndex,
          nextIndex,
          activeDrag.baseSelectedIds,
          activeDrag.action,
        );
      }
    }

    function handleWindowPointerUp() {
      endDragSelection();
    }

    window.addEventListener('pointermove', handleWindowPointerMove);
    window.addEventListener('pointerup', handleWindowPointerUp);
    window.addEventListener('pointercancel', handleWindowPointerUp);
    window.addEventListener('blur', handleWindowPointerUp);

    return () => {
      window.removeEventListener('pointermove', handleWindowPointerMove);
      window.removeEventListener('pointerup', handleWindowPointerUp);
      window.removeEventListener('pointercancel', handleWindowPointerUp);
      window.removeEventListener('blur', handleWindowPointerUp);
    };
  }, [applyDragRange, endDragSelection]);

  if (!activeSession) {
    return (
      <section className="tracker-panel" aria-label="Attendance session workspace">
        <div className="tracker-panel-header">
          <div className="panel-title-group">
            <h2 className="panel-title">Session Workspace</h2>
            <span className="sync-pill" title="Changes save automatically to local browser storage">
              <span className="sync-dot" aria-hidden="true" />
              Saved Locally
            </span>
          </div>
        </div>

        <div className="reserved-empty-state">
          <div className="empty-badge">
            <PixelTerminalIcon />
            <span>No Sessions Logged</span>
          </div>
          <h3 className="empty-title">Start your first Team SPIRIT session</h3>
          <p className="empty-description">
            Log a session with its date, time, and optional details to open the line-by-line member
            attendance roster. Every session and mark saves automatically on this device.
          </p>
          <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
            <PixelPlusIcon />
            <span>Log First Session</span>
          </button>
        </div>
      </section>
    );
  }

  const hasAnyMarked = members.some((member) => getEntry(member.id).status !== 'unmarked');

  function handleToggleSelectionMode() {
    if (selectionModeActive) {
      endDragSelection();
      setIsSelectionMode(false);
      setSelectedMemberIds([]);
    } else {
      setIsSelectionMode(true);
    }
  }

  function handleToggleMemberSelected(memberId: string) {
    if (suppressCheckboxClickMemberIdRef.current === memberId) {
      suppressCheckboxClickMemberIdRef.current = null;
      return;
    }
    setSelectedMemberIds((prev) => {
      const next = new Set(prev.filter((id) => memberIdSet.has(id)));
      if (next.has(memberId)) {
        next.delete(memberId);
      } else {
        next.add(memberId);
      }
      return Array.from(next);
    });
  }

  function handleToggleSelectAll() {
    if (filteredMembers.length === 0) return;
    setSelectedMemberIds((prev) => {
      const next = new Set(prev.filter((id) => memberIdSet.has(id)));
      if (allVisibleSelected) {
        for (const member of filteredMembers) {
          next.delete(member.id);
        }
      } else {
        for (const member of filteredMembers) {
          next.add(member.id);
        }
      }
      return Array.from(next);
    });
  }

  function handleClearSelection() {
    setSelectedMemberIds([]);
  }

  function handleMemberPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    member: ClubMember,
    index: number,
  ) {
    if (!selectionModeActive || event.button !== 0) return;
    const target = event.target;
    const startedOnCheckbox =
      target instanceof HTMLInputElement && target.dataset.selectionCheckbox === 'true';

    if (!startedOnCheckbox && isInteractiveChildTarget(target)) {
      return;
    }

    const baseSelectedIds = new Set(validSelectedIds);
    const action: 'select' | 'deselect' = baseSelectedIds.has(member.id) ? 'deselect' : 'select';

    dragSessionRef.current = {
      startIndex: index,
      lastAppliedIndex: index,
      baseSelectedIds,
      action,
      startedOnCheckbox,
      startMemberId: member.id,
      hasDraggedAcrossRows: false,
    };

    if (!startedOnCheckbox) {
      event.preventDefault();
      setIsDragSelecting(true);
      applyDragRange(index, index, baseSelectedIds, action);
    }
  }

  function handleAddSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = newMemberName.trim();
    if (!cleaned) return;
    onAddMember(cleaned);
    setNewMemberName('');
  }

  function handleStartEdit(member: ClubMember) {
    setEditingMemberId(member.id);
    setEditingMemberName(member.name);
  }

  function handleCancelEdit() {
    setEditingMemberId(null);
    setEditingMemberName('');
  }

  function handleSaveEdit(event: FormEvent<HTMLFormElement>, memberId: string) {
    event.preventDefault();
    const cleaned = editingMemberName.trim();
    if (!cleaned) return;
    onRenameMember(memberId, cleaned);
    setEditingMemberId(null);
    setEditingMemberName('');
  }

  function handleToggleStatus(
    memberId: string,
    target: Exclude<AttendanceStatus, 'unmarked'>,
  ) {
    onToggleAttendanceStatus(memberId, target);
  }

  function handleRequestDeleteMember(member: ClubMember) {
    setPendingDelete({ kind: 'members', members: [member] });
  }

  function handleRequestDeleteSelected() {
    if (selectedMembers.length === 0) return;
    setPendingDelete({ kind: 'members', members: selectedMembers });
  }

  function handleRequestDeleteSession(session: AttendanceSession) {
    setPendingDelete({ kind: 'session', session });
  }

  function handleCancelDelete() {
    setPendingDelete(null);
  }

  function handleConfirmDelete() {
    if (!activePendingDelete) return;
    if (activePendingDelete.kind === 'members') {
      const deletedIds = activePendingDelete.members.map((member) => member.id);
      const deletedIdSet = new Set(deletedIds);
      if (editingMemberId && deletedIdSet.has(editingMemberId)) {
        setEditingMemberId(null);
        setEditingMemberName('');
      }
      onDeleteMembers(deletedIds);
      setSelectedMemberIds((prev) => prev.filter((id) => !deletedIdSet.has(id)));
      if (members.length - deletedIds.length <= 0) {
        setIsSelectionMode(false);
      }
    } else {
      onDeleteSession(activePendingDelete.session.id);
    }
    setPendingDelete(null);
  }

  function handleViewChange(nextView: ViewMode) {
    onUpdatePreferences({ viewMode: nextView });
  }

  return (
    <section className="tracker-panel" aria-label="Attendance session workspace">
      <div className="tracker-panel-header">
        <div className="panel-title-group">
          <h2 className="panel-title">Attendance Roster</h2>
          <span className="panel-count">
            {filteredMembers.length} / {members.length}
          </span>
          <span className="sync-pill" title="Changes save automatically to local browser storage">
            <span className="sync-dot" aria-hidden="true" />
            Saved Locally
          </span>
        </div>

        <div className="panel-header-actions">
          {sessions.length > 1 && (
            <label className="session-select-wrap">
              <span className="sr-only">Switch active session</span>
              <select
                className="form-control session-select"
                value={activeSession.id}
                onChange={(event) => onSelectSession(event.target.value)}
                aria-label="Active session"
              >
                {sessions.map((session) => (
                  <option key={session.id} value={session.id}>
                    {session.name} ({session.date})
                  </option>
                ))}
              </select>
            </label>
          )}

          {members.length > 0 && (
            <button
              type="button"
              className="btn-secondary"
              onClick={onResetSessionMarks}
              disabled={!hasAnyMarked}
              title="Reset all member statuses in this session to Unmarked"
            >
              <PixelRefreshIcon />
              <span>Reset Marks</span>
            </button>
          )}

          <button
            type="button"
            className="icon-btn icon-btn-danger"
            onClick={() => handleRequestDeleteSession(activeSession)}
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

      <form className="add-member-bar" onSubmit={handleAddSubmit}>
        <div className="add-member-input-wrap">
          <input
            type="text"
            className="form-control add-member-input"
            placeholder="Add member name to roster (e.g. Alex Tan)..."
            value={newMemberName}
            onChange={(event) => setNewMemberName(event.target.value)}
            aria-label="New member name"
          />
        </div>
        <button
          type="submit"
          className="btn-primary"
          disabled={newMemberName.trim().length === 0}
        >
          <PixelPlusIcon />
          <span>Add Member</span>
        </button>
      </form>

      <div className="tracker-toolbar">
        <div className="filter-pills" role="tablist" aria-label="Filter roster by status">
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
          {members.length > 0 && (
            <button
              type="button"
              className={`btn-secondary btn-compact selection-toggle-btn ${
                selectionModeActive ? 'is-active' : ''
              }`}
              aria-pressed={selectionModeActive}
              onClick={handleToggleSelectionMode}
              title={
                selectionModeActive
                  ? 'Exit bulk selection mode'
                  : 'Select multiple members (click or drag across rows)'
              }
            >
              <PixelCheckIcon />
              <span>{selectionModeActive ? 'Done' : 'Select'}</span>
            </button>
          )}

          <div className="search-box">
            <span className="search-icon">
              <PixelSearchIcon />
            </span>
            <input
              type="search"
              className="search-input"
              placeholder="Search members..."
              value={searchQuery}
              onChange={(event) => onUpdatePreferences({ searchQuery: event.target.value })}
              aria-label="Search roster members"
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

      {selectionModeActive && (
        <div className="bulk-selection-bar" role="region" aria-label="Bulk selection controls">
          <div className="bulk-selection-left">
            <label className="select-all-label">
              <input
                ref={selectAllRef}
                type="checkbox"
                className="selection-checkbox"
                checked={allVisibleSelected}
                disabled={filteredMembers.length === 0}
                onChange={handleToggleSelectAll}
              />
              <span>Select All</span>
            </label>

            <span className="selection-count-pill">
              {selectedMembers.length} selected
            </span>

            <span className="selection-hint">
              Click or drag across rows to select
            </span>
          </div>

          <div className="bulk-selection-right">
            {selectedMembers.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn-secondary btn-compact"
                  onClick={handleClearSelection}
                >
                  Clear
                </button>
                <button
                  type="button"
                  className="btn-danger btn-compact"
                  onClick={handleRequestDeleteSelected}
                >
                  <PixelTrashIcon />
                  <span>Delete selected...</span>
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <div className="tracker-body">
        {filteredMembers.length === 0 ? (
          <div className="reserved-empty-state">
            <div className="empty-badge">
              <PixelTerminalIcon />
              <span>{members.length === 0 ? 'Roster Empty' : 'No Matches'}</span>
            </div>
            <h3 className="empty-title">
              {members.length === 0
                ? 'Add your first Team SPIRIT member'
                : 'No matching roster members'}
            </h3>
            <p className="empty-description">
              {members.length === 0
                ? 'Enter a member name above to build your line-by-line attendance list. All member names and marks save automatically on this device.'
                : 'Try clearing your search filter or selecting a different status tab.'}
            </p>
          </div>
        ) : viewMode === 'list' ? (
          <div
            ref={rosterContainerRef}
            className={`roster-line-list ${isDragSelecting ? 'is-drag-selecting' : ''}`}
            role="list"
            aria-label="Line-by-line attendance roster"
          >
            {filteredMembers.map((member, index) => {
              const entry = getEntry(member.id);
              const isEditing = editingMemberId === member.id;
              const isSelected = selectedSet.has(member.id);

              return (
                <article
                  key={member.id}
                  data-member-id={member.id}
                  data-member-index={index}
                  className={`roster-line-row ${
                    selectionModeActive ? 'is-selectable' : ''
                  } ${isSelected ? 'is-bulk-selected' : ''}`}
                  role="listitem"
                  onPointerDown={(event) => handleMemberPointerDown(event, member, index)}
                >
                  {selectionModeActive && (
                    <div className="roster-line-select">
                      <input
                        type="checkbox"
                        className="selection-checkbox"
                        data-selection-checkbox="true"
                        checked={isSelected}
                        onChange={() => handleToggleMemberSelected(member.id)}
                        aria-label={`Select ${member.name}`}
                      />
                    </div>
                  )}

                  <div className="roster-line-member">
                    {isEditing ? (
                      <form
                        className="inline-rename-form"
                        onSubmit={(event) => handleSaveEdit(event, member.id)}
                      >
                        <input
                          type="text"
                          className="form-control inline-rename-input"
                          value={editingMemberName}
                          onChange={(event) => setEditingMemberName(event.target.value)}
                          aria-label={`Rename ${member.name}`}
                          autoFocus
                        />
                        <button
                          type="submit"
                          className="btn-secondary btn-compact"
                          disabled={editingMemberName.trim().length === 0}
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          className="btn-secondary btn-compact"
                          onClick={handleCancelEdit}
                        >
                          Cancel
                        </button>
                      </form>
                    ) : (
                      <div className="roster-member-identity">
                        <span className="roster-member-name">{member.name}</span>
                        <span className={`status-badge status-${entry.status}`}>
                          {STATUS_LABELS[entry.status]}
                        </span>
                        <span className="roster-updated-meta mono-cell">
                          {formatTimestamp(entry.updatedAt)}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="roster-line-controls">
                    <MemberAttendanceControls
                      member={member}
                      entry={entry}
                      onToggleStatus={handleToggleStatus}
                      onReasonChange={onSetAbsenceReason}
                    />
                  </div>

                  <div className="roster-line-manage">
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => handleStartEdit(member)}
                      aria-label={`Edit ${member.name}`}
                      title="Rename member"
                    >
                      <PixelEditIcon />
                      <span>Edit</span>
                    </button>
                    <button
                      type="button"
                      className="icon-btn icon-btn-danger"
                      onClick={() => handleRequestDeleteMember(member)}
                      aria-label={`Delete ${member.name}`}
                      title="Delete member"
                    >
                      <PixelTrashIcon />
                      <span>Delete</span>
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div
            ref={rosterContainerRef}
            className={`block-grid ${isDragSelecting ? 'is-drag-selecting' : ''}`}
          >
            {filteredMembers.map((member, index) => {
              const entry = getEntry(member.id);
              const isEditing = editingMemberId === member.id;
              const isSelected = selectedSet.has(member.id);

              return (
                <article
                  key={member.id}
                  data-member-id={member.id}
                  data-member-index={index}
                  className={`block-card ${selectionModeActive ? 'is-selectable' : ''} ${
                    isSelected ? 'is-bulk-selected' : ''
                  }`}
                  onPointerDown={(event) => handleMemberPointerDown(event, member, index)}
                >
                  <div className="block-card-top">
                    <div className="block-card-top-left">
                      {selectionModeActive && (
                        <input
                          type="checkbox"
                          className="selection-checkbox"
                          data-selection-checkbox="true"
                          checked={isSelected}
                          onChange={() => handleToggleMemberSelected(member.id)}
                          aria-label={`Select ${member.name}`}
                        />
                      )}
                      <span className={`status-badge status-${entry.status}`}>
                        {STATUS_LABELS[entry.status]}
                      </span>
                    </div>
                    <div className="block-card-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => handleStartEdit(member)}
                        aria-label={`Edit ${member.name}`}
                        title="Rename member"
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

                  {isEditing ? (
                    <form
                      className="inline-rename-form"
                      onSubmit={(event) => handleSaveEdit(event, member.id)}
                    >
                      <input
                        type="text"
                        className="form-control inline-rename-input"
                        value={editingMemberName}
                        onChange={(event) => setEditingMemberName(event.target.value)}
                        aria-label={`Rename ${member.name}`}
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="btn-secondary btn-compact"
                        disabled={editingMemberName.trim().length === 0}
                      >
                        Save
                      </button>
                      <button
                        type="button"
                        className="btn-secondary btn-compact"
                        onClick={handleCancelEdit}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <h3 className="block-card-title">{member.name}</h3>
                  )}

                  <MemberAttendanceControls
                    member={member}
                    entry={entry}
                    compact
                    onToggleStatus={handleToggleStatus}
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
          activePendingDelete?.kind === 'session'
            ? {
                badgeLabel: 'Delete Session',
                title: `Delete "${activePendingDelete.session.name}"?`,
                message: `Are you sure you want to permanently delete the session "${activePendingDelete.session.name}" and all of its recorded attendance marks? This action cannot be undone.`,
                confirmLabel: 'Delete Session',
              }
            : activePendingDelete?.kind === 'members'
              ? buildMembersDeleteDialogCopy(activePendingDelete.members)
              : {
                  badgeLabel: 'Delete',
                  title: '',
                  message: '',
                  confirmLabel: 'Delete',
                };

        return (
          <ConfirmDialog
            isOpen={activePendingDelete !== null}
            badgeLabel={dialogCopy.badgeLabel}
            title={dialogCopy.title}
            message={dialogCopy.message}
            confirmLabel={dialogCopy.confirmLabel}
            onConfirm={handleConfirmDelete}
            onCancel={handleCancelDelete}
          />
        );
      })()}
    </section>
  );
}
