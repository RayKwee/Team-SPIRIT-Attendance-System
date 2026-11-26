import teamSpiritEmblem from '../assets/team-spirit-emblem.png';
import type { AccessScope, SyncStatus } from '../types/attendance';
import {
  getRouteHref,
  isAttendancePage,
  isUnmodifiedPrimaryClick,
  type AppPage,
} from '../utils/router';
import {
  PixelGamepadIcon,
  PixelIdeaIcon,
  PixelLockIcon,
  PixelLoungeIcon,
  PixelSettingsIcon,
  PixelToolsIcon,
  PixelUserIcon,
} from './PixelIcons';
import { TeamSpiritWordmark } from './TeamSpiritWordmark';

export type ActivePage = AppPage;

interface HeaderProps {
  activePage: ActivePage;
  isCloudConnected: boolean;
  accessScope?: AccessScope;
  isAdmin?: boolean;
  isRoleLoading?: boolean;
  userEmail?: string;
  linkedMemberName?: string;
  syncStatus?: SyncStatus;
  conflictCount?: number;
  syncError?: string | null;
  onNavigate: (page: ActivePage) => void;
  onRetrySync?: () => void;
  onOpenConflictModal?: () => void;
  onOpenCloudSync: () => void;
  onOpenSettings: () => void;
}

const PRIMARY_NAV_ITEMS: {
  page: ActivePage;
  label: string;
  description: string;
  isTools?: boolean;
}[] = [
  {
    page: 'lounge',
    label: 'Lounge',
    description: 'Announcements & casual student chat',
  },
  {
    page: 'games',
    label: 'Games',
    description: 'Play arcade games & climb the club leaderboards',
  },
  {
    page: 'ideas',
    label: 'Ideas',
    description: 'Pitch & browse club project ideas',
  },
  {
    page: 'tracker',
    label: 'Attendance',
    description: 'Dedicated attendance tracker, calendar & club tools',
    isTools: true,
  },
];

/**
 * Decluttered Team SPIRIT top navigation bar prioritizing the student hangout space
 * while keeping attendance management cleanly tucked into its own dedicated section.
 */
export function Header({
  activePage,
  isCloudConnected,
  accessScope = 'local',
  isAdmin = false,
  isRoleLoading = false,
  userEmail,
  linkedMemberName,
  syncStatus = 'local',
  conflictCount = 0,
  syncError,
  onNavigate,
  onRetrySync,
  onOpenConflictModal,
  onOpenCloudSync,
  onOpenSettings,
}: HeaderProps) {
  const inAttendanceSection = isAttendancePage(activePage);
  const hasConflictAlert = isCloudConnected && (syncStatus === 'conflict' || conflictCount > 0);
  const hasSyncErrorAlert = isCloudConnected && !hasConflictAlert && syncStatus === 'error';

  return (
    <header className={`header-bar ${inAttendanceSection ? 'is-tools-mode' : 'is-hangout-mode'}`}>
      <a
        href={getRouteHref('landing')}
        className="brand-group brand-home-link"
        title="Return to Team SPIRIT landing screen"
        onClick={(event) => {
          if (!isUnmodifiedPrimaryClick(event)) return;
          event.preventDefault();
          onNavigate('landing');
        }}
      >
        <img
          src={teamSpiritEmblem}
          alt=""
          aria-hidden="true"
          className="brand-emblem"
          width={40}
          height={40}
        />

        <div className="brand-text">
          <div className="brand-title-row">
            <h1 className="club-title">
              <span className="sr-only">Team SPIRIT</span>
              <TeamSpiritWordmark className="wordmark-svg" />
            </h1>
          </div>
          <p className="brand-subtitle">
            {inAttendanceSection ? 'Attendance & club ops tools' : 'Student hangout & club space'}
          </p>
        </div>
      </a>

      <nav
        className="header-nav"
        aria-label="Primary navigation"
        data-tutorial-target="header-nav"
      >
        {PRIMARY_NAV_ITEMS.map((item) => {
          const isCurrent = item.isTools ? inAttendanceSection : activePage === item.page;
          const href = getRouteHref(item.page);
          return (
            <a
              key={item.page}
              href={href}
              aria-current={isCurrent ? 'page' : undefined}
              title={item.description}
              className={`nav-link ${isCurrent ? 'is-active' : ''} ${
                item.isTools ? 'is-tools-link' : ''
              }`}
              onClick={(event) => {
                if (!isUnmodifiedPrimaryClick(event)) return;
                event.preventDefault();
                onNavigate(item.page);
              }}
            >
              {item.page === 'lounge' ? (
                <PixelLoungeIcon />
              ) : item.page === 'games' ? (
                <PixelGamepadIcon />
              ) : item.page === 'ideas' ? (
                <PixelIdeaIcon />
              ) : (
                <PixelToolsIcon />
              )}
              <span>{item.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="header-controls">
        {hasConflictAlert && onOpenConflictModal && (
          <button
            type="button"
            className="sync-status-pill is-error is-clickable"
            onClick={onOpenConflictModal}
            title="Concurrent edits collided on the same field. Click to resolve."
          >
            <span className="sync-status-dot" aria-hidden="true" />
            <span>{conflictCount > 0 ? `Conflict (${conflictCount})` : 'Conflict'}</span>
          </button>
        )}

        {hasSyncErrorAlert && onRetrySync && (
          <button
            type="button"
            className="sync-status-pill is-error is-clickable"
            onClick={onRetrySync}
            title={syncError ? `Sync error: ${syncError}. Click to retry.` : 'Sync failed. Click to retry.'}
          >
            <span className="sync-status-dot" aria-hidden="true" />
            <span>Sync Issue</span>
          </button>
        )}

        {isCloudConnected ? (
          <button
            type="button"
            className="account-status-badge"
            onClick={onOpenSettings}
            title={
              userEmail
                ? `Signed in as ${userEmail} — Open Account & Settings`
                : 'Signed in — Open Account & Settings'
            }
            aria-label={
              userEmail
                ? `Signed in as ${userEmail}. Open account settings`
                : 'Signed in. Open account settings'
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
        ) : (
          <button
            type="button"
            className="btn-secondary header-signin-btn"
            onClick={onOpenCloudSync}
            title="Sign in or create a Team SPIRIT club account"
          >
            <PixelLockIcon width={12} height={12} />
            <span>Sign In</span>
          </button>
        )}

        <button
          type="button"
          className="btn-secondary settings-icon-btn"
          data-tutorial-target="header-settings"
          onClick={onOpenSettings}
          aria-label="Open workspace settings"
          title="Settings, themes & tour"
        >
          <PixelSettingsIcon />
        </button>
      </div>
    </header>
  );
}
