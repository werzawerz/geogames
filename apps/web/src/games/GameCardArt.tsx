import type { ReactNode } from 'react';
import art from './card-art-data.json';

/** Everything is drawn on one canvas size, so all cards line up. */
const WIDTH = 640;
const HEIGHT = 280;

const Land = ({ d }: { d: string }) => <path className="art-land" d={d} />;
const Area = ({ d, tone }: { d: string; tone: string }) => <path className={`art-area art-${tone}`} d={d} />;
const Dot = ({ at, r = 7, className = 'art-dot' }: { at: readonly number[]; r?: number; className?: string }) => (
  <circle className={className} cx={at[0]} cy={at[1]} r={r} />
);

/** The "which is more?" badge shared by the Higher or Lower games. */
const Versus = () => (
  <g className="art-versus">
    <circle cx={WIDTH / 2} cy={HEIGHT / 2} r={30} />
    <path d={`M${WIDTH / 2 - 9} ${HEIGHT / 2 - 5}l9-13 9 13zM${WIDTH / 2 - 9} ${HEIGHT / 2 + 5}l9 13 9-13z`} />
  </g>
);

const Person = ({ x, y }: { x: number; y: number }) => (
  <g transform={`translate(${x} ${y})`}>
    <circle cx={0} cy={-11} r={6} />
    <path d="M-9 12v-8a9 9 0 0 1 18 0v8z" />
  </g>
);

/** People in a block, `rows` × `columns` of them. */
const Crowd = ({ x, rows, columns, className }: { x: number; rows: number; columns: number; className: string }) => (
  <g className={className}>
    {Array.from({ length: rows * columns }, (_, i) => (
      <Person key={i} x={x + (i % columns) * 30} y={HEIGHT - 44 - Math.floor(i / columns) * 38} />
    ))}
  </g>
);

const Coins = ({ x, count, className }: { x: number; count: number; className: string }) => (
  <g className={className}>
    {Array.from({ length: count }, (_, i) => (
      <g key={i} transform={`translate(${x} ${HEIGHT - 42 - i * 16})`}>
        <ellipse cx={0} cy={0} rx={46} ry={14} />
        <path className="art-coin-edge" d="M-46 0a46 14 0 0 0 92 0" />
      </g>
    ))}
  </g>
);

/** A row of buildings; each is [height, width] in canvas units. */
function Skyline({ x, buildings, className }: { x: number; buildings: readonly (readonly [number, number])[]; className: string }) {
  let left = x;
  return (
    <g className={className}>
      {buildings.map(([height, width], i) => {
        const at = left;
        left += width + 6;
        const lit = Array.from({ length: Math.floor((height - 14) / 22) }, (_, row) => row);
        return (
          <g key={i}>
            <rect x={at} y={HEIGHT - 24 - height} width={width} height={height} rx={2} />
            {lit.map((row) => (
              <rect key={row} className="art-window" x={at + width / 2 - 5} y={HEIGHT - 24 - height + 10 + row * 22} width={10} height={9} />
            ))}
          </g>
        );
      })}
    </g>
  );
}

