# Clockwork pipeline notes (delete in the final commit)

Brief: idea #3 in docs/ideas/scout-round-2.md. Branch game/clockwork, worktree geogames-wt/clockwork. E2E_PORT_BASE=6640.

## Done
- Engine `packages/games/src/clockwork.ts` (+ places, dates, generated offsets from tzdb 2026c via
  `node packages/games/scripts/build-clockwork.ts`), tests in clockwork.test.ts (19 pass).
- Registered: catalog, settings (usesRegion), pools (poolSizes), replay, index.

## Done too
- Screen, registry, RULES, card art (SVG clock, no map scene), styles. Typecheck passes.

## Next
- Screen apps/web/src/games/clockwork/ClockworkScreen.tsx: WorldMap, country highlighted, city dot for
  multi-zone countries, 15° meridian lines, time input (type 1730/17:30, arrows ±1h, shift ±15min, Enter).
- registry.tsx, GamePage RULES + showCount list, GameCardArt, styles.
- Done: bundle.test.ts case, e2e test (passes dev+build). Next: screenshots, full vitest, final commit.
