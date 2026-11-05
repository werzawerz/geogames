import { useId } from 'react';
import { citySizeStops, formatPopulationShort, type Region } from '@geogames/games';

/** Discrete slider over the city-size stops the region allows (smallest city in play). */
export function CitySizeSlider({
  region,
  value,
  onChange,
}: {
  region: Region;
  value: number;
  onChange(minPopulation: number): void;
}) {
  const id = useId();
  const stops = citySizeStops(region);
  const index = Math.max(0, stops.indexOf(value));
  if (stops.length < 2) return null;

  return (
    <div className="size-slider">
      <label htmlFor={id} className="size-value">
        Cities with <strong>{formatPopulationShort(stops[index]!)}+</strong> people
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={stops.length - 1}
        step={1}
        value={index}
        aria-valuetext={`${formatPopulationShort(stops[index]!)} or more people`}
        onChange={(e) => onChange(stops[Number(e.currentTarget.value)]!)}
      />
      <div className="size-ticks" aria-hidden="true">
        {stops.map((s) => (
          <span key={s}>{formatPopulationShort(s)}</span>
        ))}
      </div>
    </div>
  );
}
