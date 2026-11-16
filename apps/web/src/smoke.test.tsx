import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { METRICS } from '@geogames/geodata';
import { GAMES, getGame, loadPool, type HigherLowerDefinition } from '@geogames/games';
import { PlatformProvider } from './platform/PlatformProvider.tsx';
import { HigherLowerRound } from './games/higher-lower/HigherLowerScreen.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { Home } from './pages/Home.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { ContactPage, PrivacyPage } from './pages/InfoPages.tsx';
import { SiteHeader } from './components/SiteHeader.tsx';
import { routeTitle } from './App.tsx';

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

  it('renders the game setup with region choice, and nothing about plans or play limits', () => {
    const html = renderToString(
      <PlatformProvider>
        <GamePage game={game} />
      </PlatformProvider>,
    );
    expect(html).toContain('Start game');
    expect(html).toContain('Whole world');
    expect(html).toContain('South America');
    expect(html).not.toMatch(/premium|plays left|unlimited/i);
    expect(html).not.toContain('City size');
  });

  it('shows the Profile page without account actions in a build with no server', () => {
    const html = renderToString(
      <PlatformProvider>
        <ProfilePage />
      </PlatformProvider>,
    );
    expect(html).toContain('Player name');
    expect(html).toContain('Your best scores');
    expect(html).not.toContain('Delete my account');
    expect(html).not.toContain('Sign in with Google');
  });

  it('disables the contact form in a build with no server, and keeps the rest of the page', () => {
    const html = renderToString(
      <PlatformProvider>
        <ContactPage />
      </PlatformProvider>,
    );
    expect(html).toContain('Your message');
    expect(html.replace(/<!-- -->/g, "")).toContain("0 / 2000");
    expect(html).toContain('Only if you want a reply');
    expect(html).toMatch(/<textarea[^>]*disabled/);
    expect(html).not.toContain('contact-form-slot');
  });

  it('keeps the operator placeholders and the draft note in the privacy policy, and describes sign-in and deletion', () => {
    const html = renderToString(<PrivacyPage />);
    expect(html).toContain('[Operator name]');
    expect(html).toContain('[Country]');
    expect(html).toContain('Draft');
    expect(html).toContain('Delete my account');
    expect(html).toContain('salted hash');
  });

  it('shows only the player name in the header of a build with no server', () => {
    const html = renderToString(
      <PlatformProvider>
        <SiteHeader route={{ page: 'home' }} />
      </PlatformProvider>,
    );
    expect(html).not.toContain('google-btn');
    expect(html).toContain('player-name');
  });

  it('titles the profile page', () => {
    expect(routeTitle({ page: 'profile' })).toBe('Profile · GeoGames');
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
