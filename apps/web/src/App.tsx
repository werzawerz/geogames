import { useEffect } from 'react';
import { DAILY_GAMES, getGame } from '@geogames/games';
import { href, useRoute, type Route } from './router.ts';
import { SiteHeader } from './components/SiteHeader.tsx';
import { Home } from './pages/Home.tsx';
import { DailyPage } from './pages/DailyPage.tsx';
import { DailiesPage } from './pages/DailiesPage.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { ScoresPage } from './pages/ScoresPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';
import { DuelPage } from './pages/DuelPage.tsx';
import { DuelsPage } from './pages/DuelsPage.tsx';
import { NewDuelPage } from './pages/NewDuelPage.tsx';
import { SignInPage } from './pages/SignInPage.tsx';
import { AboutPage, ContactPage, PrivacyPage, TermsPage } from './pages/InfoPages.tsx';

const SITE = 'GeoGames';

/** The browser tab title for a route, e.g. "Blank Atlas · GeoGames". */
export function routeTitle(route: Route): string {
  switch (route.page) {
    case 'about':
      return `About · ${SITE}`;
    case 'privacy':
      return `Privacy policy · ${SITE}`;
    case 'terms':
      return `Terms of use · ${SITE}`;
    case 'profile':
      return `Profile · ${SITE}`;
    case 'sign-in':
      return `Sign in · ${SITE}`;
    case 'duels':
      return `Duels · ${SITE}`;
    case 'duel-new':
      return `New duel · ${SITE}`;
    case 'duel':
      return `Duel · ${SITE}`;
    case 'dailies':
      return `Daily challenges · ${SITE}`;
    case 'contact':
      return `Contact · ${SITE}`;
    case 'play':
    case 'daily':
    case 'scores': {
      const game = getGame(route.gameId);
      if (!game || game.status !== 'live') return `${SITE} · Geography games`;
      if (route.page === 'daily') return `Daily ${game.title} · ${SITE}`;
      if (route.page === 'scores') return `${game.title} leaderboard · ${SITE}`;
      return `${game.title} · ${SITE}`;
    }
    default:
      return `${SITE} · Geography games`;
  }
}

export function App() {
  const route = useRoute();
  useEffect(() => {
    document.title = routeTitle(route);
  }, [route]);
  return (
    <>
      <SiteHeader route={route} />
      <main>
        <Page route={route} />
      </main>
      <footer className="footer">
        <a href={href({ page: 'about' })}>About</a> · <a href={href({ page: 'privacy' })}>Privacy</a> · <a href={href({ page: 'terms' })}>Terms</a> ·{' '}
        <a href={href({ page: 'contact' })}>Contact</a>
      </footer>
    </>
  );
}

function Page({ route }: { route: Route }) {
  if (route.page === 'about') return <AboutPage />;
  if (route.page === 'privacy') return <PrivacyPage />;
  if (route.page === 'terms') return <TermsPage />;
  if (route.page === 'contact') return <ContactPage />;
  if (route.page === 'profile') return <ProfilePage />;
  if (route.page === 'sign-in') return <SignInPage />;
  if (route.page === 'home') return <Home />;
  if (route.page === 'dailies') return <DailiesPage />;
  if (route.page === 'duels') return <DuelsPage />;
  if (route.page === 'duel-new') return <NewDuelPage key={route.rematchOf ?? route.gameId ?? 'new'} rematchOf={route.rematchOf} gameId={route.gameId} />;
  if (route.page === 'duel') return <DuelPage key={route.code} code={route.code} />;
  const game = getGame(route.gameId);
  if (!game || game.status !== 'live') return <Home />;
  if (route.page === 'daily') return DAILY_GAMES.includes(game.id) ? <DailyPage key={game.id} game={game} /> : <Home />;
  return route.page === 'play' ? <GamePage key={game.id} game={game} /> : <ScoresPage key={`${game.id}/${route.variant}`} game={game} variant={route.variant} />;
}
