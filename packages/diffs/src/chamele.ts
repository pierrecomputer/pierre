import {
  codeToHast as chameleCodeToHast,
  type CodeToHastOptions as ChameleCodeToHastOptions,
  codeToTokens as chameleCodeToTokens,
  type CodeToTokensOptions as ChameleCodeToTokensOptions,
  StreamTokenizer as ChameleStreamTokenizer,
  isSupportedLanguage,
  type Lang,
  LiveTokenizer,
  type Theme,
} from '@pierre/chamele';
import { themes } from '@pierre/chamele/themes';
import { createThemeResolver } from '@pierre/theming';
import type { Root } from 'hast';
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
  CodeToHastOptions,
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

const chameleThemeResolver = createThemeResolver<Theme>();

async function loadChameleTheme(name: string): Promise<void> {
  if (chameleThemeResolver.hasResolvedTheme(name)) return;

  const key = kebab(name);
  let id = THEME_NAME_ALIASES[key] ?? key;
  let loader = themes[id];
  if (loader == null) {
    warnOnce(
      `@pierre/diffs/chamele: no chamele theme for "${name}"; falling back ` +
        `to a Pierre default. Register one with registerChameleTheme().`
    );
    id = key.includes('light') ? 'pierre-light' : 'pierre-dark';
    loader = themes[id];
  }
  chameleThemeResolver.registerThemeIfAbsent(id, loader);
  chameleThemeResolver.seedResolvedTheme(
    name,
    await chameleThemeResolver.resolveTheme(id)
  );
}

/**
 * Map a diffs theme name (or an inline Zed theme object) to a chamele theme.
 * The async highlighter load warms bundled themes before this synchronous
 * render path runs. Register custom names with `registerChameleTheme`.
 */
function resolveChameleTheme(theme: DiffsThemeNames | Theme): Theme {
  if (typeof theme !== 'string') return theme;
  const resolved =
    chameleThemeResolver.getResolvedTheme(theme) ??
    chameleThemeResolver.getResolvedTheme(
      THEME_NAME_ALIASES[kebab(theme)] ?? ''
    );
  if (resolved != null) return resolved;
  throw new Error(
    `Chamele theme "${theme}" is not loaded. Await chameleHighlighter.load() ` +
      'or preloadHighlighter() before highlighting.'
  );
}

/** Register a Zed theme for a diffs theme name (or override a bundled one). */
export function registerChameleTheme(name: string, theme: Theme): void {
  chameleThemeResolver.seedResolvedTheme(name, theme);
}

const warned = new Set<string>();
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

const LANG_ALIASES: Record<string, Lang> = {
  'angular-html': 'html',
  'angular-ts': 'ts',
  ansi: 'text',
  'git-commit': 'diff',
  'git-rebase': 'diff',
  'objective-c': 'c',
  'objective-cpp': 'cpp',
  riscv: 'asm',
  shellscript: 'bash',
  shellsession: 'bash',
};

function toChameleLang(lang: SupportedLanguages | undefined): Lang {
  const name = String(lang ?? 'text').toLowerCase();
  if (isSupportedLanguage(name)) return name;
  const alias = LANG_ALIASES[name];
  if (alias != null) return alias;
  warnOnce(
    `@pierre/diffs/chamele: language "${name}" has no chamele lexer; ` +
      'rendering it as plain text.'
  );
  return 'text';
}

function mapTokensOptions(
  options: CodeToTokensOptions<string, string>
): ChameleCodeToTokensOptions {
  // cssVariablePrefix/defaultColor only exist on the multi-theme member of
  // shiki's options union; read them off the widened shape
  const { cssVariablePrefix, defaultColor } = options as {
    cssVariablePrefix?: string;
    defaultColor?: string | false;
  };
  const base = {
    lang: toChameleLang(options.lang as SupportedLanguages),
    cssVariablePrefix,
    defaultColor,
    tokenizeMaxLineLength: options.tokenizeMaxLineLength,
  };
  if ('themes' in options && options.themes != null) {
    const themes: Record<string, Theme> = {};
    for (const [color, theme] of Object.entries(options.themes)) {
      if (theme != null) {
        themes[color] = resolveChameleTheme(theme as DiffsThemeNames);
      }
    }
    return { ...base, themes };
  }
  if ('theme' in options && options.theme != null) {
    return {
      ...base,
      theme: resolveChameleTheme(options.theme as DiffsThemeNames),
    };
  }
  return { ...base, theme: resolveChameleTheme('pierre-dark') };
}

function mapHastOptions(
  options: CodeToHastOptions<DiffsThemeNames>
): ChameleCodeToHastOptions {
  return {
    ...mapTokensOptions(options as CodeToTokensOptions<string, string>),
    transformers:
      options.transformers as unknown as ChameleCodeToHastOptions['transformers'],
    decorations:
      options.decorations as unknown as ChameleCodeToHastOptions['decorations'],
  };
}

