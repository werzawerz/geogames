# Duels for more games (branch game/duels-more)

## Fairness verdict
Every live game's engine draws its puzzles only in `start`/`nextLevel` from the RNG
state, and the only other input is the list of earlier puzzles (never the moves).
So all 17 live games qualify, except City Circle Free Play with self-placed circles
(each player places their own). `DUEL_GAMES` lists them; `canDuel` blocks custom circles.
Premise tests: packages/games/src/duel.test.ts (arcade's stays in circle-arcade.test.ts).

## Done
- Engines: optional `observe` callback on every replay function (no change to play).
- replay.ts: `replayRun` (score, finished, level, per-level rows with outcome incl. skipped/timeout);
  `arcadeRunSummary` removed.
- duel.ts: canDuel, duelSettings, duelThings (per-game noun), duelHasLevels, duelGames.

## Next
(API done: POST /duels uses replayRun + canDuel, rematch must be the same game; Mystery Country duel test in app.test.ts; bundle test compares replayRun.)
2. Web: router `duels/new/<game-id>`; NewDuelPage game picker; GamePage button for every duel game;
   DuelPage per-game copy; DuelLevels generic (skipped shown as skipped); DuelsPage game titles; Home copy.
3. Resume (initialMoves/onMovesChange) for HigherLower, Quiz, GreatCircle, CircleScreen.
4. Playwright duel e2e for a non-circle game; screenshots.

## Input choice per band
No new screens; duel play reuses each game's own screen.
