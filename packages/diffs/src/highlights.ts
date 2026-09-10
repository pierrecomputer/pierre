import {
  codeToTokens as highlightsCodeToTokens,
  type CodeToTokensOptions as HighlightsCodeToTokensOptions,
  StreamTokenizer as HighlightsStreamTokenizer,
  isSupportedLanguage,
  type Lang,
  LiveTokenizer,
  type Theme,
} from '@pierre/highlights';
import { themes } from '@pierre/highlights/themes';
import { createThemeResolver } from '@pierre/theming';
import type { CodeToTokensOptions } from 'shiki/core';

import type {
  CodeHighlighter,
  CodeLiveTokenizer,
  CodeLiveTokenizerOptions,
  CodeLiveTokenizerUpdate,
  CodeLiveUpdateOptions,
  CodeStreamTokenizer,
  CodeTextEdit,
} from './highlighter/code_highlighter';
import type {
  DiffsThemeNames,
  HighlightedToken,
  SupportedLanguages,
  ThemedToken,
  ThemeRegistrationResolved,
} from './types';

const THEME_NAME_ALIASES: Record<string, string> = {
  'pierre-dark-protanopia-deuteranopia': 'pierre-dark-protanopia',
  'pierre-light-protanopia-deuteranopia': 'pierre-light-protanopia',
  'pierre-dark-vibrant': 'pierre-dark',
  'pierre-light-vibrant': 'pierre-light',
};

/** kebab-case a theme display name or camelCase export name */
function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/\s+/g, '-')
    .toLowerCase();
}

const highlightsThemeResolver = createThemeResolver<Theme>();

async function loadHighlightsTheme(name: string): Promise<void> {
  if (highlightsThemeResolver.hasResolvedTheme(name)) return;

  const key = kebab(name);
  const id = THEME_NAME_ALIASES[key] ?? key;
  const loader = themes[id];
  if (loader == null) {
    throw new Error(
      `@pierre/diffs/highlights: no theme loader registered for "${name}". ` +
        'Register one with registerHighlightsTheme().'
    );
  }
  highlightsThemeResolver.registerThemeIfAbsent(id, loader);
  highlightsThemeResolver.seedResolvedTheme(
    name,
    await highlightsThemeResolver.resolveTheme(id)
  );
}

/**
 * Map a diffs theme name (or an inline Zed theme object) to a highlights theme.
 * The async highlighter load warms bundled themes before this synchronous
 * render path runs. Register custom names with `registerHighlightsTheme`.
 */
function resolveHighlightsTheme(theme: DiffsThemeNames | Theme): Theme {
  if (typeof theme !== 'string') return theme;
  const resolved =
    highlightsThemeResolver.getResolvedTheme(theme) ??
    highlightsThemeResolver.getResolvedTheme(
      THEME_NAME_ALIASES[kebab(theme)] ?? ''
    );
  if (resolved != null) return resolved;
  throw new Error(
    `Highlights theme "${theme}" is not loaded. Await highlightsHighlighter.load() ` +
      'or preloadHighlighter() before highlighting.'
  );
}

/** Register a Zed theme for a diffs theme name (or override a bundled one). */
export function registerHighlightsTheme(name: string, theme: Theme): void {
  highlightsThemeResolver.seedResolvedTheme(name, theme);
}

const unsupportedLanguages = new Set<string>();

const LANG_ALIASES: Record<string, Lang> = {
  ansi: 'text',
  riscv: 'asm',
};

/** Resolve extra Shiki aliases and report unsupported languages once. */
function toHighlightsLang(lang: SupportedLanguages | undefined): Lang {
  const name = (lang ?? 'text').toLowerCase();
  if (isSupportedLanguage(name)) return name;
  const alias = LANG_ALIASES[name];
  if (alias != null) return alias;
  if (!unsupportedLanguages.has(name)) {
    unsupportedLanguages.add(name);
    console.warn(
      `@pierre/diffs/highlights: language "${name}" has no highlights lexer; ` +
        'rendering it as plain text.'
    );
  }
  return 'text';
}

