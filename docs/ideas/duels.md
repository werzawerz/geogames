# Duels: two-player City Circle Arcade (design, approved 2026-11-20)

Designed by Opus; the user approved the defaults: **the challenger sees the creator's score before playing; creating a duel needs an account, accepting doesn't; the name is "Duel".**

## Shape

An asynchronous duel shared by link.
1. Player A finishes a normal City Circle Arcade run and taps "Challenge a friend".
2. A gets the link `#/duel/K7Q2M9XD`.
3. The first person to open it and press Play takes the duel. That person, B, plays the same seed with the same settings, once.
4. The higher verified score wins.

There is no Realtime, cron or new secret. A live race over Supabase Realtime Broadcast is a possible later phase.

## 0. Facts the design rests on

- **Engine.** `packages/games/src/circle-arcade.ts`, `createCircleArcade({cities, famous})`.
- **Circles don't depend on play.** `makePuzzle(rng, level, past)` uses only the RNG and earlier circles. `nextLevel` continues from `state.rngState`, which only puzzle-making advances. So one seed gives the same circle sequence whatever the player does, and both duellists get identical levels. Verify this with a test (§7, engine test 1).
- **Moves.** Moves are city ids, `>` (skip) and `?` (hint). `replayGame` returns `{score, finished}`.
- **Scoring.**
  - A found city scores 10 × level, minus 50% per hint.
  - A wrong guess costs only the perfect-level bonus.
  - A skip costs a life.
  - A run starts with 5 lives (max 9). A flawless level gives +1 life and +1 hint.
  - The game is endless and ends only when the lives run out.
- **Settings.** Only `cityData`, either `metro` or `proper`.
- **Resume.** The arcade supports `initialMoves`; DailyPage uses it.
- **Known limit.** The browser knows the seed, so a devtools user could compute the answers. This is the same as for the daily and the leaderboards. The server stops forged scores and second tries. The threat model is friends.

## 2. Rules

- **What each plays.** Both play City Circle Arcade with the creator run's seed and settings, under the normal arcade rules.
- **Winner.** The higher verified score wins. Equal scores are a draw. There is no tiebreak.
- **Order.** A always finished first, because a duel is made from A's finished run.
- **Which runs can start a duel.** A's run must be:
  - City Circle Arcade (`DUEL_GAMES`);
  - finished and saved on the server, within the last 24 h;
  - on the current dataset version;
  - not a daily run, not a duel run, and not already in a duel.

  It is an ordinary run and counts on A's normal leaderboard.
- **The challenger's run.** B's run is a game session with variant `duel`. It never appears on a global leaderboard or in profile bests.
- **One challenger per duel.** Pressing Play takes the duel.
- **Deadlines**, computed when read:
  - A duel is open for 7 days.
  - Once B starts, B has 24 h to finish. Otherwise it is a forfeit and A wins.
  - If the dataset changes before B takes the duel, or while B plays, the duel is void ("expired: game updated").
- **What is hidden, from whom, and when:**
  - **A's name, score, level reached and duration:** always visible. This is the stake.
  - **A's moves and the cities A found:** hidden until the duel is finished.
  - **Seed:** only to B, in the accept response and while B is playing. Never to visitors.
  - **B's score and moves:** hidden until the duel is finished. A sees only "Bo is playing".
- **Rematch.**
  - Either participant presses Rematch after a finished duel. They play a fresh run, and the new duel is reserved for the other participant.
  - Only that player can accept it. Anyone else gets "This rematch is for Bo".
  - If both press Rematch, two duels exist, one each way, which is fine.
- **Accounts.**
  - Creating a duel needs an account (`account-required`).
  - Accepting works anonymously. An anonymous player is asked to confirm their display name first.
  - Creating an account later keeps the player id. Logging in merges the duels through `merge_players`.

## 3. Player experience

**Navigation**
- Header: Games · Daily · **Duels** · About. Add Duels to the hamburger menu too.
- Routes:
  - `#/duels`: list.
  - `#/duels/new`: play a run, then create a duel.
  - `#/duels/new/<CODE>`: rematch of CODE.
  - `#/duel/<CODE>`: one duel.
