import { usePlatform } from '../platform/PlatformProvider.tsx';
import { FREE_PLAYS_PER_DAY } from '../platform/entitlements.ts';
import { href } from '../router.ts';

export function PremiumPage() {
  const { allowance, setPlan } = usePlatform();
  const premium = allowance.plan === 'premium';

  return (
    <div className="page">
      <a className="link back" href={href({ page: 'home' })}>
        ← All games
      </a>
      <h1 className="page-title">GeoGames Premium</h1>
      <div className="plans">
        <div className={`panel plan ${premium ? '' : 'active'}`}>
          <h2>Free</h2>
          <ul>
            <li>{FREE_PLAYS_PER_DAY} games per day</li>
            <li>Personal leaderboard</li>
          </ul>
        </div>
        <div className={`panel plan ${premium ? 'active' : ''}`}>
          <h2>Premium</h2>
          <ul>
            <li>Unlimited games</li>
            <li>Every new game mode</li>
            <li>Global leaderboards</li>
          </ul>
        </div>
      </div>
      <div className="panel">
        <p className="muted">
          {setPlan
            ? "Payments aren't wired up yet. This switch simulates a subscription so the free-play limit can be tested."
            : "Payments aren't wired up yet."}
        </p>
        {setPlan && (
          <button className="btn" onClick={() => setPlan(premium ? 'free' : 'premium')}>
            {premium ? 'Switch back to Free (dev)' : 'Activate Premium (dev)'}
          </button>
        )}
      </div>
    </div>
  );
}
