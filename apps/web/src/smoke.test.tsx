import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { METRICS } from '@geogames/geodata';
import { GAMES, getGame, loadPool, type HigherLowerDefinition } from '@geogames/games';
import { PlatformProvider } from './platform/PlatformProvider.tsx';
import { HigherLowerRound } from './games/higher-lower/HigherLowerScreen.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { Home } from './pages/Home.tsx';

const game = getGame('higher-lower-population')!;

describe('web smoke', () => {
  it('renders the home page with every game', () => {
    const html = renderToString(
      <PlatformProvider>
        <Home />
      </PlatformProvider>,
    );
    for (const g of GAMES) expect(html).toContain(g.title);
  });

  it('renders the game setup with region choice, unlimited in dev builds', () => {
    const html = renderToString(
      <PlatformProvider>
        <GamePage game={game} />
      </PlatformProvider>,
    );
    expect(html).toContain('Start game');
    expect(html).toContain('Whole world');
    expect(html).toContain('South America');
    expect(html).toContain('Premium: unlimited plays');
    expect(html).not.toContain('City size');
  });

  it('offers a city-size slider for city games, defaulting to 1M+', () => {
    const html = renderToString(
      <PlatformProvider>
        <GamePage game={getGame('higher-lower-city-population')!} />
      </PlatformProvider>,
    );
    expect(html).toContain('City size');
    expect(html).toContain('type="range"');
    expect(html).toMatch(/Cities with <strong>1M(<!-- -->)?\+<\/strong> people/);
  });

  it.each(GAMES.filter((g): g is HigherLowerDefinition => g.kind === 'higher-lower' && g.status === 'live'))(
    'renders a round of $id', async (g) => {
    const pool = await loadPool(g);
    const html = renderToString(<HigherLowerRound game={g} pool={pool} seed={1} onGameOver={() => {}} />);
    expect(html).toContain(METRICS[g.metric].more);
    expect(html).toContain(METRICS[g.metric].less);
    if (g.valueNote) expect(html).toContain(g.valueNote);
  });
});