- Entry points:
  - The City Circle Arcade game-over screen, under the score: **"⚔️ Challenge a friend to these circles"**. Shown when the result is saved on the server.
  - A Duels card on Home, under the dailies: "Duel a friend: same circles, one try each."

**A. Create (account holder)**
- **From game over.** "Challenge a friend to these circles" calls POST /duels `{sessionId}` and goes to `#/duel/CODE`.
- **From `#/duels/new`:**
  - Title "New duel: City Circle Arcade".
  - The line "Play your run first. Your friend then gets exactly the same circles and has to beat your score."
  - Play runs the normal arcade (`startPlay`). On game over the page finishes the play, POSTs /duels and redirects.
  - When the finish wasn't saved: "We couldn't save your run on the server, so it can't become a duel. [Try again]".
- **Anonymous players get a gate** instead of the button or page:
  - Text: "Duels need an account, so your friend knows who they're playing and your duels follow you to any device."
  - Buttons: [Create account] [Log in].
  - Sign-in returns to the same hash through SignInPage's `rememberReturn`.
  - On the game-over screen, the challenge button is shown to anonymous players too. It leads to the gate.
- **Share panel** (`#/duel/CODE`, creator, state `open`):
  - Eyebrow "Duel · City Circle Arcade". Big score. "Level 9 · 6 circles cleared".
  - Primary button **"Send the link"**: `navigator.share` where available, otherwise copy to the clipboard and show "Link copied!". Secondary: "Copy link".
  - Share text:
    `⚔️ I scored 340 on City Circle Arcade (level 9). Same circles, one try: can you beat me?\n<url>`
  - Status: "Waiting for a challenger. The link works until Tue 27 Nov, and the first person to press Play takes the duel."
  - Polls (§6).

**B. Accept (anyone with the link)**
- **Visitor, state `open`:**
  - Title "Ana challenges you".
  - "Ana scored **340** on City Circle Arcade and reached level 9."
  - Rules:
    - "You get exactly the same circles, in the same order."
    - "One try. Your score is checked by the server."
    - "Ana's answers stay hidden until you've finished."
  - Data line: "City data: metro areas (UN)".
  - If anonymous: a field "Your name in this duel" prefilled with the current name. It saves through `renamePlayer`.
  - Primary **"Play the duel"**. Small print: "Pressing Play takes this duel: nobody else can play it."
- **Playing:**
  - A one-line strip: "Duel vs Ana · to beat: **340**", then the normal GameScreen.
  - It must fit with no page scroll at 390×844 (geo-ux skill).
  - Moves are saved to localStorage under `duel:<CODE>:moves` as `{version, moves}`. A reload resumes, as DailyPage does.
- **Game over.** Call `finishPlay` with variant `duel`, clear the stored moves and re-fetch the duel.
- **Finish retry.** If the finish fails, keep the moves. On the next load, if they replay to `over`, re-submit automatically with "Sending your result…". Finishing twice is already safe.

**C. Result** (state `finished`)
- Headline:
  - "**You win!** 410 to 340"
  - "**Ana wins.** 340 to 290"
  - "**A draw!** 340 each"
- Visitor view: "Ana 340 – Bo 290".
- Two score cards side by side, stacked on phones. Each shows the name, score, "level N", and "in 14 min" (server duration; it never decides the winner).
- A level-by-level table (`components/DuelLevels.tsx`), built client-side by replaying both move lists with the engine:
  - Columns: Level · You · Ana.
  - Each cell shows points and ✓/✗, plus ★ for perfect.
  - Each row expands to the top cities with who found which.
- Buttons: **Rematch** (→ `#/duels/new/<CODE>`), Copy result (`⚔️ GeoGames duel: Ana 340 – Bo 290 (City Circle Arcade)`), All duels.
- Rematch banners:
  - For the player it's reserved for: "Ana has challenged you to a rematch" [Play it].
  - For its creator: "Rematch sent: waiting for Bo".
- Forfeit: "Bo didn't finish within 24 hours, so Ana wins." Bo's card shows "didn't finish".

