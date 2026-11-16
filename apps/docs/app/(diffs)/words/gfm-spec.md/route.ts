import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-static';

// Serves the benchmark's GFM spec fixture for the demo's large sample, so it stays out of the JS bundle.
export async function GET(): Promise<Response> {
  return new Response(
    await readFile(
      join(process.cwd(), '../../packages/words/benchmark/fixtures/gfm-spec.md')
    ),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }
  );
}
