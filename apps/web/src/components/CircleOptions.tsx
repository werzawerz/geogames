import { useId } from 'react';
import { CIRCLE_RADIUS, RADIUS_BANDS, radiusBand, type GameSettings } from '@geogames/games';
import { ChoiceChips } from './ChoiceChips.tsx';

const PLACEMENTS = [
  { id: 'random', label: 'Random' },
  { id: 'custom', label: 'I’ll place it' },
] as const;

/** Radius used when switching from Auto to a chosen size. */
const DEFAULT_CHOSEN_RADIUS = 500;

/**
 * City Circle settings: who places the circles and how big they are. On the
 * setup screen the radius is a free slider; leaderboards group radii into
 * bands, so \`mode="leaderboard"\` shows band chips instead.
 */
export function CircleOptions({
  settings,
  onChange,
  mode,
}: {
  settings: GameSettings;
  onChange(settings: GameSettings): void;
  mode: 'setup' | 'leaderboard';
}) {
  const sliderId = useId();
  const custom = settings.circlePlacement === 'custom';
  const auto = settings.circleRadiusKm === 0;
  const band = radiusBand(settings.circleRadiusKm);
  const bandInfo = RADIUS_BANDS.find((b) => b.id === band);

  const bandChips = [
    // "Auto" only makes sense for random circles.
    ...(custom ? [] : [{ id: 'auto' as const, label: 'Auto' }]),
    ...RADIUS_BANDS.map((b) => ({ id: b.id, label: `${b.label} · ${b.range}` })),
  ];

  return (
    <>
      <h2 className="setup-label">Circles</h2>
      <ChoiceChips
        label="Circle placement"
        options={PLACEMENTS}
        value={settings.circlePlacement}
        onChange={(circlePlacement) => onChange({ ...settings, circlePlacement })}
      />
      <h2 className="setup-label">Radius</h2>
      {mode === 'leaderboard' ? (
        <ChoiceChips
          label="Circle size"
          options={bandChips}
          value={band}
          onChange={(id) => onChange({ ...settings, circleRadiusKm: RADIUS_BANDS.find((b) => b.id === id)?.radius ?? 0 })}
        />
      ) : (
        <>
          {!custom && (
            <ChoiceChips
              label="Radius mode"
              options={[
                { id: 'auto', label: 'Auto' },
                { id: 'chosen', label: 'Choose' },
              ]}
              value={auto ? 'auto' : 'chosen'}
              onChange={(m) => onChange({ ...settings, circleRadiusKm: m === 'auto' ? 0 : DEFAULT_CHOSEN_RADIUS })}
            />
          )}
          {!auto && (
            <div className="size-slider">
              <label htmlFor={sliderId} className="size-value">
                Radius <strong>{settings.circleRadiusKm} km</strong>
                {bandInfo && <span className="muted"> · {bandInfo.label.toLowerCase()} circles leaderboard</span>}
              </label>
              <input
                id={sliderId}
                type="range"
                min={CIRCLE_RADIUS.min}
                max={CIRCLE_RADIUS.max}
                step={CIRCLE_RADIUS.step}
                value={settings.circleRadiusKm}
                onChange={(e) => onChange({ ...settings, circleRadiusKm: Number(e.currentTarget.value) })}
              />
              <div className="size-ticks" aria-hidden="true">
                <span>{CIRCLE_RADIUS.min} km</span>
                <span>{CIRCLE_RADIUS.max} km</span>
              </div>
            </div>
          )}
          <p className="muted small">
            {custom
              ? 'You click the map to place each circle.'
              : auto
                ? 'Auto: the smallest circle that holds enough cities (250–900 km).'
                : 'Circles are placed around a random city in the region.'}
          </p>
        </>
      )}
    </>
  );
}
