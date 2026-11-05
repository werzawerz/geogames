import { CITY_DATA, type CityData } from '@geogames/games';
import { ChoiceChips } from './ChoiceChips.tsx';

export function CityDataPicker({ value, onChange }: { value: CityData; onChange(cityData: CityData): void }) {
  const current = CITY_DATA.find((d) => d.id === value)!;
  return (
    <div className="difficulty">
      <ChoiceChips options={CITY_DATA} value={value} onChange={onChange} label="City data" />
      <p className="muted small">{current.description}</p>
    </div>
  );
}
