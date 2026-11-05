import { useEffect, useState } from 'react';

export type Route =
  | { page: 'home' }
  | { page: 'play'; gameId: string }
  | { page: 'scores'; gameId: string; variant?: string }
  | { page: 'premium' };

/** Hash routing keeps static hosting trivial (no server rewrites needed). */
export function parseRoute(hash: string): Route {
  const [, page, arg, variant] = hash.replace(/^#/, '').split('/');
  if (page === 'play' && arg) return { page: 'play', gameId: arg };
  if (page === 'scores' && arg) return { page: 'scores', gameId: arg, variant };
  if (page === 'premium') return { page: 'premium' };
  return { page: 'home' };
}

export function href(route: Route): string {
  switch (route.page) {
    case 'home':
      return '#/';
    case 'premium':
      return '#/premium';
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
