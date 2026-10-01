import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { ShikiHighlighter } from '../src/highlighter/backends/shiki';
import { RegisteredCustomLanguages } from '../src/highlighter/languages/constants';
import { registerCustomLanguage } from '../src/highlighter/languages/registerCustomLanguage';
import {
  createHighlighter,
  disposeHighlighter,
  getHighlighterIfLoaded,
  getHighlighterType,
  getSharedHighlighter,
  type HighlighterOptions,
  isHighlighterLoaded,
  isHighlighterLoading,
  isHighlighterNull,
} from '../src/highlighter/shared_highlighter';
import { getRejection } from './testUtils';

const backends = ['shiki-js', 'shiki-wasm', 'highlights'] as const;

beforeEach(disposeHighlighter);
afterEach(async () => {
  await disposeHighlighter();
  RegisteredCustomLanguages.delete('highlights-custom-ignored');
});

describe('highlighter type lock', () => {
  test('concurrent requests for one type share a single instance', async () => {
    const instances = await Promise.all(
      [0, 1, 2].map(() =>
        getSharedHighlighter({
          themes: ['pierre-dark'],
          langs: ['typescript'],
          preferredHighlighter: 'highlights',
        })
      )
    );
    expect(new Set(instances).size).toBe(1);
    expect(instances[0].name).toBe('highlights');
    expect(getHighlighterType()).toBe('highlights');
  });

  test('rejects another type while the first is loading, before its backend loads', async () => {
    const create = spyOn(ShikiHighlighter, 'create');
    try {
      const loading = getSharedHighlighter({
        themes: [],
        langs: [],
        preferredHighlighter: 'highlights',
      });
      expect(isHighlighterLoading()).toBe(true);
      for (const preferredHighlighter of ['shiki-js', 'shiki-wasm'] as const) {
        expect(
          (
            await getRejection(
              getSharedHighlighter({
                themes: [],
                langs: [],
                preferredHighlighter,
              })
            )
          ).message
        ).toContain(
          `Cannot load the "${preferredHighlighter}" highlighter while "highlights" is in use`
        );
        expect(
          (await getRejection(createHighlighter(preferredHighlighter))).message
        ).toContain(`while "highlights" is in use`);
      }
      await loading;
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  test('createHighlighter cannot bypass the loaded type', async () => {
    const shared = await getSharedHighlighter({
      themes: [],
      langs: [],
      preferredHighlighter: 'shiki-js',
    });
    expect(
      (await getRejection(createHighlighter('highlights'))).message
    ).toContain(
      'Cannot load the "highlights" highlighter while "shiki-js" is in use'
    );
    const independent = await createHighlighter();
    try {
      expect(independent).not.toBe(shared);
      expect(independent.name).toBe('shiki-js');
    } finally {
      independent.dispose();
    }
  });

  test('requests without a type follow the type in use', async () => {
    const independent = await createHighlighter('highlights');
    try {
      const shared = await getSharedHighlighter({ themes: [], langs: [] });
      expect(shared.name).toBe('highlights');
      expect(shared).not.toBe(independent);
    } finally {
      independent.dispose();
    }
  });

  test('a retained instance keeps its type in use after disposeHighlighter', async () => {
    const retained = await createHighlighter('shiki-js');
    await getSharedHighlighter({ themes: [], langs: [] });
    await disposeHighlighter();
    expect(getHighlighterType()).toBe('shiki-js');
    expect(
      (await getRejection(createHighlighter('highlights'))).message
    ).toContain('while "shiki-js" is in use');
    retained.dispose();
    retained.dispose();
    expect(getHighlighterType()).toBeUndefined();
    const next = await createHighlighter('highlights');
    expect(next.name).toBe('highlights');
    next.dispose();
  });

  test('a failed load releases its type and can be retried', async () => {
    const create = spyOn(ShikiHighlighter, 'create').mockRejectedValueOnce(
      new Error('engine failed')
    );
    try {
      const options: HighlighterOptions = {
        themes: [],
        langs: [],
        preferredHighlighter: 'shiki-js',
      };
      expect(
        (await getRejection(getSharedHighlighter(options))).message
      ).toContain('engine failed');
      await Bun.sleep(0);
      expect(getHighlighterType()).toBeUndefined();
      expect(isHighlighterNull()).toBe(true);
      expect((await getSharedHighlighter(options)).name).toBe('shiki-js');
    } finally {
      create.mockRestore();
    }
  });

  test('disposing a loaded instance releases its type synchronously', async () => {
    await getSharedHighlighter({
      themes: [],
      langs: [],
      preferredHighlighter: 'shiki-js',
    });
    const disposed = disposeHighlighter();
    expect(getHighlighterType()).toBeUndefined();
    await disposed;
  });

  test('disposing during a load disposes the loaded instance and releases its type', async () => {
    const loading = getSharedHighlighter({
      themes: [],
      langs: [],
      preferredHighlighter: 'shiki-js',
    });
    await disposeHighlighter();
    const highlighter = await loading;
    expect(() =>
      highlighter.codeToTokens('x', { lang: 'text', theme: 'pierre-dark' })
    ).toThrow('disposed');
    expect(getHighlighterType()).toBeUndefined();
    expect(
      (
        await getSharedHighlighter({
          themes: [],
          langs: [],
          preferredHighlighter: 'highlights',
        })
      ).name
    ).toBe('highlights');
  });
});

describe('shared highlighter backend lifecycle', () => {
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

  test('a loaded instance of another type is not returned', async () => {
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
  test('load-state predicates inspect the shared instance', async () => {
    expect(isHighlighterNull()).toBe(true);
    const loading = getSharedHighlighter({
      themes: [],
      langs: [],
      preferredHighlighter: 'highlights',
    });
    expect(isHighlighterLoading()).toBe(true);
    expect(isHighlighterLoaded()).toBe(false);
    const shared = await loading;
    expect(isHighlighterLoaded()).toBe(true);
    expect(isHighlighterLoading()).toBe(false);
    expect(isHighlighterNull()).toBe(false);
    expect(getHighlighterIfLoaded()).toBe(shared);
    expect(
      getHighlighterIfLoaded({ preferredHighlighter: 'shiki-js' })
    ).toBeUndefined();
    await disposeHighlighter();
    expect(isHighlighterLoaded()).toBe(false);
    expect(isHighlighterLoading()).toBe(false);
    expect(isHighlighterNull()).toBe(true);
  });

  for (const preferredHighlighter of backends) {
    test(`${preferredHighlighter} retained instances keep used themes after disposeHighlighter`, async () => {
      const highlighter = await createHighlighter(preferredHighlighter);
      try {
        await Promise.all([
          highlighter.themeResolver.resolveThemes([
            'pierre-dark',
            'pierre-light',
          ]),
          highlighter.loadLanguages(['typescript']),
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
