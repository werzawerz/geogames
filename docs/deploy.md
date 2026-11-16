# Deploying

| Piece | Where | Code |
|---|---|---|
| Frontend | GitHub Pages (static files) | `apps/web` |
| Backend API | Supabase Edge Function `api` | `apps/api`, bundled into `supabase/functions/api/index.ts` |
| Database and sign-in | Supabase | `supabase/migrations` |

Pushing to `main` runs `.github/workflows/deploy.yml`: all tests, then database migrations, then the API, then the site.

## First-time setup

### 1. Supabase

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard). Save the **database password**; pick a region near your players.
2. Note the **project ref**: the `abcdefgh` in `https://abcdefgh.supabase.co` (also in Project Settings → General).
3. Copy the **publishable key** from Project Settings → API Keys (`sb_publishable_...`). On a project that only shows the older keys, use the `anon` key.
4. Turn on **Allow anonymous sign-ins** under Authentication → Sign In / Providers.
5. Create an **access token** at [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens).

### 2. GitHub

1. Create a repository. GitHub Pages is free for public repositories; private ones need a paid plan. Nothing secret is in the code.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions:

| Kind | Name | Value |
|---|---|---|
| Secret | `SUPABASE_ACCESS_TOKEN` | the access token |
| Secret | `SUPABASE_DB_PASSWORD` | the database password |
| Variable | `SUPABASE_PROJECT_ID` | the project ref |
| Variable | `SUPABASE_PUBLISHABLE_KEY` | the publishable key |

### 3. Push

```sh
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

The site appears at `https://<you>.github.io/<repo>/`. Check the API at `https://<project-ref>.supabase.co/functions/v1/api/health`.

## Checks before a deploy

`deploy.yml` starts with the shared `check.yml`: first `npm run typecheck` and `npx vitest run`, then, only if those pass, the browser tests. The backend and the site deploy only after all of it passes.

## Day to day

- **Change of schema:** add a file to `supabase/migrations`. Tests run it too; the deploy applies it.
- **Unlimited plays for yourself:** set your display name in the app, then in the Supabase SQL editor:
  ```sql
  insert into public.subscriptions (player_id)
  select id from public.players where name = 'Your Name';
  ```
- **Other free-play limit:** `npx supabase secrets set FREE_PLAYS_PER_DAY=20 --remote=<project-ref>` (default 5).
- **Restrict the API to your site** (optional, any origin works by default): `npx supabase secrets set ALLOWED_ORIGINS=https://<you>.github.io --remote=<project-ref>`.
- **Paused project:** free projects pause after a week without activity. `keep-alive.yml` pings the API's `/health` endpoint (which runs a database query) every 3 days to prevent it. It builds the URL from the `SUPABASE_PROJECT_ID` repository variable the deploy already uses, needs no secret, and does nothing until that variable is set. Run it by hand from the Actions tab to test. If it pauses anyway, games keep working locally, and scores don't reach the leaderboard until you restore it in the dashboard.

## Running it locally

No accounts or Docker needed. The API runs on real Postgres in memory (PGlite) with the real migrations and made-up sign-ins; data is gone on restart.

```sh
npm run dev:api                                # API on http://localhost:5321/api
# in apps/web/.env.local: VITE_API_URL=http://localhost:5321/api
npm run dev                                    # site on http://localhost:5317
```

Without `.env.local` the site runs in the browser alone. `npm run e2e` covers both modes.

`npm run smoke -w @geogames/api` (after `npm run build:api`) runs the deployable bundle in Deno, Supabase's runtime, against a stand-in for Supabase's HTTP API.

## How a game is verified

1. `POST /sessions`: the server checks the daily limit, picks the seed and opens a session.
2. The browser plays with that seed.
3. `POST /sessions/:id/finish`: the server replays the moves with the same engines (`packages/games/src/replay.ts`) and stores the score it computes. A score sent by the client is ignored.

This stops forged scores and looking for a lucky seed, but not a player who uses a bot or looks answers up. Anonymous players can reset their free plays by clearing browser data, as there's no real account to tie them to yet.

The daily challenge works the same way, with one session per player, game and day. Its seed is a hash of the date, the game and the project's secret key, so nobody can work out a coming day's run. Leaving and coming back resumes the run from moves kept in the browser; clearing browser data gets a new anonymous player and so a new try, until real accounts exist.

Frontend and API must be on the same game data. Sessions are stamped with `DATASET_VERSION`, and a client on other data is asked to reload. A game in progress during a deploy that changes data loses its score.

## Limits on the free plans

Checked 2026-11-02; re-check at supabase.com/pricing.

- Edge Functions: 500,000 calls a month, about 2 s CPU per request (a test requires replaying a 40-level arcade game to stay under 1.5 s, on a development machine), 5 MB bundle (`npm run build:api` fails above it; slim the data in `apps/api/scripts/bundle.ts`).
- Database: 500 MB. Each game stores its moves, so old sessions are what to trim first.
