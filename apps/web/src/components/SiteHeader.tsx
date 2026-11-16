import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { gamesByGroup } from '@geogames/games';
import { AccountMenu } from './AccountMenu.tsx';
import { href, type Route } from '../router.ts';

/**
 * Site header: logo, a Games menu, Daily and About, and a slot on the right for the account.
 * Up to 640px the links fold into a hamburger menu.
 */
export function SiteHeader({ route }: { route: Route }) {
  const [menuOpen, setMenuOpen] = useState(false); // hamburger (phones)
  const [gamesOpen, setGamesOpen] = useState(false); // Games dropdown (desktop)
  const headerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const gamesBtnRef = useRef<HTMLButtonElement>(null);
  const groups = gamesByGroup();

  // Close everything on navigation.
  const key = href(route);
  useEffect(() => {
    setMenuOpen(false);
    setGamesOpen(false);
  }, [key]);

  // Click or focus outside closes the open menus.
  useEffect(() => {
    if (!menuOpen && !gamesOpen) return;
    const outside = (e: Event) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setGamesOpen(false);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('focusin', outside);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('focusin', outside);
    };
  }, [menuOpen, gamesOpen]);

  // Opening the hamburger moves focus to its first link.
  useEffect(() => {
    if (menuOpen) headerRef.current?.querySelector<HTMLElement>('.site-nav a')?.focus();
  }, [menuOpen]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    if (gamesOpen) {
      setGamesOpen(false);
      gamesBtnRef.current?.focus();
    }
    if (menuOpen) {
      setMenuOpen(false);
      toggleRef.current?.focus();
    }
  };

  const current = (page: Route['page']) => (route.page === page ? 'page' : undefined);

  return (
    <header className="topbar" ref={headerRef} onKeyDown={onKeyDown}>
      <a className="brand" href={href({ page: 'home' })}>
        <span aria-hidden="true">🌍 </span>GeoGames
      </a>
      <button
        ref={toggleRef}
        type="button"
        className="nav-toggle"
        aria-expanded={menuOpen}
        aria-controls="site-nav"
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span className="nav-toggle-bars" aria-hidden="true" />
      </button>
      <nav id="site-nav" className={`site-nav ${menuOpen ? 'open' : ''}`} aria-label="Main">
        <div className="games-menu">
          <button
            ref={gamesBtnRef}
            type="button"
            className="nav-link games-toggle"
            aria-expanded={gamesOpen}
            aria-controls="games-panel"
            onClick={() => setGamesOpen((o) => !o)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setGamesOpen(true);
                requestAnimationFrame(() => headerRef.current?.querySelector<HTMLElement>('.games-panel a')?.focus());
              }
            }}
          >
            Games <span aria-hidden="true">▾</span>
          </button>
          <div id="games-panel" className={`games-panel ${gamesOpen ? 'open' : ''}`}>
            {groups.map((g) => (
              <section key={g.id} aria-labelledby={`gm-${g.id}`}>
                <h2 id={`gm-${g.id}`} className="games-group">
                  {g.title}
                </h2>
                <ul>
                  {g.games.map((game) => (
                    <li key={game.id}>
                      <a href={href({ page: 'play', gameId: game.id })}>{game.title}</a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
        <a className="nav-link" href={href({ page: 'home', focus: 'daily' })}>
          Daily
        </a>
        <a className="nav-link" href={href({ page: 'about' })} aria-current={current('about')}>
          About
        </a>
      </nav>
      <div className="topbar-right">
        <div className="account-slot">
          <AccountMenu />
        </div>
      </div>
    </header>
  );
}
