# Duels rework (branch game/duels-more) — hand-off notes

Task: the user's feedback on Duels (2026-11-20): card-grid picker, "Challenge a friend" at the end of every
duel-able run (arcade and daily), and "Random or Today's daily" when starting a duel.

## Plan / decisions
1. **SQL**: edit the undeployed `supabase/migrations/20261121000000_duels.sql` in place (one file, no churn).
   - `duels.daily_date date` (null = random duel), `duels.accepted_at timestamptz` (the 24 h clock starts at accept,
     because a daily challenger may link a run they started earlier).
   - `challenger_session` no longer unique for daily duels (one daily run can answer several daily duels):
     partial unique index where `daily_date is null`.
   - `accept_duel` for a daily duel of day D (today T, UTC):
     - the accepter's daily run of D finished → linked, result at once;
     - unfinished and D = T → linked (their one daily; reset if on old data, like start_daily_session);
     - none and D = T → their daily run of D is created (uses their one daily play, counts on the board);
     - D < T and none (or unfinished on old data) → a fresh `duel` variant run on D's seed (doesn't count on D's board).
   - `duel_view` hides seed and moves of a daily duel unless the viewer finished that day's daily, or has no daily run
     of that day and the day is over (so nobody can read the answers and then finish their own daily).
   - DTO adds `daily` (date or null), `yourDaily` ({status, score} of the viewer's own run of that day), `session.variant`.
2. **API**: POST /duels accepts finished daily runs of DAILY_GAMES.
3. **Web**:
   - `#/duels/new`: card grid like Home/Dailies (GameCardArt cards, grouped); card → `#/duels/new/<game>` start step.
   - Start step: for daily games, "Random run" or "Today's daily" choice; daily uses startDaily (reuses a finished run).
   - GamePage + DailyPage: "Challenge a friend" always shown for duel-able games (server builds). Saved run → duel of
     that exact run; anonymous → sign-in, returning to `#/duels/new/<sessionId>` which makes the duel; unsaved run →
     fresh duel of the game.
   - DuelPage: daily copy, daily moves key shared with DailyPage.

## Status
- [x] SQL + API + API tests (7 new "daily duels" tests in apps/api/src/app.test.ts)
- [x] web (ChallengeFriend component, NewDuelPage card grid + random/daily, DuelPage daily copy) — typecheck + 497 unit tests pass
- [x] e2e (updated picker tests, new: challenge-after-sign-in, daily duel) — [ ] screenshots
- [ ] docs/ideas/duels.md
