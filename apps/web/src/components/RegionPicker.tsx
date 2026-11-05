import { MIN_POOL_SIZE, REGIONS, type Region } from '@geogames/games';

/** Chip row for choosing a region; regions with too few items are disabled when `sizes` is given. */
export function RegionPicker({
  value,
  onChange,
  sizes,
  unit,
}: {
  value: Region;
  onChange(region: Region): void;
  sizes?: Record<Region, number> | null;
  unit?: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label="Region">
      {REGIONS.map((r) => {
        const size = sizes?.[r.id];
        const tooSmall = size !== undefined && size < MIN_POOL_SIZE;
        return (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={value === r.id}
            className="chip"
            disabled={tooSmall}
            title={tooSmall ? `Only ${size} ${unit ?? 'items'}: not enough for a good game` : undefined}
            onClick={() => onChange(r.id)}
          >
            {r.label}
            {size !== undefined && <span className="chip-count">{size}</span>}
          </button>
        );
      })}
    </div>
  );
}
