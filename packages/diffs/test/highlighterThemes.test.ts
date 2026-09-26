import { afterAll, describe, expect, test } from 'bun:test';

import { TextDocument } from '../src/editor/textDocument';
import {
  disposeHighlighter,
  getSharedHighlighter,
} from '../src/highlighter/shared_highlighter';
import { cleanUpResolvedThemes } from '../src/highlighter/themes/cleanUpResolvedThemes';
import { registerCustomTheme } from '../src/highlighter/themes/registerCustomTheme';
import { customThemes } from '../src/highlighter/themes/themeResolver';
import type { DiffsTheme } from '../src/highlighter/themes/types';
import { getHighlighterThemeStyles } from '../src/utils/getHighlighterThemeStyles';
import { renderFileWithHighlighter } from '../src/utils/renderFileWithHighlighter';

afterAll(disposeHighlighter);

for (const preferredHighlighter of ['shiki-js', 'shiki-wasm'] as const) {
  test(`${preferredHighlighter} reloads token colors after clearing resolved themes`, async () => {
    const name = `reload-${preferredHighlighter}`;
    let color = '#ff0000';
    registerCustomTheme(name, () =>
      Promise.resolve({
        name,
        type: 'dark',
        colors: {
          'editor.foreground': color,
          'editor.background': '#000000',
        },
        tokenColors: [{ scope: 'keyword', settings: { foreground: color } }],
      })
    );
    try {
      const options = {
        preferredHighlighter,
        themes: [name],
        langs: ['javascript'],
      };
      const highlighter = await getSharedHighlighter(options);
      expect(
        highlighter
          .codeToTokens('const value = 1;', {
            lang: 'javascript',
            theme: name,
          })
          .tokens[0][0].color?.toLowerCase()
      ).toBe(color);
      color = '#0000ff';
      cleanUpResolvedThemes(preferredHighlighter);
      expect(await getSharedHighlighter(options)).toBe(highlighter);
      expect(highlighter.getTheme(name).fg).toBe(color);
      expect(
        highlighter
          .codeToTokens('const value = 1;', {
            lang: 'javascript',
            theme: name,
          })
          .tokens[0][0].color?.toLowerCase()
      ).toBe(color);
    } finally {
      customThemes.delete(name);
      cleanUpResolvedThemes(preferredHighlighter);
    }
  });
}

