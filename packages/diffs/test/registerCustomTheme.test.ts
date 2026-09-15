import type { Theme } from '@pierre/highlights';
import { afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { ThemeRegistrationAny } from 'shiki/core';

import {
  disposeHighlighter,
  getHighlighterIfLoaded,
  getSharedHighlighter,
  highlighters,
  registerCustomTheme,
} from '../src';
import { createDeferred } from './testUtils';

const textmateTheme = {
  name: 'registered-theme',
  type: 'dark',
  colors: {
    'editor.background': '#181818',
    'editor.foreground': '#eeeeee',
  },
  tokenColors: [
    { scope: ['keyword', 'storage'], settings: { foreground: '#ff0000' } },
  ],
} satisfies ThemeRegistrationAny;
const zedTheme = {
  name: 'registered-theme',
  appearance: 'dark',
  style: {
    'editor.background': '#181818',
    'editor.foreground': '#eeeeee',
    syntax: { keyword: { color: '#00ff00' } },
  },
} satisfies Theme;
const backends = ['highlights', 'shiki-js', 'shiki-wasm'] as const;

beforeEach(disposeHighlighter);
afterEach(disposeHighlighter);

test.each(['cold', 'loaded'] as const)(
  'registers the same name in both formats with %s backends',
  async (state) => {
    if (state === 'loaded') {
      for (const preferredHighlighter of backends) {
        await getSharedHighlighter({ preferredHighlighter, themes: [] });
      }
    }
    const name = `registered-formats-${state}`;
    const loadTextmate = mock(() =>
      Promise.resolve({ ...textmateTheme, name })
    );
    const loadZed = mock(() => Promise.resolve({ ...zedTheme, name }));
    registerCustomTheme(name, loadTextmate, 'textmate');
    registerCustomTheme(name, loadZed, 'zed');
    expect(loadTextmate).not.toHaveBeenCalled();
    expect(loadZed).not.toHaveBeenCalled();

    for (const preferredHighlighter of backends) {
      if (state === 'cold') {
        expect(
          getHighlighterIfLoaded({ preferredHighlighter })
        ).toBeUndefined();
      }
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: [name],
        langs: ['typescript'],
      });
      const { tokens } = highlighter.codeToTokens('if (true) {}', {
        lang: 'typescript',
        theme: highlighter.getTheme(name),
      });
      expect(tokens[0][0].content.trimEnd()).toBe('if');
      expect(tokens[0][0].color?.toLowerCase()).toBe(
        preferredHighlighter === 'highlights' ? '#00ff00' : '#ff0000'
      );
    }
  }
);

test.each([...backends])(
  'registers themes while %s is loading and after disposal',
  async (preferredHighlighter) => {
    const loader = highlighters[preferredHighlighter];
    const deferred = createDeferred<void>();
    highlighters[preferredHighlighter] = async () => {
      await deferred.promise;
      return loader();
    };
    const name = `registered-during-${preferredHighlighter}`;
    const pending = getSharedHighlighter({
      preferredHighlighter,
      themes: [name],
    });
    try {
      if (preferredHighlighter === 'highlights') {
        registerCustomTheme(
          name,
          () => Promise.resolve({ ...zedTheme, name }),
          'zed'
        );
      } else {
        registerCustomTheme(
          name,
          () => Promise.resolve({ ...textmateTheme, name }),
          'textmate'
        );
      }
    } finally {
      highlighters[preferredHighlighter] = loader;
      deferred.resolve();
    }
    const retained = await pending;
    await disposeHighlighter();
    const nextName = `${name}-after-disposal`;
    if (preferredHighlighter === 'highlights') {
      registerCustomTheme(
        nextName,
        () => Promise.resolve({ ...zedTheme, name: nextName }),
        'zed'
      );
    } else {
      registerCustomTheme(
        nextName,
        () => Promise.resolve({ ...textmateTheme, name: nextName }),
        'textmate'
      );
    }
    expect((await retained.themeResolver.resolveTheme(nextName)).name).toBe(
      nextName
    );
    const active = await getSharedHighlighter({
      preferredHighlighter,
      themes: [name, nextName],
    });
    expect(active).not.toBe(retained);
    expect(active.getTheme(name)).toEqual(retained.getTheme(name));
    expect(active.getTheme(nextName)).toEqual(retained.getTheme(nextName));
  }
);

test('duplicate registration preserves both formats and rejects conflicting unscoped loaders', async () => {
  const name = 'registered-duplicate-theme';
  registerCustomTheme(
    name,
    () => Promise.resolve({ ...zedTheme, name }),
    'zed'
  );
  registerCustomTheme(
    name,
    () => Promise.resolve({ ...textmateTheme, name }),
    'textmate'
  );
  const error = spyOn(console, 'error').mockImplementation(() => {});
  try {
    registerCustomTheme(
      name,
      () => Promise.resolve({ ...zedTheme, name, style: {} }),
      'zed'
    );
    registerCustomTheme(name, () => Promise.resolve({ name }), 'textmate');
    registerCustomTheme(name, () => Promise.resolve({ name }));
    expect(error).toHaveBeenCalledTimes(3);
    expect(error).toHaveBeenNthCalledWith(
      1,
      'registerCustomTheme: theme name already registered',
      name
    );
    for (const preferredHighlighter of backends) {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter,
        themes: [name],
      });
      expect(highlighter.getTheme(name)).toMatchObject({
        ...(preferredHighlighter === 'highlights'
          ? { style: zedTheme.style }
          : {
              colors: textmateTheme.colors,
              settings: textmateTheme.tokenColors,
            }),
        name,
      });
    }
  } finally {
    error.mockRestore();
  }
});

test('a loaded theme in the other format does not block registration', async () => {
  const name = 'registered-only-on-shiki';
  const shiki = await getSharedHighlighter({
    preferredHighlighter: 'shiki-js',
    themes: [],
  });
  shiki.themeResolver.registerTheme(name, () => Promise.resolve(textmateTheme));
  const original = await shiki.themeResolver.resolveTheme(name);
  registerCustomTheme(
    name,
    () => Promise.resolve({ ...zedTheme, name }),
    'zed'
  );
  const highlights = await getSharedHighlighter({ themes: [name] });
  expect(highlights.getTheme(name)).toEqual({ ...zedTheme, name });
  expect(shiki.getTheme(name)).toBe(original);
});