/** Zed theme foreground, resolved like chamele's theme compiler. */
function themeForeground(theme: Theme): string | undefined {
  const style = theme.style ?? {};
  return style['editor.foreground'] ?? style.text ?? style.foreground;
}

/** Zed theme background, resolved like chamele's theme compiler. */
function themeBackground(theme: Theme): string | undefined {
  const style = theme.style ?? {};
  return style['editor.background'] ?? style.background;
}

/**
 * Map a Zed theme's editor colors onto the VS Code color keys the diffs
 * editor reads (`buildEditorThemeCSS` in editor/tokenizer.ts).
 */
function themeEditorColors(theme: Theme): Record<string, string> {
  const style = theme.style ?? {};
  const player = (Array.isArray(style.players) ? style.players[0] : null) ?? {};
  const mapped: Record<string, string | undefined> = {
    'editor.selectionBackground': player.selection,
    'editor.lineHighlightBackground': style['editor.active_line.background'],
    'editor.findMatchBackground': style['search.match_background'],
    'editor.findMatchHighlightBackground': style['search.match_background'],
    'editorBracketMatch.background':
      style['editor.document_highlight.bracket_background'],
    'editorCursor.foreground': player.cursor,
    'editorHint.foreground': style.hint,
    'editorInfo.foreground': style.info,
    'editorWarning.foreground': style.warning,
    'editorError.foreground': style.error,
  };
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(mapped)) {
    if (typeof value === 'string') colors[key] = value;
  }
  return colors;
}

class ChameleCodeStreamTokenizer implements CodeStreamTokenizer {
  #stream: ChameleStreamTokenizer;

  constructor(options: CodeToTokensOptions<string, string>) {
    this.#stream = new ChameleStreamTokenizer(mapTokensOptions(options));
  }

  pushCode(code: string): ThemedToken[][] {
    return this.#stream.pushCode(code) as ThemedToken[][];
  }

  end(): ThemedToken[][] {
    return this.#stream.end() as ThemedToken[][];
  }
}

/**
 * The diffs live-tokenizer contract over chamele's incremental
 * `LiveTokenizer`: identical `TextEdit`/update shapes flow straight through;
 * only theme and language names are mapped and line tokens are converted to
 * the editor's `[char, fg, text]` tuples.
 */
class ChameleLiveTokenizer implements CodeLiveTokenizer {
  #live: LiveTokenizer;

  constructor(options: CodeLiveTokenizerOptions) {
    this.#live = new LiveTokenizer({
      lang: toChameleLang(options.lang),
      theme: resolveChameleTheme(options.theme),
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
    // chamele returns a pending line's text as one unthemed token, so an
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
 * The experimental chamele-backed `CodeHighlighter`: syntax highlighting runs
 * in chamele's WebAssembly lexers instead of shiki's TextMate grammars.
 * Languages are built in; themes load on demand from chamele's bundle.
 *
 * ```ts
 * import { File, setHighlighter } from '@pierre/diffs';
 * import { chameleHighlighter } from '@pierre/diffs/chamele';
 *
 * setHighlighter(chameleHighlighter);
 * const file = new File();
 * ```
 */
export const chameleHighlighter: CodeHighlighter = {
  name: 'chamele',
  async load({ themes }) {
    await Promise.all(themes.map((theme) => loadChameleTheme(theme)));
  },
  isReady({ themes }) {
    return themes.every(
      (theme) =>
        chameleThemeResolver.hasResolvedTheme(theme) ||
        chameleThemeResolver.hasResolvedTheme(
          THEME_NAME_ALIASES[kebab(theme)] ?? ''
        )
    );
  },
  getTheme(name: DiffsThemeNames): ThemeRegistrationResolved {
    const theme = resolveChameleTheme(name);
    return {
      name,
      displayName: theme.name,
      type: theme.appearance === 'light' ? 'light' : 'dark',
      fg: themeForeground(theme) ?? '',
      bg: themeBackground(theme) ?? '',
      colors: themeEditorColors(theme),
      settings: [],
    } as ThemeRegistrationResolved;
  },
  codeToTokens(code: string, options: CodeToTokensOptions<string, string>) {
    return chameleCodeToTokens(code, mapTokensOptions(options)) as {
      tokens: ThemedToken[][];
    };
  },
  codeToHast(code: string, options: CodeToHastOptions<DiffsThemeNames>): Root {
    return chameleCodeToHast(code, mapHastOptions(options)) as unknown as Root;
  },
  StreamTokenizer: ChameleCodeStreamTokenizer,
  createLiveTokenizer(options: CodeLiveTokenizerOptions): CodeLiveTokenizer {
    return new ChameleLiveTokenizer(options);
  },
};

export default chameleHighlighter;