**D. Other states**
- **Creator, state `playing`:** "Bo took your duel and is playing now. You'll see the result here." Polls.
- **Challenger with an unfinished session:** resumes play.
- **Taken (409):** "Someone else already played this duel." [Start your own duel] [All duels].
- **Reserved for someone else:** "This rematch is for Bo." [Start your own duel].
- **Creator on their own open duel:** never a Play button; they see the share panel.
- **Expired, no taker:** "Nobody took this duel within 7 days." [Start a new duel] for the creator.
- **Expired, data changed:** "The game was updated since this duel was made, so its circles can't be played any more."
- **Not found:** "This duel link doesn't work. Check you copied all of it."
- **Server unreachable:** "Duels live on the server, and we can't reach it right now." [Try again].
- **Local build:** "Duels need the GeoGames server."
- **`update-required`:** reuse DailyPage's "There's a new version of the game" [Reload].

**E. `#/duels` list**
- Header button "Start a new duel".
- Sections, each hidden when empty:
  - **Your turn:** rematches reserved for you, and duels you took but haven't finished.
  - **Waiting:** your open duels, with "Copy link", and duels your opponent is playing.
  - **Finished:** "Won 410–340 vs Ana · 3 days ago", with W/D/L chips.
- A per-opponent record, computed client-side: "vs Ana: 3–1–0".
- Empty state: "No duels yet. Play a City Circle Arcade run and challenge a friend to the same circles."
- Anonymous, with no duels: the account gate text plus "Got a link from a friend? Just open it: no account needed to play."

## 4. Data model: `supabase/migrations/20261121000000_duels.sql`

The same stance as before: RLS on, no policies, service_role only.

```sql
create table public.duels (
  code text primary key check (code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$'),
  game_id text not null,
  settings jsonb not null,
  seed bigint not null,
  dataset_version text not null,
  creator_id uuid not null references public.players (id) on delete cascade,
  creator_session uuid not null unique references public.game_sessions (id) on delete cascade,
  creator_level integer not null check (creator_level >= 1),
  challenger_id uuid references public.players (id) on delete cascade,
  challenger_session uuid unique references public.game_sessions (id) on delete cascade,
  reserved_for uuid references public.players (id) on delete cascade,
  rematch_of text references public.duels (code) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (challenger_id is null or challenger_id <> creator_id),
  check (reserved_for is null or reserved_for <> creator_id),
  check ((challenger_id is null) = (challenger_session is null))
);
create index duels_creator on public.duels (creator_id, created_at desc);
create index duels_challenger on public.duels (challenger_id, created_at desc) where challenger_id is not null;
create index duels_reserved on public.duels (reserved_for) where reserved_for is not null;
create index duels_rematch on public.duels (rematch_of) where rematch_of is not null;
alter table public.duels enable row level security;
revoke all on public.duels from public, anon, authenticated;
grant all on public.duels to service_role;
```

**Functions** (the contracts are fixed; write the bodies):

1. **`duel_source(p_session uuid, p_player uuid) returns jsonb`**
   - Returns the caller's own session as `{gameId, variant, settings, seed, datasetVersion, status, finishedAt, moves, score, duelCode}`, or null.
   - `duelCode` is the duel already made from it, if any.
2. **`create_duel(p_player, p_code, p_session, p_level, p_rematch_of, p_open_days, p_per_hour, p_max_open) returns jsonb`**
   - Lock the players row.
   - If a duel already exists for the session, return `{ok:true, code}` (idempotent).
   - Rate limits: more than `p_per_hour` duels created in the last hour, or `p_max_open` or more open duels → `{ok:false, error:'rate-limited'}`.
   - Rematch: the caller must be the creator or challenger of `p_rematch_of`, and it must have a challenger. Otherwise `forbidden`. `reserved_for` is the other participant.
   - Copy `game_id, settings, seed, dataset_version` from the session. `expires_at = now() + p_open_days days`.
   - On a primary-key clash, return `{ok:false, error:'code-taken'}`. The API retries with a new code.
