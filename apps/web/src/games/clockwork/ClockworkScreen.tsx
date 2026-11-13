import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import { getCountry } from '@geogames/geodata';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  CLOCK_DATES,
  CLOCK_MAX_LIVES,
  CLOCK_SKIP,
  clockPlace,
  clockPlan,
  clockworkCountries,
  createClockwork,
  formatClock,
  formatOffset,
  parseClock,
  replayClockwork,
  type ClockGuessResult,
  type ClockMark,
  type ClockPlace,
  type ClockState,
  type Clockwork,
  type ClockworkDefinition,
} from '@geogames/games';
import { WorldMap, type MapCountry, type ToScreen } from '../../components/WorldMap.tsx';
import { circleShape } from '../circle/shared.tsx';
import type { GameScreenProps } from '../types.ts';

const MARKS: Record<ClockMark, string> = { flawless: '🎯', cleared: '🟩', missed: '🟧', lost: '🟥' };
const DAY = 24 * 60;

/** Loads the map shapes (lazily), then plays. */
export function ClockworkScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<ClockworkDefinition>) {
  const [shapes, setShapes] = useState<WorldShapes | null>(null);
  const [error, setError] = useState(false);
  const game = useMemo(() => createClockwork({ countries: clockworkCountries() }), []);
  useEffect(() => {
    let cancelled = false;
    loadWorldShapes().then(
      (s) => !cancelled && setShapes(s),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!shapes) return <p className="panel center muted">Loading map…</p>;
  return <ClockworkPlay shapes={shapes} game={game} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

/** "Perth, Australia" for a city, "Japan" for a country. */
const placeName = (place: ClockPlace) => {
  const country = getCountry(place.country)?.name ?? place.country;
  return place.city ? `${place.city.name}, ${country}` : country;
};

/**
 * A view of the place with room around it, so the meridians either side show
 * where it lies. The view grows with the country, but a small one (Belgium,
 * Senegal) still fills a good part of it, so the answer is clearly visible.
 */
function frameFor(place: ClockPlace): GeoPermissibleObjects {
  const country = getCountry(place.country);
  const centre = place.city?.latlng ?? country?.latlng ?? [0, 0];
  const area = country?.metrics.area?.value ?? 0;
  const radius = place.city ? 2400 : 600 + Math.sqrt(area);
  return circleShape(centre, radius);
}

/** A meridian every 15°, an hour of the sun's travel; Greenwich stands out. */
const MERIDIANS = Array.from({ length: 24 }, (_, i) => {
  const lng = -180 + i * 15;
  return {
    lng,
    line: { type: 'LineString', coordinates: Array.from({ length: 35 }, (_, j) => [lng, -85 + j * 5]) } as GeoPermissibleObjects,
  };
});

function messageFor(result: ClockGuessResult, minutes: number, state: ClockState): string | null {
  const time = formatClock(minutes);
  switch (result) {
    case 'right':
      return null;
    case 'repeat':
      return `You’ve tried ${time} already.`;
    case 'invalid':
      return 'Type a time like 17:30.';
    case 'earlier':
    case 'later': {
      const hint = `It’s ${result} than ${time}.`;
      if (state.level.status === 'lost') return hint;
      const left = clockPlan(state.level.number).misses - state.level.guesses.length;
      return left > 1 ? `${hint} ${left - 1} more free ${left === 2 ? 'miss' : 'misses'}.` : `${hint} One more miss costs a life.`;
    }
  }
}

function ClockworkPlay({
  shapes,
  game,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  game: Clockwork;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<ClockState>(() => replayClockwork(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const { level } = state;
  const place = clockPlace(level.place);
  const plan = clockPlan(level.number);
  const playing = state.status === 'playing';
  const name = placeName(place);
  const date = CLOCK_DATES[level.date]!.label;
  const utc = formatClock(level.utcHour * 60);

  useEffect(() => {
    setMessage(null);
    setText('');
  }, [level.number]);

  // Keyboard play: the input while a level is on, the next button after it. Without
  // scrolling, which would push the question off the top of a short screen.
  useEffect(() => {
    (playing ? input.current : nextButton.current)?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const frame = useMemo(() => frameFor(place), [place]);
  const countries = useMemo<MapCountry[]>(() => [{ id: place.country, tone: 'start' }], [place]);
  const overlay = useMemo(
    () => (projection: GeoProjection) => {
      const path = geoPath(projection);
      return (
        <g className="clock-meridians">
          {MERIDIANS.map(({ lng, line }) => (
            <path key={lng} className={lng === 0 ? 'clock-meridian clock-greenwich' : 'clock-meridian'} d={path(line) ?? ''} />
          ))}
        </g>
      );
    },
    [],
  );
  const markers = (toScreen: ToScreen) => {
    if (!place.city) return null;
    const point = toScreen([place.city.latlng[1], place.city.latlng[0]]);
    if (!point) return null;
    return (
      <g className="city-marker marker-end" transform={`translate(${point[0]},${point[1]})`}>
        <circle r={6} />
        <text x={10} y={0}>
          {place.city.name}
        </text>
      </g>
    );
  };

  const parsed = parseClock(text);

  const guess = (minutes: number) => {
    const { state: next, result } = game.guess(state, minutes);
    setMessage(messageFor(result, minutes, next));
    setState(next);
    if (result === 'earlier' || result === 'later') setText('');
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parsed === null) setMessage(text.trim() ? `“${text.trim()}” isn’t a time. Try 17:30 or 1730.` : 'Type a time like 17:30.');
    else guess(parsed);
  };

  // Arrow keys step the time: an hour, or a quarter with Shift. From empty, they start at the UTC time.
  const step = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    const by = (e.shiftKey ? 15 : 60) * (e.key === 'ArrowUp' ? 1 : -1);
    setText(formatClock((((parsed ?? level.utcHour * 60) + by) % DAY + DAY) % DAY));
  };

  const skip = () => {
    setMessage(null);
    setState(game.skip(state));
  };

  const next = () => setState(game.nextLevel(state));

  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}.`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  const misses = level.status === 'cleared' ? level.guesses.length - 1 : level.guesses.length;
  const skipped = level.status === 'lost' && state.moves.at(-1) === CLOCK_SKIP;
  const answer = (
    <p className="clock-answer">
      It’s <strong>{formatClock(level.answer)}</strong> in {name}: {formatOffset(level.offset)} on {date}.
    </p>
  );

  return (
    <div className="route clockwork-game">
      <div className="route-status">
        <span>
          Level <strong>{level.number}</strong>
        </span>
        <span className="lives" aria-label={`${state.lives} lives`}>
          {Array.from({ length: Math.max(state.lives, 1) }, (_, i) => (
            <span key={i} className={i < state.lives ? 'life' : 'life lost'} aria-hidden="true">
              ♥
            </span>
          ))}
        </span>
        <span aria-label={`${misses} of ${plan.misses} misses`}>
          Misses <strong className="clock-misses">{misses}</strong>/{plan.misses}
        </span>
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <div className="clock-prompt">
        <p className="clock-given">
          It’s <strong className="clock-utc">{utc} UTC</strong> on <strong>{date}</strong>.
        </p>
        <p className="clock-question">
          What time is it in <strong>{name}</strong>?
        </p>
      </div>

      <WorldMap
        shapes={shapes}
        countries={countries}
        frame={frame}
        borders={false}
        overlay={overlay}
        markers={markers}
        label={`Map: ${name}, with a line every 15° of longitude`}
      />

      {playing ? (
        <>
          <form className="clock-form" onSubmit={submit}>
            <input
              ref={input}
              className="clock-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={step}
              placeholder="17:30"
              inputMode="numeric"
              autoComplete="off"
              aria-label="Local time"
              aria-describedby="clock-preview"
            />
            <button className="btn btn-primary" type="submit">
              Guess
            </button>
          </form>
          <p id="clock-preview" className="clock-preview muted">
            {parsed !== null && text.trim() !== formatClock(parsed) ? `= ${formatClock(parsed)}` : '1730, 17:30 or 5:30pm. ↑↓ an hour, Shift ↑↓ 15 min.'}
          </p>
          <p className="route-message" role="status">
            {message ?? 'UTC is London’s winter time. A line on the map every 15°, an hour of the sun’s travel.'}
          </p>
          <div className="arcade-actions">
            <button className="btn" onClick={skip}>
              ⏭ Skip <span className="muted">−1 ♥</span>
            </button>
          </div>
        </>
      ) : level.status === 'cleared' ? (
        <div className="route-summary solved" role="status">
          <p className="route-summary-title">
            Right! {formatClock(level.answer)} in {name}. +{level.points}
          </p>
          <p className="muted">{formatOffset(level.offset)} on {date}.</p>
          {place.note && <p className="clock-note">{place.note}</p>}
          {level.flawless && (
            <p className="bonus-life">{state.bonusLife ? 'Flawless! +1 ♥' : `Flawless! Lives are full (${CLOCK_MAX_LIVES} at most).`}</p>
          )}
          <button ref={nextButton} className="btn btn-primary btn-lg" onClick={next}>
            Next level
          </button>
        </div>
      ) : (
        <div className="route-summary failed" role="status">
          <p className="route-summary-title">
            {skipped ? 'Skipped: −1 ♥' : plan.misses === 1 ? 'A miss: −1 ♥' : `${plan.misses} misses: −1 ♥`}
          </p>
          {state.status === 'over' && <p className="route-summary-title">Out of lives</p>}
          {answer}
          {place.note && <p className="clock-note">{place.note}</p>}
          {state.status === 'over' ? (
            <button ref={nextButton} className="btn btn-primary btn-lg" onClick={finish}>
              See final score
            </button>
          ) : (
            <button ref={nextButton} className="btn btn-primary btn-lg" onClick={next}>
              Next level
            </button>
          )}
        </div>
      )}

      {level.guesses.length > 0 && (
        <ol className="clock-guesses" aria-label="Your guesses">
          {level.guesses.map((g) => {
            const right = g === level.answer;
            const diff = ((((level.answer - g) % DAY) + DAY + DAY / 2) % DAY) - DAY / 2;
            return (
              <li key={g} className={right ? 'guess-in' : 'guess-out'}>
                {formatClock(g)} <span className="muted">{right ? '✓' : diff < 0 ? '↓ earlier' : '↑ later'}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
