/** Chips with a line describing the current choice. */
export function DescribedChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string; description: string }[];
  value: T;
  onChange(value: T): void;
  label: string;
}) {
  return (
    <div className="difficulty">
      <ChoiceChips options={options} value={value} onChange={onChange} label={label} />
      <p className="muted small">{options.find((o) => o.id === value)!.description}</p>
    </div>
  );
}

/** A row of mutually exclusive chips (radio group). */
export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange(value: T): void;
  label: string;
}) {
  return (
    <div className="chips" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className="chip"
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
