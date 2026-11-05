# GeoGames

Geography games for the browser. Live now: **Higher or Lower** on country population, area and GDP per capita, and on city population; **Border Route**, a map game where you connect two countries through as few neighbours as possible; the **Capitals** and **Flags** quizzes; **City Circle Arcade**, endless levels of naming the biggest cities inside ever smaller circles; **Pin Drop**, clicking where a city is against a distance budget; **Great Circle**, naming the countries a straight line crosses; **Mystery Country**, working out a hidden country from the clues each guess gives; and **City Circle: Free Play** with your own region, radius and circles. In dev builds (`npm run dev`) plays are unlimited; production builds use the free-play limit. The code is laid out so that more games, accounts, leaderboards and a freemium plan can be added without restructuring.

Border Route, City Circle Arcade, Pin Drop and Mystery Country also have a **daily challenge**: the same run for everyone, one try a day (a new one at midnight UTC), no free play spent, with a leaderboard for the day and a spoiler-free result to share.

The frontend (`apps/web`, GitHub Pages) and backend (`apps/api`, a Hono API on Supabase Edge Functions, with Postgres and sign-in from Supabase) deploy separately: see [docs/deploy.md](docs/deploy.md). Without a backend configured, the site runs in the browser alone.

```bash
npm install
npm run dev          # http://localhost:5317
npm test             # dataset integrity, game engine, web smoke tests (Vitest)
npm run e2e          # browser tests in headless Chromium, against dev server and production build
npm run typecheck
npm run build        # static site in apps/web/dist
npm run data:build   # refresh countries + cities from upstream sources (cached in packages/geodata/.cache)
```

Requires Node 23.6+ (the data script runs `.ts` directly). First-time browser test setup: `npx playwright install chromium`.

The browser tests (`apps/web/e2e`) fail on any console error, so dev-only problems (like a module the Vite dev server serves differently from the build) are caught too.

## Layout

```
packages/geodata   Country + city datasets and typed query API (framework-free)
  data/countries.json       generated, committed, validated
  data/cities/              generated, committed, validated; split into major.json + one file per continent
  data/overrides.json       hand-maintained country fixes, each with a citation
  data/city-overrides.json  hand-maintained city renames/exclusions, each with a reason
  scripts/build-*.ts        fetch → normalize → merge → validate → write
packages/games     Pure game logic + game catalog (no React; reusable on a server)
apps/web           React + Vite front end
  src/platform/        player, entitlements (free plays), scores: interfaces + local implementations
  src/games/           one screen per game kind, registered in registry.ts
  src/pages/           home, game, leaderboard, premium
```

## Country dataset

One record per country/territory (250 entries, 197 treated as sovereign by default: 193 UN members, plus Vatican City, Palestine, Kosovo and Taiwan).

