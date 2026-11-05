import { lazy, Suspense } from 'react';
import type { GameScreenProps } from './types.ts';
import { HigherLowerScreen } from './higher-lower/HigherLowerScreen.tsx';
import { QuizScreen } from './quiz/QuizScreen.tsx';

// Map games pull in d3-geo and map shapes; load them only when played.
const RouteScreen = lazy(() => import('./route/RouteScreen.tsx').then((m) => ({ default: m.RouteScreen })));
const CircleScreen = lazy(() => import('./circle/CircleScreen.tsx').then((m) => ({ default: m.CircleScreen })));
const GreatCircleScreen = lazy(() => import('./great-circle/GreatCircleScreen.tsx').then((m) => ({ default: m.GreatCircleScreen })));
const MysteryScreen = lazy(() => import('./mystery/MysteryScreen.tsx').then((m) => ({ default: m.MysteryScreen })));
const PinDropScreen = lazy(() => import('./pin/PinDropScreen.tsx').then((m) => ({ default: m.PinDropScreen })));
const ArcadeScreen = lazy(() => import('./circle/ArcadeScreen.tsx').then((m) => ({ default: m.ArcadeScreen })));

/** Renders the screen for a game's kind. Adding a game kind = one engine + one screen + one case here. */
export function GameScreen(props: GameScreenProps) {
  const { game } = props;
  switch (game.kind) {
    case 'higher-lower':
      return <HigherLowerScreen {...props} game={game} />;
    case 'quiz':
      return <QuizScreen {...props} game={game} />;
    case 'route':
      return (
        <Suspense fallback={<p className="panel center muted">Loading…</p>}>
          <RouteScreen {...props} game={game} />
        </Suspense>
      );
    case 'circle':
      return (
        <Suspense fallback={<p className="panel center muted">Loading…</p>}>
          <CircleScreen {...props} game={game} />
        </Suspense>
      );
    case 'great-circle':
      return (
        <Suspense fallback={<p className="panel center muted">Loading…</p>}>
          <GreatCircleScreen {...props} game={game} />
        </Suspense>
      );
    case 'mystery-country':
      return (
        <Suspense fallback={<p className="panel center muted">Loading…</p>}>
          <MysteryScreen {...props} game={game} />
        </Suspense>
      );
    case 'pin-drop':
      return (
        <Suspense fallback={<p className="panel center muted">Loading…</p>}>
          <PinDropScreen {...props} game={game} />
        </Suspense>
      );
    case 'circle-arcade':
      return (
        <Suspense fallback={<p className="panel center muted">Loading…</p>}>
          <ArcadeScreen {...props} game={game} />
        </Suspense>
      );
  }
}
