import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'dailies' }
  | { page: 'play'; gameId: string }
  | { page: 'daily'; gameId: string }
  | { page: 'scores'; gameId: string; variant?: string }
  | { page: 'duels' }
  /**
   * A new duel: of a game (`duels/new/<game-id>`), a rematch of a duel (`duels/new/<CODE>`),
   * or of a run the player has just finished (`duels/new/<session-id>`).
   */
  | { page: 'duel-new'; rematchOf?: string; gameId?: string; sessionId?: string }
  | { page: 'duel'; code: string }
  | { page: 'profile' }
  | { page: 'sign-in' }
  | { page: 'about' }
  | { page: 'privacy' }
  | { page: 'terms' }
  | { page: 'contact' };

const DUEL_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$/;
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pages with no game in the route. */
export const INFO_PAGES = ['about', 'privacy', 'terms', 'contact'] as const;

/** Hash routing keeps static hosting trivial (no server rewrites needed). */
export function parseRoute(hash: string): Route {
  const [, page, arg, variant] = hash.replace(/^#/, '').split('/');
  if (page === 'play' && arg) return { page: 'play', gameId: arg };
  if (page === 'daily' && !arg) return { page: 'dailies' };
  if (page === 'daily' && arg) return { page: 'daily', gameId: arg };
  if (page === 'scores' && arg) return { page: 'scores', gameId: arg, variant };
  if (page === 'duels' && arg === 'new') {
    // Duel codes are upper case, game ids lower-case words and session ids UUIDs, so one place in the path serves all three.
    if (!variant) return { page: 'duel-new' };
    if (DUEL_CODE.test(variant)) return { page: 'duel-new', rematchOf: variant };
    if (SESSION_ID.test(variant)) return { page: 'duel-new', sessionId: variant.toLowerCase() };
    return { page: 'duel-new', gameId: variant };
  }
  if (page === 'duels') return { page: 'duels' };
  if (page === 'duel' && arg) return { page: 'duel', code: arg };
  if (page === 'profile') return { page: 'profile' };
  if (page === 'sign-in') return { page: 'sign-in' };
  if ((INFO_PAGES as readonly string[]).includes(page ?? '')) return { page: page as (typeof INFO_PAGES)[number] };
  return { page: 'home' };
}

export function href(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/';
    case 'dailies':
      return '#/daily';
    case 'duels':
      return '#/duels';
    case 'duel-new':
      return `#/duels/new${route.rematchOf ? `/${route.rematchOf}` : route.sessionId ? `/${route.sessionId}` : route.gameId ? `/${route.gameId}` : ''}`;
    case 'duel':
      return `#/duel/${route.code}`;
    case 'profile':
    case 'sign-in':
    case 'about':
    case 'privacy':
    case 'terms':
    case 'contact':
      return `#/${route.page}`;
    case 'scores':
      return `#/scores/${route.gameId}${route.variant ? `/${route.variant}` : ''}`;
    default:
      return `#/${route.page}/${route.gameId}`;
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
