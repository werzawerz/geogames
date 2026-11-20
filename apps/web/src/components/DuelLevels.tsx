import { useEffect, useState } from 'react';
import type { CityId } from '@geogames/geodata';
import { arcadePools, createCircleArcade, type CircleArcade, type GameSettings } from '@geogames/games';

/** What one player did on one level, from replaying their moves. */
export interface LevelResult {
  number: number;
  points: number;
  /** No misses, skips or hints, and cleared. */
  perfect: boolean;
  cleared: boolean;
  found: readonly CityId[];
}

export interface RunLevels {
  /** The cities to find on each level, by level number: the same for both players. */
  top: Map<number, readonly CityId[]>;
  results: Map<number, LevelResult>;
}

/** Plays a run again, move by move, and keeps how each level ended. */
export function summariseRun(game: CircleArcade, seed: number, moves: readonly string[]): RunLevels {
  const top = new Map<number, readonly CityId[]>();
  const results = new Map<number, LevelResult>();
  const note = (state: ReturnType<CircleArcade['start']>) => {
    const { level } = state;
    top.set(level.number, game.top(level));
    const cleared = level.status === 'cleared';
    results.set(level.number, {
      number: level.number,
      points: level.points,
      cleared,
      perfect: cleared && level.misses === 0 && level.skipped.length === 0 && Object.keys(level.hints).length === 0,
      found: level.guesses.filter((id) => game.top(level).includes(id)),
    });
  };
  let state = game.start(seed);
  note(state);
  for (const move of moves) {
    if (state.status === 'level-clear') {
      state = game.nextLevel(state);
      note(state);
    }
    if (state.status === 'over') break;
    if (move === '>') state = game.skip(state);
    else if (move === '?') state = game.hint(state);
    else state = game.guess(state, move).state;
    note(state);
  }
  return { top, results };
}

const cell = (r: LevelResult | undefined) =>
  r ? (
    <>
      <strong>{r.points}</strong> <span aria-label={r.cleared ? 'cleared' : 'not cleared'}>{r.cleared ? '✓' : '✗'}</span>
      {r.perfect && <span aria-label="perfect"> ★</span>}
    </>
  ) : (
    <span className="muted" aria-label="not reached">
      –
    </span>
  );

export interface DuelRuns {
  game: CircleArcade;
  left: RunLevels;
  right: RunLevels;
}

/** The highest level a run reached. */
export const levelReached = (run: RunLevels) => Math.max(0, ...run.results.keys());

/** Replays both runs of a finished duel (loads the city data first); null until ready. */
export function useDuelRuns(settings: GameSettings, seed: number | undefined, left: readonly string[] | undefined, right: readonly string[] | undefined) {
  const [runs, setRuns] = useState<DuelRuns | null>(null);
  useEffect(() => {
    if (seed === undefined || !left || !right) return;
    let cancelled = false;
    arcadePools(settings).then((pools) => {
      if (cancelled) return;
      const game = createCircleArcade(pools);
      setRuns({ game, left: summariseRun(game, seed, left), right: summariseRun(game, seed, right) });
    });
    return () => {
      cancelled = true;
    };
  }, [settings, seed, left, right]);
  return runs;
}

/** The level-by-level comparison of a finished duel: points per level, and who found which city. */
export function DuelLevels({ data, left, right }: { data: DuelRuns | null; left: string; right: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!data) return <p className="muted center">Loading the level table…</p>;
  const levels = [...new Set([...data.left.results.keys(), ...data.right.results.keys()])].sort((a, b) => a - b);

  return (
    <table className="duel-levels">
      <caption className="setup-label">Level by level</caption>
      <thead>
        <tr>
          <th scope="col">Level</th>
          <th scope="col">{left}</th>
          <th scope="col">{right}</th>
        </tr>
      </thead>
      <tbody>
        {levels.map((n) => {
          const a = data.left.results.get(n);
          const b = data.right.results.get(n);
          const expanded = open === n;
          const cities = data.left.top.get(n) ?? data.right.top.get(n) ?? [];
          return [
            <tr key={n} className={expanded ? 'open' : undefined}>
              <th scope="row">
                <button type="button" className="duel-level-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : n)}>
                  {n} <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                </button>
              </th>
              <td>{cell(a)}</td>
              <td>{cell(b)}</td>
            </tr>,
            expanded && (
              <tr key={`${n}-cities`} className="duel-level-cities">
                <td colSpan={3}>
                  <ul>
                    {cities.map((id) => (
                      <li key={id}>
                        <span>{data.game.cities.get(id)?.name ?? id}</span>
                        <span>{a?.found.includes(id) ? `${left} ✓` : `${left} ✗`}</span>
                        <span>{b?.found.includes(id) ? `${right} ✓` : `${right} ✗`}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );
}
