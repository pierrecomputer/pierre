import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [runtime, ...args] = process.argv.slice(2);
if (runtime == null)
  throw new Error(
    'Usage: words:bench-runtime -- <runtime> [benchmark options]'
  );

const result = spawnSync(
  runtime,
  [fileURLToPath(new URL('./bench.ts', import.meta.url)), ...args],
  { stdio: 'inherit' }
);
if (result.error != null) throw result.error;
process.exitCode = result.status ?? 1;
