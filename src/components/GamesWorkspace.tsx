import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useGameLeaderboards } from '../hooks/useGameLeaderboards';
import {
  ARCADE_GAMES,
  ARCADE_GAME_BY_ID,
  sortLeaderboardEntries,
  type ArcadeGameId,
  type GameRunPayload,
} from '../lib/gamesApi';
import type { ClubMember } from '../types/attendance';
import { formatTimestamp } from '../utils/date';
import {
  PixelChevronIcon,
  PixelCloseIcon,
  PixelExpandIcon,
  PixelGamepadIcon,
  PixelLockIcon,
  PixelRefreshIcon,
  PixelSparkleIcon,
  PixelTrashIcon,
  PixelTrophyIcon,
  PixelUserIcon,
} from './PixelIcons';

export interface GamesWorkspaceProps {
  userId: string | null;
  userEmail?: string;
  linkedMember?: ClubMember | null;
  isAdmin: boolean;
  onOpenCloudSync: () => void;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

function resolveDisplayName(
  linkedMember: ClubMember | null | undefined,
  userEmail: string | undefined,
): string {
  if (linkedMember?.name?.trim()) return linkedMember.name.trim();
  if (userEmail?.trim()) {
    const localPart = userEmail.split('@')[0]?.trim();
    if (localPart) return localPart;
    return userEmail.trim();
  }
  return 'Club Member';
}

function resolveStaticAssetUrl(relativePath: string): string {
  const base = import.meta.env.BASE_URL || '/';
  const normalizedBase = base.endsWith('/') ? base : `${base}/`;
  return `${normalizedBase}${relativePath}`;
}

function getModeAccentClass(gameId: ArcadeGameId, modeId: string): string {
  const mode = ARCADE_GAME_BY_ID[gameId].modes.find((item) => item.id === modeId.toLowerCase());
  return mode ? `is-${mode.accent}` : 'is-cyan';
}

function getModeLabel(gameId: ArcadeGameId, modeId: string): string {
  const mode = ARCADE_GAME_BY_ID[gameId].modes.find((item) => item.id === modeId.toLowerCase());
  return mode?.label ?? modeId.toUpperCase();
}

/**
 * Dedicated Team SPIRIT Arcade Games section:
 * - Lazy-loads Schloss Defender & Buzzy Escape inside isolated same-origin iframes
 *   only when launched so other hub pages incur zero bundle or runtime overhead.
 * - Syncs persistent account-linked leaderboards & lifetime stats via Supabase RPC/Realtime.
 * - Lets guests play immediately without saving scores or blocking login walls.
 */
export function GamesWorkspace({
  userId,
  userEmail,
  linkedMember = null,
  isAdmin,
  onOpenCloudSync,
  onNotify,
}: GamesWorkspaceProps) {
  const isAuthenticated = Boolean(userId);
  const displayName = useMemo(
    () => (isAuthenticated ? resolveDisplayName(linkedMember, userEmail) : 'Guest'),
    [isAuthenticated, linkedMember, userEmail],
  );

  const [activeGameId, setActiveGameId] = useState<ArcadeGameId | null>(null);
  const [selectedBoardGame, setSelectedBoardGame] = useState<ArcadeGameId>('schloss-defender');
  const [modeFilter, setModeFilter] = useState<string>('all');
  const [showStageBoardDrawer, setShowStageBoardDrawer] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const lastRunHashRef = useRef<{ key: string; at: number } | null>(null);

  const {
    entries,
    statsByGame,
    personalBestByGame,
    isLoading,
    schemaReady,
    isLiveConnected,
    isSavingRun,
    error,
    refresh,
    submitRun,
    removeEntry,
  } = useGameLeaderboards({ userId, onNotify });

  // Build sync payload for the active game iframe
  const pushSyncToIframe = useCallback(
    (gameId: ArcadeGameId) => {
      const targetWindow = iframeRef.current?.contentWindow;
      if (!targetWindow) return;
      const gameBoard = sortLeaderboardEntries(entries, gameId, 'all').slice(0, 25);
      const personalStats = statsByGame[gameId];
      targetWindow.postMessage(
        {
          type: 'TS_GAME_SYNC',
          payload: {
            isAuthenticated,
            userId,
            displayName,
            leaderboard: gameBoard,
            personalBestByMode: personalBestByGame[gameId] ?? {},
            personalStats,
          },
        },
        window.location.origin,
      );
    },
    [displayName, entries, isAuthenticated, personalBestByGame, statsByGame, userId],
  );

  // Re-sync live cloud leaderboard & auth state into the active iframe whenever data changes
  useEffect(() => {
    if (!activeGameId) return;
    pushSyncToIframe(activeGameId);
  }, [activeGameId, pushSyncToIframe]);

  // Track Fullscreen API state cleanly
  useEffect(() => {
    function handleFullscreenChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // Listen for verified same-origin postMessage events from the mounted game iframe
  useEffect(() => {
    if (!activeGameId) return;

    function handleMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (!iframeRef.current || event.source !== iframeRef.current.contentWindow) return;

      const data = event.data as {
        type?: string;
        gameId?: ArcadeGameId;
        payload?: Partial<GameRunPayload>;
      } | null;
      if (!data || typeof data.type !== 'string') return;

      if (data.type === 'TS_GAME_READY') {
        const readyGame = data.gameId === 'buzzy-escape' || data.gameId === 'schloss-defender'
          ? data.gameId
          : activeGameId;
        if (readyGame) {
          pushSyncToIframe(readyGame);
        }
        return;
      }

      if (data.type === 'TS_GAME_EXIT') {
        if (document.fullscreenElement) {
          void document.exitFullscreen().catch(() => undefined);
        }
        setActiveGameId(null);
        setShowStageBoardDrawer(false);
        return;
      }

      if (data.type === 'TS_GAME_RUN_COMPLETE' && data.payload) {
        const gameId =
          data.gameId === 'buzzy-escape' || data.gameId === 'schloss-defender'
            ? data.gameId
            : activeGameId;
        if (!gameId) return;

        // Guests can play freely without saving scores.
        if (!isAuthenticated) return;

        const mode = String(data.payload.mode || '').toLowerCase();
        const score = Math.max(0, Math.floor(Number(data.payload.score) || 0));
        const runKey = `${gameId}:${mode}:${score}:${data.payload.kills ?? 0}:${data.payload.won ? 1 : 0}`;
        const now = Date.now();
        if (
          lastRunHashRef.current &&
          lastRunHashRef.current.key === runKey &&
          now - lastRunHashRef.current.at < 1500
        ) {
          return;
        }
        lastRunHashRef.current = { key: runKey, at: now };

        void submitRun({
          gameId,
          mode,
          score,
          won: Boolean(data.payload.won),
          kills: Number(data.payload.kills) || 0,
          maxCombo: Number(data.payload.maxCombo) || 0,
          hitsTaken: Number(data.payload.hitsTaken) || 0,
          durationSec: Number(data.payload.durationSec) || 0,
          rankTitle: data.payload.rankTitle ?? null,
          avatarId: Number(data.payload.avatarId) || 0,
        });
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [activeGameId, isAuthenticated, pushSyncToIframe, submitRun]);

  const handleLaunchGame = useCallback((gameId: ArcadeGameId) => {
    setActiveGameId(gameId);
    setSelectedBoardGame(gameId);
    setModeFilter('all');
    setShowStageBoardDrawer(false);
    setIframeReloadKey((prev) => prev + 1);
  }, []);

  const handleExitGame = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    setActiveGameId(null);
    setShowStageBoardDrawer(false);
  }, []);

  const handleToggleFullscreen = useCallback(() => {
    const el = stageContainerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else if (typeof el.requestFullscreen === 'function') {
      void el.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const boardGameMeta = ARCADE_GAME_BY_ID[selectedBoardGame];
  const filteredLeaderboard = useMemo(
    () => sortLeaderboardEntries(entries, selectedBoardGame, modeFilter),
    [entries, modeFilter, selectedBoardGame],
  );

  const topChampionByGame = useMemo(() => {
    const map: Record<ArcadeGameId, (typeof entries)[number] | null> = {
      'schloss-defender': sortLeaderboardEntries(entries, 'schloss-defender', 'all')[0] ?? null,
      'buzzy-escape': sortLeaderboardEntries(entries, 'buzzy-escape', 'all')[0] ?? null,
    };
    return map;
  }, [entries]);

  const selectedGameMyStats = statsByGame[selectedBoardGame];

  // Theater Game Stage view when a game is actively playing
  if (activeGameId) {
    const activeGame = ARCADE_GAME_BY_ID[activeGameId];
    const stageBoard = sortLeaderboardEntries(entries, activeGameId, 'all').slice(0, 15);
    const iframeSrc = resolveStaticAssetUrl(activeGame.iframePath);

    return (
      <div
        ref={stageContainerRef}
        className={`arcade-stage-shell ${isFullscreen ? 'is-fullscreen' : ''}`}
      >
        <div className="arcade-stage-bar">
          <div className="arcade-stage-bar-left">
            <button
              type="button"
              className="btn-secondary btn-compact arcade-back-btn"
              onClick={handleExitGame}
            >
              <PixelChevronIcon
                width={11}
                height={11}
                style={{ transform: 'rotate(180deg)' }}
              />
              <span>Back to Arcade</span>
            </button>

            <div className="arcade-stage-identity">
              <span className="arcade-stage-title">{activeGame.title}</span>
              <span className="arcade-stage-controls-hint">{activeGame.controlsSummary}</span>
            </div>
          </div>

          <div className="arcade-stage-bar-right">
            {isAuthenticated ? (
              <span
                className={`arcade-save-pill is-authenticated ${isSavingRun ? 'is-saving' : ''}`}
                title="Completed runs save automatically to your account leaderboard"
              >
                <span className="lounge-live-dot" aria-hidden="true" />
                <span>
                  {isSavingRun ? 'Saving score…' : `Auto-saving as ${displayName}`}
                </span>
              </span>
            ) : (
              <div className="arcade-guest-pill-group">
                <span
                  className="arcade-save-pill is-guest"
                  title="Guests can play freely; sign in to persist high scores"
                >
                  <PixelLockIcon width={10} height={10} />
                  <span>Guest · Scores not saved</span>
                </span>
                <button
                  type="button"
                  className="btn-primary btn-compact-primary"
                  onClick={onOpenCloudSync}
                >
                  <PixelUserIcon width={11} height={11} />
                  <span>Sign In</span>
                </button>
              </div>
            )}

            <button
              type="button"
              className={`btn-secondary btn-compact ${showStageBoardDrawer ? 'is-active' : ''}`}
              onClick={() => setShowStageBoardDrawer((prev) => !prev)}
              title="Toggle live club leaderboard drawer"
            >
              <PixelTrophyIcon width={12} height={12} />
              <span>Leaderboard</span>
            </button>

            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => setIframeReloadKey((prev) => prev + 1)}
              title="Restart game frame"
              aria-label="Restart game"
            >
              <PixelRefreshIcon width={12} height={12} />
            </button>

            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={handleToggleFullscreen}
              title={isFullscreen ? 'Exit fullscreen' : 'Play fullscreen'}
              aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
              <PixelExpandIcon width={12} height={12} />
              <span>{isFullscreen ? 'Exit Full' : 'Fullscreen'}</span>
            </button>
          </div>
        </div>

        <div className="arcade-stage-viewport">
          <iframe
            key={`${activeGame.id}-${iframeReloadKey}`}
            ref={iframeRef}
            src={iframeSrc}
            title={`${activeGame.title} — Team SPIRIT Arcade`}
            className="arcade-game-iframe"
            allow="autoplay; fullscreen"
            onLoad={() => {
              pushSyncToIframe(activeGame.id);
              iframeRef.current?.contentWindow?.focus();
            }}
          />

          {showStageBoardDrawer && (
            <aside className="arcade-stage-drawer" aria-label={`${activeGame.title} live leaderboard`}>
              <div className="arcade-stage-drawer-head">
                <div className="arcade-stage-drawer-title">
                  <PixelTrophyIcon width={13} height={13} />
                  <span>Club Top Scores</span>
                </div>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => setShowStageBoardDrawer(false)}
                  aria-label="Close leaderboard drawer"
                >
                  <PixelCloseIcon width={11} height={11} />
                </button>
              </div>

              <div className="arcade-stage-drawer-list">
                {stageBoard.length === 0 ? (
                  <p className="arcade-drawer-empty">
                    {isAuthenticated
                      ? 'No club scores yet. Finish a run to take #1!'
                      : 'No club scores yet. Sign in to claim #1!'}
                  </p>
                ) : (
                  stageBoard.map((entry, idx) => {
                    const isMine = Boolean(userId && entry.userId === userId);
                    return (
                      <div
                        key={entry.id}
                        className={`arcade-drawer-row ${isMine ? 'is-mine' : ''}`}
                      >
                        <span
                          className={`arcade-rank-badge ${
                            idx === 0
                              ? 'is-gold'
                              : idx === 1
                                ? 'is-silver'
                                : idx === 2
                                  ? 'is-bronze'
                                  : ''
                          }`}
                        >
                          #{idx + 1}
                        </span>
                        <div className="arcade-drawer-player">
                          <span className="arcade-drawer-name">{entry.playerName}</span>
                          <span
                            className={`arcade-mode-pill ${getModeAccentClass(
                              activeGameId,
                              entry.mode,
                            )}`}
                          >
                            {getModeLabel(activeGameId, entry.mode)}
                          </span>
                        </div>
                        <span className="arcade-drawer-score mono-cell">
                          {entry.bestScore.toLocaleString()}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            </aside>
          )}
        </div>
      </div>
    );
  }

  // Arcade Lobby view
  return (
    <div className="arcade-workspace" data-tutorial-target="arcade-hub">
      <section className="lounge-welcome-banner arcade-hero-banner" aria-label="Team SPIRIT Arcade">
        <div className="lounge-welcome-copy">
          <div className="lounge-welcome-kicker">
            <PixelGamepadIcon width={13} height={13} />
            <span>Team SPIRIT Student Arcade</span>
            <span className="lounge-welcome-dot" aria-hidden="true">
              ·
            </span>
            <span>{ARCADE_GAMES.length} Playable Games</span>
            {schemaReady && (
              <>
                <span className="lounge-welcome-dot" aria-hidden="true">
                  ·
                </span>
                <span className={`arcade-live-inline ${isLiveConnected ? 'is-live' : ''}`}>
                  {isLiveConnected ? 'Live Leaderboards' : 'Syncing'}
                </span>
              </>
            )}
          </div>
          <h2 className="lounge-welcome-heading">
            Take a break, chase high scores &amp; climb the club board.
          </h2>
          <p className="lounge-welcome-subtitle">
            {isAuthenticated
              ? `Signed in as ${displayName}. Every completed run automatically updates your personal bests, lifetime stats, and the live Team SPIRIT leaderboard.`
              : 'Jump straight into any game as a guest with zero setup. Sign in with your Team SPIRIT account anytime to save high scores and compete on the club leaderboard.'}
          </p>
        </div>

        <div className="lounge-welcome-actions">
          {isAuthenticated ? (
            <span className="arcade-account-pill">
              <span className="lounge-live-dot" aria-hidden="true" />
              <span>Saving scores as {displayName}</span>
            </span>
          ) : (
            <button type="button" className="lounge-pitch-shortcut" onClick={onOpenCloudSync}>
              <PixelUserIcon width={13} height={13} />
              <span>Sign In to Save Scores</span>
            </button>
          )}
        </div>
      </section>

      {isAdmin && !schemaReady && (
        <div className="lounge-schema-hint arcade-schema-hint" role="note">
          Persistent cloud leaderboards need Section 10 of <code>supabase/schema.sql</code> applied
          in the Supabase SQL Editor. Both games remain fully playable right now!
        </div>
      )}

      {error && (
        <div className="lounge-schema-hint arcade-schema-hint" role="alert">
          {error}
        </div>
      )}

      {/* Featured Games Catalog */}
      <section className="arcade-catalog-grid" aria-label="Playable arcade games">
        {ARCADE_GAMES.map((game) => {
          const champ = topChampionByGame[game.id];
          const myStats = statsByGame[game.id];
          const myBests = personalBestByGame[game.id] ?? {};
          const myTopScore = Math.max(0, myStats?.highestScore ?? 0, ...Object.values(myBests));

          return (
            <article
              key={game.id}
              className={`arcade-game-card is-${game.accent} ${
                selectedBoardGame === game.id ? 'is-board-selected' : ''
              }`}
            >
              <div className="arcade-game-card-top">
                <div className="arcade-game-badges">
                  <span className={`arcade-genre-pill is-${game.accent}`}>
                    <PixelGamepadIcon width={11} height={11} />
                    <span>{game.genre}</span>
                  </span>
                  <span className="arcade-modes-count-pill">{game.modes.length} Modes</span>
                </div>

                {champ ? (
                  <span
                    className="arcade-champ-chip"
                    title={`#1 overall: ${champ.playerName} (${champ.bestScore.toLocaleString()})`}
                  >
                    <PixelTrophyIcon width={11} height={11} />
                    <span>
                      #1 {champ.playerName} · {champ.bestScore.toLocaleString()}
                    </span>
                  </span>
                ) : (
                  <span className="arcade-champ-chip is-open">
                    <PixelSparkleIcon width={11} height={11} />
                    <span>Crown Open</span>
                  </span>
                )}
              </div>

              <div className="arcade-game-card-body">
                <h3 className="arcade-game-title">{game.title}</h3>
                <p className="arcade-game-subtitle">{game.subtitle}</p>
                <p className="arcade-game-desc">{game.description}</p>
              </div>

              <div className="arcade-game-controls-box">
                <span className="arcade-controls-label">Controls</span>
                <span className="arcade-controls-text">{game.controlsSummary}</span>
              </div>

              <div className="arcade-game-card-footer">
                <div className="arcade-personal-pill">
                  {isAuthenticated ? (
                    <>
                      <span className="arcade-personal-label">Your Best</span>
                      <strong className="arcade-personal-val mono-cell">
                        {myTopScore > 0 ? myTopScore.toLocaleString() : '—'}
                      </strong>
                      {myStats && myStats.gamesPlayed > 0 && (
                        <span className="arcade-personal-runs">
                          · {myStats.gamesPlayed} {myStats.gamesPlayed === 1 ? 'run' : 'runs'}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <PixelLockIcon width={10} height={10} />
                      <span className="arcade-personal-label">Guest Play · Unsaved</span>
                    </>
                  )}
                </div>

                <div className="arcade-game-card-actions">
                  <button
                    type="button"
                    className="btn-secondary btn-compact"
                    onClick={() => {
                      setSelectedBoardGame(game.id);
                      setModeFilter('all');
                    }}
                  >
                    <PixelTrophyIcon width={12} height={12} />
                    <span>Board</span>
                  </button>
                  <button
                    type="button"
                    className="btn-primary btn-compact-primary arcade-play-btn"
                    onClick={() => handleLaunchGame(game.id)}
                  >
                    <PixelGamepadIcon width={12} height={12} />
                    <span>Play Now</span>
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </section>

      {/* Account Lifetime Stats Strip (when signed in) */}
      {isAuthenticated && selectedGameMyStats && (
        <section
          className="arcade-my-stats-strip"
          aria-label={`Your ${boardGameMeta.title} lifetime stats`}
        >
          <div className="arcade-my-stats-title">
            <PixelUserIcon width={13} height={13} />
            <span>
              Your {boardGameMeta.title} Stats
              {selectedGameMyStats.bestRankTitle ? ` · ${selectedGameMyStats.bestRankTitle}` : ''}
            </span>
          </div>
          <div className="arcade-my-stats-grid">
            <div className="arcade-stat-tile">
              <span className="arcade-stat-label">Runs Played</span>
              <strong className="arcade-stat-value mono-cell">
                {selectedGameMyStats.gamesPlayed.toLocaleString()}
              </strong>
            </div>
            <div className="arcade-stat-tile">
              <span className="arcade-stat-label">Highest Score</span>
              <strong className="arcade-stat-value mono-cell is-gold">
                {selectedGameMyStats.highestScore.toLocaleString()}
              </strong>
            </div>
            <div className="arcade-stat-tile">
              <span className="arcade-stat-label">Cumulative Score</span>
              <strong className="arcade-stat-value mono-cell">
                {selectedGameMyStats.totalScore.toLocaleString()}
              </strong>
            </div>
            {selectedBoardGame === 'schloss-defender' ? (
              <>
                <div className="arcade-stat-tile">
                  <span className="arcade-stat-label">Victories</span>
                  <strong className="arcade-stat-value mono-cell is-green">
                    {selectedGameMyStats.wins.toLocaleString()}
                  </strong>
                </div>
                <div className="arcade-stat-tile">
                  <span className="arcade-stat-label">Total Invaders Slain</span>
                  <strong className="arcade-stat-value mono-cell">
                    {selectedGameMyStats.totalKills.toLocaleString()}
                  </strong>
                </div>
                <div className="arcade-stat-tile">
                  <span className="arcade-stat-label">Best Combo</span>
                  <strong className="arcade-stat-value mono-cell is-cyan">
                    x{Math.max(1, selectedGameMyStats.bestCombo)}
                  </strong>
                </div>
              </>
            ) : (
              <div className="arcade-stat-tile">
                <span className="arcade-stat-label">Best Difficulty</span>
                <strong className="arcade-stat-value">
                  {selectedGameMyStats.bestMode
                    ? getModeLabel('buzzy-escape', selectedGameMyStats.bestMode)
                    : '—'}
                </strong>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Persistent Club Leaderboard */}
      <section className="lounge-card arcade-leaderboard-panel" aria-label="Club arcade leaderboard">
        <div className="arcade-leaderboard-header">
          <div className="arcade-leaderboard-title-group">
            <span className="arcade-trophy-icon">
              <PixelTrophyIcon width={15} height={15} />
            </span>
            <div>
              <h3 className="lounge-section-title">Club Leaderboards</h3>
              <p className="arcade-leaderboard-sub">
                Best verified score per logged-in Team SPIRIT member &amp; difficulty mode.
              </p>
            </div>
          </div>

          <div className="arcade-leaderboard-controls">
            <div className="arcade-game-tabs" role="tablist" aria-label="Select game leaderboard">
              {ARCADE_GAMES.map((game) => (
                <button
                  key={game.id}
                  type="button"
                  role="tab"
                  aria-selected={selectedBoardGame === game.id}
                  className={`lounge-room-tab ${selectedBoardGame === game.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setSelectedBoardGame(game.id);
                    setModeFilter('all');
                  }}
                >
                  <span>{game.title}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              className="btn-secondary btn-compact"
              onClick={() => void refresh()}
              disabled={isLoading}
              title="Refresh leaderboard"
            >
              <PixelRefreshIcon width={12} height={12} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        <div className="arcade-mode-filters" role="tablist" aria-label="Filter by difficulty mode">
          <button
            type="button"
            role="tab"
            aria-selected={modeFilter === 'all'}
            className={`filter-pill ${modeFilter === 'all' ? 'is-active' : ''}`}
            onClick={() => setModeFilter('all')}
          >
            All Modes
          </button>
          {boardGameMeta.modes.map((mode) => (
            <button
              key={mode.id}
              type="button"
              role="tab"
              aria-selected={modeFilter === mode.id}
              className={`filter-pill ${modeFilter === mode.id ? 'is-active' : ''}`}
              onClick={() => setModeFilter(mode.id)}
            >
              {mode.label}
            </button>
          ))}
        </div>

        <div className="arcade-leaderboard-body">
          {isLoading ? (
            <div className="arcade-board-empty">Loading club leaderboard…</div>
          ) : filteredLeaderboard.length === 0 ? (
            <div className="arcade-board-empty">
              <p>
                No verified {boardGameMeta.title} scores
                {modeFilter !== 'all' ? ` in ${getModeLabel(selectedBoardGame, modeFilter)} mode` : ''}{' '}
                yet.
              </p>
              <button
                type="button"
                className="btn-primary btn-compact-primary"
                onClick={() => handleLaunchGame(selectedBoardGame)}
              >
                <PixelGamepadIcon width={12} height={12} />
                <span>Play {boardGameMeta.title}</span>
              </button>
            </div>
          ) : (
            <div className="arcade-table-scroll">
              <table className="arcade-leaderboard-table">
                <thead>
                  <tr>
                    <th className="col-rank">Rank</th>
                    <th>Player</th>
                    <th>Mode</th>
                    <th className="col-num">Best Score</th>
                    {selectedBoardGame === 'schloss-defender' ? (
                      <>
                        <th className="col-num">Kills</th>
                        <th className="col-num">Combo</th>
                        <th>Defender Rank</th>
                      </>
                    ) : (
                      <th>Arcade Rank</th>
                    )}
                    <th>Recorded</th>
                    {isAdmin && <th className="col-actions" aria-label="Moderation" />}
                  </tr>
                </thead>
                <tbody>
                  {filteredLeaderboard.map((entry, idx) => {
                    const isMine = Boolean(userId && entry.userId === userId);
                    const rankClass =
                      idx === 0
                        ? 'is-gold'
                        : idx === 1
                          ? 'is-silver'
                          : idx === 2
                            ? 'is-bronze'
                            : '';

                    return (
                      <tr key={entry.id} className={isMine ? 'is-mine' : undefined}>
                        <td className="col-rank">
                          <span className={`arcade-rank-badge ${rankClass}`}>#{idx + 1}</span>
                        </td>
                        <td>
                          <div className="arcade-player-cell">
                            <span className="arcade-player-name">{entry.playerName}</span>
                            {entry.playerRole === 'admin' && (
                              <span className="lounge-role-pill is-admin">Lead</span>
                            )}
                            {isMine && <span className="admin-self-tag">You</span>}
                          </div>
                        </td>
                        <td>
                          <span
                            className={`arcade-mode-pill ${getModeAccentClass(
                              selectedBoardGame,
                              entry.mode,
                            )}`}
                          >
                            {getModeLabel(selectedBoardGame, entry.mode)}
                          </span>
                        </td>
                        <td className="col-num arcade-score-cell mono-cell">
                          {entry.bestScore.toLocaleString()}
                        </td>
                        {selectedBoardGame === 'schloss-defender' ? (
                          <>
                            <td className="col-num mono-cell">{entry.kills.toLocaleString()}</td>
                            <td className="col-num mono-cell">x{Math.max(1, entry.maxCombo)}</td>
                            <td className="arcade-rank-title-cell">{entry.rankTitle || '—'}</td>
                          </>
                        ) : (
                          <td className="arcade-rank-title-cell">{entry.rankTitle || '—'}</td>
                        )}
                        <td className="arcade-date-cell mono-cell">
                          {formatTimestamp(entry.achievedAt)}
                        </td>
                        {isAdmin && (
                          <td className="col-actions">
                            <button
                              type="button"
                              className="icon-btn icon-btn-danger"
                              onClick={() => void removeEntry(entry.id)}
                              title={`Remove ${entry.playerName}'s score`}
                              aria-label={`Remove ${entry.playerName}'s leaderboard entry`}
                            >
                              <PixelTrashIcon width={11} height={11} />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

export default GamesWorkspace;
