# Border Blitz build notes, playtest fixes (delete in the final commit)

Playtest: scratchpad pipeline/border-blitz/playtest.md. Metrics script: scratchpad bb/metrics.ts (WT env points it at another copy;
bb/old holds commit 7d77f21 for the before numbers). Before: bb/playtest-before.txt, after: bb/playtest-after.txt.

## Done (engine, packages/games/src/border-blitz.ts)
- Lives carry over: start 3, flawless +1 up to 5, wrong -1, 0 ends the run.
- Give up: move 'give-up' (ended 'gave-up'). Time bonus: move 't:<seconds>' via claimTime, right after a clear.
- Clock: base 5 s + 6/5/4/3.5/3 s per neighbour.
- Order by difficulty (engine `difficulty`), ranked within Africa and the rest; level picks among choices(level) nearest.
  Familiarity floors Europe 0.7, South America 0.6. Min 3 neighbours. No subregion repeat within 3 levels.

## Next
- Engine tests (old ones are out of date and fail), bundle test (lives now carry over).
- Screen: lives display, Give up button, claimTime on clear, hide count from level 11, labels for all missed, tiles above the fold at 1280x900.
- Rules text, e2e, screenshots, final commit.
