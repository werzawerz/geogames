-- Duels: a player's finished City Circle Arcade run becomes a challenge by link.
-- The first person to press Play takes it and plays the same seed once; the higher
-- verified score wins. Same stance as the rest: row level security with no
-- policies, and the rules (one taker, what is hidden until the end) live in
-- these functions, so concurrent requests can't break them. See docs/ideas/duels.md.

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
  -- A rematch can only be taken by the other player of the duel it follows.
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

-- The caller's own session, for making a duel from it; null when it isn't theirs.
-- `duelCode` is the duel already made from it.
create function public.duel_source(p_session uuid, p_player uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'gameId', s.game_id, 'variant', s.variant, 'settings', s.settings, 'seed', s.seed,
    'datasetVersion', s.dataset_version, 'status', s.status, 'finishedAt', s.finished_at,
    'moves', s.moves, 'score', s.score,
    'duelCode', (select d.code from public.duels d where d.creator_session = s.id)
  )
  from public.game_sessions s where s.id = p_session and s.player_id = p_player
$$;

-- Makes a duel from the caller's finished run. Asking again for the same run gives
-- the same duel. Refuses when the player made too many duels in the last hour or has
-- too many open ones; the code is chosen by the API (a clash asks for another).
create function public.create_duel(
  p_player uuid,
  p_code text,
  p_session uuid,
  p_level integer,
  p_rematch_of text,
  p_open_days integer,
  p_per_hour integer,
  p_max_open integer
) returns jsonb
language plpgsql as $$
declare
  s public.game_sessions;
  previous public.duels;
  existing text;
  other uuid;
begin
  perform 1 from public.players where id = p_player for update;
  select d.code into existing from public.duels d where d.creator_session = p_session and d.creator_id = p_player;
  if found then
    return jsonb_build_object('ok', true, 'code', existing);
  end if;
  select * into s from public.game_sessions where id = p_session and player_id = p_player and status = 'finished';
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;
  if (select count(*) from public.duels d where d.creator_id = p_player and d.created_at > now() - interval '1 hour') >= p_per_hour
    or (select count(*) from public.duels d
        where d.creator_id = p_player and d.challenger_id is null and d.expires_at > now()) >= p_max_open
  then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;
  if p_rematch_of is not null then
    select * into previous from public.duels where code = p_rematch_of;
    if not found or previous.challenger_id is null or p_player not in (previous.creator_id, previous.challenger_id) then
      return jsonb_build_object('ok', false, 'error', 'forbidden');
    end if;
    other := case when previous.creator_id = p_player then previous.challenger_id else previous.creator_id end;
  end if;
  if exists (select 1 from public.duels where code = p_code) then
    return jsonb_build_object('ok', false, 'error', 'code-taken');
  end if;
  insert into public.duels (code, game_id, settings, seed, dataset_version, creator_id, creator_session,
                            creator_level, reserved_for, rematch_of, expires_at)
  values (p_code, s.game_id, s.settings, s.seed, s.dataset_version, p_player, s.id,
          p_level, other, p_rematch_of, now() + make_interval(days => p_open_days));
  return jsonb_build_object('ok', true, 'code', p_code);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'code-taken');
end
$$;

-- Where a duel stands, worked out when read: {state, reason, forfeit}.
create function public.duel_status(d public.duels, p_dataset_version text, p_play_hours integer) returns jsonb
language plpgsql stable as $$
declare
  ch public.game_sessions;
  deadline timestamptz;
begin
  if d.challenger_session is null then
    if d.dataset_version <> p_dataset_version then
      return jsonb_build_object('state', 'expired', 'reason', 'outdated');
    end if;
    if now() > d.expires_at then
      return jsonb_build_object('state', 'expired', 'reason', 'time');
    end if;
    return jsonb_build_object('state', 'open');
  end if;
  select * into ch from public.game_sessions where id = d.challenger_session;
  deadline := ch.started_at + make_interval(hours => p_play_hours);
  if ch.status = 'finished' and ch.finished_at <= deadline then
    return jsonb_build_object('state', 'finished', 'forfeit', false);
  end if;
  if now() > deadline then
    return jsonb_build_object('state', 'finished', 'forfeit', true);
  end if;
  if d.dataset_version <> p_dataset_version then
    return jsonb_build_object('state', 'expired', 'reason', 'outdated');
  end if;
  return jsonb_build_object('state', 'playing');
