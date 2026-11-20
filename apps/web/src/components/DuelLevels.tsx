import { useEffect, useState } from 'react';
import type { CityId } from '@geogames/geodata';
import {
  arcadePools,
  createCircleArcade,
  replayCircleArcade,
  replayRun,
  type CircleArcade,
  type GameDefinition,
  type GameSettings,
  type LevelOutcome,
  type LevelRow,
  type RunSummary,
} from '@geogames/games';

/** City Circle Arcade's extra: each level's cities to find, and which of them each run found. */
export interface ArcadeDetail {
  game: CircleArcade;
  top: Map<number, readonly CityId[]>;
  found: [Map<number, readonly CityId[]>, Map<number, readonly CityId[]>];
}

/** Notes each level's cities to find (the same for both players) and returns the ones a run found. */
function arcadeFound(game: CircleArcade, seed: number, moves: readonly string[], top: Map<number, readonly CityId[]>) {
  const found = new Map<number, readonly CityId[]>();
  replayCircleArcade(game, seed, moves, ({ level }) => {
    top.set(level.number, game.top(level));
    found.set(level.number, level.guesses.filter((id) => game.top(level).includes(id)));
  });
  return found;
}

export interface DuelRuns {
  left: RunSummary;
  right: RunSummary;
  arcade?: ArcadeDetail;
}

/** Replays both runs of a finished duel (loading the game's data first); null until ready. */
export function useDuelRuns(
  game: GameDefinition | undefined,
  settings: GameSettings,
  seed: number | undefined,
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
) {
  const [runs, setRuns] = useState<DuelRuns | null>(null);
  useEffect(() => {
    if (!game || seed === undefined || !left || !right) return;
    let cancelled = false;
    (async () => {
      const [a, b] = await Promise.all([replayRun(game, settings, seed, left), replayRun(game, settings, seed, right)]);
      let arcade: ArcadeDetail | undefined;
      if (game.kind === 'circle-arcade') {
        const engine = createCircleArcade(await arcadePools(settings));
        const top = new Map<number, readonly CityId[]>();
        arcade = { game: engine, top, found: [arcadeFound(engine, seed, left, top), arcadeFound(engine, seed, right, top)] };
      }
      if (!cancelled) setRuns({ left: a, right: b, arcade });
    })().catch(() => {
      // Without the data the table just doesn't show; the scores above still do.
    });
    return () => {
      cancelled = true;
    };
  }, [game, settings, seed, left, right]);
  return runs;
}

/** How a level ended: a mark, with words for screen readers and the key under the table. */
const MARKS: Record<LevelOutcome, { mark: string; label: string }> = {
  perfect: { mark: '✓★', label: 'perfect' },
  cleared: { mark: '✓', label: 'cleared' },
  skipped: { mark: '↷', label: 'skipped' },
  timeout: { mark: '⏱', label: 'out of time' },
  lost: { mark: '✗', label: 'missed' },
  playing: { mark: '…', label: 'not finished' },
};

const cell = (r: LevelRow | undefined) =>
  r ? (
    <>
      <strong>{r.points}</strong>{' '}
      <span className={`duel-mark mark-${r.outcome}`} aria-label={MARKS[r.outcome].label} title={MARKS[r.outcome].label}>
        {MARKS[r.outcome].mark}
      </span>
    </>
  ) : (
    <span className="muted" aria-label="not reached">
      –
    </span>
  );

/** A finished duel level by level: each player's points and how the level ended; for City Circle Arcade, who found which city. */
export function DuelLevels({ data, left, right }: { data: DuelRuns | null; left: string; right: string }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!data) return <p className="muted center">Loading the level table…</p>;
  const byNumber = (run: RunSummary) => new Map(run.levels.map((l) => [l.number, l]));
  const [a, b] = [byNumber(data.left), byNumber(data.right)];
  const levels = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => x - y);
  const shown = new Set([...data.left.levels, ...data.right.levels].map((l) => l.outcome));
  const { arcade } = data;

  return (
    <>
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
            const expanded = open === n;
            const cities = arcade?.top.get(n) ?? [];
            return [
              <tr key={n} className={expanded ? 'open' : undefined}>
                <th scope="row">
                  {arcade ? (
                    <button type="button" className="duel-level-toggle" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : n)}>
                      {n} <span aria-hidden="true">{expanded ? '▾' : '▸'}</span>
                    </button>
                  ) : (
                    n
                  )}
                </th>
                <td>{cell(a.get(n))}</td>
                <td>{cell(b.get(n))}</td>
              </tr>,
              arcade && expanded && (
                <tr key={`${n}-cities`} className="duel-level-cities">
                  <td colSpan={3}>
                    <ul>
                      {cities.map((id) => (
                        <li key={id}>
                          <span>{arcade.game.cities.get(id)?.name ?? id}</span>
                          <span>{arcade.found[0].get(n)?.includes(id) ? `${left} ✓` : `${left} ✗`}</span>
                          <span>{arcade.found[1].get(n)?.includes(id) ? `${right} ✓` : `${right} ✗`}</span>
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
      <p className="muted small duel-key">
        {(Object.keys(MARKS) as LevelOutcome[])
          .filter((o) => shown.has(o))
          .map((o) => `${MARKS[o].mark} ${MARKS[o].label}`)
          .join(' · ')}
      </p>
    </>
  );
}