describe('highlights themes', () => {
  test('keeps boolean CSS-variable roots and editor tokens on the component palette', async () => {
    for (const style of [
      {},
      { 'editor.foreground': '#ff0000', 'editor.background': '#00ff00' },
    ]) {
      const name = `zed-boolean-css-${Object.keys(style).length}`;
      registerCustomTheme(
        name,
        () =>
          Promise.resolve({
            name,
            appearance: 'dark',
            cssVariables: true as const,
            style,
          }),
        'zed'
      );
      try {
        const highlighter = await getSharedHighlighter({
          preferredHighlighter: 'highlights',
          themes: [name],
          langs: [],
        });
        const theme = highlighter.getTheme(name);
        expect(theme.fg).toBe('var(--hls-foreground)');
        expect(theme.bg).toBe('var(--hls-background)');
        for (const cssVariablePrefix of [undefined, '--custom-']) {
          const tokens = highlighter.codeToTokens('42', {
            lang: 'json',
            theme: name,
            cssVariablePrefix,
          });
          expect(tokens.fg).toBe(
            `var(${cssVariablePrefix ?? '--hls-'}foreground)`
          );
          expect(tokens.bg).toBe(
            `var(${cssVariablePrefix ?? '--hls-'}background)`
          );
        }
        const rendered = renderFileWithHighlighter(
          { name: 'test.json', contents: '42' },
          highlighter,
          {
            theme: name,
            tokenizeMaxLineLength: 1000,
            useTokenTransformer: false,
          }
        );
        expect(rendered.themeStyles).toBe(
          'color:var(--diffs-token-foreground);background-color:var(--diffs-token-background);' +
            '--diffs-fg:var(--diffs-token-foreground);--diffs-bg:var(--diffs-token-background);'
        );
        expect(
          getHighlighterThemeStyles({
            highlighter,
            theme: { dark: name, light: name },
          })
        ).toBe(
          '--diffs-dark:var(--diffs-token-foreground);--diffs-dark-bg:var(--diffs-token-background);' +
            '--diffs-light:var(--diffs-token-foreground);--diffs-light-bg:var(--diffs-token-background);'
        );
        const textDocument = new TextDocument('test.json', '42', 'json');
        const tokenizer = highlighter.createLiveTokenizer({
          textDocument,
          theme: name,
          onDeferTokenize: () => {},
        });
        try {
          const change = textDocument.applyEdits([
            {
              range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 2 },
              },
              newText: '43',
            },
          ]);
          expect(tokenizer.tokenize(change!).get(0)).toEqual([
            [0, 'var(--diffs-token-number)', '43'],
          ]);
        } finally {
          tokenizer.dispose();
        }
      } finally {
        customThemes.delete(name);
        cleanUpResolvedThemes('highlights');
      }
    }
  });

  test('expands named CSS palettes for component roots and editor overlays', async () => {
    const name = 'zed-css-palette';
    registerCustomTheme(
      name,
      () =>
        Promise.resolve({
          name,
          appearance: 'dark',
          cssVariables: {
            prefix: '--app-',
            defaults: {
              foreground: '#eeeeee',
              background: '#111111',
              added: '#00ff00',
            },
          },
          style: {
            foreground: 'foreground',
            background: 'background',
            created: 'added',
            'editor.active_line.background': 'active-line',
            players: [{ cursor: 'cursor', selection: 'selection' }],
            syntax: { number: 'number' },
          },
        }),
      'zed'
    );
    try {
      const highlighter = await getSharedHighlighter({
        preferredHighlighter: 'highlights',
        themes: [name],
        langs: [],
      });
      const theme = highlighter.getTheme(name);
      const tokens = highlighter.codeToTokens('42', {
        lang: 'json',
        theme: name,
      });
      expect(tokens.fg).toBe(theme.fg);
      expect(tokens.bg).toBe(theme.bg);
      expect(theme.colors?.['editorCursor.foreground']).toBe(
        'var(--app-cursor)'
      );
      expect(theme.colors?.['editor.selectionBackground']).toBe(
        'var(--app-selection)'
      );
      expect(theme.colors?.['editor.lineHighlightBackground']).toBe(
        'var(--app-active-line)'
      );
      expect(getHighlighterThemeStyles({ highlighter, theme: name })).toBe(
        'color:var(--app-foreground, #eeeeee);background-color:var(--app-background, #111111);' +
          '--diffs-fg:var(--app-foreground, #eeeeee);--diffs-bg:var(--app-background, #111111);' +
          '--diffs-addition-color:var(--app-added, #00ff00);'
      );
    } finally {
      customThemes.delete(name);
      cleanUpResolvedThemes('highlights');
    }
  });

  test('exposes editor overlay colors under the keys the editor reads', async () => {
    const highlighter = await getSharedHighlighter({
      preferredHighlighter: 'highlights',
      themes: ['pierre-dark', 'andromeeda'],
      langs: [],
    });
    const pierre = highlighter.getTheme('pierre-dark');
    const pierreColors = pierre.colors ?? {};
    const player = pierre.zed?.style.players?.[0];
    expect(player?.cursor).toBeDefined();
    expect(player?.cursor).toBe(pierreColors['editorCursor.foreground']);
    expect(player?.selection).toBe(pierreColors['editor.selectionBackground']);
    expect(pierreColors['editor.lineHighlightBackground']).toBe(
      pierreColors['editor.active_line.background']
    );
    expect(pierreColors['gitDecoration.addedResourceForeground']).toBe(
      pierreColors.created
    );
    const andromeeda = highlighter.getTheme('andromeeda').colors ?? {};
    expect(andromeeda['search.match_background']).toBeDefined();
    expect(andromeeda['editor.findMatchBackground']).toBe(
      andromeeda['search.match_background']
    );
    expect(andromeeda['editor.findMatchHighlightBackground']).toBe(
      andromeeda['search.match_background']
    );
    expect(andromeeda['editorBracketMatch.background']).toBe(
      andromeeda['editor.document_highlight.bracket_background']
    );
    expect(andromeeda['editorError.foreground']).toBe(andromeeda.error);
    expect(andromeeda['editorHint.foreground']).toBe(andromeeda.hint);
  });

  test('prefers a portable custom theme over a bundled theme of the same name', async () => {
    const name = 'andromeeda';
    const custom: DiffsTheme = {
      name,
      type: 'light',
      fg: '#111111',
      bg: '#eeeeee',
      colors: {},
      zed: {
        name,
        appearance: 'light',
        style: {
          'editor.foreground': '#111111',
          'editor.background': '#eeeeee',
        },
      },
    };
    registerCustomTheme(name, () => Promise.resolve(custom), 'diffs');
    try {
      cleanUpResolvedThemes('highlights');
      const highlighter = await getSharedHighlighter({
        preferredHighlighter: 'highlights',
        themes: [name],
        langs: [],
      });
      const theme = highlighter.getTheme(name);
      expect(theme.type).toBe('light');
      expect(theme.fg).toBe('#111111');
      expect(theme.zed?.style['editor.background']).toBe('#eeeeee');
    } finally {
      customThemes.delete(name);
      cleanUpResolvedThemes('highlights');
    }
  });
});
