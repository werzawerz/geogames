# Border Blitz build notes, review round 1 fixes (delete in the final commit)

Review: scratchpad pipeline/border-blitz/review-1.md. Before numbers saved in scratchpad bb/before.txt.

## Done
- 1 territory passes: TERRITORY_OWNERS in geodata links.ts; engine `throughTerritory`, guess result 'territory' (free, not in moves). Tests.
- 2 Africa: plan `africaShare` (0.3 for 9-16, 0.35 for 17-20), max 2 in a row. Tests.
- 6 early levels: Spain allowed (Morocco only via the Ceuta/Melilla exclave, from EXCLAVES); `familiar` keeps Central Asia + Caucasus out of 1-4. Tests.

## Next
- Screen done: territory message + rules (1), saved deadline (3), frame.ts + frame.test.ts (4), microstate dots (5). e2e: 2 border blitz tests pass.
- After numbers in scratchpad bb/after.txt. Remaining: screenshots, final commit.
