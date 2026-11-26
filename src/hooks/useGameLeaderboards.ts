import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteArcadeLeaderboardEntry,
  fetchArcadeLeaderboards,
  recordArcadeGameRun,
  type ArcadeGameId,
  type GameLeaderboardEntry,
  type GamePlayerStats,
  type GameRunPayload,
  type RecordGameRunResult,
} from '../lib/gamesApi';
import { supabase } from '../lib/supabase';

interface UseGameLeaderboardsOptions {
  userId: string | null;
  onNotify?: (options: {
    tone: 'success' | 'info' | 'warning' | 'error';
    tag: string;
    message: string;
  }) => void;
}

export function useGameLeaderboards({ userId, onNotify }: UseGameLeaderboardsOptions) {
  const [entries, setEntries] = useState<GameLeaderboardEntry[]>([]);
  const [playerStats, setPlayerStats] = useState<GamePlayerStats[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [schemaReady, setSchemaReady] = useState(true);
  const [isLiveConnected, setIsLiveConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSavingRun, setIsSavingRun] = useState(false);

  const loadAll = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      try {
        const result = await fetchArcadeLeaderboards(userId);
        setEntries(result.entries);
        setPlayerStats(result.playerStats);
        setSchemaReady(result.schemaReady);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load arcade leaderboards.');
      } finally {
        if (!silent) setIsLoading(false);
      }
    },
    [userId],
  );

  useEffect(() => {
    void loadAll(false);
  }, [loadAll]);

  // Subscribe to Supabase Realtime updates on arcade tables when schema is installed
  useEffect(() => {
    if (!schemaReady) {
      setIsLiveConnected(false);
      return;
    }

    const channel = supabase
      .channel('team-spirit-arcade-leaderboards')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_leaderboard_entries' },
        () => {
          void loadAll(true);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'game_player_stats' },
        () => {
          void loadAll(true);
        },
      )
      .subscribe((status) => {
        setIsLiveConnected(status === 'SUBSCRIBED');
      });

    return () => {
      setIsLiveConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [loadAll, schemaReady]);

  const personalBestByGame = useMemo(() => {
    const map: Record<ArcadeGameId, Record<string, number>> = {
      'schloss-defender': {},
      'buzzy-escape': {},
    };
    if (!userId) return map;
    for (const entry of entries) {
      if (entry.userId === userId) {
        const prev = map[entry.gameId][entry.mode] ?? 0;
        if (entry.bestScore > prev) {
          map[entry.gameId][entry.mode] = entry.bestScore;
        }
      }
    }
    return map;
  }, [entries, userId]);

  const statsByGame = useMemo(() => {
    const map: Record<ArcadeGameId, GamePlayerStats | null> = {
      'schloss-defender': null,
      'buzzy-escape': null,
    };
    for (const stat of playerStats) {
      map[stat.gameId] = stat;
    }
    return map;
  }, [playerStats]);

  const submitRun = useCallback(
    async (payload: GameRunPayload): Promise<RecordGameRunResult | null> => {
      if (!userId) return null;
      setIsSavingRun(true);
      try {
        const result = await recordArcadeGameRun(payload);
        setSchemaReady(true);
        await loadAll(true);
        if (result.isNewPersonalBest && payload.score > 0) {
          onNotify?.({
            tone: 'success',
            tag: 'New High Score',
            message: `Saved ${result.bestScore.toLocaleString()} (${result.mode.toUpperCase()}) to the club leaderboard!`,
          });
        }
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unable to save run.';
        if (msg === 'ARCADE_SCHEMA_MISSING') {
          setSchemaReady(false);
          onNotify?.({
            tone: 'warning',
            tag: 'Arcade DB Setup',
            message:
              'Run supabase/schema.sql Section 10 in Supabase SQL Editor to enable persistent cloud leaderboards.',
          });
        } else {
          onNotify?.({
            tone: 'error',
            tag: 'Score Sync',
            message: msg,
          });
        }
        return null;
      } finally {
        setIsSavingRun(false);
      }
    },
    [loadAll, onNotify, userId],
  );

  const removeEntry = useCallback(
    async (entryId: string) => {
      try {
        await deleteArcadeLeaderboardEntry(entryId);
        await loadAll(true);
        onNotify?.({
          tone: 'info',
          tag: 'Leaderboard Updated',
          message: 'Removed leaderboard entry.',
        });
      } catch (err) {
        onNotify?.({
          tone: 'error',
          tag: 'Moderation Error',
          message: err instanceof Error ? err.message : 'Unable to remove leaderboard entry.',
        });
      }
    },
    [loadAll, onNotify],
  );

  return {
    entries,
    statsByGame,
    personalBestByGame,
    isLoading,
    schemaReady,
    isLiveConnected,
    isSavingRun,
    error,
    refresh: () => loadAll(false),
    submitRun,
    removeEntry,
  };
}