/** Translate Shiki options to loaded Highlights themes and language names. */
function mapTokensOptions(
  options: CodeToTokensOptions<string, string>
): HighlightsCodeToTokensOptions {
  // cssVariablePrefix/defaultColor only exist on the multi-theme member of
  // shiki's options union; read them off the widened shape
  const { cssVariablePrefix, defaultColor } = options as {
    cssVariablePrefix?: string;
    defaultColor?: string | false;
  };
  const base = {
    lang: toHighlightsLang(options.lang as SupportedLanguages),
    cssVariablePrefix,
    defaultColor,
    tokenizeMaxLineLength: options.tokenizeMaxLineLength,
  };
  if ('themes' in options && options.themes != null) {
    const themes: Record<string, Theme> = {};
    for (const [color, theme] of Object.entries(options.themes)) {
      if (theme != null) {
        themes[color] = resolveHighlightsTheme(theme as DiffsThemeNames);
      }
    }
    return { ...base, themes };
  }
  if ('theme' in options && options.theme != null) {
    return {
      ...base,
      theme: resolveHighlightsTheme(options.theme as DiffsThemeNames),
    };
  }
  return { ...base, theme: resolveHighlightsTheme('pierre-dark') };
}

class HighlightsCodeStreamTokenizer implements CodeStreamTokenizer {
  #stream: HighlightsStreamTokenizer;

  constructor(options: CodeToTokensOptions<string, string>) {
    this.#stream = new HighlightsStreamTokenizer(mapTokensOptions(options));
  }

  pushCode(code: string): ThemedToken[][] {
    return this.#stream.pushCode(code);
  }

  end(): ThemedToken[][] {
    return this.#stream.end();
  }
}

/**
 * The diffs live-tokenizer contract over highlights's incremental
 * `LiveTokenizer`: identical `TextEdit`/update shapes flow straight through;
 * only theme and language names are mapped and line tokens are converted to
 * the editor's `[char, fg, text]` tuples.
 */
class HighlightsLiveTokenizer implements CodeLiveTokenizer {
  #live: LiveTokenizer;

  constructor(options: CodeLiveTokenizerOptions) {
    this.#live = new LiveTokenizer({
      lang: toHighlightsLang(options.lang),
      theme: resolveHighlightsTheme(options.theme),
      code: options.code,
      tokenizeMaxLineLength: options.tokenizeMaxLineLength,
      onDeferTokenize: options.onDeferTokenize,
      renderRange: options.renderRange,
    });
  }

  get revision(): number {
    return this.#live.revision;
  }

  get lineCount(): number {
    return this.#live.lineCount;
  }

  get pendingTokenization(): boolean {
    return this.#live.pendingTokenization;
  }

  applyEdits(
    edits: readonly CodeTextEdit[],
    options?: CodeLiveUpdateOptions
  ): CodeLiveTokenizerUpdate {
    return this.#live.applyEdits(edits, options);
  }

  reset(
    code: string,
    options?: CodeLiveUpdateOptions
  ): CodeLiveTokenizerUpdate {
    return this.#live.reset(code, options);
  }

  getLineTokens(line: number): {
    tokens: HighlightedToken[];
    bracketIgnoredRanges: [start: number, end: number][];
  } {
    const { tokens, bracketIgnoredRanges } = this.#live.getLineTokens(line);
    const tuples: HighlightedToken[] = tokens.map((token) => [
      token.offset,
      token.color ?? '',
      token.content,
    ]);
    // highlights returns a pending line's text as one unthemed token, so an
    // empty token list really is an empty line; keep the editor's sentinel
    if (tuples.length === 0) tuples.push([0, '', '']);
    return { tokens: tuples, bracketIgnoredRanges };
  }

  flush(): void {
    this.#live.flush();
  }

  pause(): void {
    this.#live.pause();
  }

  resume(): void {
    this.#live.resume();
  }

  dispose(): void {
    this.#live.dispose();
  }
}

