import type { ReactNode } from 'react';
import type { AccessScope, RealtimeStatus, SyncStatus } from '../types/attendance';
import { getRouteHref, isUnmodifiedPrimaryClick, type AppPage } from '../utils/router';
import {
  PixelCalendarIcon,
  PixelHelpIcon,
  PixelListIcon,
  PixelPlusIcon,
  PixelShieldIcon,
  PixelTerminalIcon,
  PixelUserIcon,
  PixelUsersIcon,
} from './PixelIcons';

interface AttendanceToolsSectionProps {
  activeSubPage: 'tracker' | 'calendar';
  periodLabel: string;
  memberCount: number;
  isMemberSidebarOpen: boolean;
  isAccountsPanelOpen: boolean;
  accountsPanelId: string;
  accountsCount: number;
  isTutorialActive: boolean;
  sidebarId: string;
  isCloudConnected: boolean;
  accessScope: AccessScope;
  canBrowseFullRoster: boolean;
  isAdmin: boolean;
  syncStatus: SyncStatus;
  realtimeStatus: RealtimeStatus;
  pendingSyncCount: number;
  conflictCount: number;
  isEditingActive: boolean;
  syncError: string | null;
  onNavigate: (page: AppPage) => void;
  onRetrySync: () => void;
  onOpenConflictModal: () => void;
  onToggleMemberSidebar: () => void;
  onToggleAccountsPanel?: () => void;
  onStartTutorial: () => void;
  onOpenCreateSession: () => void;
  children: ReactNode;
}

function getSyncBadgeMeta(
  syncStatus: SyncStatus,
  pendingSyncCount: number,
  conflictCount: number,
  realtimeStatus: RealtimeStatus,
  isEditingActive: boolean,
  syncError?: string | null,
) {
  if (syncStatus === 'conflict' || conflictCount > 0) {
    return {
      tone: 'error',
      label: conflictCount > 0 ? `Conflict (${conflictCount})` : 'Conflict',
      title: 'Concurrent edits collided on the same field. Click to review and resolve.',
      interactive: true,
      action: 'conflict' as const,
    };
  }
  if (syncStatus === 'loading' || syncStatus === 'syncing') {
    return {
      tone: 'syncing',
      label: isEditingActive ? 'Saving draft...' : 'Syncing...',
      title: isEditingActive
        ? 'Waiting for active input before syncing changes'
        : 'Syncing changes with Supabase',
      interactive: false,
      action: 'none' as const,
    };
  }
  if (syncStatus === 'pending') {
    return {
      tone: 'pending',
      label: pendingSyncCount > 0 ? `Pending (${pendingSyncCount})` : 'Pending',
      title: syncError
        ? `Offline or delayed sync (${syncError}). Click to retry.`
        : 'Pending changes queued. Click to retry sync.',
      interactive: true,
      action: 'retry' as const,
    };
  }
  if (syncStatus === 'error') {
    return {
      tone: 'error',
      label: 'Sync Error',
      title: syncError ? `Sync error: ${syncError}. Click to retry.` : 'Sync failed. Click to retry.',
      interactive: true,
      action: 'retry' as const,
    };
  }
  if (syncStatus === 'reconnecting' || realtimeStatus === 'reconnecting') {
    return {
      tone: 'pending',
      label: 'Reconnecting...',
      title: 'Live channel reconnecting — 15s background sync remains active. Click to sync now.',
      interactive: true,
      action: 'retry' as const,
    };
  }
  return {
    tone: 'synced',
    label: realtimeStatus === 'connected' ? 'Live' : 'Synced',
    title:
      realtimeStatus === 'connected'
        ? 'Live multi-tab & Supabase Cloud Sync active'
        : 'All attendance data synced with Supabase',
    interactive: false,
    action: 'none' as const,
  };
}

/**
 * Dedicated isolated container for all technical attendance management tools:
 * Session Tracker, Attendance Checklist, Calendar, Member Manager, Admin Accounts, and Cloud Sync controls.
 */
