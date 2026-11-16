-- The first public version is free: no plans or subscriptions, and no daily play
-- limit unless the API is configured with one (FREE_PLAYS_PER_DAY). Adds what
-- real accounts need: which players are anonymous (public leaderboards only show
-- signed-in players), deleting a player, moving an anonymous player's games into
-- the account they signed in to, caps on how fast one player can start and
-- finish games, and a feedback inbox.

drop function public.get_me(uuid, text, integer);
drop function public.start_session(uuid, text, text, text, jsonb, bigint, text, integer);
drop function public.start_daily_session(uuid, text, text, text, jsonb, bigint, text);
drop function public.finish_session(uuid, uuid, jsonb, integer);
drop function public.allowance(uuid, integer);
drop function public.player_plan(uuid);
drop table public.subscriptions;

-- Set by the API from the verified token on every signed-in call. True until the
-- player links a Google account; linking can't be undone, so it never goes back.
alter table public.players add column anonymous boolean not null default true;

-- Signs a player up on first use and records that they're signed in once they are.
create function public.ensure_player(p_player uuid, p_anonymous boolean, p_default_name text) returns void
language sql as $$
  insert into public.players (id, name, anonymous) values (p_player, p_default_name, p_anonymous)
  on conflict (id) do update set anonymous = false
    where players.anonymous and not excluded.anonymous
$$;

create function public.get_me(p_player uuid, p_anonymous boolean, p_default_name text) returns jsonb
language plpgsql as $$
begin
  perform public.ensure_player(p_player, p_anonymous, p_default_name);
  return jsonb_build_object(
    'name', (select name from public.players where id = p_player),
    'bests', coalesce((
      select jsonb_object_agg(game_id, variants) from (
        select game_id, jsonb_object_agg(variant, best) as variants from (
          select game_id, variant, max(score) as best
          from public.game_sessions
          where player_id = p_player and status = 'finished'
          group by game_id, variant
        ) by_variant
        group by game_id
      ) by_game
    ), '{}'::jsonb)
  );
end
$$;

-- Opens a session. Refuses when the player started too many games in the last
-- minute or hour (scripted floods), or, only when the API passes a daily limit,
-- when today's plays are used up. The row lock makes one player's simultaneous
-- requests wait for each other, so they can't overrun either.
create function public.start_session(
  p_player uuid,
  p_anonymous boolean,
  p_default_name text,
  p_game_id text,
  p_variant text,
  p_settings jsonb,
  p_seed bigint,
  p_dataset_version text,
  p_daily_limit integer,
  p_per_minute integer,
  p_per_hour integer
) returns jsonb
language plpgsql as $$
declare
  session_id uuid;
begin
  perform public.ensure_player(p_player, p_anonymous, p_default_name);
  perform 1 from public.players where id = p_player for update;
  if (select count(*) from public.game_sessions g
      where g.player_id = p_player and g.started_at > now() - interval '1 minute' and g.variant not like 'daily-%') >= p_per_minute
    or (select count(*) from public.game_sessions g
      where g.player_id = p_player and g.started_at > now() - interval '1 hour' and g.variant not like 'daily-%') >= p_per_hour
  then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;
  if p_daily_limit is not null and (
    select count(*) from public.game_sessions g
    where g.player_id = p_player and g.started_at >= public.day_start() and g.variant not like 'daily-%'
  ) >= p_daily_limit then
    return jsonb_build_object('ok', false, 'error', 'play-limit');
  end if;
  insert into public.game_sessions (player_id, game_id, variant, settings, seed, dataset_version)
  values (p_player, p_game_id, p_variant, p_settings, p_seed, p_dataset_version)
  returning id into session_id;
  return jsonb_build_object('ok', true, 'sessionId', session_id);
end
$$;

-- As before, plus recording whether the player is signed in.
create function public.start_daily_session(
  p_player uuid,
  p_anonymous boolean,
  p_default_name text,
  p_game_id text,
  p_variant text,
  p_settings jsonb,
  p_seed bigint,
  p_dataset_version text
) returns jsonb
language plpgsql as $$
declare
  s public.game_sessions;
begin
  perform public.ensure_player(p_player, p_anonymous, p_default_name);
  insert into public.game_sessions (player_id, game_id, variant, settings, seed, dataset_version)
  values (p_player, p_game_id, p_variant, p_settings, p_seed, p_dataset_version)
  on conflict (player_id, game_id, variant) where variant like 'daily-%' do update
    set dataset_version = excluded.dataset_version, seed = excluded.seed, started_at = now()
    where game_sessions.status = 'playing' and game_sessions.dataset_version <> excluded.dataset_version;
  select * into s from public.game_sessions
  where player_id = p_player and game_id = p_game_id and variant = p_variant;
  return jsonb_build_object('sessionId', s.id, 'seed', s.seed, 'status', s.status, 'score', s.score);
end
$$;

create index game_sessions_player_finished on public.game_sessions (player_id, finished_at) where status = 'finished';

-- Stores the verified result. Finishing twice keeps the first result, so a retry
-- after a lost connection gets the same answer. A player who finished too many
-- games in the last minute or hour is refused (the game stays open).
create function public.finish_session(
  p_session uuid,
  p_player uuid,
  p_moves jsonb,
  p_score integer,
  p_per_minute integer,
  p_per_hour integer
) returns jsonb
language plpgsql as $$
declare
  s public.game_sessions;
  previous_best integer;
