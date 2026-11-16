# Backend plan

Status: **built and deployed**. Since 2026-11-16 the game is free: plans and subscriptions are gone (see migration `20261116000000_free_accounts_feedback.sql` and [google-sign-in.md](google-sign-in.md) for accounts). The plan below is kept as written. How to deploy and run it is in [deploy.md](deploy.md).

What changed from the plan below while building it: the API runs on **Supabase Edge Functions**, not Cloudflare Workers (about 2 s CPU per request instead of 10 ms, so replays fit without extra work, and one provider to manage). The site goes on **GitHub Pages**. Local development and tests use **PGlite** instead of the Supabase CLI's Docker stack. Replay data is slimmed when bundling (`apps/api/scripts/bundle.ts`). Weekly leaderboards aren't built yet.

## Decision

- **Reference data stays static.** Countries and cities remain versioned files built offline (`packages/geodata`). No database for them: they're read-only, the same for everyone, and cheap to serve from a CDN. The server imports the same packages to verify games. Revisit only for map games with polygons or very large place sets (then PostGIS). The build pipeline may use SQLite/DuckDB internally if processing gets unwieldy, but it still outputs static files.
- **Player data goes into Postgres behind our own API.** Accounts, game sessions, scores, plays and subscriptions are mutable, per player, and must be trusted by the server.

## Architecture

- `apps/api`: a TypeScript API built with **Hono** (runs unchanged on Cloudflare Workers, Node and Deno, so hosting stays open). It imports `@geogames/games` and `@geogames/geodata` to replay games.
- **Supabase** for Postgres and sign-in. Local development uses the Supabase CLI (requires Docker).
- The web app keeps its seams: swap the local `ScoreService`, `EntitlementService` and `Player` implementations in `PlatformProvider.tsx` for API-backed ones. Game screens don't change.

### Game sessions (server-authoritative)

1. `POST /sessions {gameId, settings}`: the server checks the plan, spends a free play, picks the **seed**, and records `started_at`.
2. The client plays with that seed.
3. `POST /sessions/:id/finish {moves}`: the server replays with the shared engine, computes the score (and the time, for timed modes) and stores it.

This closes current holes: seed fishing (the client picks its seed today), resettable free-play counters (localStorage), and forged times. Each session stores the **dataset version**, so old games still replay after a data update.

### Tables (sketch)

- `players`: id, display name, auth user id
- `game_sessions`: id, player_id, game_id, variant, settings jsonb, seed, dataset_version, started_at, finished_at, moves jsonb, score, status
- `subscriptions`: player_id, plan, provider ids, period end (Stripe later)
- Leaderboards: queries or views over finished sessions (all-time, weekly; per game and variant)

## Hosting ($0 for the MVP)

| Piece | Choice | Free-tier catch | First paid step |
|---|---|---|---|
| Web app | Cloudflare Pages (or GitHub Pages) | None of note | n/a |
| API | Cloudflare Workers Free: 100k requests/day | 10 ms CPU per request | Workers Paid, $5/month |
| DB + auth | Supabase Free: 500 MB, 50k MAU | Pauses after 7 days without activity | Supabase Pro, $25/month |

- **CPU limit:** replaying a game must not parse large city files on the server. Build slim per-pool files (ids + metric values only) for verification. Upgrade Workers to $5/month if that's still too tight.
- **Pausing:** real players keep the project active. Until there are any, a daily scheduled ping does.
- **Rejected:** Render Free (15-minute sleep with about a minute to wake; free Postgres expires after 30 days). Railway and Fly.io have no lasting free tier.
- Prices as checked on 2026-10-31 (mostly third-party summaries). Re-check supabase.com/pricing and the Cloudflare pricing pages before deploying.

## Order of work

1. `apps/api` (Hono) + local Supabase; migrations for the tables above.
2. Session endpoints with server seeds and replay verification (slim server-side pools).
3. API-backed `Player` (sign-in), `ScoreService` (global and weekly leaderboards) and `EntitlementService`.
4. Deploy: Pages + Workers + Supabase.
5. Later: Stripe feeding `EntitlementService`; timed game modes.
