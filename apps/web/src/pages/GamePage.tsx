import { useCallback, useState } from 'react';
import {
  MIN_POOL_SIZE,
  describeSettings,
  normalizeSettings,
  poolSizes,
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
import type { FinishResult, Play } from '../platform/backend.ts';
import { load, save } from '../platform/storage.ts';
import { GameScreen } from '../games/registry.tsx';
import type { GameOutcome } from '../games/types.ts';
import { RegionPicker } from '../components/RegionPicker.tsx';
import { CitySizeSlider } from '../components/CitySizeSlider.tsx';
import { DescribedChips } from '../components/ChoiceChips.tsx';
import { DifficultyPicker } from '../components/DifficultyPicker.tsx';
import { CircleOptions } from '../components/CircleOptions.tsx';
import { href } from '../router.ts';

type Phase =
  | { name: 'setup' }
  | { name: 'playing'; play: Play; settings: GameSettings }
  | { name: 'over'; score: number; settings: GameSettings; result: FinishResult | null; message?: string };

/** Last-used settings per game, so "Play" starts where the player left off. */
function useRememberedSettings(game: GameDefinition) {
  const key = `settings:${game.id}`;
  // Normalizing also repairs stored settings the game no longer allows.
  const [settings, setSettings] = useState<GameSettings>(() => normalizeSettings(load(key, {}), game));
  const update = useCallback(
    (next: GameSettings) => {
      const normalized = normalizeSettings(next, game);
      setSettings(normalized);
      save(key, normalized);
    },
    [key, game],
  );
  return [settings, update] as const;
}

export function GamePage({ game }: { game: GameDefinition }) {
  const { allowance, startPlay, finishPlay } = usePlatform();
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const [settings, setSettings] = useRememberedSettings(game);
  const [blocked, setBlocked] = useState(false);
  const [starting, setStarting] = useState(false);
  const [updateRequired, setUpdateRequired] = useState(false);

  const start = async (chosen: GameSettings) => {
    if (starting) return;
    setStarting(true);
    const result = await startPlay(game, chosen);
    setStarting(false);
    if (result.status === 'update-required') setUpdateRequired(true);
    else if (result.status === 'out-of-plays') setBlocked(true);
    else setPhase({ name: 'playing', play: result.play, settings: chosen });
  };

  const play = phase.name === 'playing' ? phase.play : null;
  const playing = phase.name === 'playing' ? phase.settings : settings;
  const onGameOver = useCallback(
    async ({ score, moves, message }: GameOutcome) => {
      setPhase({ name: 'over', score, settings: playing, result: null, message });
      if (!play) return;
      const result = await finishPlay(play, { gameId: game.id, variant: variantKey(playing, game), score, seed: play.seed, moves });
      setPhase({ name: 'over', score: result.score, settings: playing, result, message });
    },
    [finishPlay, game, play, playing],
  );

  if (updateRequired) {
    return (
      <div className="page">
        <div className="panel center">
          <h1>There's a new version of the game</h1>
          <button className="btn btn-primary btn-lg" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }

  if (blocked || (phase.name === 'setup' && allowance.remaining === 0)) {
    return <OutOfPlays />;
  }

  const isDefault = (s: GameSettings) => variantKey(s, game) === 'world';

  return (
    <div className="page">
      <a className="link back" href={href({ page: 'home' })}>
        ← All games
      </a>
      <h1 className="page-title">{game.title}</h1>

      {phase.name === 'setup' && (
        <GameSetup game={game} settings={settings} onChange={setSettings} onStart={() => start(settings)} starting={starting} />
      )}

      {phase.name === 'playing' && (
        <>
          {!isDefault(phase.settings) && <p className="region-tag">{describeSettings(phase.settings, game)}</p>}
          <GameScreen key={phase.play.seed} game={game} settings={phase.settings} seed={phase.play.seed} onGameOver={onGameOver} />
        </>
      )}

      {phase.name === 'over' && (
        <div className="panel center">
          <p className="eyebrow">Game over · {describeSettings(phase.settings, game)}</p>
          <p className="big-score">{phase.score}</p>
          {phase.message && <p className="lead">🏆 {phase.message}</p>}
          {phase.result && (
            <p>{phase.result.isPersonalBest ? '🎉 New personal best!' : `Personal best: ${phase.result.personalBest}`}</p>
          )}
          {phase.result?.notice && <p className="muted score-notice">{phase.result.notice}</p>}
          <div className="row">
            <button className="btn btn-primary btn-lg" disabled={starting} onClick={() => start(phase.settings)}>
              Play again
            </button>
            <button className="btn" onClick={() => setPhase({ name: 'setup' })}>
              Change settings
            </button>
            <a
              className="btn"
              href={href({ page: 'scores', gameId: game.id, variant: variantKey(phase.settings, game) })}
            >
              Leaderboard
            </a>
          </div>
          <PlaysLeft />
        </div>
      )}
    </div>
  );
}

const RULES: Record<GameDefinition['kind'], string> = {
  'higher-lower': 'Guess right to keep your streak going. One wrong answer ends the game.',
  route:
    'Twenty levels, with longer routes in less familiar places as you go. Running out of guesses ends your run. The fewer guesses you need and the higher the level, the more points you get. Bridges and tunnels count as borders (Denmark–Sweden, the Channel Tunnel); exclaves like Kaliningrad only lead to their own neighbours.',
  quiz: 'A point for every right answer. Three wrong answers and you’re out.',
  circle: 'Three circles. A point for every top city you find; five misses end a circle.',
  'great-circle':
    'A straight line runs between two cities, the shortest way around the globe (so it can look curved on the map). The map shows no borders, only the countries at each end and the ones you find. Name every country the line crosses, in any order. A wrong country or a skip costs one of your 5 lives; a perfect level earns one back. Twenty levels, with longer lines through less familiar places.',
  'mystery-country':
    'Guess the hidden country. Every wrong guess shows how far it is from the mystery country (centre to centre), which way to go, whether it’s on the same continent, and whether the mystery country has more people and land (▲▲ means over 3 times more, ▼▼ under a third). More clues appear as you run out of guesses. The fewer guesses you need and the higher the level, the more points you get. Twenty levels, with less familiar countries and fewer guesses as you go; running out of guesses ends your run.',
  'border-blitz':
    'A country lights up on a map without borders: name all its neighbours, in any order, before the clock runs out. Neighbours share a land border; bridges and tunnels count too (Denmark–Sweden, the Channel Tunnel), but sea crossings don’t, and nor do territories: naming France for Brazil (they meet only in French Guiana) or the UK for Spain (only at Gibraltar) costs nothing but doesn’t count. You have 3 lives for the whole run: a wrong country costs one, and 2 seconds; a flawless level earns one back, up to 5. Every neighbour scores 10 points times the level, a flawless level half as much again, and every second left on the clock 2 points times the level. Running out of lives or time ends your run, and so does giving up on a level. Twenty levels, from famous countries with famous neighbours to obscure ones, with less time per neighbour as you go; from level 11 you aren’t told how many neighbours there are.',
  'pin-drop':
    'A city is named: click where it is, zooming in for precision. Up to 100 points for a close pin. Every kilometre off comes out of your 5,000 km budget, and the run ends when it’s gone. Within 50 km costs nothing and earns 250 km back. Less famous cities come in as you go, and pay more.',
  'circle-arcade':
    'Name the top cities in each circle, anywhere in the world. Early circles are big and mostly about famous, much-visited cities; later ones get smaller and ask for more. Wrong guesses are free but spoil a perfect level; a skip costs a life. Hints (the country and every third letter) are limited and halve a city’s points. A perfect level, without misses, skips or hints, earns a life and a hint back.',
};

function GameSetup({
  game,
  settings,
  onChange,
  onStart,
  starting,
}: {
  game: GameDefinition;
  settings: GameSettings;
  onChange(settings: GameSettings): void;
  onStart(): void;
  starting: boolean;
}) {
  const sizes = poolSizes(game, settings);
  const inPlay = sizes[settings.region];
  const unit = game.subject === 'city' ? 'cities' : 'countries';
  // City Circle counts possible circle centres, which isn't a useful number to show.
  const showCount = !['circle', 'circle-arcade', 'pin-drop', 'great-circle', 'mystery-country', 'border-blitz'].includes(game.kind);

  return (
    <div className="panel center">
      <p className="lead">{game.tagline}</p>
      <p>{RULES[game.kind]}</p>
      <div className="setup">
        {usesRegion(game) && (
          <>
            <h2 className="setup-label">Region</h2>
            <RegionPicker
              value={settings.region}
              onChange={(region) => onChange({ ...settings, region })}
              sizes={sizes}
              unit={unit}
            />
          </>
        )}
        {usesDifficulty(game) && (
          <>
            <h2 className="setup-label">Difficulty</h2>
            <DifficultyPicker value={settings.difficulty} onChange={(difficulty) => onChange({ ...settings, difficulty })} />
          </>
        )}
        {usesCircleOptions(game) && <CircleOptions settings={settings} onChange={onChange} mode="setup" />}
        {usesCityData(game) && (
          <>
            <h2 className="setup-label">City data</h2>
            <DescribedChips options={CITY_DATA} label="City data" value={settings.cityData} onChange={(cityData) => onChange({ ...settings, cityData })} />
          </>
        )}
        {usesRouteMode(game) && (
          <>
            <h2 className="setup-label">Difficulty</h2>
            <DescribedChips options={ROUTE_MODES} label="Difficulty" value={settings.routeMode} onChange={(routeMode) => onChange({ ...settings, routeMode })} />
          </>
        )}
        {usesCitySize(game) && (
          <>
            <h2 className="setup-label">City size</h2>
            <CitySizeSlider
              region={settings.region}
              value={settings.cityMinPopulation}
              onChange={(cityMinPopulation) => onChange({ ...settings, cityMinPopulation })}
            />
          </>
        )}
        {showCount && (
          <p className="muted small">
            {inPlay} {unit} in play
          </p>
        )}
      </div>
      <button className="btn btn-primary btn-lg" onClick={onStart} disabled={inPlay < MIN_POOL_SIZE || starting}>
        Start game
      </button>
      <PlaysLeft />
    </div>
  );
}

function PlaysLeft() {
  const { allowance } = usePlatform();
  if (allowance.remaining === null) return <p className="muted">Premium: unlimited plays</p>;
  return (
    <p className="muted">
      {allowance.remaining} of {allowance.limit} free plays left today ·{' '}
      <a className="link" href={href({ page: 'premium' })}>
        Go unlimited
      </a>
    </p>
  );
}

function OutOfPlays() {
  const { allowance } = usePlatform();
  const time = allowance.resetsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <div className="page">
      <div className="panel center">
        <h1>You've used today's free plays</h1>
        <p>
          Free players get {allowance.limit} games a day. New plays unlock at {time}, or upgrade for unlimited games.
        </p>
        <div className="row">
          <a className="btn btn-primary btn-lg" href={href({ page: 'premium' })}>
            See Premium
          </a>
          <a className="btn" href={href({ page: 'home' })}>
            Back to games
          </a>
        </div>
      </div>
    </div>
  );
}
