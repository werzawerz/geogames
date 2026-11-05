// Pieces shared by City Circle (free play) and City Circle Arcade.
import { geoCircle } from 'd3-geo';
import { getCountry, type CityId } from '@geogames/geodata';
import { distanceKm, type CircleCity, type CirclePuzzle } from '@geogames/games';
import { Flag } from '../../components/Flag.tsx';
import { fitLabels, type ToScreen } from '../../components/WorldMap.tsx';

const KM_PER_DEGREE = 111.195;
/** Gap between a city's dot and its label, in map units. */
const LABEL_OFFSET = 10;
export const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat('en');

/** GeoJSON circle of `radiusKm` around [lat, lng]. */
export const circleShape = (center: readonly [number, number], radiusKm: number) =>
  geoCircle()
    .center([center[1], center[0]])
    .radius(radiusKm / KM_PER_DEGREE)
    .precision(2)();

/** 1-based rank inside the circle, or null when outside. */
export function rankIn(puzzle: CirclePuzzle, id: CityId): number | null {
  const i = puzzle.inside.indexOf(id);
  return i < 0 ? null : i + 1;
}

export type MarkerTone = 'found' | 'inside' | 'outside' | 'missed' | 'skipped';

export interface CityMarker {
  id: CityId;
  tone: MarkerTone;
}

/** Marker for a guess: green in the top `target`, amber elsewhere inside, red outside. */
export function guessMarker(puzzle: CirclePuzzle, target: number, id: CityId): CityMarker {
  const rank = rankIn(puzzle, id);
  return { id, tone: rank === null ? 'outside' : rank <= target ? 'found' : 'inside' };
}

/** Tooltip for an urban area that spans several cities. */
export const includesTitle = (city: CircleCity) =>
  city.includes?.length ? `Urban area including ${city.includes.join(', ')}` : undefined;

/** City dots with labels ("2. Naples", "#8 Benghazi"); best-ranked labels win when they'd overlap. */
export function CityMarkers({
  markers,
  cities,
  puzzle,
  target,
  toScreen,
}: {
  markers: readonly CityMarker[];
  cities: ReadonlyMap<CityId, CircleCity>;
  puzzle: CirclePuzzle;
  target: number;
  toScreen: ToScreen;
}) {
  const placed = markers.flatMap(({ id, tone }) => {
    const city = cities.get(id)!;
    const point = toScreen([city.latlng[1], city.latlng[0]]);
    if (!point) return [];
    const rank = rankIn(puzzle, id);
    const prefix = rank === null ? '' : rank <= target ? `${rank}. ` : `#${rank} `;
    return [{ id, tone, rank: rank ?? Infinity, x: point[0], y: point[1], text: `${prefix}${city.name}` }];
  });
  // Every city keeps its dot; only labels can be dropped.
  const labelled = new Set(
    fitLabels(
      [...placed].sort((a, b) => a.rank - b.rank).map((m) => ({ ...m, x: m.x + LABEL_OFFSET })),
      'start',
    ).map((m) => m.id),
  );
  return (
    <>
      {placed.map(({ id, tone, x, y, text }) => (
        <g key={id} className={`city-marker marker-${tone}`} transform={`translate(${x},${y})`}>
          <circle r={6} />
          {labelled.has(id) && (
            <text x={LABEL_OFFSET} y={0}>
              {text}
            </text>
          )}
        </g>
      ))}
    </>
  );
}

/** Every guess so far (latest first) with its population and how it scored. */
export function GuessTable({
  cities,
  puzzle,
  target,
  guesses,
}: {
  cities: ReadonlyMap<CityId, CircleCity>;
  puzzle: CirclePuzzle;
  target: number;
  guesses: readonly CityId[];
}) {
  if (guesses.length === 0) return null;
  return (
    <table className="guess-table">
      <thead>
        <tr>
          <th scope="col">City</th>
          <th scope="col" className="num">
            Population
          </th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>
        {[...guesses].reverse().map((id) => {
          const city = cities.get(id)!;
          const country = getCountry(city.countryId);
          const rank = rankIn(puzzle, id);
          const [tone, result] =
            rank === null
              ? ['outside', `Outside · ${Math.round(distanceKm(puzzle.center, city.latlng) - puzzle.radiusKm)} km away`]
              : rank <= target
                ? ['found', `Top ${target} · #${rank}`]
                : ['inside', `Inside · #${rank}`];
          return (
            <tr key={id}>
              <td>
                <span className="guess-city">
                  {country && <Flag iso2={country.iso2} className="suggestion-flag" />}
                  {city.name}
                  <span className="muted">{country?.name}</span>
                  {city.includes?.length ? <span className="includes">incl. {city.includes.join(', ')}</span> : null}
                </span>
              </td>
              <td className="num">{full.format(city.population)}</td>
              <td>
                <span className={`result result-${tone}`}>{result}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
