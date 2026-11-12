# Halfway build notes (branch game/halfway)

Brief: idea #5 in the round-1 ideas file. Name a city near the great-circle midpoint of two shown cities.

## Done
- Engine `packages/games/src/halfway.ts` + `halfway.test.ts` (12 tests pass). Registered in catalog, settings (no region), pools, replay, index.
- Fairness: each level is built only if >= 3 "fair" cities (famous, or big per plan) lie within the radius of the midpoint.

## Next
- Screen done (HalfwayScreen.tsx, registry, RULES, card art, CSS). Not yet checked in a browser.
- bundle.test.ts case and e2e test done and passing. Next: screenshots, full vitest, final commit.

## Open questions
- None yet.
