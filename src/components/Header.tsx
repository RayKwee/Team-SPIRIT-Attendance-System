import { PixelCalendarIcon, PixelChevronIcon, PixelListIcon, PixelPlusIcon } from './PixelIcons';

export type ActivePage = 'tracker' | 'calendar';

interface HeaderProps {
  activePage: ActivePage;
  periodLabel: string;
  onOpenCreateSession: () => void;
}

const NAV_LINKS: { page: ActivePage; label: string; href: string }[] = [
  { page: 'tracker', label: 'Attendance Tracker', href: './index.html' },
  { page: 'calendar', label: 'Calendar', href: './calendar.html' },
];

/** Top utility header displaying Team SPIRIT branding, page navigation, and session actions. */
export function Header({ activePage, periodLabel, onOpenCreateSession }: HeaderProps) {
  return (
    <header className="header-bar">
      <div className="brand-group">
        <div className="voxel-emblem" aria-hidden="true">
          <span className="voxel-red" />
          <span className="voxel-gold" />
          <span className="voxel-cyan" />
          <span className="voxel-green" />
        </div>

        <div className="brand-text">
          <div className="brand-title-row">
            <h1 className="club-title">
              <span className="word-team">Team</span>{' '}
              <span aria-label="SPIRIT">
                <span className="letter-s">S</span>
                <span className="letter-p">P</span>
                <span className="letter-i1">I</span>
                <span className="letter-r">R</span>
                <span className="letter-i2">I</span>
                <span className="letter-t">T</span>
              </span>
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
          return (
            <a
              key={link.page}
              href={link.href}
              aria-current={isCurrent ? 'page' : undefined}
              className={`nav-link ${isCurrent ? 'is-active' : ''}`}
            >
              {link.page === 'tracker' ? <PixelListIcon /> : <PixelCalendarIcon />}
              <span>{link.label}</span>
            </a>
          );
        })}
      </nav>

      <div className="header-controls">
        <div className="period-pill" title="Current date">
          <PixelCalendarIcon />
          <span>{periodLabel}</span>
        </div>

        <button type="button" className="btn-primary" onClick={onOpenCreateSession}>
          <PixelPlusIcon />
          <span>Record Session</span>
        </button>
      </div>
    </header>
  );
}
