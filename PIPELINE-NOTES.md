# Border Blitz build notes (delete in the final commit)

Brief: idea #1 in the round-1 ideas file. Branch `game/border-blitz`. Ports: dev 6410, `E2E_PORT_BASE=6400`.

## Done
- Engine `packages/games/src/border-blitz.ts` + tests (13 passing). Registered in catalog, settings (`usesRegion`), pools (`poolSizes`), replay, index.
- Design: graph = `buildBorderGraph(routeCountries())` (same as Border Route), answers and targets only sovereign countries.
  3 lives per level, 3rd wrong ends the run. Clock runs on the screen; it sends a `timeout` move. Score: 10 x level per neighbour,
  flawless level +50%. Not in `DAILY_GAMES` (user decides).

## Next (screen, registry, rules, card art and bundle test are done; typecheck + vitest pass)
- Screen done: apps/web/src/games/border-blitz/BorderBlitzScreen.tsx (deadline-based clock, sends timeout move).
- e2e test added and passing (dev + build). Remaining: screenshots (desktop + 390px), final commit.

## Open questions
- Resume restarts the current level's clock (time isn't in the moves).
