import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Leave 20% headroom below Vercel's 20,000,000-byte prerendered response limit.
const PRERENDER_BUDGET_BYTES = 16_000_000;

// Next's HTML includes the hydration payload, so measure the complete page
// after building instead of relying on JavaScript bundle or compressed sizes.
export function checkPrerenderSize(distDirectory: string) {
  const appDirectory = join(distDirectory, 'server', 'app');
  let largest: { path: string; bytes: number } | undefined;
  for (const path of readdirSync(appDirectory, {
    recursive: true,
    encoding: 'utf8',
  })) {
    if (!path.endsWith('.html')) continue;
    const bytes = statSync(join(appDirectory, path)).size;
    if (largest == null || bytes > largest.bytes) {
      largest = { path, bytes };
    }
  }

  if (largest == null) {
    throw new Error(`No prerendered HTML found in ${appDirectory}`);
  }
  if (largest.bytes > PRERENDER_BUDGET_BYTES) {
    throw new Error(
      `${largest.path} is ${largest.bytes.toLocaleString('en-US')} bytes, ` +
        `exceeding the ${PRERENDER_BUDGET_BYTES.toLocaleString('en-US')}-byte ` +
        'page budget. Reduce prerendered content or hydration data before ' +
        "reaching Vercel's 20,000,000-byte limit."
    );
  }
  return largest;
}

if (import.meta.main) {
  const distDirectory = process.env.VERCEL
    ? '.next'
    : `.next/${process.env.NEXT_PUBLIC_SITE ?? 'diffs'}`;
  const largest = checkPrerenderSize(distDirectory);
  console.log(
    `Largest prerendered page: ${largest.path} ` +
      `(${largest.bytes.toLocaleString('en-US')} / ` +
      `${PRERENDER_BUDGET_BYTES.toLocaleString('en-US')} bytes)`
  );
}