begin
  perform 1 from public.players where id = p_player for update;
  select * into s from public.game_sessions where id = p_session and player_id = p_player for update;
  if not found then
    return null;
  end if;
  if s.status = 'playing' and (
    (select count(*) from public.game_sessions g
     where g.player_id = p_player and g.status = 'finished' and g.finished_at > now() - interval '1 minute') >= p_per_minute
    or (select count(*) from public.game_sessions g
     where g.player_id = p_player and g.status = 'finished' and g.finished_at > now() - interval '1 hour') >= p_per_hour
  ) then
    return jsonb_build_object('error', 'rate-limited');
  end if;
  select coalesce(max(score), 0) into previous_best from public.game_sessions
  where player_id = p_player and game_id = s.game_id and variant = s.variant and status = 'finished' and id <> s.id;
  if s.status = 'playing' then
    update public.game_sessions
    set status = 'finished', finished_at = now(), moves = p_moves, score = p_score
    where id = s.id
    returning * into s;
  end if;
  return jsonb_build_object(
    'score', s.score,
    'isPersonalBest', s.score > previous_best,
    'personalBest', greatest(previous_best, s.score)
  );
end
$$;

-- Each signed-in player's best game, best first; the earlier game wins a tie.
-- Anonymous players keep their personal bests but aren't listed here.
create or replace function public.leaderboard_global(p_game_id text, p_variant text, p_limit integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'playerName', player_name, 'score', score, 'playedAt', finished_at) order by score desc, finished_at), '[]'::jsonb)
  from (
    select * from (
      select distinct on (g.player_id) g.id, p.name as player_name, g.score, g.finished_at
      from public.game_sessions g
      join public.players p on p.id = g.player_id
      where g.game_id = p_game_id and g.variant = p_variant and g.status = 'finished' and g.score > 0 and not p.anonymous
      order by g.player_id, g.score desc, g.finished_at
    ) best
    order by score desc, finished_at
    limit p_limit
  ) ranked
$$;

-- Everything about a player; the API deletes their sign-in account right after.
create function public.delete_player(p_player uuid) returns boolean
language sql as $$
  delete from public.players where id = p_player returning true
$$;

-- Moves an anonymous player's games into the account they signed in to (the
-- browser had both: its anonymous session, then the account's). A daily
-- challenge both played keeps the account's run. The anonymous player is deleted;
-- the API deletes its sign-in account too.
create function public.merge_players(p_from uuid, p_into uuid, p_default_name text) returns integer
language plpgsql as $$
declare
  moved integer;
begin
  if p_from = p_into or not exists (select 1 from public.players where id = p_from and anonymous) then
    return 0;
  end if;
  perform public.ensure_player(p_into, false, p_default_name);
  update public.game_sessions g set player_id = p_into
  where g.player_id = p_from
    and not (g.variant like 'daily-%' and exists (
      select 1 from public.game_sessions mine
      where mine.player_id = p_into and mine.game_id = g.game_id and mine.variant = g.variant
    ));
  get diagnostics moved = row_count;
  delete from public.players where id = p_from;
  return moved;
end
$$;

-- Messages from the feedback form. Nobody reads them through the API; look in the
-- dashboard. Deleting a player deletes their messages too.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players (id) on delete cascade,
  message text not null check (char_length(message) between 1 and 2000),
  email text check (char_length(email) <= 254),
  page text check (char_length(page) <= 200),
  -- A salted hash, not the address: enough to rate-limit, nothing to leak.
  ip_hash text,
  created_at timestamptz not null default now()
);

create index feedback_player_created on public.feedback (player_id, created_at);
create index feedback_ip_created on public.feedback (ip_hash, created_at);

alter table public.feedback enable row level security;
revoke all on public.feedback from public, anon, authenticated;
grant all on public.feedback to service_role;

create function public.submit_feedback(
  p_player uuid,
  p_anonymous boolean,
  p_default_name text,
  p_message text,
  p_email text,
  p_page text,
  p_ip_hash text,
  p_per_player_hour integer,
  p_per_ip_hour integer
) returns jsonb
language plpgsql as $$
begin
  perform public.ensure_player(p_player, p_anonymous, p_default_name);
  perform 1 from public.players where id = p_player for update;
  if (select count(*) from public.feedback f
      where f.player_id = p_player and f.created_at > now() - interval '1 hour') >= p_per_player_hour
    or (p_ip_hash is not null and (select count(*) from public.feedback f
      where f.ip_hash = p_ip_hash and f.created_at > now() - interval '1 hour') >= p_per_ip_hour)
  then
    return jsonb_build_object('ok', false);
  end if;
  insert into public.feedback (player_id, message, email, page, ip_hash)
  values (p_player, p_message, p_email, p_page, p_ip_hash);
  return jsonb_build_object('ok', true);
end
$$;

-- Only the API may run these.
do $$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature from pg_proc p
    where p.pronamespace = 'public'::regnamespace
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn.signature);
    execute format('grant execute on function %s to service_role', fn.signature);
  end loop;
end
$$;
