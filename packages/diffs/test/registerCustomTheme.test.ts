import type { Theme, ThemeFamily } from '@pierre/highlights';
import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test';

import { createHighlighter } from '../src/highlighter/shared_highlighter';
import { cleanUpResolvedThemes } from '../src/highlighter/themes/cleanUpResolvedThemes';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { resolveTheme } from '../src/highlighter/themes/resolveTheme';
import { customThemes } from '../src/highlighter/themes/themeResolver';

const names: string[] = [];
const zed: Theme = {
  name: 'Friendly Zed Name',
  appearance: 'dark',
  style: {
    'editor.foreground': '#ddeeff',
    'editor.background': '#112233',
    syntax: { keyword: '#ff0000' },
  },
};
const family: ThemeFamily = {
  name: 'Friendly Zed Family',
  themes: [
    zed,
    {
      name: 'Second Zed Theme',
      appearance: 'light',
      style: { foreground: '#000000', background: '#ffffff' },
    },
  ],
};

afterEach(() => {
  for (const name of names.splice(0)) customThemes.delete(name);
  cleanUpResolvedThemes();
});

describe('registerCustomTheme with Highlights themes', () => {
  for (const defaultExport of [false, true]) {
    test(`lazily resolves and tokenizes a ${defaultExport ? 'default-exported' : 'direct'} Zed theme`, async () => {
      const name = `generic-zed-${defaultExport ? 'module' : 'direct'}`;
      names.push(name);
      const loader = mock(() =>
        Promise.resolve(defaultExport ? { default: zed } : zed)
      );
      registerCustomTheme(name, loader, 'zed');
      expect(loader).not.toHaveBeenCalled();

      const highlighter = await createHighlighter({
        preferredHighlighter: 'highlights',
      });
      try {
        const theme = await resolveTheme(name, 'highlights');
        expect(theme.name).toBe(name);
        expect(theme.zed?.name).toBe(name);
        expect(theme.type).toBe('dark');
        expect(theme.fg).toBe('#ddeeff');
        expect(theme.bg).toBe('#112233');
        expect(theme.textmate).toBeUndefined();
        expect(zed.name).toBe('Friendly Zed Name');
        expect(await resolveTheme(name, 'highlights')).toBe(theme);
        expect(loader).toHaveBeenCalledTimes(1);

        const result = highlighter.codeToTokens('const answer = 42;', {
          lang: 'javascript',
          theme: name,
        });
        expect(result.fg).toBe(theme.fg);
        expect(result.bg).toBe(theme.bg);
        expect(
          result.tokens.flat().find((token) => token.content.includes('const'))
            ?.color
        ).toBe('#ff0000');
      } finally {
        highlighter.dispose();
      }
    });

    test(`uses the first member of a ${defaultExport ? 'default-exported' : 'direct'} Zed theme family`, async () => {
      const name = `generic-zed-family-${defaultExport ? 'module' : 'direct'}`;
      names.push(name);
      registerCustomTheme(
        name,
        () => Promise.resolve(defaultExport ? { default: family } : family),
        'zed'
      );

      const theme = await resolveTheme(name, 'highlights');
      expect(theme.name).toBe(name);
      expect(theme.zed?.name).toBe(name);
      expect(theme.type).toBe('dark');
      expect(theme.fg).toBe('#ddeeff');
      expect(theme.bg).toBe('#112233');
      expect(theme.zed?.style.syntax?.keyword).toBe('#ff0000');
    });
  }

  test('rejects an empty Zed theme family with an actionable error', () => {
    const name = 'generic-zed-empty-family';
    names.push(name);
    registerCustomTheme(name, () => Promise.resolve({ themes: [] }), 'zed');

    expect(resolveTheme(name, 'highlights')).rejects.toThrow(
      /empty|at least one/i
    );
  });

  for (const backend of ['shiki-js', 'shiki-wasm'] as const) {
    test(`rejects Zed themes and families on ${backend} with an actionable error`, () => {
      for (const [kind, theme] of [
        ['theme', zed],
        ['family', family],
      ] as const) {
        const name = `generic-zed-${kind}-${backend}`;
        names.push(name);
        registerCustomTheme(name, () => Promise.resolve(theme), 'zed');

        expect(resolveTheme(name, backend)).rejects.toThrow(/textmate.*Shiki/);
      }
    });
  }

  test('keeps the first registration for the same name and format', async () => {
    const name = 'generic-zed-duplicate';
    names.push(name);
    const loader = mock(() => Promise.resolve(zed));
    const duplicate = mock(() => Promise.resolve(family));
    const error = spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      registerCustomTheme(name, loader, 'zed');
      registerCustomTheme(name, duplicate, 'zed');

      const theme = await resolveTheme(name, 'highlights');
      expect(theme.name).toBe(name);
      expect(theme.zed?.name).toBe(name);
      expect(theme.fg).toBe('#ddeeff');
      expect(theme.bg).toBe('#112233');
      expect(loader).toHaveBeenCalledTimes(1);
      expect(duplicate).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith(
        'SharedHighlight.registerCustomTheme: theme name and type already registered',
        name,
        'zed'
      );
    } finally {
      error.mockRestore();
    }
  });
});

