import { toSupabaseSyncError } from './attendanceSync';
import { supabase } from './supabase';

export type ArcadeGameId = 'schloss-defender' | 'buzzy-escape';

export interface ArcadeGameModeMeta {
  id: string;
  label: string;
  accent: 'green' | 'gold' | 'orange' | 'red' | 'purple' | 'cyan';
  rankWeight: number;
}

export interface ArcadeGameDefinition {
  id: ArcadeGameId;
  title: string;
  subtitle: string;
  genre: string;
  description: string;
  controlsSummary: string;
  iframePath: string;
  accent: 'gold' | 'cyan';
  modes: ArcadeGameModeMeta[];
}

export const ARCADE_GAMES: ArcadeGameDefinition[] = [
  {
    id: 'schloss-defender',
    title: 'Schloss Defender',
    subtitle: '2D Arena Castle Defense',
    genre: 'Action · Wave Defense',
    description:
      'Defend the castle gate against relentless waves of invaders with sword slashes, fire blasts, and dashes across 6 escalating modes including Endless survival.',
    controlsSummary: 'WASD / Arrows move · J slash · K / L abilities · Space dash',
    iframePath: 'games/schloss-defender/index.html',
    accent: 'gold',
    modes: [
      { id: 'endless', label: 'Endless', accent: 'cyan', rankWeight: 6 },
      { id: 'impossible', label: 'Impossible', accent: 'red', rankWeight: 5 },
      { id: 'nightmare', label: 'Nightmare', accent: 'purple', rankWeight: 4 },
      { id: 'hard', label: 'Hard', accent: 'orange', rankWeight: 3 },
      { id: 'medium', label: 'Medium', accent: 'gold', rankWeight: 2 },
      { id: 'easy', label: 'Easy', accent: 'green', rankWeight: 1 },
    ],
  },
  {
    id: 'buzzy-escape',
    title: 'Buzzy Escape',
    subtitle: 'Pixel Arcade Honeycomb Runner',
    genre: 'Arcade · Precision Reflex',
    description:
      'Guide Buzzy through shifting honeycombs and dashing wasps using Shield, Sword, and Shrink abilities. Practice Mode is free; competitive runs save to the club board.',
    controlsSummary: 'Space / Click flap · 1 / 2 / 3 or Q / E / R abilities',
    iframePath: 'games/buzzy-escape/index.html',
    accent: 'cyan',
    modes: [
      { id: 'impossible', label: 'Impossible', accent: 'red', rankWeight: 6 },
      { id: 'extreme', label: 'Extreme', accent: 'purple', rankWeight: 5 },
      { id: 'nightmare', label: 'Nightmare', accent: 'orange', rankWeight: 4 },
      { id: 'hard', label: 'Hard', accent: 'gold', rankWeight: 3 },
      { id: 'medium', label: 'Medium', accent: 'cyan', rankWeight: 2 },
      { id: 'easy', label: 'Easy', accent: 'green', rankWeight: 1 },
    ],
  },
];

export const ARCADE_GAME_BY_ID: Record<ArcadeGameId, ArcadeGameDefinition> = {
  'schloss-defender': ARCADE_GAMES[0],
  'buzzy-escape': ARCADE_GAMES[1],
};

export interface GameLeaderboardEntry {
  id: string;
  gameId: ArcadeGameId;
  mode: string;
  userId: string;
  playerName: string;
  playerRole: 'admin' | 'member';
  avatarId: number;
  bestScore: number;
  won: boolean;
  kills: number;
  maxCombo: number;
  hitsTaken: number;
  durationSec: number;
  rankTitle: string | null;
  achievedAt: string;
}

export interface GamePlayerStats {
  gameId: ArcadeGameId;
  userId: string;
  playerName: string;
  playerRole: 'admin' | 'member';
  avatarId: number;
  gamesPlayed: number;
  wins: number;
  totalScore: number;
  highestScore: number;
  totalKills: number;
  bestCombo: number;
  totalHitsTaken: number;
  bestMode: string | null;
  bestRankTitle: string | null;
  lastPlayedAt: string;
}

