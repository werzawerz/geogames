// Builds the Edge Function: apps/api/src/edge.ts into supabase/functions/api/index.ts.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from './bundle.ts';

const API = join(dirname(fileURLToPath(import.meta.url)), '..');
// Supabase says 5 MB, but it measures its own bundle, which is bigger than ours: a 4.62 MB file was refused.
const LIMIT_BYTES = 4 * 1024 * 1024;

const bytes = await bundle(join(API, 'src', 'edge.ts'), join(API, '..', '..', 'supabase', 'functions', 'api', 'index.ts'));
console.log(`supabase/functions/api/index.ts: ${(bytes / 1024 / 1024).toFixed(2)} MB`);
if (bytes > LIMIT_BYTES) {
  console.error('Too big to deploy: slim the data in scripts/bundle.ts.');
  process.exit(1);
}
