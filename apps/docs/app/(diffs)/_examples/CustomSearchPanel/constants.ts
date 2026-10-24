import { DEFAULT_THEMES } from '@pierre/diffs';
import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

// Server-side preload input for the custom search panel example. The file
// repeats a few identifiers so find and replace have something to step
// through. The token transformer is pre-enabled so the SSR markup matches the
// editor that attaches on the client.
export const CUSTOM_SEARCH_PANEL_EXAMPLE: PreloadFileOptions<
  undefined,
  undefined
> = {
  file: {
    name: 'fetchWithRetry.ts',
    contents: `export interface RetryOptions {
  retries: number;
  delayMs: number;
}

const DEFAULT_RETRY: RetryOptions = { retries: 3, delayMs: 250 };

export async function fetchWithRetry(
  url: string,
  options: RetryOptions = DEFAULT_RETRY
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.retries; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
      lastError = new Error(\`Request failed: \${response.status}\`);
    } catch (error) {
      lastError = error;
    }
    await sleep(options.delayMs * 2 ** attempt);
  }
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}
`,
  },
  options: {
    theme: DEFAULT_THEMES,
    themeType: 'dark',
    unsafeCSS: CustomScrollbarCSS,
    useTokenTransformer: true,
  },
};
