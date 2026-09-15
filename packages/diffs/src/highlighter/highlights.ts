import {
  codeToTokens,
  isSupportedLanguage,
  LiveTokenizer,
  StreamTokenizer,
} from '@pierre/highlights';
import type {
  CodeToTokensOptions as HighlightsTokenOptions,
  Theme,
} from '@pierre/highlights';
import { themes } from '@pierre/highlights/themes/loader';
import { createThemeResolver, type ThemeLoader } from '@pierre/theming';

import type {
  CodeToTokensOptions,
  DiffsHighlighter,
  DiffsTheme,
} from '../types';

/** Keep Highlights loaders and resolved themes local to this backend instance. */
export function createDiffsHighlighter(
  customThemeLoaders?: ReadonlyMap<string, ThemeLoader<DiffsTheme>>
): DiffsHighlighter {
  const themeResolver = createThemeResolver<DiffsTheme>({
    fallbackLoader: (name) =>
      customThemeLoaders?.get(name) ??
      (Object.hasOwn(themes, name) ? themes[name] : undefined),
    normalizeTheme(theme, name) {
      const resolved = getHighlightsTheme(theme);
      return resolved.name === name ? resolved : { ...resolved, name };
    },
  });
  return {
    name: 'highlights',
    themeResolver,
    createLiveTokenizer({
      textDocument,
      renderRange,
      onDeferTokenize,
      ...options
    }) {
      const tokenizer = new LiveTokenizer({
        ...getHighlightsOptions(options),
        code: textDocument.getText(),
        renderRange,
        onDeferTokenize,
      });
      return {
        get pendingTokenization() {
          return tokenizer.pendingTokenization;
        },
        getLineTokens(line) {
          return tokenizer.getLineTokens(line);
        },
        tokenize(change, options) {
          if (change.hasInexactRanges === true) {
            return tokenizer.reset(textDocument.getText(), options);
          }
          return tokenizer.applyEdits(
            change.changes.map(({ range, text }) => ({ range, newText: text })),
            options
          );
        },
        reset(options) {
          return tokenizer.reset(textDocument.getText(), options);
        },
        flush(endLine) {
          tokenizer.flush(endLine);
        },
        pause() {
          tokenizer.pause();
        },
        resume() {
          tokenizer.resume();
        },
        dispose() {
          tokenizer.dispose();
        },
      };
    },
    createStreamTokenizer(options) {
      const tokenizer = new StreamTokenizer(getHighlightsOptions(options));
      let pendingCR = false;
      return {
        pushCode(chunk) {
          // Retain a trailing CR until the next chunk can complete its CRLF.
          if (pendingCR) chunk = '\r' + chunk;
          pendingCR = chunk.endsWith('\r');
          if (pendingCR) chunk = chunk.slice(0, -1);
          return tokenizer.pushCode(chunk.replace(/\r(?!\n)/g, '\n'));
        },
        end() {
          return pendingCR
            ? [...tokenizer.pushCode('\n'), ...tokenizer.end()]
            : tokenizer.end();
        },
        dispose() {
          tokenizer.dispose();
          pendingCR = false;
        },
      };
    },
    codeToTokens(code, options) {
      return codeToTokens(
        code.replace(/\r(?!\n)/g, '\n'),
        getHighlightsOptions(options)
      );
    },
    getTheme(name) {
      const theme = themeResolver.getResolvedTheme(name);
      if (theme == null) throw new Error('Theme "' + name + '" is not loaded');
      return theme;
    },
  };
}

/** Normalize generic language and theme options for all Highlights entrypoints. */
function getHighlightsOptions({
  theme,
  lang,
  ...options
}: CodeToTokensOptions): HighlightsTokenOptions {
  return {
    ...options,
    lang: isSupportedLanguage(lang) ? lang : 'text',
    ...('dark' in theme && 'light' in theme
      ? {
          themes: {
            dark: getHighlightsTheme(theme.dark),
            light: getHighlightsTheme(theme.light),
          },
        }
      : { theme: getHighlightsTheme(theme) }),
  };
}

/** Check backend-neutral themes before passing them to Highlights. */
function getHighlightsTheme(theme: DiffsTheme): Theme {
  if (
    !('appearance' in theme) ||
    (theme.appearance !== 'dark' && theme.appearance !== 'light') ||
    !('style' in theme) ||
    theme.style == null ||
    typeof theme.style !== 'object' ||
    Array.isArray(theme.style)
  ) {
    throw new Error('Theme "' + theme.name + '" is not a Highlights theme');
  }
  return theme as Theme;
}
