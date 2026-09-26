import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

test.describe('portable worker', () => {
  for (const highlighter of ['shiki-js', 'shiki-wasm', 'highlights'] as const) {
    for (const mode of ['classic', 'module', 'blob'] as const) {
      test(`renders ${highlighter} through a standalone ${mode} worker`, async ({
        context,
        page,
      }) => {
        const portablePath = '/standalone/worker-portable.js';
        const workerFiles: string[] = [];
        const body = await readFile(
          resolve(import.meta.dirname, '../../dist/worker/worker-portable.js')
        );
        // Catch accidental bundling of the main-thread grammar and theme catalogs.
        expect(body.byteLength).toBeLessThan(1_500_000);
        // Serve emitted bytes unchanged: Vite would otherwise resolve bare
        // imports and hide a broken standalone worker bundle.
        await context.route(
          (url) => url.pathname.startsWith('/standalone/'),
          async (route) => {
            const { pathname } = new URL(route.request().url());
            workerFiles.push(pathname);
            if (pathname !== portablePath) {
              await route.abort();
              return;
            }
            await route.fulfill({ contentType: 'text/javascript', body });
          }
        );
        const pageErrors: string[] = [];
        page.on('pageerror', (error) => pageErrors.push(error.message));

        await page.goto(
          `/test/e2e/fixtures/worker-portable.html?highlighter=${highlighter}&mode=${mode}&workerUrl=${portablePath}`
        );
        await page.waitForFunction(
          () => window.__workerPortableReady === true,
          undefined,
          { timeout: 20_000 }
        );

        expect(
          await page.evaluate(() => window.__workerPortableError)
        ).toBeUndefined();
        expect(
          await page.evaluate(() => window.__workerPortableInitialized)
        ).toBe(true);
        // Syntax highlighting splits the first line into several token spans.
        expect(
          await page.locator('[data-content] [data-char]').count()
        ).toBeGreaterThan(1);
        expect(workerFiles).toEqual([portablePath]);
        expect(pageErrors).toEqual([]);
      });
    }
  }
});