describe('registerCustomTheme format selection', () => {
  test('defaults existing two-argument registrations to TextMate', async () => {
    const name = 'custom-default-textmate';
    names.push(name);
    const loader = mock(() => Promise.resolve({ name, tokenColors: [] }));
    registerCustomTheme(name, loader);
    expect(loader).not.toHaveBeenCalled();

    for (const backend of ['shiki-js', 'shiki-wasm'] as const) {
      const theme = await resolveTheme(name, backend);
      expect(theme.textmate?.name).toBe(name);
    }
    expect(loader).toHaveBeenCalledTimes(2);
  });

  for (const first of ['textmate', 'zed', 'diffs'] as const) {
    test(`keeps same-name loaders separate when ${first} registers first`, async () => {
      const name = `custom-format-order-${first}`;
      names.push(name);
      const textmateLoader = mock(() =>
        Promise.resolve({
          default: {
            name,
            type: 'light' as const,
            colors: {
              'editor.foreground': '#112233',
              'editor.background': '#ffffff',
            },
            tokenColors: [],
          },
        })
      );
      const zedLoader = mock(() => Promise.resolve(zed));
      const diffsLoader = mock(() =>
        Promise.resolve({
          name,
          type: 'dark' as const,
          fg: '#abcdef',
          bg: '#012345',
          zed,
        })
      );
      if (first === 'diffs') {
        registerCustomTheme(name, diffsLoader, 'diffs');
      }
      if (first === 'textmate') {
        registerCustomTheme(name, textmateLoader, 'textmate');
        registerCustomTheme(name, zedLoader, 'zed');
      } else {
        registerCustomTheme(name, zedLoader, 'zed');
        registerCustomTheme(name, textmateLoader, 'textmate');
      }
      if (first !== 'diffs') {
        registerCustomTheme(name, diffsLoader, 'diffs');
      }
      expect(textmateLoader).not.toHaveBeenCalled();
      expect(zedLoader).not.toHaveBeenCalled();

      const highlights = await resolveTheme(name, 'highlights');
      expect(highlights.fg).toBe('#ddeeff');
      expect(highlights.zed?.name).toBe(name);
      expect(zedLoader).toHaveBeenCalledTimes(1);
      expect(diffsLoader).not.toHaveBeenCalled();
      expect(textmateLoader).not.toHaveBeenCalled();

      for (const backend of ['shiki-js', 'shiki-wasm'] as const) {
        const shiki = await resolveTheme(name, backend);
        expect(shiki.fg).toBe('#112233');
        expect(shiki.bg).toBe('#ffffff');
        expect(shiki.textmate?.name).toBe(name);
        expect(shiki.zed).toBeUndefined();
      }
      expect(textmateLoader).toHaveBeenCalledTimes(2);
      expect(zedLoader).toHaveBeenCalledTimes(1);
    });
  }

  for (const type of ['textmate', 'zed'] as const) {
    test(`does not load a custom ${type} palette for the other backend`, async () => {
      const name = 'pierre-dark';
      names.push(name);
      const loader = mock(() => Promise.resolve(zed));
      if (type === 'textmate') {
        registerCustomTheme(name, loader);
      } else {
        registerCustomTheme(name, loader, type);
      }

      const backend = type === 'textmate' ? 'highlights' : 'shiki-js';
      const theme = await resolveTheme(name, backend);
      expect(theme.fg).toBe('#fafafa');
      expect(loader).not.toHaveBeenCalled();
    });
  }

  test('rejects a TextMate theme registered as Zed', () => {
    const name = 'custom-invalid-zed';
    names.push(name);
    const loader = () => Promise.resolve({ name, tokenColors: [] });
    // @ts-expect-error TextMate loaders require the TextMate registration type.
    registerCustomTheme(name, loader, 'zed');
    expect(resolveTheme(name, 'highlights')).rejects.toThrow(
      /TextMate.*registerCustomTheme/
    );
  });

  test('rejects a Zed theme registered as TextMate', () => {
    const name = 'custom-invalid-textmate';
    names.push(name);
    registerCustomTheme(name, () => Promise.resolve(zed));
    expect(resolveTheme(name, 'shiki-js')).rejects.toThrow(
      /Zed.*TextMate.*Shiki/
    );
  });
});