/**
 * The experimental highlights-backed `CodeHighlighter`: syntax highlighting runs
 * in highlights's WebAssembly lexers instead of shiki's TextMate grammars.
 * Languages are built in; themes load on demand from highlights's bundle.
 *
 * ```ts
 * import { File, setHighlighter } from '@pierre/diffs';
 * import { highlightsHighlighter } from '@pierre/diffs/highlights';
 *
 * setHighlighter(highlightsHighlighter);
 * const file = new File();
 * ```
 */
export const highlightsHighlighter: CodeHighlighter = {
  name: 'highlights',
  async load({ themes }) {
    await Promise.all(themes.map((theme) => loadHighlightsTheme(theme)));
  },
  isReady({ themes }) {
    return themes.every(
      (theme) =>
        highlightsThemeResolver.hasResolvedTheme(theme) ||
        highlightsThemeResolver.hasResolvedTheme(
          THEME_NAME_ALIASES[kebab(theme)] ?? ''
        )
    );
  },
  getTheme(name: DiffsThemeNames): ThemeRegistrationResolved {
    const theme = resolveHighlightsTheme(name);
    const style = theme.style ?? {};
    const player = style.players?.[0];
    // Map Zed colors to the VS Code keys used by the editor's theme CSS.
    const mapped = {
      'editor.selectionBackground': player?.selection,
      'editor.lineHighlightBackground': style['editor.active_line.background'],
      'editor.findMatchBackground': style['search.match_background'],
      'editor.findMatchHighlightBackground': style['search.match_background'],
      'editorBracketMatch.background':
        style['editor.document_highlight.bracket_background'],
      'editorCursor.foreground': player?.cursor,
      'editorHint.foreground': style.hint,
      'editorInfo.foreground': style.info,
      'editorWarning.foreground': style.warning,
      'editorError.foreground': style.error,
      'gitDecoration.addedResourceForeground': style.created,
      'gitDecoration.deletedResourceForeground': style.deleted,
      'gitDecoration.modifiedResourceForeground': style.modified,
      'terminal.ansiGreen': style['terminal.ansi.green'],
      'terminal.ansiRed': style['terminal.ansi.red'],
      'terminal.ansiBlue': style['terminal.ansi.blue'],
    };
    const colors: Record<string, string> = {};
    for (const [key, value] of Object.entries(mapped)) {
      if (typeof value === 'string') colors[key] = value;
    }
    for (const [status, scope] of [
      ['added', 'diff.plus'],
      ['deleted', 'diff.minus'],
      ['modified', 'diff.delta'],
    ]) {
      const syntax = style.syntax?.[scope];
      const color = typeof syntax === 'string' ? syntax : syntax?.color;
      if (color != null) {
        colors[`gitDecoration.${status}ResourceForeground`] ??= color;
      }
    }
    return {
      name,
      displayName: theme.name,
      type: theme.appearance === 'light' ? 'light' : 'dark',
      fg: theme.cssVariables
        ? 'var(--hls-foreground)'
        : (style['editor.foreground'] ?? style.text ?? style.foreground ?? ''),
      bg: theme.cssVariables
        ? 'var(--hls-background)'
        : (style['editor.background'] ?? style.background ?? ''),
      colors,
      settings: [],
    };
  },
  codeToTokens(code: string, options: CodeToTokensOptions<string, string>) {
    return highlightsCodeToTokens(code, mapTokensOptions(options));
  },
  StreamTokenizer: HighlightsCodeStreamTokenizer,
  createLiveTokenizer(options: CodeLiveTokenizerOptions): CodeLiveTokenizer {
    return new HighlightsLiveTokenizer(options);
  },
};

export default highlightsHighlighter;
