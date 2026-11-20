import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import type { AccessScope, RealtimeStatus, SyncStatus } from '../types/attendance';
import { getRouteHref, isUnmodifiedPrimaryClick, type AppPage } from '../utils/router';
import {
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelHelpIcon,
  PixelIdeaIcon,
  PixelListIcon,
  PixelPlusIcon,
  PixelSettingsIcon,
  PixelUserIcon,
  PixelUsersIcon,
} from './PixelIcons';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

export type ActivePage = AppPage;

interface HeaderProps {
  activePage: ActivePage;
  periodLabel: string;
  memberCount: number;
  isMemberSidebarOpen: boolean;
  isTutorialActive?: boolean;
  sidebarId?: string;
  isCloudConnected: boolean;
  accessScope?: AccessScope;
  canBrowseFullRoster?: boolean;
  isAdmin?: boolean;
  isRoleLoading?: boolean;
  userEmail?: string;
  linkedMemberName?: string;
  syncStatus?: SyncStatus;
  realtimeStatus?: RealtimeStatus;
  pendingSyncCount?: number;
  conflictCount?: number;
  isEditingActive?: boolean;
  syncError?: string | null;
  onNavigate: (page: ActivePage) => void;
  onRetrySync?: () => void;
  onOpenConflictModal?: () => void;
  onOpenCloudSync: () => void;
  onToggleMemberSidebar: () => void;
  onStartTutorial: () => void;
  onOpenSettings: () => void;
  onOpenCreateSession: () => void;
}

const NAV_LINKS: { page: ActivePage; label: string }[] = [
  { page: 'tracker', label: 'Attendance Tracker' },
  { page: 'calendar', label: 'Calendar' },
  { page: 'ideas', label: 'Updates & Ideas' },
];

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

