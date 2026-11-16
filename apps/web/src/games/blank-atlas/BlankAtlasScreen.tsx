import { useEffect, useMemo, useRef, useState } from 'react';
import { geoPath, type GeoPermissibleObjects, type GeoProjection } from 'd3-geo';
import type { Geometry } from 'geojson';
import { BLANK_ATLAS_KIND_LABELS, type BlankAtlasFeature } from '@geogames/geodata/blank-atlas';
import { loadBlankAtlasShapes } from '@geogames/geodata/blank-atlas-shapes';
import { loadWorldShapes, type WorldShapes } from '@geogames/geodata/shapes';
import {
  BLANK_ATLAS_MAX_LIVES,
  BLANK_ATLAS_SKIP,
  blankAtlasGame,
  blankAtlasGroup,
  blankAtlasViewKm,
  distanceKm,
  replayBlankAtlas,
  type BlankAtlas,
  type BlankAtlasDefinition,
  type BlankAtlasMark,
  type BlankAtlasState,
} from '@geogames/games';
import { WorldMap, type ToScreen } from '../../components/WorldMap.tsx';
import { circleShape } from '../circle/shared.tsx';
import { placeLabels } from '../halfway/HalfwayScreen.tsx';
import type { GameScreenProps } from '../types.ts';

const MAX_ZOOM = 30;
const km = new Intl.NumberFormat('en');
/** Distances to the nearest 100 km: a feature's centre is only roughly where it is. */
const roughKm = (d: number) => km.format(Math.max(100, Math.round(d / 100) * 100));
/** A feature this much smaller than the view gets a ring around it, so it can't be missed. */
const RING_SHARE = 1 / 10;
/** Water narrower than this (map units) is drawn unmasked, with an edge and a ring. */
const NARROW_UNITS = 10;
/** The blur softening a sea's open-water edge, in map units: at most this, and none below the least. */
const MAX_BLUR = 6;
const MIN_BLUR = 1;
/** Phones show the map narrower: the view closes in, so small features stay big enough to see. */
const PHONE_VIEW_SHARE = 0.6;
const isPhone = () => typeof matchMedia !== 'undefined' && matchMedia('(max-width: 640px)').matches;

const MARKS: Record<BlankAtlasMark, string> = { flawless: '🟩', lost: '🟥' };

/** Names read with "the" (the Sahara, the Azores) or without (Lake Baikal, Sicily, Crimea). */
function withThe(f: BlankAtlasFeature): string {
  const bare =
    /^(Lake|Mount|Lough|Salar|Dasht)\b/.test(f.name) ||
    f.kind === 'island' ||
    (f.kind === 'lake' && !/Sea|meer/.test(f.name)) ||
    (['peninsula', 'lowland'].includes(f.kind) && !/[\s-]/.test(f.name) && !/s$/.test(f.name) && !['Sahel', 'Sudd', 'Pantanal'].includes(f.name));
  return bare ? f.name : `the ${f.name}`;
}
const capitalised = (s: string) => s[0]!.toUpperCase() + s.slice(1);

