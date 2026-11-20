import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'dailies' }
  | { page: 'play'; gameId: string }
  | { page: 'daily'; gameId: string }
  | { page: 'scores'; gameId: string; variant?: string }
  | { page: 'profile' }
  | { page: 'sign-in' }
  | { page: 'about' }
  | { page: 'privacy' }
  | { page: 'terms' }
  | { page: 'contact' };

/** Pages with no game in the route. */
export const INFO_PAGES = ['about', 'privacy', 'terms', 'contact'] as const;

/** Hash routing keeps static hosting trivial (no server rewrites needed). */
export function parseRoute(hash: string): Route {
  const [, page, arg, variant] = hash.replace(/^#/, '').split('/');
  if (page === 'play' && arg) return { page: 'play', gameId: arg };
  if (page === 'daily' && !arg) return { page: 'dailies' };
  if (page === 'daily' && arg) return { page: 'daily', gameId: arg };
  if (page === 'scores' && arg) return { page: 'scores', gameId: arg, variant };
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