end
$$;

-- What one player may see of a duel: the single place that decides what is hidden.
-- The challenger's result and both move lists wait until the duel is finished; the
-- seed goes only to the challenger, and only while they play.
create function public.duel_view(
  d public.duels,
  p_player uuid,
  p_dataset_version text,
  p_play_hours integer,
  p_with_moves boolean
) returns jsonb
language plpgsql stable as $$
declare
  status jsonb := public.duel_status(d, p_dataset_version, p_play_hours);
  state text := status ->> 'state';
  forfeit boolean := coalesce((status ->> 'forfeit')::boolean, false);
  is_over boolean := state = 'finished';
  show_ch boolean := state = 'finished' and not coalesce((status ->> 'forfeit')::boolean, false);
  with_moves boolean := p_with_moves and state = 'finished';
  cs public.game_sessions;
  ch public.game_sessions;
  r public.duels;
  you text;
  creator_dto jsonb;
  challenger_dto jsonb;
  outcome text;
  result jsonb;
begin
  select * into cs from public.game_sessions where id = d.creator_session;
  if d.challenger_session is not null then
    select * into ch from public.game_sessions where id = d.challenger_session;
  end if;
  you := case when p_player = d.creator_id then 'creator' when p_player = d.challenger_id then 'challenger' else 'visitor' end;

  creator_dto := jsonb_build_object(
    'name', (select name from public.players where id = d.creator_id),
    'score', cs.score,
    'level', d.creator_level,
    'status', 'finished',
    'durationSec', extract(epoch from cs.finished_at - cs.started_at)::integer
  );
  if with_moves then
    creator_dto := creator_dto || jsonb_build_object('moves', cs.moves);
  end if;

  if d.challenger_id is not null then
    challenger_dto := jsonb_build_object(
      'name', (select name from public.players where id = d.challenger_id),
      'score', case when show_ch then ch.score end,
      'level', null,
      'status', case when forfeit then 'forfeit' when is_over then 'finished' else 'playing' end,
      'durationSec', case when show_ch then extract(epoch from ch.finished_at - ch.started_at)::integer end
    );
    if with_moves and show_ch then
      challenger_dto := challenger_dto || jsonb_build_object('moves', ch.moves);
    end if;
  end if;

  if is_over then
    outcome := case
      when forfeit or cs.score > ch.score then 'creator'
      when cs.score < ch.score then 'challenger'
      else 'draw' end;
  end if;

  result := jsonb_build_object(
    'code', d.code,
    'gameId', d.game_id,
    'settings', d.settings,
    'createdAt', d.created_at,
    'expiresAt', d.expires_at,
    'you', you,
    'state', state,
    'creator', creator_dto,
    'challenger', challenger_dto,
    'reservedFor', (select name from public.players where id = d.reserved_for),
    'reservedForYou', d.reserved_for is not distinct from p_player,
    'outcome', outcome,
    'rematch', null
  );
  if with_moves then
    result := result || jsonb_build_object('seed', d.seed);
  end if;
  if state = 'expired' then
    result := result || jsonb_build_object('expiredReason', status ->> 'reason');
  end if;
  if you = 'challenger' and state = 'playing' then
    result := result || jsonb_build_object('session', jsonb_build_object('sessionId', ch.id, 'seed', ch.seed));
  end if;
  if you <> 'visitor' then
    select * into r from public.duels where rematch_of = d.code order by created_at desc limit 1;
    if found then
      result := result || jsonb_build_object('rematch', jsonb_build_object(
        'code', r.code,
        'forYou', r.reserved_for is not distinct from p_player,
        'byYou', r.creator_id = p_player,
        'state', public.duel_status(r, p_dataset_version, p_play_hours) ->> 'state'
      ));
    end if;
  end if;
  return result;
end
$$;

