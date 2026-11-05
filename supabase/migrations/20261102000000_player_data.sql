-- Player data: accounts, game sessions, subscriptions.
--
-- Nothing here is reachable from the browser: tables have row level security
-- with no policies, and functions can only be run by service_role, which is what
-- the API uses. The rules that must hold under concurrent requests (the daily
-- play limit, finishing a game once) live in these functions.

create table public.players (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 24),
  created_at timestamptz not null default now()
);

create table public.subscriptions (
  player_id uuid primary key references public.players (id) on delete cascade,
  plan text not null default 'premium' check (plan in ('premium')),
  provider text,
  provider_id text,
  -- Null never expires: for plans granted by hand.
  current_period_end timestamptz,
  created_at timestamptz not null default now()
);

create table public.game_sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id) on delete cascade,
  game_id text not null,
  variant text not null,
  settings jsonb not null,
  seed bigint not null,
  dataset_version text not null,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  moves jsonb,
  score integer,
  check (status = 'playing' or (finished_at is not null and moves is not null and score is not null))
);

create index game_sessions_leaderboard on public.game_sessions (game_id, variant, score desc, finished_at)
  where status = 'finished';
create index game_sessions_player_started on public.game_sessions (player_id, started_at);

alter table public.players enable row level security;
alter table public.subscriptions enable row level security;
alter table public.game_sessions enable row level security;
revoke all on public.players, public.subscriptions, public.game_sessions from public, anon, authenticated;
grant all on public.players, public.subscriptions, public.game_sessions to service_role;

-- Daily limits count from midnight UTC.
create function public.day_start() returns timestamptz
language sql stable as $$
  select date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;

create function public.player_plan(p_player uuid) returns text
language sql stable as $$
  select case when exists (
    select 1 from public.subscriptions s
    where s.player_id = p_player and (s.current_period_end is null or s.current_period_end > now())
  ) then 'premium' else 'free' end
$$;

create function public.allowance(p_player uuid, p_free_limit integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'plan', public.player_plan(p_player),
    'limit', case when public.player_plan(p_player) = 'premium' then null else p_free_limit end,
    'used', (select count(*) from public.game_sessions g where g.player_id = p_player and g.started_at >= public.day_start())
  )
$$;

-- For the keep-alive check: touches the database so a free project doesn't pause.
create function public.ping() returns boolean
language sql stable as $$
  select exists (select 1 from public.players limit 1) or true
$$;

-- The player's profile, signing them up on first use.
create function public.get_me(p_player uuid, p_default_name text, p_free_limit integer) returns jsonb
language plpgsql as $$
begin
  insert into public.players (id, name) values (p_player, p_default_name) on conflict (id) do nothing;
  return jsonb_build_object(
    'name', (select name from public.players where id = p_player),
    'allowance', public.allowance(p_player, p_free_limit),
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

create function public.rename_player(p_player uuid, p_name text) returns boolean
language sql as $$
  update public.players set name = p_name where id = p_player returning true
$$;

-- Spends a play and opens a session. The row lock makes simultaneous requests
-- from one player wait for each other, so they can't overrun the limit.
create function public.start_session(
  p_player uuid,
  p_default_name text,
  p_game_id text,
  p_variant text,
  p_settings jsonb,
  p_seed bigint,
  p_dataset_version text,
  p_free_limit integer
) returns jsonb
language plpgsql as $$
declare
  current_allowance jsonb;
  session_id uuid;
begin
  insert into public.players (id, name) values (p_player, p_default_name) on conflict (id) do nothing;
  perform 1 from public.players where id = p_player for update;
  current_allowance := public.allowance(p_player, p_free_limit);
  if current_allowance ->> 'plan' = 'free' and (current_allowance ->> 'used')::integer >= p_free_limit then
    return jsonb_build_object('ok', false, 'allowance', current_allowance);
  end if;
  insert into public.game_sessions (player_id, game_id, variant, settings, seed, dataset_version)
  values (p_player, p_game_id, p_variant, p_settings, p_seed, p_dataset_version)
  returning id into session_id;
  return jsonb_build_object('ok', true, 'sessionId', session_id, 'allowance', public.allowance(p_player, p_free_limit));
end
$$;

-- A player's own session, or null.
create function public.get_session(p_session uuid, p_player uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'gameId', game_id, 'settings', settings, 'seed', seed, 'datasetVersion', dataset_version, 'status', status, 'score', score
  )
  from public.game_sessions where id = p_session and player_id = p_player
$$;

-- Stores the verified result. Finishing twice keeps the first result, so a retry
-- after a lost connection gets the same answer.
create function public.finish_session(p_session uuid, p_player uuid, p_moves jsonb, p_score integer) returns jsonb
language plpgsql as $$
declare
  s public.game_sessions;
  previous_best integer;
begin
  select * into s from public.game_sessions where id = p_session and player_id = p_player for update;
  if not found then
    return null;
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

-- Each player's best game, best first; the earlier game wins a tie.
create function public.leaderboard_global(p_game_id text, p_variant text, p_limit integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'playerName', player_name, 'score', score, 'playedAt', finished_at) order by score desc, finished_at), '[]'::jsonb)
  from (
    select * from (
      select distinct on (g.player_id) g.id, p.name as player_name, g.score, g.finished_at
      from public.game_sessions g
      join public.players p on p.id = g.player_id
      where g.game_id = p_game_id and g.variant = p_variant and g.status = 'finished' and g.score > 0
      order by g.player_id, g.score desc, g.finished_at
    ) best
    order by score desc, finished_at
    limit p_limit
  ) ranked
$$;

create function public.leaderboard_personal(p_player uuid, p_game_id text, p_variant text, p_limit integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'playerName', player_name, 'score', score, 'playedAt', finished_at) order by score desc, finished_at), '[]'::jsonb)
  from (
    select g.id, p.name as player_name, g.score, g.finished_at
    from public.game_sessions g
    join public.players p on p.id = g.player_id
    where g.player_id = p_player and g.game_id = p_game_id and g.variant = p_variant and g.status = 'finished'
    order by g.score desc, g.finished_at
    limit p_limit
  ) ranked
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