| Field group | Source |
| --- | --- |
| ISO codes, names, translations, aliases, capitals, region/continent, borders, landlocked, currencies, languages, TLDs, area | [mledoze/countries](https://github.com/mledoze/countries), pinned tag (ODbL) |
| population, GDP, GDP per capita, life expectancy | World Bank WDI API, most recent non-empty year (CC BY 4.0) |
| gaps (e.g. Taiwan and Vatican population) | `overrides.json`, each value cited |
| population density | derived |

Every metric carries `{ value, year, source }`, so stale or manual numbers can be traced. The build fails on integrity errors: duplicate codes, dangling border references, a sovereign country without population or area, or a manual value without a citation. The same checks run in `npm test`.

Adding a metric means adding a World Bank indicator in `scripts/build-countries.ts`, a `MetricId` and a `METRICS` entry (label, units, formatting, "more"/"less" wording). After that, a higher/lower game on the new metric is one entry in `packages/games/src/catalog.ts`.

## City dataset

About 11,600 cities of 50k+ from two UN sources, chosen so the numbers match what people know:

- **Cities of 300k+: UN World Urbanization Prospects 2018** (its projection for 2025, CC BY 3.0 IGO), 1,860 agglomerations. Each country defines its agglomerations as its statistics office does, so the figures match common knowledge: Rome 4.3M ahead of Milan 3.2M and Naples 2.2M, London 9.8M, Tokyo 37M the largest. Definitions differ by country (Germany counts cities proper, so Essen is 0.58M; the US and UK count built-up metro areas). The table is frozen, so it is kept as a snapshot in `data/sources/wup2018-cities-300k.csv` (extracted once with `scripts/extract-wup2018.cjs`).
- **Smaller cities: UN World Urbanization Prospects 2025**, which measures every city as its continuous dense urban area (Degree of Urbanisation) down to 50k. Its big-city figures are consistent but often surprising (Naples ahead of Rome, Jakarta ahead of Tokyo), so they are not used above 300k. Small cities that duplicate an agglomeration are dropped.

**Names.** The English name where the UN gives one in parentheses ("Roma (Rome)"), except where the parentheses hold a former name or a region ("Mumbai (Bombay)", "Birmingham (West Midlands)"); German names the UN wrote in ASCII get their umlauts back ("Duesseldorf"); a few typos are fixed. Big GeoNames cities inside an agglomeration without an entry of their own (Yokohama in Tokyo) become aliases and are listed as `includes`. Spellings are then aligned with English usage from Wikidata (by GeoNames ID; batched queries with retries): a label is taken only when it is a respelling of our name (Jiddah → Jeddah, Gent → Ghent) or one city of a joint name (Dallas-Fort Worth → Dallas), since Wikidata often links GeoNames places to municipalities, districts or seat towns ("Madrid city", Ekurhuleni → Benoni). Names set by hand win, and `KEEP_UN_NAME` lists the few labels that would be worse; `.cache/renamed-cities.txt` lists every rename of the last build for review. The old name stays an alias. Hungarian names (Pozsony, Nagyvárad, Ungvár, Bécs) are aliases too, from Wikidata labels (CC0) of settlements with 40k+ people, matched by GeoNames ID or, when Wikidata links a different GeoNames entry, by English name within 25 km; `ALIAS_LANGUAGES` in `build-cities.ts` adds more languages. Small-city rows carry their aliases as an optional 7th column.

**Quality.** WUP 2025 cities carry three flags: `verified` (a GeoNames place with a matching name within 50 km), `recognizable` (a capital, or a place GeoNames knows as sizeable in its own right, which filters out rural-density clusters named after small towns) and the UN's `plausibility` (low is excluded). The 2018 agglomerations are official and always playable.

**City proper, the alternative dataset.** City Circle Arcade can also be played with `city-proper.json`: about 10,900 GeoNames places of 50k+ (CC BY 4.0) as the city itself, not its metro area, so Bergamo is 120k rather than the UN's 900k-odd agglomeration, and Yokohama and Kyoto are cities of their own. GeoNames needs three kinds of cleaning, all in `build-cities.ts`. City parts are dropped, for places near a much bigger city: cities that are their own region (`REGION_CITIES`), China's places missing from the UN list, city-states, precise Wikidata types (`DISTRICT_TYPE`) and short name lists. No figure exceeds the city's UN metro figure, which removes whole-prefecture numbers in China and errors like Taipei at 7.9M; so big Chinese cities show their metro figure here too. A few big entries with no metro figure to check against are corrected by hand (`PROPER_DROP`, `PROPER_POPULATION`), and smaller ones may still be off. Scores are kept separately (`world-proper`).

**Files.** Apps only download what a game needs: `major.json` (300k+), `small-cities.json` (smaller playable cities as slim rows with coordinates), `<continent>.json` (everything per continent) and `index.json` (playable counts per region and size, for setup screens).

## Map shapes

Maps (`apps/web/src/components/WorldMap.tsx`) zoom and pan with the mouse wheel, pinch, drag or the +/−/reset buttons (d3-zoom). Country shapes and overlays such as circles scale with the zoom; labels and city markers are positioned in screen space so they stay the same size, and clicks are converted back through the zoom.

`@geogames/geodata/shapes` loads country outlines from Natural Earth 1:50m (`world-atlas` package, public domain data) as GeoJSON keyed by our country ids, plus a borderless land silhouette. Shapes without an ISO code are mapped by name (Kosovo), and breakaway regions are drawn as part of their UN member state (Somaliland → Somalia, N. Cyprus → Cyprus). The file is ~240 KB gzipped and only loads for map games.

## Games

- **Capitals / Flags** (`choice-quiz.ts`): a generic multiple-choice engine. Four options, a point per right answer, three lives. Wrong options come from the same subregion first, then the continent, so they're plausible (Hungary's capital next to Bratislava and Vienna). An item can accept several answers (South Africa's three capitals), and none of them is ever offered as a wrong option. Capital fixes (e.g. Astana, not Nur-Sultan) live in `overrides.json`.
- **City Circle Arcade** (`circle-arcade.ts`): endless levels. Circles can land anywhere in the world from level 1; difficulty comes from how many of the cities to find are **well known**: among the world's most visited cities (Euromonitor international arrivals, snapshot in `geodata/data/sources/euromonitor-top-cities.csv`, matched to city ids as `tourismRank` in `index.json`). `LEVEL_PLANS`: levels 1–4 find 3 cities in a 1000–3000 km circle, 2 of them well known; 5–8 find 4 (700–2000 km, 2 well known); 9–12 find 5 (500–1200 km, 2 well known); 13–16 find 5 (350–800 km, 1 well known); 17–20 find 6 (250–500 km); 21+ find 7 (200–350 km). While well-known cities are required, circles centre near one. Cities to find also have a minimum size early on (500k, then 300k, 200k, 100k), circles keep 1000 km from the last 6, and a city asked in the last 4 levels isn't asked again. 5 lives (max 9): a skip (reveals the best remaining city, no points) costs one; wrong guesses are free but spoil the level's perfect bonus. A perfect level (no misses, skips or hints) gives back a life and a hint. Hints are scarce: 3 to start (max 5). A hint shows a city's country and every third letter, never the first (the search box would complete the name from it), once per city, and halves its points. Circles don't repeat within a game: a new one may overlap an earlier one by at most half of their combined area and share at most one city to find with it (a France circle after a Western Europe one is fine; London, Paris, Berlin again is not); after 300 tries a long game falls back to the short-term rules. A city is worth 10 × the level number. Moves (guesses, `>` skip, `?` hint) replay from the seed.
- **City Circle: Free Play** (`circle.ts`): 3 circles per game; name the 5 most populous cities (every playable city of 50k+, UN urban areas) inside each, with 5 misses allowed, or give up a circle (kept points stay; the give-up is in the move log). Settings: radius (Auto, or any 150–1500 km on a slider) and placement. Leaderboards group radii into bands (small 150–350, medium 400–750, large 800–1500 km) so similar circles compete; a chosen radius too small for the region grows in 50 km steps until circles fit. Random circles are centred near (not on) a city in the chosen region and stay 1,500 km from earlier ones; Auto picks the smallest of 250/400/600/900 km holding at least 8 cities. With "I'll place it" the player clicks the map before each round (the map frames the bulk of the region's cities) and a circle must hold at least 5 cities; placements go into the move log as `@lat,lng` so games still replay. Cities from neighbouring regions inside the circle count too. In a region game a random circle must have at least 3 of its top 5 cities in that region (Cyprus counts as Europe, so otherwise a "Europe" circle could be all Turkey, the Levant and Egypt). A table under the map lists every guess with its population and result: top 5 with rank, inside with rank, or outside with the distance from the circle. Guesses outside the top 5 show their rank inside the circle (e.g. "#8 Benghazi").
- **Mystery Country** (`mystery-country.ts`): a run of up to 20 levels. Each wrong guess shows the distance and direction to a hidden country, and how its continent, population and area compare; running out of guesses ends the run. Scores depend only on right and wrong, so the server replays them without the countries' positions.
- **Great Circle** (`great-circle.ts`): a run of up to 20 levels with 5 lives. A line runs between two cities (the shortest path on the globe) and the player names every country it crosses, in any order. `scripts/build-great-circles.ts` traces about 25,000 random lines through the country outlines ahead of time, so the game and the server just read a list (`data/great-circles.json`), and it keeps only fair ones: every country crossed for at least 70 km, none entered twice, all of them sovereign.
- **Border Route** (`route.ts`): an arcade run of up to 20 levels (`ROUTE_LEVELS`): 2-3 countries in between among well-known countries outside Africa and the Caribbean (levels 1-4), 3-4 anywhere outside them (5-8), then anywhere with 3-5, 4-6 and 5-8 (from 9, 13 and 17). No start or goal comes up twice in a run. Running out of guesses ends the run. The border graph only counts land borders listed by both countries (this drops sea "borders" such as Sri Lanka–India), plus fixed links you can drive across (`FIXED_LINKS` in `geodata/src/links.ts`: Øresund Bridge, Channel Tunnel, King Fahd Causeway, Johor–Singapore Causeway). Routes are played on country *parts*: exclaves (`EXCLAVES`: Kaliningrad, Nakhchivan, Cabinda, Ceuta and Melilla) only connect to what they touch, so Poland → Russia → Finland is refused, since Poland only borders Kaliningrad. Territories with land borders (Western Sahara, French Guiana, Gibraltar, Hong Kong, Macau, Saint Martin/Sint Maarten) can be crossed and typed but never start or end a route; Mauritania and Morocco, for example, only connect through Western Sahara or Algeria. Players move country by country: a guess must border the start or a country already placed (branching off earlier countries is allowed), otherwise it's refused at no cost. Guesses are coloured by whether they lie on a shortest route, one step off, or further away. A round is solved once the guesses connect start and goal. Scoring: 10 points per route, minus 2 per guess beyond the minimum (at least 2), times the level. The map is a full political map with borders, framed once per round on the start, goal and their neighbours; only the start, goal and guesses are named, so recognising the unlabelled shapes is the challenge. **Hard mode** draws only the borders of the start, the goal and your guesses (the rest isn't in the page at all) and keeps the length of the shortest route secret until the round ends. As a guess limit tied to the route would reveal its length, every route gets `HARD_MODE_GUESSES` (12) instead. A country that doesn't border the route isn't refused for free here, as that would reveal hidden borders: it stays off the map but costs a guess and 2 points like any other guess beyond the minimum (naming it again is free). It has its own leaderboards.

- A game's **definition** (`catalog.ts`) is static metadata: id, kind, subject (country/city), title, metric.
- A game's **pool** (`pools.ts`) is chosen in the games package, not the UI, so a server replays against exactly the same items. City files load lazily, and only the ones the settings need.
- **Settings** (`settings.ts`) are chosen on the setup step before each game: a region (whole world or one continent) and, for city games, the smallest city size (a slider over `CITY_SIZE_STOPS`, default 1M+). World city games go down to 300k at most, a single continent to 100k; 50k is reserved for per-country games. Quiz games add a difficulty: Easy asks only the best-known 40% of the region (ranked by population and GDP percentiles, `countryProminence`) with wrong options from anywhere; Medium asks everything with options from the same continent; Hard draws options from the same subregion. Regions and sizes leaving fewer than `MIN_POOL_SIZE` items are not offered. Each settings combination has its own leaderboard (`variantKey`, e.g. `europe-100k`); default settings keep the plain key (`world`, `europe`) so older scores stay put.
- **Higher or Lower** never shows an item twice; when every country (or city) in the pool has been shown and answered, the game ends as a perfect run.
- A game **engine** is pure and generic over anything with `id` + `metrics`: `start(seed)`, `guess(state, …)`, `next(state)`. The RNG state lives inside the game state, so a game is fully reproducible from its seed plus its move log (`replayHigherLower`). A backend can use this to check submitted scores before they enter a global leaderboard.
- A game **screen** implements `GameScreenProps` and reports `{ score, moves }` when the game ends. The page handles plays, scores and the game-over panel.

## Platform services (currently local placeholders)

| Service | Now | Later |
| --- | --- | --- |
| `Player` | anonymous id + editable name in localStorage | auth account |
| `EntitlementService` | 5 free plays/day, dev toggle for Premium | server-enforced plan from the subscription provider |
| `ScoreService` | personal scores in localStorage; global returns `null` | API with server-side replay verification |

All implementations are chosen in `PlatformProvider.tsx`; components only see the interfaces. The local free-play limit is easy to bypass and is only a UX placeholder. Real enforcement must happen on the server.

## Next steps

1. Backend: planned in [docs/backend-plan.md](docs/backend-plan.md) (Hono API + Supabase, $0 hosting on Cloudflare). Deferred while we experiment with games.
2. Payments (e.g. Stripe or Paddle) feeding the plan into `EntitlementService`.
3. New game kinds: flag quiz, capitals, borders, "locate on map".
4. Split the dataset into a lazily loaded chunk or per-game slices once it grows (the main JS bundle is ~157 KB gzip, mostly data).