3. **`duel_view(d duels, p_player, p_dataset_version, p_play_hours, p_with_moves) returns jsonb`**
   - The single source of truth for state. Joins both sessions and both players' names.
   - `you`: `creator`, `challenger` or `visitor`.
   - State:
     - **No challenger:**
       - `dataset_version` differs → `expired` (reason `outdated`);
       - past `expires_at` → `expired` (reason `time`);
       - otherwise `open`.
     - **With a challenger session `ch`:**
       - finished by `started_at + p_play_hours` → `finished`, outcome by score;
       - else past that deadline → `finished`, challenger `forfeit`, outcome `creator`;
       - else dataset differs → `expired` (reason `outdated`);
       - else `playing`.
   - **Hiding is done here:**
     - The challenger's score and duration only when `finished`.
     - Moves of both players only when `p_with_moves` and `finished`.
     - `session {sessionId, seed}` only for the challenger while `playing`.
   - Also returns `reservedFor` (a name), `reservedForYou`, and `rematch` (the newest duel with `rematch_of = d.code`, as `{code, forYou, byYou, state}`).
4. **`get_duel(p_code, p_player, p_dataset_version, p_play_hours)`**
   - `duel_view(..., true)`, or null.
5. **`list_duels(p_player, p_dataset_version, p_play_hours, p_limit)`**
   - Duels where the caller is creator or challenger, plus open duels reserved for the caller.
   - The last 60 days, newest first, without moves.
6. **`accept_duel(p_code, p_player, p_anonymous, p_default_name, p_dataset_version, p_per_minute, p_per_hour)`**
   - `ensure_player`, lock the player, then the duel `for update`.
   - Checks, in order:
     1. not found → `not-found`;
     2. already the challenger → `{ok, sessionId, seed}` of the existing session;
     3. the creator → `forbidden`;
     4. has a challenger → `taken`;
     5. reserved for someone else → `reserved`;
     6. expired or the dataset differs → `expired`;
     7. the same rate limits as `start_session` → `rate-limited`.
   - Then insert a `game_sessions` row with variant `'duel'` and the duel's settings, seed and dataset version. Set the challenger and return `{ok, sessionId, seed}`.
7. **Replace `get_me`** (same signature) so `bests` excludes variant `duel`.
8. **Replace `merge_players`** (same signature). Before moving sessions:
   - delete duels that would become self-duels;
   - repoint `creator_id`, `challenger_id` and `reserved_for` from `p_from` to `p_into`;
   - then the existing body.
9. End with the same revoke/grant `do $$` loop as the 2026-11-16 migration.

**Unchanged:**
- `start_session` limits already count duel sessions.
- `finish_session` works as-is.
- Leaderboards are per variant, so `duel` never mixes in.
- Deleting a player cascades to their duels.

## 5. API

**`packages/games/src/api-contract.ts`**
- Constants: `DUEL_GAMES = ['city-circle-arcade']`, `DUEL_VARIANT = 'duel'`, `DUEL_OPEN_DAYS = 7`, `DUEL_PLAY_HOURS = 24`.
  - Export these as values from index.ts, as MIN_PASSWORD_LENGTH is.
- Requests and responses:
  - `CreateDuelRequest {sessionId; rematchOf?}` / `CreateDuelResponse {code}`;
  - `AcceptDuelRequest {datasetVersion}` / `AcceptDuelResponse {sessionId, seed}`;
  - `DuelListResponse {duels: DuelDto[]}`.
- `DuelState = 'open'|'playing'|'finished'|'expired'`.
- `DuelPlayerDto`:
  - `name`;
  - `score` (null until it may be shown);
  - `level` (null for the challenger here);
  - `status` (`'playing'|'finished'|'forfeit'`);
  - `durationSec`;
  - `moves?` (only when finished).
- `DuelDto`:
  - `code, gameId, settings, createdAt, expiresAt`;
  - `you` (`'creator'|'challenger'|'visitor'`);
  - `state`, `expiredReason?` (`'time'|'outdated'`);
  - `creator`, `challenger | null`;
  - `reservedFor: string | null`, `reservedForYou`;
  - `outcome` (`'creator'|'challenger'|'draw'|null`);
  - `session?: {sessionId, seed}`;
  - `rematch: {code, forYou, byYou, state} | null`.
- Add `'account-required'` and `'duel-unavailable'` to `ApiErrorCode`.

**`packages/games/src/replay.ts`**
- Add `arcadeRunSummary(settings, seed, moves) → {score, level, cleared, finished}`, using the cached arcade. Export it.

