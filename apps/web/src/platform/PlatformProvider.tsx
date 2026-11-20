import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { GameDefinition, GameSettings } from '@geogames/games';
import { createApiBackend } from './api-backend.ts';
import { createDevAuth, createSupabaseAuth, type Account } from './auth.ts';
import {
  createLocalBackend,
  type Backend,
  type DailyStart,
  type DuelService,
  type FeedbackInput,
  type FinishedGame,
  type FinishResult,
  type Play,
  type RenameResult,
  type StartResult,
} from './backend.ts';
import type { ScoreService } from './scores.ts';
import type { Player } from './player.ts';

export type { Account } from './auth.ts';
export type { AcceptResult, DuelFailure, DuelService, FeedbackInput, FinishResult, FinishStatus, RenameResult } from './backend.ts';
export { DuelError } from './backend.ts';

interface Platform {
  player: Player;
  /** 'local': a build without a server (no sign-in); 'anonymous': playing without an account; 'signed-in': with an email account. */
  account: Account;
  /** 'rejected': the server refused the name (offensive), and the old one stays; 'offline': kept here, sent next time. */
  renamePlayer(name: string): Promise<RenameResult>;
  startPlay(game: GameDefinition, settings: GameSettings): Promise<StartResult>;
  startDaily(game: GameDefinition): Promise<DailyStart>;
  /** `status` says whether the score reached the server ('saved') or stayed in this browser. */
  finishPlay(play: Play, game: FinishedGame): Promise<FinishResult>;
  /** Signs in to an account; this player's games move into it. Rejects with a SignInError. */
  logIn(email: string, password: string): Promise<void>;
  /** Gives this player an email and password to sign in with, keeping its games. Rejects with a SignInError. */
  createAccount(email: string, password: string): Promise<void>;
  /** Signs out in this browser; play continues as a fresh anonymous player. */
  signOut(): Promise<void>;
  /** Deletes the player's games, feedback and account on the server, then starts over as a fresh anonymous player. */
  deleteAccount(): Promise<void>;
  /** Rejects with a message for the player when it can't be sent. */
  sendFeedback(input: FeedbackInput): Promise<void>;
  scores: ScoreService;
  /** Undefined in a build without a server: duels live there. */
  duels: DuelService | undefined;
}

const PlatformContext = createContext<Platform | null>(null);

/** Set at build time: with VITE_API_URL the app runs against the API, without it in this browser alone. */
function createBackend(): Backend {
  const { VITE_API_URL: apiUrl, VITE_SUPABASE_URL: supabaseUrl, VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey } = import.meta.env;
  if (!apiUrl) return createLocalBackend();
  return createApiBackend(apiUrl, supabaseUrl && supabaseKey ? createSupabaseAuth(supabaseUrl, supabaseKey) : createDevAuth());
}

const MAX_NAME_LENGTH = 24;

/**
 * Single place where the backend is chosen. Swapping it doesn't touch any game
 * or page component.
 */
export function PlatformProvider({ children }: { children: ReactNode }) {
  const [backend] = useState(createBackend);
  const [player, setPlayer] = useState(backend.initial.player);
  const [account, setAccount] = useState(backend.initial.account);

  useEffect(() => {
    let cancelled = false;
    backend.load().then((loaded) => {
      if (cancelled || !loaded) return;
      setPlayer(loaded.player);
      setAccount(loaded.account);
    });
    return () => {
      cancelled = true;
    };
  }, [backend]);

  const startPlay = useCallback((game: GameDefinition, settings: GameSettings) => backend.startPlay(game, settings), [backend]);

  const startDaily = useCallback((game: GameDefinition) => backend.startDaily(game), [backend]);

  const finishPlay = useCallback((play: Play, game: FinishedGame) => backend.finishPlay(play, game, player), [backend, player]);

  const renamePlayer = useCallback(
    async (name: string): Promise<RenameResult> => {
      const next = { ...player, name: name.trim().slice(0, MAX_NAME_LENGTH).trim() || player.name };
      if (next.name === player.name) return 'ok';
      setPlayer(next);
      const result = await backend.rename(next);
      if (result === 'rejected') setPlayer((current) => (current.name === next.name ? player : current));
      return result;
    },
    [backend, player],
  );

  const startOver = useCallback((next: { player: Player; account: Account }) => {
    setPlayer(next.player);
    setAccount(next.account);
  }, []);
  const logIn = useCallback(async (email: string, password: string) => startOver(await backend.logIn(email, password)), [backend, startOver]);
  const createAccount = useCallback(
    async (email: string, password: string) => startOver(await backend.createAccount(email, password)),
    [backend, startOver],
  );
  const signOut = useCallback(async () => startOver(await backend.signOut()), [backend, startOver]);
  const deleteAccount = useCallback(async () => startOver(await backend.deleteAccount()), [backend, startOver]);

  const sendFeedback = useCallback((input: FeedbackInput) => backend.sendFeedback(input), [backend]);

  const value = useMemo(
    () => ({
      player,
      account,
      renamePlayer,
      startPlay,
      startDaily,
      finishPlay,
      logIn,
      createAccount,
      signOut,
      deleteAccount,
      sendFeedback,
      scores: backend.scores,
      duels: backend.duels,
    }),
    [player, account, renamePlayer, startPlay, startDaily, finishPlay, logIn, createAccount, signOut, deleteAccount, sendFeedback, backend],
  );
  return <PlatformContext.Provider value={value}>{children}</PlatformContext.Provider>;
}

export function usePlatform(): Platform {
  const ctx = useContext(PlatformContext);
  if (!ctx) throw new Error('usePlatform outside PlatformProvider');
  return ctx;
}
