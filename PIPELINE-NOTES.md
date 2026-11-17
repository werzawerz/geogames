# Supply Chain pipeline notes
Done: data build script (packages/geodata/scripts/build-supply-chain.ts) + data/supply-chain.json (111 commodities, 64 KB).
Sources: FAOSTAT (CC BY 4.0, 2022-24 avg), USGS MCS 2026 (PD, 2024; PDFs read with pdftotext -table, rows checked against world totals, hand fixes noted in script), EIA INTL (PD, 2024).
Next: engine (packages/games/src/supply-chain.ts), wiring, screen, card art, tests.
Rules chosen: answer set = top N sovereign producers with >=3% share plus any within 10% of the Nth; 3 misses (2 from L21, 1 from L36).
Input: free text (countries), all countries suggested equally; map borders={false}, found countries only.