**`apps/api/src/app.ts`**
- Add to `Limits`: `duelsPerHour: 20`, `openDuelsMax: 20`.
- Codes are 8 characters from `23456789ABCDEFGHJKMNPQRSTUVWXYZ`, made with `crypto.getRandomValues`.
- Uppercase the code param first, so pasted lowercase works. A code of the wrong format is a 404.

`POST /duels` (signedIn):
1. An anonymous caller → 403 `account-required`.
2. Validate the body. `sessionId` must be a UUID; `rematchOf`, if present, must be a valid code.
3. Call `duel_source`:
   - null → 404;
   - not a duel game, a `duel` variant or `daily-*` → 400;
   - not finished → 422 `unfinished-game`;
   - finished more than 24 h ago → 400;
   - an old dataset → 409 `update-required`;
   - `duelCode` set → 200 `{code}`.
4. Get the level from `arcadeRunSummary`.
5. Call `create_duel`, with up to 3 tries on `code-taken`. Map `rate-limited` → 429 and `forbidden` → 403.
6. Return 201 `{code}`.

`GET /duels` (signedIn):
- `list_duels` with limit 50.

`GET /duels/:code` (signedIn, anonymous fine):
- `get_duel`, or 404. Return the DTO as is: hiding is done in SQL.

`POST /duels/:code/accept` (signedIn, anonymous fine):
1. Body `datasetVersion` ≠ `DATASET_VERSION` → 409 `update-required`.
2. Call `accept_duel` and map the result:
   - `not-found` → 404;
   - `forbidden` or `reserved` → 403;
   - `taken` or `expired` → 409 `duel-unavailable`;
   - `rate-limited` → 429;
   - ok → 200.

The challenger finishes through the usual POST /sessions/:id/finish.

## 6. Web

**Router** (`router.ts`):
- Routes:
  - `{page:'duels'}`;
  - `{page:'duel-new', rematchOf?}`;
  - `{page:'duel', code}`.
- Parse `duels/new` before `duels`.
- `routeTitle`: "Duels", "New duel" and "Duel".
- Wire all three in App.tsx.

**Platform:**
- **`backend.ts`:**
  - Add `duels?: DuelService`, undefined in the local backend:
    - `create(sessionId, rematchOf?)`;
    - `list()`;
    - `get(code)` (null when not found);
    - `accept(code)` → `{status:'ok', play} | {status:'unavailable'|'forbidden'|'update-required'|'offline'}`.
  - The others throw a `DuelError` with a reason.
- **`api-backend.ts`:** implement it.
- **`PlatformProvider.tsx`:** expose it.

**`GamePage.tsx`:**
- Keep `play` in the `over` phase.
- For a game in `DUEL_GAMES` whose result is saved with a `sessionId`, show "⚔️ Challenge a friend to these circles":
  - signed in → create the duel and navigate;
  - anonymous → the gate.

**`pages/NewDuelPage.tsx`:**
- The gate when the player isn't signed in.
- Otherwise a copy of the GamePage flow, using the arcade's remembered settings: `startPlay` → GameScreen → `finishPlay` → `duels.create(sessionId, rematchOf)` → navigate.

**`pages/DuelPage.tsx`:**
- A phase machine like DailyPage. Render by `dto.state` and `dto.you`, following §3.
- **Playing:** reuse GameScreen from `games/registry.tsx` with the duel's settings and seed, and persist moves as DailyPage does.
- **Result table:** `components/DuelLevels.tsx`.
- **Polling:**
  - When to poll: you are the creator and the state is `open` or `playing`, or a rematch you sent is pending.
  - Every 20 s while the tab is visible. Re-fetch on `visibilitychange`.
  - Stop after 15 min and show a Refresh button.
- **Share:** `navigator.share`, otherwise the clipboard. The URL is `location.origin + location.pathname + href(...)`.

**`pages/DuelsPage.tsx`:**
- The grouped list and the per-opponent record, as in §3E.

**Header and Home:**
- **`SiteHeader.tsx`:** a "Duels" link with `aria-current` on the duel routes, in the hamburger menu too.
- **`Home.tsx`:** the Duels teaser card.

