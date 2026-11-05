import { getGame } from '@geogames/games';
import { usePlatform } from './platform/PlatformProvider.tsx';
import { href, useRoute, type Route } from './router.ts';
import { Home } from './pages/Home.tsx';
import { GamePage } from './pages/GamePage.tsx';
import { ScoresPage } from './pages/ScoresPage.tsx';
import { PremiumPage } from './pages/PremiumPage.tsx';

export function App() {
  const route = useRoute();
  return (
    <>
      <TopBar />
      <main>
        <Page route={route} />
      </main>
      <footer className="footer">
        Data: World Bank WDI (CC BY 4.0), UN World Urbanization Prospects 2018 & 2025 (CC BY 3.0 IGO), GeoNames (CC BY 4.0), Wikidata (CC0), Euromonitor rankings,
        mledoze/countries (ODbL), flag-icons (MIT).
      </footer>
    </>
  );
}

function Page({ route }: { route: Route }) {
  if (route.page === 'premium') return <PremiumPage />;
  if (route.page === 'home') return <Home />;
  const game = getGame(route.gameId);
  if (!game || game.status !== 'live') return <Home />;
  return route.page === 'play' ? <GamePage key={game.id} game={game} /> : <ScoresPage key={`${game.id}/${route.variant}`} game={game} variant={route.variant} />;
}

function TopBar() {
  const { allowance, player } = usePlatform();
  return (
    <nav className="topbar">
      <a className="brand" href={href({ page: 'home' })}>
        🌍 GeoGames
      </a>
      <div className="topbar-right">
        <span className="muted">{player.name}</span>
        <a className="pill" href={href({ page: 'premium' })}>
          {allowance.remaining === null ? 'Premium' : `${allowance.remaining}/${allowance.limit} plays`}
        </a>
      </div>
    </nav>
  );
}
