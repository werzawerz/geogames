import { useEffect, useState } from 'react';
import {
  normalizeSettings,
  settingsFromVariant,
  variantKey,
  usesCircleOptions,
  usesCityData,
  usesRouteMode,
  CITY_DATA,
  ROUTE_MODES,
  usesCitySize,
  usesDifficulty,
  usesRegion,
  type GameDefinition,
  type GameSettings,
} from '@geogames/games';
import { usePlatform } from '../platform/PlatformProvider.tsx';
import type { LeaderboardScope, RankedScore } from '../platform/scores.ts';
import { RegionPicker } from '../components/RegionPicker.tsx';
import { CitySizeSlider } from '../components/CitySizeSlider.tsx';
import { DescribedChips } from '../components/ChoiceChips.tsx';
import { DifficultyPicker } from '../components/DifficultyPicker.tsx';
import { CircleOptions } from '../components/CircleOptions.tsx';
import { href } from '../router.ts';

export function ScoresPage({ game, variant = 'world' }: { game: GameDefinition; variant?: string }) {
  const { scores, player, renamePlayer } = usePlatform();
  const [scope, setScope] = useState<LeaderboardScope>('personal');
  const [entries, setEntries] = useState<RankedScore[] | null | undefined>(undefined);
  const [settings, setSettings] = useState(() => settingsFromVariant(variant, game));
  const key = variantKey(settings, game);

  // Settings live in local state; the URL is updated in place so dragging the
  // slider doesn't push history entries or jump the page.
  const choose = (next: GameSettings) => {
    const normalized = normalizeSettings(next, game);
    setSettings(normalized);
    history.replaceState(null, '', href({ page: 'scores', gameId: game.id, variant: variantKey(normalized, game) }));
  };

  useEffect(() => {
    let cancelled = false;
    setEntries(undefined);
    scores.top(game.id, key, scope, 20).then((e) => !cancelled && setEntries(e));
    return () => {
      cancelled = true;
    };
  }, [scores, game.id, key, scope]);

  return (
    <div className="page">
      <a className="link back" href={href({ page: 'home' })}>
        ← All games
      </a>
      <h1 className="page-title">{game.title}: leaderboard</h1>

      {usesRegion(game) && <RegionPicker value={settings.region} onChange={(region) => choose({ ...settings, region })} />}
      {usesDifficulty(game) && (
        <DifficultyPicker value={settings.difficulty} onChange={(difficulty) => choose({ ...settings, difficulty })} />
      )}
      {usesCircleOptions(game) && (
        <div className="setup center">
          <CircleOptions settings={settings} onChange={choose} mode="leaderboard" />
        </div>
      )}
      {usesCityData(game) && <DescribedChips options={CITY_DATA} label="City data" value={settings.cityData} onChange={(cityData) => choose({ ...settings, cityData })} />}
      {usesRouteMode(game) && <DescribedChips options={ROUTE_MODES} label="Difficulty" value={settings.routeMode} onChange={(routeMode) => choose({ ...settings, routeMode })} />}
      {usesCitySize(game) && (
        <CitySizeSlider
          region={settings.region}
          value={settings.cityMinPopulation}
          onChange={(cityMinPopulation) => choose({ ...settings, cityMinPopulation })}
        />
      )}

      <div className="tabs" role="tablist">
        {(['personal', 'global'] as const).map((s) => (
          <button key={s} role="tab" aria-selected={scope === s} className="tab" onClick={() => setScope(s)}>
            {s === 'personal' ? 'Your best' : 'Global'}
          </button>
        ))}
      </div>

      <div className="panel">
        {entries === undefined && <p className="muted">Loading…</p>}
        {entries === null && <p className="muted">The global leaderboard isn't available right now.</p>}
        {entries?.length === 0 && <p className="muted">
            No scores yet with these settings. Play a round!
          </p>}
        {entries && entries.length > 0 && (
          <ol className="scores">
            {entries.map((e, i) => (
              <li key={e.id}>
                <span className="rank">{i + 1}</span>
                <span className="who">{e.playerName}</span>
                <span className="when">{new Date(e.playedAt).toLocaleDateString()}</span>
                <span className="pts">{e.score}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <label className="name-field">
        Display name
        <input
          defaultValue={player.name}
          maxLength={24}
          onBlur={(e) => renamePlayer(e.currentTarget.value)}
        />
      </label>

      <p>
        <a className="btn btn-primary" href={href({ page: 'play', gameId: game.id })}>
          Play
        </a>
      </p>
    </div>
  );
}
