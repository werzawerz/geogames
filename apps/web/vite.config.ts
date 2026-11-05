import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Node needs `import('./x.json', { with: { type: 'json' } })`, but Vite's dev
 * server serves JSON as a JavaScript module, which browsers refuse to load under
 * that attribute. Dropping it from dynamic JSON imports keeps shared packages
 * working in both places. (Production builds bundle the JSON and don't need this.)
 */
function stripDynamicJsonImportAttributes(): Plugin {
  const pattern = /import\(\s*(['"][^'"]+\.json['"])\s*,\s*\{\s*with:\s*\{\s*type:\s*['"]json['"]\s*\}\s*\}\s*\)/g;
  return {
    name: 'strip-dynamic-json-import-attributes',
    apply: 'serve',
    transform(code, id) {
      if (!/\.[cm]?[jt]sx?$/.test(id) || !pattern.test(code)) return null;
      pattern.lastIndex = 0;
      return { code: code.replace(pattern, 'import($1)'), map: null };
    },
  };
}

export default defineConfig({
  plugins: [stripDynamicJsonImportAttributes(), react()],
  // A project's GitHub Pages site lives under /<repo>/.
  base: process.env.VITE_BASE ?? '/',
  // Separate dependency caches let the e2e dev server run beside `npm run dev`
  // without the two invalidating each other.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
  // Map screens load lazily, so Vite would only discover these on first use and
  // then reload the page to re-optimize, mid-game. Pre-bundle them at startup.
  optimizeDeps: {
    include: ['d3-geo', 'd3-zoom', 'd3-selection', 'topojson-client'],
  },
  // 5173 is commonly taken by other local Vite projects.
  server: { port: 5317 },
  preview: { port: 5318 },
});
