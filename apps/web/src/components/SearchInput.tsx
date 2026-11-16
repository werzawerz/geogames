import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Flag } from './Flag.tsx';
import { buildIndex, exactMatch, normalize, search, type SearchItem } from './search.ts';

export type { SearchItem } from './search.ts';

const MAX_SUGGESTIONS = 8;

/**
 * Type-ahead picker. Matches names and aliases (San Jose → San Francisco),
 * tolerates typos (Kyev), and understands a trailing country ("San Jose, USA").
 * Bigger places come first among equal matches. Submits on Enter or click.
 */
export function SearchInput({
  items,
  exclude,
  onPick,
  onNoMatch,
  placeholder,
  label,
  cleanQuery = (t) => t,
  exactOnly = false,
  focusWithoutScroll = false,
}: {
  items: readonly SearchItem[];
  exclude: ReadonlySet<string>;
  onPick(id: string): void;
  /** Enter on text that names nothing. */
  onNoMatch(): void;
  placeholder: string;
  label: string;
  /** Rewrites the text before matching (River Run drops a "River" around the name). */
  cleanQuery?(text: string): string;
  /** Enter takes only an exact name or an arrowed suggestion; anything else is "no match", never a guess. */
  exactOnly?: boolean;
  /** Focuses on mount without scrolling the page, instead of autoFocus. */
  focusWithoutScroll?: boolean;
}) {
  const listId = useId();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  // Set by the arrow keys only: a pointer resting on the list mustn't change what Enter picks.
  const [arrowed, setArrowed] = useState(false);

  const index = useMemo(() => buildIndex(items), [items]);
  const query = cleanQuery(text);
  const suggestions = useMemo(() => search(index, query, exclude, MAX_SUGGESTIONS), [index, query, exclude]);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusWithoutScroll) input.current?.focus({ preventScroll: true });
  }, [focusWithoutScroll]);

  const pick = (item: SearchItem) => {
    onPick(item.id);
    setText('');
    setActive(0);
    setArrowed(false);
  };

  // A single exact name (or short form: UK, UAE, DRC) wins over fuzzy and prefix
  // suggestions, unless the player arrowed to one. That includes excluded items, so the game can say why it can't take
  // them (instead of "Mali" quietly picking Somalia). Several exact matches
  // (Hyderabad, India / Pakistan) use the highlighted suggestion instead.
  const submit = () => {
    if (!normalize(text)) return;
    const exact = arrowed ? null : exactMatch(index, query);
    const chosen = exact ?? (arrowed ? suggestions[active] : exactOnly ? undefined : suggestions[0])?.item;
    if (chosen) pick(chosen);
    else onNoMatch();
  };

  return (
    <div className="search-input">
      <input
        type="text"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-activedescendant={suggestions[active] ? `${listId}-${suggestions[active].item.id}` : undefined}
        aria-label={label}
        placeholder={placeholder}
        autoComplete="off"
        ref={input}
        autoFocus={!focusWithoutScroll}
        value={text}
        onChange={(e) => {
          setText(e.currentTarget.value);
          setActive(0);
          setArrowed(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, suggestions.length - 1));
            setArrowed(true);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
            setArrowed(true);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            setText('');
          }
        }}
      />
      {suggestions.length > 0 && (
        <ul className="suggestions" role="listbox" id={listId}>
          {suggestions.map(({ item, via }, i) => (
            <li
              key={item.id}
              id={`${listId}-${item.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                pick(item);
              }}
              // Move, not enter: a list opening under a resting pointer must not steal the selection.
              onMouseMove={() => setActive(i)}
            >
              {item.iso2 && <Flag iso2={item.iso2} className="suggestion-flag" />}
              <span>{item.label}</span>
              {via && <span className="suggestion-via">{via}</span>}
              {item.detail && <span className="suggestion-detail">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