/** Loads the map, the features and their outlines (all lazily), then plays. */
export function BlankAtlasScreen({ seed, initialMoves, onMovesChange, onGameOver }: GameScreenProps<BlankAtlasDefinition>) {
  const [loaded, setLoaded] = useState<{ shapes: WorldShapes; outlines: Readonly<Record<string, Geometry>>; game: BlankAtlas } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    Promise.all([loadWorldShapes(), loadBlankAtlasShapes(), blankAtlasGame()]).then(
      ([shapes, outlines, game]) => !cancelled && setLoaded({ shapes, outlines, game }),
      () => !cancelled && setError(true),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="panel center">Couldn't load the map. Check your connection and try again.</p>;
  if (!loaded) return <p className="panel center muted">Loading map…</p>;
  return <BlankAtlasPlay {...loaded} seed={seed} initialMoves={initialMoves} onMovesChange={onMovesChange} onGameOver={onGameOver} />;
}

const isWater = (f: BlankAtlasFeature) => blankAtlasGroup(f.kind) === 'water';

function BlankAtlasPlay({
  shapes,
  outlines,
  game,
  seed,
  initialMoves,
  onMovesChange,
  onGameOver,
}: {
  shapes: WorldShapes;
  outlines: Readonly<Record<string, Geometry>>;
  game: BlankAtlas;
  seed: number;
  initialMoves: GameScreenProps['initialMoves'];
  onMovesChange: GameScreenProps['onMovesChange'];
  onGameOver: GameScreenProps['onGameOver'];
}) {
  const [state, setState] = useState<BlankAtlasState>(() => replayBlankAtlas(game, seed, initialMoves ?? []));
  useEffect(() => onMovesChange?.(state.moves), [state.moves, onMovesChange]);
  const { level } = state;
  const playing = state.status === 'playing';
  const target = game.features.get(level.feature)!;
  const picked = level.picked ? game.features.get(level.picked)! : null;
  const wrong = picked && picked.id !== target.id ? picked : null;
  const kind = BLANK_ATLAS_KIND_LABELS[target.kind].toLowerCase();
  const options = level.options.map((id) => game.features.get(id)!);

  const viewKm = blankAtlasViewKm(target, level.number);
  const frameKm = isPhone() ? Math.max(target.radiusKm * 1.1, viewKm * PHONE_VIEW_SHARE) : viewKm;
  // Centred on the feature: it's lit up anyway, so the centre gives nothing away.
  const frame = useMemo<GeoPermissibleObjects>(() => circleShape(target.center, frameKm), [target, frameKm]);

  const overlay = useMemo(() => {
    const tone = level.status === 'lost' ? 'lost' : level.status === 'cleared' ? 'found' : 'target';
    const shown = [...(wrong ? [{ f: wrong, tone: 'guess' }] : []), { f: target, tone }];
    let landPath: { projection: GeoProjection; d: string } | null = null;
    return (projection: GeoProjection) => {
      const path = geoPath(projection);
      if (landPath?.projection !== projection) landPath = { projection, d: path(shapes.land) ?? '' };
      // About how wide each feature is on this map, in map units: its area over its length.
      const widthOf = (f: BlankAtlasFeature) => {
        const [[x0, y0], [x1, y1]] = path.bounds(outlines[f.id]!);
        return path.area(outlines[f.id]!) / Math.max(1, Math.hypot(x1 - x0, y1 - y0));
      };
      // Water narrower than the 1:50m coast can show (the Dardanelles) would vanish under the
      // land mask: it's drawn whole, with an edge, instead.
      const narrow = (f: BlankAtlasFeature) => isWater(f) && widthOf(f) < NARROW_UNITS;
      // Water is masked by the land, so a sea's rough outline stops at the coast, and blurred,
      // so where it meets open sea there's no hard, straight edge. The blur scales with the
      // feature, and narrow water (the Dardanelles) isn't blurred at all, or it would vanish.
      const blurOf = (f: BlankAtlasFeature) => (isWater(f) && !narrow(f) ? Math.min(MAX_BLUR, widthOf(f) / 8) : 0);
      const draw = ({ f, tone }: { f: BlankAtlasFeature; tone: string }) => {
        const blur = blurOf(f);
        return (
          <path
            key={`${tone}-${f.id}`}
            className={`atlas-feature atlas-${tone}${f.kind === 'lake' ? ' atlas-lake' : ''}${isWater(f) && !narrow(f) ? ' atlas-sea' : ''}`}
            d={path(outlines[f.id]!) ?? ''}
            mask={isWater(f) && !narrow(f) ? 'url(#atlas-sea-mask)' : undefined}
            filter={blur >= MIN_BLUR ? `url(#atlas-soft-${f.id})` : undefined}
          />
        );
      };
      // A ring marks a feature small for the view, every strait (narrow by nature), and narrow water.
      const small = target.radiusKm < frameKm * RING_SHARE || target.kind === 'strait' || narrow(target);
      const ring = small ? circleShape(target.center, Math.max(target.radiusKm * 2.5, frameKm * 0.12)) : null;
      return (
        <>
          <defs>
            <mask id="atlas-sea-mask" maskUnits="userSpaceOnUse" x={-1e4} y={-1e4} width={2e4} height={2e4}>
              <rect x={-1e4} y={-1e4} width={2e4} height={2e4} fill="white" />
              <path d={landPath.d} fill="black" />
            </mask>
            {shown.map(({ f }) => (
              <filter key={f.id} id={`atlas-soft-${f.id}`} x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation={blurOf(f)} />
              </filter>
            ))}
          </defs>
          {shown.map(draw)}
          {ring && <path className="atlas-ring" d={path(ring) ?? ''} />}
        </>
      );
    };
  }, [target, frameKm, wrong, level.status, outlines, shapes.land]);

  const markers = (toScreen: ToScreen) => {
    const named = [...(playing ? [] : [{ f: target, tone: 'found' }]), ...(wrong ? [{ f: wrong, tone: 'outside' }] : [])];
    const placed = named.flatMap(({ f, tone }) => {
      const point = toScreen([f.center[1], f.center[0]]);
      return point ? [{ key: `${tone}-${f.id}`, tone, text: f.name, x: point[0], y: point[1] }] : [];
    });
    return placeLabels(placed, null).map(({ key, tone, text, x, y, anchor }) => (
      <g key={`label-${key}`} className={`city-marker marker-${tone}`}>
        <text x={x} y={y} textAnchor={anchor}>
          {text}
        </text>
      </g>
    ));
  };

  const choose = (id: string) => setState((s) => game.guess(s, id).state);
  const skip = () => setState((s) => game.skip(s));
  const next = () => setState((s) => game.nextLevel(s));
  const finish = () =>
    onGameOver({
      score: state.score,
      moves: state.moves,
      message: `You reached level ${level.number}.`,
      shareLine: state.marks.map((m) => MARKS[m]).join(''),
    });

  // Keys 1–4 pick an option while the level is on.
  const live = useRef({ playing, options: level.options });
  live.current = { playing, options: level.options };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const n = Number(e.key);
      if (live.current.playing && n >= 1 && n <= live.current.options.length) {
        e.preventDefault();
        choose(live.current.options[n - 1]!);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // choose only reads the latest state through setState.
  }, []);

  // When a level ends, its button takes the focus, so Enter goes on (without scrolling the page).
  const nextButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!playing) nextButton.current?.focus({ preventScroll: true });
  }, [playing, level.number]);

  const skipped = level.status === 'lost' && state.moves.at(-1) === BLANK_ATLAS_SKIP;
  const fact = `${capitalised(withThe(target))}: ${BLANK_ATLAS_KIND_LABELS[target.kind].toLowerCase()}, about ${roughKm(target.radiusKm * 2)} km across.`;
  const result =
    level.status === 'cleared' ? (
      <>
        <strong>✓ Right! +{level.points}</strong> {state.bonusLife ? '+1 ♥.' : `Lives are full (${BLANK_ATLAS_MAX_LIVES}).`}
      </>
    ) : skipped ? (
      <strong>Skipped: −1 ♥.</strong>
    ) : wrong ? (
      <>
        <strong>✗ Not {withThe(wrong)}: −1 ♥.</strong> It’s shown in red, about {roughKm(distanceKm(wrong.center, target.center))} km away.
      </>
    ) : null;

  return (
    <div className="route blank-atlas-game">
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
        <span aria-live="polite">
          Score <strong>{state.score}</strong>
        </span>
      </div>

      <p className="atlas-prompt">
        Which <strong>{kind}</strong> is lit up?
      </p>

      <WorldMap
        shapes={shapes}
        frame={frame}
        borders={false}
        terrain
        maxZoom={MAX_ZOOM}
        overlay={overlay}
        markers={markers}
        label={playing ? `Map: an unnamed ${kind}, lit up` : `Map: ${target.name}`}
      />

      <div className="atlas-options" role="group" aria-label="Options">
        {options.map((f, i) => {
          const mark = playing ? '' : f.id === target.id ? ' option-right' : f.id === level.picked ? ' option-wrong' : ' option-other';
          return (
            <button key={f.id} type="button" className={`btn atlas-option${mark}`} disabled={!playing} onClick={() => choose(f.id)}>
              <span className="option-key" aria-hidden="true">
                {i + 1}
              </span>
              <span className="option-name">{f.name}</span>
              {!playing && f.id === target.id && <span className="option-mark">✓</span>}
              {!playing && f.id === level.picked && f.id !== target.id && <span className="option-mark">✗</span>}
            </button>
          );
        })}
      </div>

      {playing ? (
        <div className="atlas-actions">
          <span className="muted atlas-hint">Tap a name, or press 1–4. A wrong pick costs a life.</span>
          <button className="btn atlas-skip" onClick={skip}>
            ⏭ Skip <span className="muted">−1 ♥</span>
          </button>
        </div>
      ) : (
        <div className={`atlas-result ${level.status === 'cleared' ? 'solved' : 'failed'}`} role="status">
          <p className="atlas-result-text">
            {result} <span className="muted">{fact}</span>
            {state.status === 'over' && <strong> Out of lives.</strong>}
          </p>
          <button ref={nextButton} className="btn btn-primary" onClick={state.status === 'over' ? finish : next}>
            {state.status === 'over' ? 'See final score' : 'Next level'}
          </button>
        </div>
      )}
    </div>
  );
}
