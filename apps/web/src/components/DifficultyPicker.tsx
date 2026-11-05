import { DIFFICULTIES, type Difficulty } from '@geogames/games';

/** Easy / Medium / Hard chips with a one-line explanation of the chosen level. */
export function DifficultyPicker({ value, onChange }: { value: Difficulty; onChange(difficulty: Difficulty): void }) {
  const current = DIFFICULTIES.find((d) => d.id === value)!;
  return (
    <div className="difficulty">
      <div className="chips" role="radiogroup" aria-label="Difficulty">
        {DIFFICULTIES.map((d) => (
          <button
            key={d.id}
            type="button"
            role="radio"
            aria-checked={value === d.id}
            className={`chip difficulty-${d.id}`}
            onClick={() => onChange(d.id)}
          >
            {d.label}
          </button>
        ))}
      </div>
      <p className="muted small">{current.description}</p>
    </div>
  );
}