create function public.get_duel(p_code text, p_player uuid, p_dataset_version text, p_play_hours integer) returns jsonb
language sql stable as $$
  select public.duel_view(d, p_player, p_dataset_version, p_play_hours, true) from public.duels d where d.code = p_code
$$;

-- The caller's duels of the last 60 days, newest first, plus open rematches
-- reserved for them. No moves: the list only needs scores.
create function public.list_duels(p_player uuid, p_dataset_version text, p_play_hours integer, p_limit integer) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(view order by created_at desc), '[]'::jsonb) from (
    select public.duel_view(d, p_player, p_dataset_version, p_play_hours, false) as view, d.created_at
    from public.duels d
    where (d.creator_id = p_player or d.challenger_id = p_player or (d.reserved_for = p_player and d.challenger_id is null))
      and d.created_at > now() - interval '60 days'
    order by d.created_at desc
    limit p_limit
  ) latest
$$;

-- The first caller takes the duel: a session on the duel's seed, variant 'duel'. Asking
-- again as the same player gives the same session back, so a reload resumes.
create function public.accept_duel(
  p_code text,
  p_player uuid,
  p_anonymous boolean,
  p_default_name text,
  p_dataset_version text,
  p_per_minute integer,
  p_per_hour integer
) returns jsonb
language plpgsql as $$
declare
  d public.duels;
  s public.game_sessions;
  session_id uuid;
begin
  perform public.ensure_player(p_player, p_anonymous, p_default_name);
  perform 1 from public.players where id = p_player for update;
  select * into d from public.duels where code = p_code for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not-found');
  end if;
  if d.challenger_id = p_player then
    select * into s from public.game_sessions where id = d.challenger_session;
    return jsonb_build_object('ok', true, 'sessionId', s.id, 'seed', s.seed);
  end if;
  if d.creator_id = p_player then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if d.challenger_id is not null then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  if d.reserved_for is not null and d.reserved_for <> p_player then
    return jsonb_build_object('ok', false, 'error', 'reserved');
  end if;
  if d.dataset_version <> p_dataset_version or now() > d.expires_at then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if (select count(*) from public.game_sessions g
      where g.player_id = p_player and g.started_at > now() - interval '1 minute' and g.variant not like 'daily-%') >= p_per_minute
    or (select count(*) from public.game_sessions g
      where g.player_id = p_player and g.started_at > now() - interval '1 hour' and g.variant not like 'daily-%') >= p_per_hour
  then
    return jsonb_build_object('ok', false, 'error', 'rate-limited');
  end if;
  insert into public.game_sessions (player_id, game_id, variant, settings, seed, dataset_version)
  values (p_player, d.game_id, 'duel', d.settings, d.seed, d.dataset_version)
  returning id into session_id;
  update public.duels set challenger_id = p_player, challenger_session = session_id where code = d.code;
  return jsonb_build_object('ok', true, 'sessionId', session_id, 'seed', d.seed);
end
$$;

-- As before, but the challenger's runs (variant 'duel') aren't a player's own bests.
create or replace function public.get_me(p_player uuid, p_anonymous boolean, p_default_name text) returns jsonb
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
          where player_id = p_player and status = 'finished' and variant <> 'duel'
          group by game_id, variant
        ) by_variant
        group by game_id
      ) by_game
    ), '{}'::jsonb)
  );
end
$$;

-- As before, plus the duels: ones that would become a player against themselves
-- are deleted, the rest follow the player into the account.
create or replace function public.merge_players(p_from uuid, p_into uuid, p_default_name text) returns integer
language plpgsql as $$
declare
  moved integer;
begin
  if p_from = p_into or not exists (select 1 from public.players where id = p_from and anonymous) then
    return 0;
  end if;
  perform public.ensure_player(p_into, false, p_default_name);
  delete from public.duels
  where (creator_id = p_from and (challenger_id = p_into or reserved_for = p_into))
     or (creator_id = p_into and (challenger_id = p_from or reserved_for = p_from));
  update public.duels set creator_id = p_into where creator_id = p_from;
  update public.duels set challenger_id = p_into where challenger_id = p_from;
  update public.duels set reserved_for = p_into where reserved_for = p_from;
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