export interface GameRunPayload {
  gameId: ArcadeGameId;
  mode: string;
  score: number;
  won?: boolean;
  kills?: number;
  maxCombo?: number;
  hitsTaken?: number;
  durationSec?: number;
  rankTitle?: string | null;
  avatarId?: number;
}

export interface RecordGameRunResult {
  isNewPersonalBest: boolean;
  bestScore: number;
  previousBest: number;
  mode: string;
  playerName: string;
}

interface DbGameLeaderboardRow {
  id: string;
  game_id: string;
  mode: string;
  user_id: string;
  player_name: string;
  player_role: string;
  avatar_id: number;
  best_score: number;
  won: boolean;
  kills: number;
  max_combo: number;
  hits_taken: number;
  duration_sec: number | string;
  rank_title: string | null;
  achieved_at: string;
}

interface DbGamePlayerStatsRow {
  game_id: string;
  user_id: string;
  player_name: string;
  player_role: string;
  avatar_id: number;
  games_played: number;
  wins: number;
  total_score: number | string;
  highest_score: number;
  total_kills: number;
  best_combo: number;
  total_hits_taken: number;
  best_mode: string | null;
  best_rank_title: string | null;
  last_played_at: string;
}

export interface FetchArcadeLeaderboardsResult {
  entries: GameLeaderboardEntry[];
  playerStats: GamePlayerStats[];
  schemaReady: boolean;
}

function isArcadeGameId(val: unknown): val is ArcadeGameId {
  return val === 'schloss-defender' || val === 'buzzy-escape';
}

function mapLeaderboardRow(row: DbGameLeaderboardRow): GameLeaderboardEntry | null {
  if (!isArcadeGameId(row.game_id)) return null;
  return {
    id: row.id,
    gameId: row.game_id,
    mode: row.mode,
    userId: row.user_id,
    playerName: row.player_name,
    playerRole: row.player_role === 'admin' ? 'admin' : 'member',
    avatarId: Number(row.avatar_id) || 0,
    bestScore: Number(row.best_score) || 0,
    won: Boolean(row.won),
    kills: Number(row.kills) || 0,
    maxCombo: Number(row.max_combo) || 0,
    hitsTaken: Number(row.hits_taken) || 0,
    durationSec: Number(row.duration_sec) || 0,
    rankTitle: row.rank_title ?? null,
    achievedAt: row.achieved_at,
  };
}

function mapPlayerStatsRow(row: DbGamePlayerStatsRow): GamePlayerStats | null {
  if (!isArcadeGameId(row.game_id)) return null;
  return {
    gameId: row.game_id,
    userId: row.user_id,
    playerName: row.player_name,
    playerRole: row.player_role === 'admin' ? 'admin' : 'member',
    avatarId: Number(row.avatar_id) || 0,
    gamesPlayed: Number(row.games_played) || 0,
    wins: Number(row.wins) || 0,
    totalScore: Number(row.total_score) || 0,
    highestScore: Number(row.highest_score) || 0,
    totalKills: Number(row.total_kills) || 0,
    bestCombo: Number(row.best_combo) || 0,
    totalHitsTaken: Number(row.total_hits_taken) || 0,
    bestMode: row.best_mode ?? null,
    bestRankTitle: row.best_rank_title ?? null,
    lastPlayedAt: row.last_played_at,
  };
}

export function getModeRankWeight(gameId: ArcadeGameId, mode: string): number {
  const game = ARCADE_GAME_BY_ID[gameId];
  const found = game.modes.find((item) => item.id === mode.toLowerCase());
  return found?.rankWeight ?? 0;
}

export function sortLeaderboardEntries(
  entries: GameLeaderboardEntry[],
  gameId: ArcadeGameId,
  modeFilter: string,
): GameLeaderboardEntry[] {
  const filtered = entries.filter(
    (entry) => entry.gameId === gameId && (modeFilter === 'all' || entry.mode === modeFilter),
  );
  return [...filtered].sort((a, b) => {
    if (gameId === 'schloss-defender' && modeFilter === 'all') {
      const weightDiff = getModeRankWeight(gameId, b.mode) - getModeRankWeight(gameId, a.mode);
      if (weightDiff !== 0) return weightDiff;
    }
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    return a.achievedAt.localeCompare(b.achievedAt);
  });
}

