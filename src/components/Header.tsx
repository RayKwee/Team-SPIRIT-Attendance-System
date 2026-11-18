import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import type { SyncStatus } from '../types/attendance';
import { getRouteHref, isUnmodifiedPrimaryClick, type AppPage } from '../utils/router';
import {
  PixelCalendarIcon,
  PixelChevronIcon,
  PixelListIcon,
  PixelLogOutIcon,
  PixelPlusIcon,
  PixelSettingsIcon,
  PixelUsersIcon,
} from './PixelIcons';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

export type ActivePage = AppPage;

interface HeaderProps {
  activePage: ActivePage;
  periodLabel: string;
  memberCount: number;
  isMemberSidebarOpen: boolean;
  sidebarId?: string;
  isCloudConnected: boolean;
  userEmail?: string;
  syncStatus?: SyncStatus;
  pendingSyncCount?: number;
  syncError?: string | null;
  onNavigate: (page: ActivePage) => void;
  onRetrySync?: () => void;
  onOpenCloudSync: () => void;
  onDisconnectCloudSync: () => void;
  onToggleMemberSidebar: () => void;
  onOpenSettings: () => void;
  onOpenCreateSession: () => void;
}

const NAV_LINKS: { page: ActivePage; label: string }[] = [
  { page: 'tracker', label: 'Attendance Tracker' },
  { page: 'calendar', label: 'Calendar' },
];

function getSyncBadgeMeta(
  syncStatus: SyncStatus,
  pendingSyncCount: number,
  syncError?: string | null,
) {
  if (syncStatus === 'loading' || syncStatus === 'syncing') {
    return {
      tone: 'syncing',
      label: 'Syncing...',
      title: 'Syncing changes with Supabase',
      interactive: false,
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
    };
  }
  if (syncStatus === 'error') {
    return {
      tone: 'error',
      label: 'Sync Error',
      title: syncError ? `Sync error: ${syncError}. Click to retry.` : 'Sync failed. Click to retry.',
      interactive: true,
    };
  }
  return {
    tone: 'synced',
    label: 'Synced',
    title: 'All attendance data synced with Supabase',
    interactive: false,
  };
}

/** Top utility header displaying Team SPIRIT branding, page navigation, sync status, and session actions. */
export function Header({
  activePage,
  periodLabel,
  memberCount,
  isMemberSidebarOpen,
  sidebarId,
  isCloudConnected,
  userEmail,
  syncStatus = 'local',
  pendingSyncCount = 0,
  syncError,
  onNavigate,
  onRetrySync,
  onOpenCloudSync,
  onDisconnectCloudSync,
  onToggleMemberSidebar,
  onOpenSettings,
  onOpenCreateSession,
}: HeaderProps) {
  const syncMeta = getSyncBadgeMeta(syncStatus, pendingSyncCount, syncError);

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

      <nav className="header-nav" aria-label="Primary navigation">
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
                if (!isCurrent) {
                  onNavigate(link.page);
                }
              }}
            >
              {link.page === 'tracker' ? <PixelListIcon /> : <PixelCalendarIcon />}
              <span>{link.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="header-controls">
        {isCloudConnected ? (
          <>
            {syncMeta.interactive && onRetrySync ? (
              <button
                type="button"
                className={`sync-status-pill is-${syncMeta.tone} is-clickable`}
                onClick={onRetrySync}
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
              className="cloud-sync-toggle is-connected"
              onClick={onDisconnectCloudSync}
              aria-pressed={true}
              title={
                userEmail
                  ? `Cloud sync active (${userEmail}) — Click to sign out and return to local-only mode`
                  : 'Cloud sync active — Click to sign out and return to local-only mode'
              }
              aria-label="Disconnect Supabase Cloud Sync"
            >
              <span className="cloud-sync-dot" aria-hidden="true" />
              <span className="cloud-sync-label">Cloud Sync</span>
              <span className="cloud-sync-switch" aria-hidden="true">
                <span className="cloud-sync-knob" />
              </span>
              <PixelLogOutIcon />
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
            isMemberSidebarOpen
              ? 'Collapse Member Manager sidebar'
              : 'Open Member Manager sidebar'
          }
        >
          <PixelUsersIcon />
          <span>Members</span>
          <span className="member-count-badge">{memberCount}</span>
        </button>

        <button
          type="button"
          className="btn-secondary settings-icon-btn"
          onClick={onOpenSettings}
          aria-label="Open workspace settings"
          title="Workspace settings"
        >
          <PixelSettingsIcon />
        </button>

        <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
          <PixelPlusIcon />
          <span>Record Session</span>
        </button>
      </div>
    </header>
  );
}
