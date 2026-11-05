import { useEffect, useState } from 'react';

// SVG flags from flag-icons (emoji flags don't render on Windows). Lazy glob:
// each flag is its own asset, fetched only when a country is shown.
const FLAGS = import.meta.glob<string>('../../../../node_modules/flag-icons/flags/4x3/*.svg', {
  query: '?url',
  import: 'default',
});

const loaderFor = (iso2: string) => FLAGS[`../../../../node_modules/flag-icons/flags/4x3/${iso2.toLowerCase()}.svg`];

export function Flag({ iso2, className = '' }: { iso2: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    loaderFor(iso2)?.().then((url) => !cancelled && setSrc(url));
    return () => {
      cancelled = true;
    };
  }, [iso2]);
  return (
    <span className={`flag ${className}`} aria-hidden="true">
      {src && <img src={src} alt="" />}
    </span>
  );
}
