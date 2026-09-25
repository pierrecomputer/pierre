import { afterEach, describe, expect, test } from 'bun:test';

import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import { registerCustomLanguage } from '../src/highlighter/languages/registerCustomLanguage';
import {
  createHighlighter,
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  isHighlighterLoaded,
  isHighlighterLoading,
  isHighlighterNull,
} from '../src/highlighter/shared_highlighter';

const backends = ['shiki-js', 'shiki-wasm', 'highlights'] as const;

afterEach(async () => {
  await disposeHighlighter();
  RegisteredCustomLanguages.delete('highlights-custom-ignored');
});

describe('shared highlighter backend lifecycle', () => {
  test('keeps independent cached instances for each backend', async () => {
    const instances = await Promise.all(
      backends.map((preferredHighlighter) =>
        getSharedHighlighter({
          themes: ['pierre-dark'],
          langs: ['typescript'],
          preferredHighlighter,
        })
      )
    );
    expect(new Set(instances).size).toBe(3);
    for (const [index, preferredHighlighter] of backends.entries()) {
      const highlighter = instances[index];
      expect(highlighter.name).toBe(preferredHighlighter);
      expect(
        getHighlighterIfLoaded({
          theme: 'pierre-dark',
          lang: 'typescript',
          preferredHighlighter,
        })
      ).toBe(highlighter);
      expect(
        await getSharedHighlighter({
          themes: [],
          langs: [],
          preferredHighlighter,
        })
      ).toBe(highlighter);
      const tokens = highlighter.codeToTokens('const value = 1;', {
        lang: 'typescript',
        theme: 'pierre-dark',
      });
      expect(tokens.tokens[0].map((token) => token.content).join('')).toBe(
        'const value = 1;'
      );
      expect(tokens.tokens[0].some((token) => token.color != null)).toBe(true);
    }
    expect(getHighlighterIfLoaded()).toBe(instances[0]);
  });

  for (const preferredHighlighter of backends) {
    test(`${preferredHighlighter} disposes resources and creates a fresh instance`, async () => {
      const options = {
        themes: ['pierre-dark'],
        langs: ['text'],
        preferredHighlighter,
      };
      const highlighter = await getSharedHighlighter(options);
      await disposeHighlighter();
      expect(getHighlighterIfLoaded({ preferredHighlighter })).toBeUndefined();
      expect(() =>
        highlighter.codeToTokens('x', { lang: 'text', theme: 'pierre-dark' })
      ).toThrow('disposed');
      expect(await getSharedHighlighter(options)).not.toBe(highlighter);
    });
  }

  test('a cold requested backend cannot return another cached backend', async () => {
    await getSharedHighlighter({ themes: [], langs: [] });
    expect(
      getHighlighterIfLoaded({ preferredHighlighter: 'highlights' })
    ).toBeUndefined();
  });

  test('Highlights ignores custom TextMate loaders and renders unknown languages as text', async () => {
    let calls = 0;
    registerCustomLanguage('highlights-custom-ignored', () => {
      calls++;
      return Promise.reject(new Error('TextMate loader should not run'));
    });
    const highlighter = await getSharedHighlighter({
      themes: ['pierre-dark'],
      langs: ['highlights-custom-ignored'],
      preferredHighlighter: 'highlights',
    });
    expect(calls).toBe(0);
    const result = highlighter.codeToTokens('custom text', {
      lang: 'highlights-custom-ignored',
      theme: 'pierre-dark',
    });
    expect(
      result.tokens
        .flat()
        .map((token) => token.content)
        .join('')
    ).toBe('custom text');
  });
});

describe('shared highlighter cache state', () => {
  test('load-state predicates inspect the requested backend', async () => {
    expect(isHighlighterNull('highlights')).toBe(true);
    const loading = getSharedHighlighter({
      themes: [],
      langs: [],
      preferredHighlighter: 'highlights',
    });
    expect(isHighlighterLoading('highlights')).toBe(true);
    expect(isHighlighterLoaded('highlights')).toBe(false);
    await loading;
    expect(isHighlighterLoaded('highlights')).toBe(true);
    expect(isHighlighterLoading('highlights')).toBe(false);
    expect(isHighlighterNull('highlights')).toBe(false);
    // The default backend stays cold.
    expect(isHighlighterLoaded()).toBe(false);
    expect(isHighlighterLoading()).toBe(false);
    expect(isHighlighterNull()).toBe(true);
  });

  test('an explicit undefined instance does not fall back to the default backend', async () => {
    const shared = await getSharedHighlighter({ themes: [], langs: [] });
    expect(isHighlighterLoaded()).toBe(true);
    const missing:
      | Awaited<ReturnType<typeof getSharedHighlighter>>
      | undefined = undefined;
    expect(isHighlighterNull(missing)).toBe(true);
    expect(isHighlighterLoaded(missing)).toBe(false);
    expect(isHighlighterLoading(missing)).toBe(false);
    expect(isHighlighterLoaded(shared)).toBe(true);
  });

  for (const preferredHighlighter of backends) {
    test(`${preferredHighlighter} retained instances keep used themes after disposeHighlighter`, async () => {
      const highlighter = await createHighlighter({ preferredHighlighter });
      try {
        await Promise.all([
          highlighter.themeResolver.resolveThemes([
            'pierre-dark',
            'pierre-light',
          ]),
          highlighter.loadLanguages?.(['typescript']),
        ]);
        const theme = highlighter.getTheme('pierre-dark');
        await disposeHighlighter();
        expect(
          highlighter.themeResolver.hasResolvedThemes(['pierre-dark'])
        ).toBe(false);
        expect(highlighter.getTheme('pierre-dark')).toBe(theme);
        const tokens = highlighter.codeToTokens('const value = 1;', {
          lang: 'typescript',
          theme: 'pierre-dark',
        });
        expect(tokens.tokens[0].some((token) => token.color != null)).toBe(
          true
        );
        expect(() => highlighter.getTheme('pierre-light')).toThrow(
          'has not been resolved'
        );
      } finally {
        highlighter.dispose();
      }
    });
  }
});
