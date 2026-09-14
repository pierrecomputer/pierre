import { expect, test } from 'bun:test';

import { defaultHighlighter } from '../src/highlighter';

test.each([undefined, 'highlights', 'shiki-wasm', 'shiki-js'] as const)(
  'public entrypoints only load the preferred highlighter: %s',
  async (preferredHighlighter) => {
    // A fresh process prevents other tests from preloading either dependency.
    const child = Bun.spawn(
      [
        process.execPath,
        '--eval',
        `const preferredHighlighter = ${JSON.stringify(preferredHighlighter)};
        if (preferredHighlighter === 'shiki-js') globalThis.WebAssembly = undefined;
        const dependencies = [
          '@pierre/highlights', 'shiki/core',
          'shiki/engine/javascript', 'shiki/engine/oniguruma',
        ];
        const { getSharedHighlighter } = await import('./src/index.ts');
        await import('./src/edit/index.ts');
        await import('./src/react/index.ts');
        await import('./src/ssr/index.ts');
        await import('./src/worker/index.ts');
        await import('./src/highlighter/themeNames.ts');
        const before = dependencies.filter(name => require.resolve(name) in require.cache);
        const highlighter = await getSharedHighlighter({
          preferredHighlighter, themes: ['nord'], langs: ['typescript'],
        });
        const { tokens } = highlighter.codeToTokens('const value = 1;', {
          lang: 'typescript', theme: highlighter.getTheme('nord'),
        });
        console.log(JSON.stringify({
          before,
          after: dependencies.filter(name => require.resolve(name) in require.cache),
          name: highlighter.name,
          highlighted: tokens[0].length > 1,
        }));`,
      ],
      {
        cwd: new URL('..', import.meta.url).pathname,
        stdout: 'pipe',
        stderr: 'pipe',
      }
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
    expect(JSON.parse(stdout)).toEqual({
      before: [],
      after:
        preferredHighlighter === 'shiki-js'
          ? ['shiki/core', 'shiki/engine/javascript']
          : preferredHighlighter === 'shiki-wasm'
            ? ['shiki/core', 'shiki/engine/oniguruma']
            : ['@pierre/highlights'],
      name: preferredHighlighter ?? defaultHighlighter,
      highlighted: true,
    });
  }
);