/**
 * Fetches persistent club leaderboard entries and (when signed in) the user's lifetime stats.
 * Publicly readable by guests and members; gracefully returns `schemaReady: false` if Section 10
 * SQL has not yet been applied in Supabase.
 */
export async function fetchArcadeLeaderboards(
  userId: string | null,
): Promise<FetchArcadeLeaderboardsResult> {
  const { data: lbData, error: lbError, status: lbStatus } = await supabase
    .from('game_leaderboard_entries')
    .select('*')
    .order('best_score', { ascending: false })
    .limit(300);

  if (lbError) {
    const syncErr = toSupabaseSyncError(lbError, 'Failed to load arcade leaderboards.', lbStatus);
    if (syncErr.isMissingTable || syncErr.isMissingColumn) {
      return { entries: [], playerStats: [], schemaReady: false };
    }
    throw new Error(syncErr.message || 'Unable to load arcade leaderboards.');
  }

  const entries = ((lbData ?? []) as DbGameLeaderboardRow[])
    .map(mapLeaderboardRow)
    .filter((item): item is GameLeaderboardEntry => item !== null);

  let playerStats: GamePlayerStats[] = [];
  if (userId) {
    const { data: statsData, error: statsError, status: statsStatus } = await supabase
      .from('game_player_stats')
      .select('*')
      .eq('user_id', userId);

    if (statsError) {
      const syncErr = toSupabaseSyncError(
        statsError,
        'Failed to load player arcade stats.',
        statsStatus,
      );
      if (syncErr.isMissingTable || syncErr.isMissingColumn) {
        return { entries, playerStats: [], schemaReady: false };
      }
      throw new Error(syncErr.message || 'Unable to load your arcade stats.');
    }

    playerStats = ((statsData ?? []) as DbGamePlayerStatsRow[])
      .map(mapPlayerStatsRow)
      .filter((item): item is GamePlayerStats => item !== null);
  }

  return { entries, playerStats, schemaReady: true };
}

/** Records a completed game run for the currently authenticated user via atomic server RPC. */
export async function recordArcadeGameRun(payload: GameRunPayload): Promise<RecordGameRunResult> {
  const { data, error, status } = await supabase.rpc('record_game_run', {
    p_game_id: payload.gameId,
    p_mode: payload.mode.toLowerCase(),
    p_score: Math.max(0, Math.floor(payload.score)),
    p_won: Boolean(payload.won),
    p_kills: Math.max(0, Math.floor(payload.kills ?? 0)),
    p_max_combo: Math.max(0, Math.floor(payload.maxCombo ?? 0)),
    p_hits_taken: Math.max(0, Math.floor(payload.hitsTaken ?? 0)),
    p_duration_sec: Math.max(0, Number((payload.durationSec ?? 0).toFixed(1))),
    p_rank_title: payload.rankTitle ?? null,
    p_avatar_id: Math.max(0, Math.floor(payload.avatarId ?? 0)),
  });

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to save game score.', status);
    if (syncErr.isMissingTable || syncErr.isMissingColumn || error.code === 'PGRST202') {
      throw new Error('ARCADE_SCHEMA_MISSING');
    }
    throw new Error(syncErr.message || 'Unable to save game score.');
  }

  const parsed = (data ?? {}) as Record<string, unknown>;
  return {
    isNewPersonalBest: Boolean(parsed.is_new_personal_best),
    bestScore: Number(parsed.best_score) || Math.max(0, Math.floor(payload.score)),
    previousBest: Number(parsed.previous_best) || 0,
    mode: typeof parsed.mode === 'string' ? parsed.mode : payload.mode.toLowerCase(),
    playerName: typeof parsed.player_name === 'string' ? parsed.player_name : 'Club Member',
  };
}

/** Admin-only moderation action to remove a leaderboard entry. */
export async function deleteArcadeLeaderboardEntry(entryId: string): Promise<void> {
  const { error, status } = await supabase
    .from('game_leaderboard_entries')
    .delete()
    .eq('id', entryId);

  if (error) {
    const syncErr = toSupabaseSyncError(error, 'Failed to remove leaderboard entry.', status);
    throw new Error(syncErr.message || 'Unable to remove leaderboard entry.');
  }
}
