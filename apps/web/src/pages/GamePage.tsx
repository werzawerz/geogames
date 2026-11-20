import { useCallback, useState } from 'react';
import {
  DUEL_GAMES,
  MIN_POOL_SIZE,
  describeSettings,
  hasSettings,
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
  | { name: 'over'; score: number; settings: GameSettings; result: FinishResult | null; play: Play | null; message?: string; completed?: boolean };

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
  const { startPlay, finishPlay, duels, account } = usePlatform();
  const [phase, setPhase] = useState<Phase>({ name: 'setup' });
  const [challenge, setChallenge] = useState<'idle' | 'making' | 'failed'>('idle');
  const [settings, setSettings] = useRememberedSettings(game);
  const [starting, setStarting] = useState(false);
  const [updateRequired, setUpdateRequired] = useState(false);

  const start = async (chosen: GameSettings) => {
    if (starting) return;
    setStarting(true);
    const result = await startPlay(game, chosen);
    setStarting(false);
    if (result.status === 'update-required') setUpdateRequired(true);
    else setPhase({ name: 'playing', play: result.play, settings: chosen });
  };

  const play = phase.name === 'playing' ? phase.play : null;
  const playing = phase.name === 'playing' ? phase.settings : settings;
  const onGameOver = useCallback(
    async ({ score, moves, message, completed }: GameOutcome) => {
      setChallenge('idle');
      setPhase({ name: 'over', score, settings: playing, result: null, play, message, completed });
      if (!play) return;
      const result = await finishPlay(play, { gameId: game.id, variant: variantKey(playing, game), score, seed: play.seed, moves });
      setPhase({ name: 'over', score: result.score, settings: playing, result, play, message, completed });
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

  // "Challenge a friend": a saved run of a duel game becomes a duel, for those with an account.
  const challengeFriend = async (sessionId: string) => {
    setChallenge('making');
    try {
      const code = await duels!.create(sessionId);
      location.hash = href({ page: 'duel', code });
    } catch {
      setChallenge('failed');
    }
  };

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
          <p className="eyebrow">
            {phase.completed ? 'Run complete' : 'Game over'} · {describeSettings(phase.settings, game)}
          </p>
          <p className="big-score">{phase.score}</p>
          {phase.message && <p className="lead">🏆 {phase.message}</p>}
          {phase.result && (
            <p>{phase.result.isPersonalBest ? '🎉 New personal best!' : `Personal best: ${phase.result.personalBest}`}</p>
          )}
          {phase.result?.notice && (
            <p className={`muted score-notice score-${phase.result.status}`} role="status">
              {phase.result.notice}
            </p>
          )}
          {DUEL_GAMES.includes(game.id) && duels && phase.result?.status === 'saved' && phase.play?.sessionId && (
            <div className="duel-challenge">
              {account.status === 'signed-in' ? (
                <button className="btn" disabled={challenge === 'making'} onClick={() => challengeFriend(phase.play!.sessionId!)}>
                  ⚔️ Challenge a friend to these circles
                </button>
              ) : (
                <a className="btn" href={href({ page: 'duel-new' })}>
                  ⚔️ Challenge a friend to these circles
                </a>
              )}
              {challenge === 'failed' && (
                <p className="muted small" role="alert">
                  We couldn't make the duel. Please try again.
                </p>
              )}
            </div>
          )}
          <div className="row">
            <button className="btn btn-primary btn-lg" disabled={starting} onClick={() => start(phase.settings)}>
              Play again
            </button>
            {hasSettings(game) && (
              <button className="btn" onClick={() => setPhase({ name: 'setup' })}>
                Change settings
              </button>
            )}
            <a
              className="btn"
              href={href({ page: 'scores', gameId: game.id, variant: variantKey(phase.settings, game) })}
            >
              Leaderboard
            </a>
          </div>
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
  halfway:
    'Two cities are shown: name a real city near the point halfway between them, along the shortest route around the globe. A guess within the level’s radius clears it, and the closer, the more points. A guess further away shows how far off it was. Two misses in a level are free (one from level 26, none from level 40); the next, or a skip, costs one of your 3 lives and ends the level, showing the answer. A first guess within a third of the radius is flawless: half as many points again, and a lost life back (never more than 3). The run goes on until your lives are gone: famous cities first, then smaller radii, no line, and from level 16 no names, only the two dots.',
  clockwork:
    'A time in UTC (London’s winter time) and a date are given, and a country lights up: pick the local time there with the hour and minute buttons and press Check (on a keyboard you can type it, like 1730, and press Enter). If a country has several time zones, a city is named. A wrong time tells you whether the answer is earlier or later. Two misses in a level are free (one from level 15, when dates start to matter, and none from level 45); the next, or a skip, costs one of your 3 lives and ends the level, showing the answer. Right first time is flawless: half as many points again, and a lost life back (never more than 3). The run goes on until your lives are gone: first clocks that follow longitude, then the ones that don’t (China, Spain, India’s half hour), then summer dates with daylight saving, north and south, and from level 25 the dates between one country’s clock change and another’s, and the oddities.',
  'native-tongue':
    'A country’s own name for itself is shown in its own script. Type the English name of the country.¶A wrong guess shows what that country calls itself, and after the first miss you are told the language.¶Two misses are free (one from level 21, none from level 41); the next, or a skip, costs one of your 3 lives and ends the level.¶Right first time is flawless: half as many points again, and a lost life back (never more than 3).¶The run goes on until your lives are gone: Latin-letter names first, then scripts that belong to one country (Greek, Georgian, Thai), then shared ones (Cyrillic, Arabic, Devanagari) from level 21.¶Names come from Unicode CLDR.',
  'supply-chain':
    'A commodity is shown: coffee, cobalt, crude oil. Name the countries that make the most of it, in any order: 3 at first, then 4 or 5.¶Each one you find fills in on the map with its share of the world’s output. A wrong guess that is a big producer tells you its place.¶A country within a tenth of the last place counts too. Countries with under 3% of the world’s output are never asked for.¶Three wrong guesses (two from level 21, one from level 36) or a skip cost a life and end the level. Finding them all without a miss earns half as many points again and a life back (never above 3).¶It goes on until your lives are gone. The figures are from FAOSTAT, USGS and EIA, and every level shows its source and year.',
  'river-run':
    'A river draws itself on the map from its source. Name it before the line reaches its end: the less of it drawn, the more points. A wrong guess draws that river in grey where it really runs. Two misses in a level are free; the third, a skip, or the line reaching its end costs one of your 3 lives and ends the level. Naming it on your first try before it’s half drawn is flawless: half as many points again, and a lost life back (never more than 3). From half drawn, four names are offered: the right one, picked or typed, scores half, and a wrong one of the four costs a life at once. The run goes on until your lives are gone: the great rivers first, then regional rivers from level 9, tributaries from level 21, and from level 36 rivers deep in the Amazon, Siberia and China with little around them to place them by. Each stage starts slowly, and the rivers draw faster as you go.',
  'blank-atlas':
    'A sea, mountain range, desert, lake, peninsula or island lights up on a shaded-relief map with no labels and no borders. Pick its name from four of the same kind (tap, or keys 1–4). A right pick scores 15 × the level and gives a lost life back (never more than 3). A wrong pick, or a skip, costs one of your 3 lives and ends the level; the one you picked is shown in red where it really is. The run goes on until your lives are gone: headline features first, then regional seas, ranges and deserts from level 9, and from level 21 straits, small ranges and archipelagos, close up. The wrong options get closer look-alikes as you go.',
  'region-run':
    'A country is drawn as plain shapes, its states, provinces or regions, with no names. One lights up: type its name, in English or the local language.¶A wrong guess is shaded red where it really is, so a miss teaches. Naming a division of another country is free: it only tells you where that one is.¶Three wrong guesses in a level cost one of your 3 lives and end it, showing the answer; a skip costs a life too. Right first time is flawless: half as many points again, and a lost life back (never more than 3). Later guesses score less.¶The run goes on until your lives are gone: the big divisions of the United States, Canada, Australia and Germany first; then Brazil, France, Italy, Spain, Mexico and Japan from level 9; from level 21 China, India, the smaller divisions, and countries few people learn, like Argentina, Turkey, Poland and Nigeria. Divisions too small to see are never asked.',
  'on-the-grid':
    'A coordinate is given, like 23°S, 47°W: type the country that contains it. The map is blind: coastlines only, with no borders, names, lines or marker, so you place the coordinates yourself.¶A wrong country shows which way the spot lies from it, and how far (to its nearest edge), and is shaded on the map. A neighbour of the answer is told so.¶Three wrong guesses in a level cost one of your 3 lives and end it, showing where the spot is; two from level 21, one from level 41. A skip costs a life too.¶Right first time is flawless: half as many points again, and a lost life back (never more than 3). Later guesses score less.¶The run goes on until your lives are gone: round coordinates deep inside big countries first, then 5° steps and smaller countries from level 9, any whole degree near borders too from level 21, and from level 41 no map until the answer.',
  'circle-arcade':
    'Name the top cities in each circle, anywhere in the world. Early circles are big and mostly about famous, much-visited cities; later ones get smaller and ask for more. Wrong guesses are free but spoil a perfect level; a skip costs a life. Hints (the country and every third letter) are limited and halve a city’s points. A perfect level, without misses, skips or hints, earns a life and a hint back.',
};

/** Rules text; lines (separated by a pilcrow) become bullets. */
function Rules({ text }: { text: string }) {
  const lines = text.split('¶');
  if (lines.length === 1) return <p>{text}</p>;
  return (
    <ul className="rules-list">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

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
  const showCount = !['circle', 'circle-arcade', 'pin-drop', 'halfway', 'great-circle', 'mystery-country', 'border-blitz', 'clockwork', 'blank-atlas', 'river-run', 'native-tongue', 'supply-chain', 'on-the-grid', 'region-run'].includes(game.kind);

  return (
    <div className="panel center">
      <p className="lead">{game.tagline}</p>
      <Rules text={RULES[game.kind]} />
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
    </div>
  );
}