export function AttendanceToolsSection({
  activeSubPage,
  periodLabel,
  memberCount,
  isMemberSidebarOpen,
  isAccountsPanelOpen,
  accountsPanelId,
  accountsCount,
  isTutorialActive,
  sidebarId,
  isCloudConnected,
  accessScope,
  canBrowseFullRoster,
  isAdmin,
  syncStatus,
  realtimeStatus,
  pendingSyncCount,
  conflictCount,
  isEditingActive,
  syncError,
  onNavigate,
  onRetrySync,
  onOpenConflictModal,
  onToggleMemberSidebar,
  onToggleAccountsPanel,
  onStartTutorial,
  onOpenCreateSession,
  children,
}: AttendanceToolsSectionProps) {
  const syncMeta = getSyncBadgeMeta(
    syncStatus,
    pendingSyncCount,
    conflictCount,
    realtimeStatus,
    isEditingActive,
    syncError,
  );

  const isPersonalProfileOnly =
    !canBrowseFullRoster && (accessScope === 'member_self' || accessScope === 'member_unlinked');

  return (
    <div className="attendance-tools-shell">
      <section className="attendance-tools-bar" aria-label="Attendance and club management tools">
        <div className="attendance-tools-left">
          <div className="attendance-tools-title-wrap">
            <span className="attendance-tools-kicker">
              <PixelTerminalIcon width={12} height={12} />
              <span>Attendance &amp; Ops Console</span>
            </span>
            <span className="attendance-tools-date">{periodLabel}</span>
          </div>

          <nav className="attendance-subnav" aria-label="Attendance section views">
            <a
              href={getRouteHref('tracker')}
              aria-current={activeSubPage === 'tracker' ? 'page' : undefined}
              className={`attendance-subnav-link ${activeSubPage === 'tracker' ? 'is-active' : ''}`}
              onClick={(event) => {
                if (!isUnmodifiedPrimaryClick(event)) return;
                event.preventDefault();
                onNavigate('tracker');
              }}
            >
              <PixelListIcon width={13} height={13} />
              <span>Sessions &amp; Tracker</span>
            </a>

            <a
              href={getRouteHref('calendar')}
              aria-current={activeSubPage === 'calendar' ? 'page' : undefined}
              className={`attendance-subnav-link ${activeSubPage === 'calendar' ? 'is-active' : ''}`}
              onClick={(event) => {
                if (!isUnmodifiedPrimaryClick(event)) return;
                event.preventDefault();
                onNavigate('calendar');
              }}
            >
              <PixelCalendarIcon width={13} height={13} />
              <span>Calendar</span>
            </a>
          </nav>
        </div>

        <div className="attendance-tools-actions">
          {isCloudConnected ? (
            syncMeta.interactive ? (
              <button
                type="button"
                className={`sync-status-pill is-${syncMeta.tone} is-clickable`}
                onClick={syncMeta.action === 'conflict' ? onOpenConflictModal : onRetrySync}
                title={syncMeta.title}
              >
                <span className="sync-status-dot" aria-hidden="true" />
                <span>{syncMeta.label}</span>
              </button>
            ) : (
              <div className={`sync-status-pill is-${syncMeta.tone}`} title={syncMeta.title}>
                <span className="sync-status-dot" aria-hidden="true" />
                <span>{syncMeta.label}</span>
              </div>
            )
          ) : (
            <span
              className="header-local-tag"
              title="Local-only mode: attendance records are stored on this device only until you sign in"
            >
              <span className="cloud-sync-dot" aria-hidden="true" />
              <span>Local</span>
            </span>
          )}

          {isCloudConnected && isAdmin && onToggleAccountsPanel && (
            <button
              type="button"
              className={`btn-secondary btn-compact accounts-nav-trigger ${
                isAccountsPanelOpen ? 'is-active' : ''
              }`}
              aria-expanded={isAccountsPanelOpen}
              aria-controls={accountsPanelId}
              onClick={onToggleAccountsPanel}
              title={
                isAccountsPanelOpen
                  ? 'Collapse Admin Accounts panel'
                  : 'Open Admin Accounts panel (promote, demote, unlink, or disable accounts)'
              }
            >
              <PixelShieldIcon />
              <span>Accounts</span>
              <span className="accounts-nav-count">{accountsCount}</span>
            </button>
          )}

          <button
            type="button"
            className={`btn-secondary btn-compact member-toggle-btn ${
              isMemberSidebarOpen ? 'is-active' : ''
            }`}
            aria-expanded={isMemberSidebarOpen}
            aria-controls={sidebarId}
            onClick={onToggleMemberSidebar}
            title={
              isPersonalProfileOnly
                ? isMemberSidebarOpen
                  ? 'Collapse My Profile drawer'
                  : 'Open My Profile & Attendance Summary'
                : isMemberSidebarOpen
                  ? 'Collapse Member Manager sidebar'
                  : 'Open Member Manager sidebar'
            }
          >
            {isPersonalProfileOnly ? (
              <>
                <PixelUserIcon />
                <span>My Profile</span>
              </>
            ) : (
              <>
                <PixelUsersIcon />
                <span>Members</span>
                <span className="member-count-badge">{memberCount}</span>
              </>
            )}
          </button>

          <button
            type="button"
            className={`btn-secondary btn-compact tutorial-trigger-btn ${
              isTutorialActive ? 'is-active' : ''
            }`}
            onClick={onStartTutorial}
            aria-pressed={isTutorialActive}
            aria-label="Start interactive tutorial walkthrough"
            title="Interactive Walkthrough — Step-by-step feature guide"
          >
            <PixelHelpIcon />
            <span className="tutorial-trigger-label">Tour</span>
          </button>

          {(accessScope === 'local' || accessScope === 'admin') && (
            <button
              type="button"
              className="btn-primary btn-compact-primary"
              onClick={onOpenCreateSession}
            >
              <PixelPlusIcon />
              <span>Record Session</span>
            </button>
          )}
        </div>
      </section>

      <div className="attendance-tools-body">{children}</div>
    </div>
  );
}
