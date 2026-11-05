import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameDefinition, GameSettings } from '@geogames/games';
import { createApiBackend } from './api-backend.ts';
import { createDevAuth, createSupabaseAuth } from './auth.ts';
import { createLocalBackend, type Backend, type FinishedGame, type FinishResult, type Play, type StartResult } from './backend.ts';
import type { Allowance, Plan } from './entitlements.ts';
import type { ScoreService } from './scores.ts';
import type { Player } from './player.ts';

interface Platform {
  player: Player;
  renamePlayer(name: string): void;
  allowance: Allowance;
  startPlay(game: GameDefinition, settings: GameSettings): Promise<StartResult>;
  finishPlay(play: Play, game: FinishedGame): Promise<FinishResult>;
  /** Only without a server: lets the free-play limit be tried out. */
  setPlan?(plan: Plan): void;
  scores: ScoreService;
}

const PlatformContext = createContext<Platform | null>(null);

/** Set at build time: with VITE_API_URL the app runs against the API, without it in this browser alone. */
function createBackend(): Backend {
  const { VITE_API_URL: apiUrl, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey } = import.meta.env;
  if (!apiUrl) return createLocalBackend();
  return createApiBackend(apiUrl, supabaseUrl && supabaseKey ? createSupabaseAuth(supabaseUrl, supabaseKey) : createDevAuth());
}

/**
 * Single place where the backend is chosen. Swapping it doesn't touch any game
 * or page component.
 */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [backend] = useState(createBackend);
  const [player, setPlayer] = useState(backend.initial.player);
  const [allowance, setAllowance] = useState(backend.initial.allowance);

  useEffect(() => {
    let cancelled = false;
    backend.load().then((loaded) => {
      if (cancelled || !loaded) return;
      setPlayer(loaded.player);
      setAllowance(loaded.allowance);
    });
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const startPlay = useCallback(
    async (game: GameDefinition, settings: GameSettings) => {
      const result = await backend.startPlay(game, settings);
      if (result.status !== 'update-required') setAllowance(result.allowance);
      return result;
    },
    [backend],
  );

  const finishPlay = useCallback((play: Play, game: FinishedGame) => backend.finishPlay(play, game, player), [backend, player]);

  const setPlan = useMemo(
    () => (backend.simulatePlan ? (plan: Plan) => setAllowance(backend.simulatePlan!(plan)) : undefined),
    [backend],
  );

  const renamePlayer = useCallback(
    (name: string) => {
      const next = { ...player, name: name.trim().slice(0, 24) || player.name };
      if (next.name === player.name) return;
      setPlayer(next);
      void backend.rename(next);
    },
    [backend, player],
  );

  const value = useMemo(
    () => ({ player, renamePlayer, allowance, startPlay, finishPlay, setPlan, scores: backend.scores }),
    [player, renamePlayer, allowance, startPlay, finishPlay, setPlan, backend],
  );
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform outside PlatformProvider');
  return ctx;
}
