# Region Run: pipeline notes

Branch game/region-run. Brief: docs/ideas/scout-round-3.md section 1.

Done: data build (packages/geodata/scripts/build-regions.ts -> data/regions.json, version file, src/regions.ts, src/regions-map.ts),
engine packages/games/src/region-run.ts + tests, registration (catalog, settings, pools, replay, index, bundle.ts, bundle.test.ts).
Next: web screen apps/web/src/games/region-run/, registry, RULES in GamePage, card art, e2e, screenshots.
Input per band: free text with search over every division (current country first), one input pattern for all bands.
Duels: DUEL_GAMES holds only city-circle-arcade (arcade-specific summary); not added. Sequence is move-independent (tested).
