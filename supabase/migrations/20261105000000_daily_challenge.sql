-- Daily challenges are game sessions in a variant of their own ("daily-2026-11-05"):
-- one per player, game and day, and they don't spend a free play.

create unique index game_sessions_one_daily on public.game_sessions (player_id, game_id, variant)
  where variant like 'daily-%';

create or replace function public.allowance(p_player uuid, p_free_limit integer) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'plan', public.player_plan(p_player),
    'limit', case when public.player_plan(p_player) = 'premium' then null else p_free_limit end,
    'used', (
      select count(*) from public.game_sessions g
      where g.player_id = p_player and g.started_at >= public.day_start() and g.variant not like 'daily-%'
    )
  )
$$;

-- The player's session for this challenge, opened on the first call. A session
-- still in progress on older game data can't be replayed, so it starts over.
create function public.start_daily_session(
  p_player uuid,
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
  insert into public.players (id, name) values (p_player, p_default_name) on conflict (id) do nothing;
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

revoke all on function public.start_daily_session(uuid, text, text, text, jsonb, bigint, text) from public, anon, authenticated;
grant execute on function public.start_daily_session(uuid, text, text, text, jsonb, bigint, text) to service_role;
