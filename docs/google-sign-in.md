# Setting up "Sign in with Google"

Everyone plays at once as an anonymous Supabase user. "Sign in with Google" links a Google account to that same user, so earlier scores are kept, and puts the player on the public leaderboards (anonymous players only see their own bests). If the Google account already belongs to another GeoGames player (say, from another device), the browser signs in to that account instead and the API moves this browser's anonymous games into it.

You do this once, in two dashboards. No secret goes into the repository: the Google client secret lives only in Supabase.

You need your Supabase **project ref**: the `abcdefgh` in `https://abcdefgh.supabase.co` (Project Settings → General).

## 1. Google Cloud project

1. Open [console.cloud.google.com](https://console.cloud.google.com/) and sign in.
2. Project picker (top left) → **New project**. Name: `GeoGames`. Create, then make sure it's selected.

## 2. OAuth consent screen

1. Menu → **APIs & Services → OAuth consent screen** (newer consoles call it **Google Auth Platform → Branding**). Click **Get started** if asked.
2. **App information**: App name `GeoGames`; User support email: your address.
3. **Audience**: **External**.
4. **Contact information**: your address. Agree to the policy and **Create**.
5. **Branding** (or "Edit app"):
   - Application home page: `https://werzawerz.github.io/geogames/`
   - Application privacy policy link: `https://werzawerz.github.io/geogames/#/privacy`
   - Application terms of service link: `https://werzawerz.github.io/geogames/#/terms`
   - Authorised domains: add `werzawerz.github.io` and `supabase.co`.
   - A logo is optional. Adding one means Google has to verify the app, which takes days; leave it out to start.
6. **Data access** (or **Scopes**): add only `openid`, `.../auth/userinfo.email` and `.../auth/userinfo.profile`. These are non-sensitive, so no review is needed.
7. **Audience → Publishing status**: click **Publish app** (to "In production"). While it says "Testing", only the test users you list can sign in.

## 3. OAuth client

1. **APIs & Services → Credentials** (or **Google Auth Platform → Clients**) → **Create credentials → OAuth client ID**.
2. Application type: **Web application**. Name: `GeoGames Supabase`.
3. **Authorised JavaScript origins**: `https://werzawerz.github.io` (and `http://localhost:5317` if you want to try it locally).
4. **Authorised redirect URIs**: `https://<project-ref>.supabase.co/auth/v1/callback`. Google returns to Supabase, never to the site directly.
5. **Create**. Copy the **Client ID** and **Client secret**. Keep the secret out of the repository, chats and screenshots.

## 4. Supabase dashboard

In [supabase.com/dashboard](https://supabase.com/dashboard) → your project → **Authentication**:

1. **Sign In / Providers → Google**: enable it, paste the Client ID and Client secret, **Save**. Leave "Skip nonce checks" off.
2. **Sign In / Providers → User Signups** (same page, top):
   - **Allow anonymous sign-ins**: on (it already is if you followed deploy.md).
   - **Allow manual linking**: on. Without it, "Sign in with Google" fails, since it links Google to the anonymous player.
3. **URL Configuration**:
   - **Site URL**: `https://werzawerz.github.io/geogames/`
   - **Redirect URLs**: add
     - `https://werzawerz.github.io/geogames/`
     - `http://localhost:5317/**` (local dev; covers `http://localhost:5317/` and `http://localhost:5317/geogames/`)

     The app sends players back to the page's own address without the `#/...` part, so these are enough; it puts the player back on the page they were on.
4. Optional, **Rate Limits**: the anonymous sign-in limit (30 an hour per IP by default) also caps how fast a script can make new players. Leave it.

## 5. Check it

1. Open `https://werzawerz.github.io/geogames/` in a private window, play a game, then press **Sign in with Google** in the header.
2. After Google, you're back on the same page, signed in, and your game is in "Your best" and on the global leaderboard.
3. In Supabase → Authentication → Users, the user now shows the Google provider (same user id as before).

## How it works (for reference)

- The web app uses Supabase's **PKCE** flow (`flowType: 'pkce'`). The implicit flow would put tokens in the URL fragment, where the hash router keeps its routes. With PKCE, Supabase redirects to `https://werzawerz.github.io/geogames/?code=...`; the library swaps the code for a session on load, and the app restores the `#/...` route it saved in `sessionStorage` before leaving (`apps/web/src/platform/auth.ts`).
- The API decides who is on public leaderboards from the verified token (Supabase Auth's `is_anonymous`), never from what the browser says.
- **Account already exists:** linking fails with `identity_already_exists`. The app then signs in to that account with Google (a second, usually instant, trip) and calls `POST /api/me/merge` with the anonymous player's token, which it kept for that moment. The API checks both tokens, moves the anonymous player's games into the account (where both played the same daily challenge, the account's run is kept) and deletes the anonymous user. If the merge fails (say, more than an hour passed and the old token expired), those games are left behind; the account itself is unaffected.
- **Sign out** forgets the session in this browser only (other devices stay signed in) and continues as a fresh anonymous player.
- **Delete account** (`DELETE /api/me`) deletes the player's games, feedback and Supabase user, using the service key that only the Edge Function has.

## Local development

`npm run dev:api` doesn't talk to Supabase: its made-up sign-in (`createDevAuth`) "signs in" by keeping the same player id and marking it as signed in, so leaderboards and the account state can be tried without Google. To try real Google sign-in locally, put `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` of the real project in `apps/web/.env.local` next to `VITE_API_URL`, and add the localhost redirect URL above.

`supabase/config.toml` mirrors these settings for the Supabase CLI's local stack (`supabase start`), reading the Google client from the environment variables `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`. The hosted project does not read config.toml (the deploy workflow doesn't push it); set it in the dashboard as above.
