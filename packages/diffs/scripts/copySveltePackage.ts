import { cpSync, existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const packageOutput = resolve(import.meta.dir, '../.svelte-review-package');
const distOutput = resolve(import.meta.dir, '../dist/svelte');

if (!existsSync(packageOutput)) {
  throw new Error(
    `Expected svelte-package output at ${packageOutput}, but it was not created.`
  );
}

rmSync(distOutput, { force: true, recursive: true });
cpSync(packageOutput, distOutput, { recursive: true });