const Clue = ({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) => (
  <g className="art-chip">
    <rect x={x} y={y} width={width} height={34} rx={17} />
    <text x={x + width / 2} y={y + 18}>
      {children}
    </text>
  </g>
);

const ART: Record<string, () => ReactNode> = {
  'higher-lower-population': () => (
    <>
      <Crowd x={72} rows={4} columns={6} className="art-fill-a" />
      <Crowd x={436} rows={2} columns={4} className="art-fill-b" />
      <Versus />
    </>
  ),
  'higher-lower-area': () => (
    <>
      <path className="art-fill-a" d={art.area.left} />
      <path className="art-fill-b" d={art.area.right} />
      <Versus />
    </>
  ),
  'higher-lower-gdp-per-capita': () => (
    <>
      <Coins x={170} count={10} className="art-coins-a" />
      <Coins x={470} count={4} className="art-coins-b" />
      <Versus />
    </>
  ),
  'higher-lower-city-population': () => (
    <>
      <path className="art-ground" d={`M0 ${HEIGHT - 24}H${WIDTH}`} />
      <Skyline x={58} buildings={[[130, 42], [205, 52], [160, 38], [232, 48]]} className="art-fill-a" />
      <Skyline x={402} buildings={[[70, 44], [118, 52], [84, 40], [58, 44]]} className="art-fill-b" />
      <Versus />
    </>
  ),
  'border-route': () => (
    <>
      <Land d={art.route.land} />
      {art.route.countries.map((c) => (
        <Area key={c.d} {...c} />
      ))}
    </>
  ),
  capitals: () => (
    <>
      <Land d={art.capital.land} />
      <Area d={art.capital.country} tone="start" />
      <path
        className="art-star"
        transform={`translate(${art.capital.point[0]} ${art.capital.point[1]})`}
        d="M0-15 4.4-4.6 15.6-4.6 6.8 2.4 9.9 13.3 0 7 -9.9 13.3 -6.8 2.4 -15.6-4.6 -4.4-4.6Z"
      />
      <Clue x={art.capital.point[0]! + 26} y={art.capital.point[1]! - 17} width={84}>
        Rome
      </Clue>
    </>
  ),
  flags: () => (
    <>
      <g transform="rotate(-9 150 150)">
        <rect fill="#fff" x={60} y={84} width={180} height={120} rx={8} />
        <path fill="#0055a4" d="M60 92a8 8 0 0 1 8-8h52v120H68a8 8 0 0 1-8-8z" />
        <rect fill="#fff" x={120} y={84} width={60} height={120} />
        <path fill="#ef4135" d="M180 84h52a8 8 0 0 1 8 8v104a8 8 0 0 1-8 8h-52z" />
      </g>
      <g transform="rotate(8 490 150)">
        <rect fill="#fecc00" x={400} y={84} width={180} height={120} rx={8} />
        <path fill="#006aa7" d="M408 84h42v48h130V92a8 8 0 0 0-8-8H408zM400 156v40a8 8 0 0 0 8 8h42v-52zM474 204h98a8 8 0 0 0 8-8v-40H474z" />
      </g>
      <g>
        <rect fill="#fff" x={225} y={62} width={190} height={130} rx={8} />
        <circle fill="#bc002d" cx={320} cy={127} r={40} />
        <rect className="art-flag-edge" x={225} y={62} width={190} height={130} rx={8} />
      </g>
    </>
  ),
  'city-circle-arcade': () => (
    <>
      <Land d={art.arcade.land} />
      {art.arcade.rings.map((d, i) => (
        <path key={d} className={`art-ring art-ring-${i}`} d={d} />
      ))}
      {art.arcade.points.map((at) => (
        <Dot key={at.join()} at={at} />
      ))}
    </>
  ),
  'city-circle': () => (
    <>
      <Land d={art.free.land} />
      <path className="art-ring art-ring-placed" d={art.free.ring} />
      <path
        className="art-crosshair"
        d={`M${art.free.center[0]! - 16} ${art.free.center[1]}h32M${art.free.center[0]} ${art.free.center[1]! - 16}v32`}
      />
      {art.free.points.map((at) => (
        <Dot key={at.join()} at={at} />
      ))}
    </>
  ),
  'great-circle': () => (
    <>
      <Land d={art.line.land} />
      {art.line.countries.map((c) => (
        <Area key={c.d} {...c} />
      ))}
      {art.line.ends.map((c) => (
        <Area key={c.d} {...c} />
      ))}
      <path className="art-line" d={art.line.path} />
      {art.line.points.map((at) => (
        <Dot key={at.join()} at={at} />
      ))}
    </>
  ),
  'pin-drop': () => (
    <>
      <Land d={art.pin.land} />
      <path className="art-dash" d={art.pin.path} />
      <Dot at={art.pin.target} />
      <path
        className="art-pin"
        transform={`translate(${art.pin.guess[0]} ${art.pin.guess[1]})`}
        d="M0 0C-5-9-13-15-13-25a13 13 0 0 1 26 0C13-15 5-9 0 0Z"
      />
      <circle className="art-pin-hole" cx={art.pin.guess[0]} cy={art.pin.guess[1]! - 25} r={4.5} />
    </>
  ),
  'mystery-country': () => (
    <>
      <Land d={art.mystery.land} />
      {art.mystery.guesses.map((c) => (
        <Area key={c.d} {...c} />
      ))}
      <path className="art-hidden" d={art.mystery.target} />
      <text className="art-mark" x={art.mystery.point[0]} y={art.mystery.point[1]! + 2}>
        ?
      </text>
    </>
  ),
};

/** The picture on a game's card. It repeats nothing a screen reader needs. */
export function GameCardArt({ gameId }: { gameId: string }) {
  const draw = ART[gameId];
  if (!draw) return null;
  return (
    <svg className="card-art" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" preserveAspectRatio="xMidYMid slice">
      {draw()}
    </svg>
  );
}
