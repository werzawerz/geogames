# Supply Chain pipeline notes
Done: data build script + data (111 commodities, 64 KB); engine + unit/bundle tests; wiring; screen (apps/web/src/games/supply-chain); rules; card art; e2e written (not yet run).
Sources: FAOSTAT (CC BY 4.0, 2022-24 avg), USGS MCS 2026 (PD, 2024; PDFs read with pdftotext -table, rows checked against world totals, hand fixes noted in script), EIA INTL (PD, 2024).
Next: run typecheck, vitest, the e2e (E2E_PORT_BASE=6720 npx playwright test -g "supply-chain"), screenshots, full Playwright suite once; delete this file in the final commit.
Rules: answer set = top N sovereign producers with >=3% share plus any within 10% of the Nth; 3 misses (2 from L21, 1 from L36).
Input: free text (all countries, same suggestion order every level); map borders={false}, found countries only; shares only for found countries.