/** Top utility header displaying Team SPIRIT branding, page navigation, sync status, and session actions. */
export function Header({
  activePage,
  periodLabel,
  memberCount,
  isMemberSidebarOpen,
  isTutorialActive = false,
  sidebarId,
  isCloudConnected,
  accessScope = 'local',
  canBrowseFullRoster = true,
  isAdmin = false,
  isRoleLoading = false,
  userEmail,
  linkedMemberName,
  syncStatus = 'local',
  realtimeStatus = 'disconnected',
  pendingSyncCount = 0,
  conflictCount = 0,
  isEditingActive = false,
  syncError,
  onNavigate,
  onRetrySync,
  onOpenConflictModal,
  onOpenCloudSync,
  onToggleMemberSidebar,
  onStartTutorial,
  onOpenSettings,
  onOpenCreateSession,
}: HeaderProps) {
  const syncMeta = getSyncBadgeMeta(
    syncStatus,
    pendingSyncCount,
    conflictCount,
    realtimeStatus,
    isEditingActive,
    syncError,
  );

  return (
    <header className="header-bar">
      <div className="brand-group">
        <img
          src={teamSpiritEmblem}
          alt=""
          aria-hidden="true"
          className="brand-emblem"
          width={44}
          height={44}
        />

        <div className="brand-text">
          <div className="brand-title-row">
            <h1 className="club-title">
              <span className="sr-only">Team SPIRIT</span>
              <TeamSpiritWordmark className="wordmark-svg" />
            </h1>
            <span className="hud-tag">
              <PixelChevronIcon width={11} height={11} />
              Attendance
            </span>
          </div>
          <p className="brand-subtitle">Personal club roster &amp; attendance tracker</p>
        </div>
      </div>

      <nav
        className="header-nav"
        aria-label="Primary navigation"
        data-tutorial-target="header-nav"
      >
        {NAV_LINKS.map((link) => {
          const isCurrent = activePage === link.page;
          const href = getRouteHref(link.page);
          return (
            <a
              key={link.page}
              href={href}
              aria-current={isCurrent ? 'page' : undefined}
              className={`nav-link ${isCurrent ? 'is-active' : ''}`}
              onClick={(event) => {
                if (!isUnmodifiedPrimaryClick(event)) return;
                event.preventDefault();
                onNavigate(link.page);
              }}
            >
              {link.page === 'tracker' ? (
                <PixelListIcon />
              ) : link.page === 'calendar' ? (
                <PixelCalendarIcon />
              ) : (
                <PixelIdeaIcon />
              )}
              <span>{link.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="header-controls">
        {isCloudConnected ? (
          <>
            {syncMeta.interactive &&
            (syncMeta.action === 'conflict' ? onOpenConflictModal : onRetrySync) ? (
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
            )}

            <button
              type="button"
              className="account-status-badge"
              onClick={onOpenSettings}
              title={
                userEmail
                  ? `Signed in to Supabase as ${userEmail} — Click to open Account & Settings`
                  : 'Signed in to Supabase Cloud Sync — Click to open Account & Settings'
              }
              aria-label={
                userEmail
                  ? `Signed in as ${userEmail}. Open account settings`
                  : 'Signed in to Supabase. Open account settings'
              }
            >
              <span className="account-status-dot" aria-hidden="true" />
              <PixelUserIcon className="account-status-icon" />
              <span className="account-status-email">
                {linkedMemberName || userEmail || 'Signed In'}
              </span>
              {!isRoleLoading && (
                <span
                  className={`account-role-tag ${
                    isAdmin
                      ? 'is-admin'
                      : accessScope === 'broad_viewer'
                        ? 'is-viewer'
                        : 'is-member'
                  }`}
                >
                  {isAdmin ? 'Admin' : accessScope === 'broad_viewer' ? 'Viewer' : 'Member'}
                </span>
              )}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="cloud-sync-toggle is-local"
            onClick={onOpenCloudSync}
            aria-pressed={false}
            title="Local-only mode: data is stored on this device only at your own risk. Click to sign in and enable Supabase Cloud Sync."
          >
            <span className="cloud-sync-dot" aria-hidden="true" />
            <span className="cloud-sync-label">Local Only</span>
            <span className="cloud-sync-switch" aria-hidden="true">
              <span className="cloud-sync-knob" />
            </span>
            <span className="cloud-sync-action">Cloud Sync</span>
          </button>
        )}

        <div className="period-pill" title="Current date">
          <PixelCalendarIcon />
          <span>{periodLabel}</span>
        </div>

        <button
          type="button"
          className={`btn-secondary member-toggle-btn ${isMemberSidebarOpen ? 'is-active' : ''}`}
          aria-expanded={isMemberSidebarOpen}
          aria-controls={sidebarId}
          onClick={onToggleMemberSidebar}
          title={
            !canBrowseFullRoster &&
            (accessScope === 'member_self' || accessScope === 'member_unlinked')
              ? isMemberSidebarOpen
                ? 'Collapse My Profile drawer'
                : 'Open My Profile & Attendance Summary'
              : isMemberSidebarOpen
                ? 'Collapse Member Manager sidebar'
                : 'Open Member Manager sidebar'
          }
        >
          {!canBrowseFullRoster &&
          (accessScope === 'member_self' || accessScope === 'member_unlinked') ? (
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
          className={`btn-secondary tutorial-trigger-btn ${isTutorialActive ? 'is-active' : ''}`}
          onClick={onStartTutorial}
          aria-pressed={isTutorialActive}
          aria-label="Start interactive tutorial walkthrough"
          title="Interactive Tutorial Mode — Step-by-step feature guide"
        >
          <PixelHelpIcon />
          <span className="tutorial-trigger-label">Tour</span>
        </button>

        <button
          type="button"
          className="btn-secondary settings-icon-btn"
          data-tutorial-target="header-settings"
          onClick={onOpenSettings}
          aria-label="Open workspace settings"
          title="Workspace settings"
        >
          <PixelSettingsIcon />
        </button>

        {(accessScope === 'local' || accessScope === 'admin') && (
          <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
            <PixelPlusIcon />
            <span>Record Session</span>
          </button>
        )}
      </div>
    </header>
  );
}