**`styles.css`:**
- Classes: `.duel-strip`, `.duel-cards` (a grid of 2, 1 column under 640 px), `.duel-levels`, and W/D/L chips.
- Use the Paper Atlas tokens: the teal accent for wins, brass for draws.

## 7. Tests

**Engine** (`circle-arcade.test.ts`):
1. **The duel premise.** For 5 seeds, play one run by solving levels and another by skipping with hints. The circles (center, radius, top cities) match for every level both reached.
2. `arcadeRunSummary` agrees with `replayGame`.

**API** (`app.test.ts` style):
- Add `delete from public.duels` to `beforeEach`, before `game_sessions`.
- Helper: `makeDuel(token)` (a `playArcade` run, then POST /duels).

Cases:
1. Create gives 201 and an 8-character code. A second POST for the same session returns the same code.
2. Anonymous create → 403 `account-required`.
3. Refusals:
   - unfinished → 422;
   - another player's session → 404;
   - not arcade → 400;
   - a daily session → 400;
   - a duel session → 400;
   - a session finished more than 24 h ago (backdate `finished_at`) → 400.
4. A visitor's GET while open:
   - the creator's score and level are shown;
   - the seed appears nowhere in the JSON;
   - no `session` and no moves.
5. Accept:
   - the same seed as A's run;
   - accepting again returns the same session;
   - a third player → 409;
   - the creator → 403.
6. While B plays:
   - A sees `playing` with the challenger's score null and no moves;
   - B's GET has `session`.
7. B finishes through `/sessions/:id/finish`:
   - `finished`, the outcome is right, and both see both move lists;
   - equal scores give a draw.
8. B's duel run is on no global leaderboard and not in `/me` bests. A's run stays on A's board.
9. Expiry: `expires_at` in the past → `expired/time`, accept 409. A changed dataset → `expired/outdated`.
10. Forfeit: the challenger's `started_at` 25 h ago → `finished`, `forfeit`, creator wins.
11. Rematch:
    - reserved for the other player, and a stranger gets 403;
    - the reserved player can accept;
    - a non-participant can't make one;
    - the original's `rematch` field shows it.
12. List: the right duels with the right `you`, including a rematch reserved for the caller.
13. Merge: an anonymous challenger logs in to an account and the duel moves with them. A duel that would become a self-duel is deleted.
14. DELETE /me removes the creator's duels.
15. Rate limits: `duelsPerHour: 1` → the second create is 429. `openDuelsMax` → 429.
16. A bad code format → 404. A lowercase code works.

**Router unit test:** round trips for the three new routes.

**Playwright** (`api.spec.ts` style, against the dev API, with two `browser.newContext()`):
1. **Happy path:**
   - A creates an account, plays `#/duels/new` by skipping until out of lives, and lands on `#/duel/CODE`.
   - B (anonymous) opens the link, sees "challenges you" and A's score, presses Play, finds level 1's top city (computed with the engine from the `/accept` seed), then skips out.
   - B sees "You win!". A sees "wins" after a poll or reload. The level table shows both.
2. **Taken:** a third context sees "Someone else already played this duel."
3. **Gate:** anonymous `#/duels/new` shows the gate. Create account returns to `#/duels/new`.
4. **Resume:** B reloads mid-run and keeps the level and guesses.
5. **Layout:** at 390×844 the strip, map and input are visible without scrolling, and the result cards stack.

## 8. Build order (each step green before the next)

1. Engine helper, constants, contract types and error codes. Engine tests.
2. Migration and functions. The PGlite migrations run.
3. API create and get. Tests 1–4 and 16.
4. API accept, list, state, merge and limits. Tests 5–15.
5. Web platform DuelService and router.
6. DuelPage (all states, share, resume, polling) and NewDuelPage (gate).
7. The GamePage button, DuelsPage, header link, Home card and styles.
8. DuelLevels table, rematch flow and banners.
9. Playwright e2e and screenshots at desktop and 390×844.
10. Optional: a "your turn" header badge.

**Later:**
- More games: any engine whose next puzzle doesn't depend on the moves (Border Route? Pin Drop?).
- A live race mode over Realtime Broadcast, with cosmetic progress messages only. The result still comes from replay.
