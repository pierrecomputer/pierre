import type { Lang as LexerLang } from './languages';

/**
 * A built-in language name or alias. `ansi` is terminal output with escape
 * sequences, as in Shiki.
 */
export type Lang = LexerLang | 'ansi';

/**
 * Styles for a Zed syntax scope. The `& {}` unions preserve literal
 * suggestions and accept `string` and `number` types from bundled themes.
 */
export interface ThemeSyntaxSettings {
  /** Text color, or a variable suffix for a named CSS palette. */
  color?: string;
  /** `italic` enables italic text. Other values use normal text. */
  font_style?: 'italic' | 'normal' | (string & {});
  /** Font weight from 100 to 900, rounded to the nearest hundred. */
  font_weight?:
    | 100
    | 200
    | 300
    | 400
    | 500
    | 600
    | 700
    | 800
    | 900
    | (number & {});
}

/** Colors for one collaborator slot in a Zed theme's `players` array. */
export interface ThemePlayer {
  /** Cursor color for this collaborator. */
  cursor?: string;
  /** Selection color for this collaborator. */
  selection?: string;
  /** Background color for this collaborator. */
  background?: string;
}

/** Colors and syntax scopes from a Zed-compatible theme. */
export interface ThemeStyle {
  /** Background color when `editor.background` is absent. */
  background?: string;
  /** Text color when both `editor.foreground` and `text` are absent. */
  foreground?: string;
  /** Text color when `editor.foreground` is absent. Takes precedence over `foreground`. */
  text?: string;
  /** Editor background color. Takes precedence over `background`. */
  'editor.background'?: string;
  /** Editor text color. Takes precedence over `text` and `foreground`. */
  'editor.foreground'?: string;
  /** Background color for the active editor line. */
  'editor.active_line.background'?: string;
  /** Background color for a highlighted bracket. */
  'editor.document_highlight.bracket_background'?: string;
  /** Background color for a search match. */
  'search.match_background'?: string;
  /** Colors for each collaborator. */
  players?: readonly ThemePlayer[];
  /** Color for error diagnostics. */
  error?: string;
  /** Color for warning diagnostics. */
  warning?: string;
  /** Color for information diagnostics. */
  info?: string;
  /** Color for hint diagnostics. */
  hint?: string;
  /** Syntax scope names mapped to text colors or font and color settings. */
  syntax?: Record<string, string | ThemeSyntaxSettings>;
  /** Additional Zed theme properties, such as `terminal.ansi.red`. */
  [key: string]: unknown;
}

/** A Zed-compatible color theme. */
export interface Theme {
  /** Display name of the theme. */
  name: string;
  /** Light or dark appearance. Accepts other names from bundled themes. */
  appearance: 'dark' | 'light' | (string & {});
  /** Editor colors and syntax styles. */
  style: ThemeStyle;
  /**
   * `true` uses CSS variables for each token type and ignores `style`.
   * A palette object treats colors in `style` as variable suffixes and retains font styles.
   */
  cssVariables?:
    | true
    | {
        /** Prefix for palette variables. Defaults to `--hls-`. */
        prefix?: string;
        /** Fallback CSS values keyed by variable suffix, without the prefix. */
        defaults?: Record<string, string>;
      };
}

/** A Zed-compatible collection of themes. */
export interface ThemeFamily {
  /** Display name of the theme family. */
  name?: string;
  /** Author of the theme family. */
  author?: string;
  /** Themes in the family. Highlights uses the first member. */
  themes: readonly Theme[];
}

/**
 * A Shiki-compatible styled run within one line. Offsets use UTF-16 code
 * units. `codeToTokens` and streams use input offsets. `getLineTokens`
 * uses line offsets.
 */
export interface ThemedToken {
  /** Token text without line breaks. In `ansi` mode, escape sequences are absent. */
  content: string;
  /** Start offset in UTF-16 code units, relative to the input or line. */
  offset: number;
  /** A theme color, or a prefixed `var(...)` for CSS-variable themes. */
  color?: string;
  /** Background color. Highlights emits it only for `ansi`. */
  bgColor?: string;
  /**
   * Shiki flags: italic 1, bold 2, underline 4, strikethrough 8.
   * Highlights emits italic and bold, and all four for `ansi`.
   */
  fontStyle?: number;
  /**
   * Styles for multiple themes. The `defaultColor` theme uses `color`,
   * `font-style`, and `font-weight`. Other themes use custom properties
   * with the prefix `${cssVariablePrefix}${themeColor}`.
   * Equal runs share this map. Replace it to change one token's styles.
   */
  htmlStyle?: Record<string, string>;
  /** Extra attributes for the token's `<span>` (`htmlAttrs` in Shiki). */
  htmlAttrs?: Record<string, string>;
  /** Standard token type: 0 or omitted for other; 1 comment; 2 string; 3 regex. */
  type?: number;
}

/** Options shared by every highlighting and tokenization entry point. */
export interface CodeToHtmlBaseOptions {
  /** Built-in language name or alias, or `ansi` for terminal output. */
  lang: Lang;
  /** Prefix for CSS-variable colors and per-theme properties. Defaults to `--hls-`. */
  cssVariablePrefix?: string;
  /**
   * The key in `themes` to apply with inline `color`, `font-style`, and
   * `font-weight`. Other themes use custom properties with the prefix
   * `${cssVariablePrefix}${key}`.
   *
   * Defaults to `light`, as in Shiki. Throws if `themes` lacks that key.
   * Use `false` for custom properties only. Use `'light-dark()'` to combine
   * the `light` and `dark` theme colors with CSS `light-dark()`.
   */
  defaultColor?: string | false;
}

/** Options shared by every tokenization entry point. */
export interface CodeToTokensBaseOptions extends CodeToHtmlBaseOptions {
  /**
   * Lines at or above this length become one token without syntax styles,
   * as in Shiki. This limits the number of DOM elements for long lines.
   * `0` or `undefined` disables the limit.
   * ANSI escape sequences count toward the input UTF-16 length but are
   * removed from token content. Their SGR state still applies to later lines.
   */
  tokenizeMaxLineLength?: number;
}

/**
 * Choose exactly one: `theme` for one theme, or `themes` for named color
 * schemes such as `{ dark, light }`. `themes` uses CSS custom properties.
 * A `ThemeFamily` in either place resolves to its first member (`themes[0]`).
 */
export type ThemeOptions =
  | { theme: Theme | ThemeFamily; themes?: undefined }
  | { theme?: undefined; themes: Record<string, Theme | ThemeFamily> };

/** Options for highlighting source code as HTML. */
export type CodeToHtmlOptions = CodeToHtmlBaseOptions & ThemeOptions;

/** Options for tokenizing source code. */
export type CodeToTokensOptions = CodeToTokensBaseOptions & ThemeOptions;

/** Result of `codeToTokens`, matching Shiki's `TokensResult`. */
export interface TokensResult {
  /** Themed tokens in source order, with one array per line. */
  tokens: ThemedToken[][];
  /** Root text color. With multiple themes, this can include CSS declarations. */
  fg?: string;
  /** Root background color. With multiple themes, this can include CSS declarations. */
  bg?: string;
  /** Theme name, or `highlights-themes` followed by the names of all active themes. */
  themeName?: string;
  /** Complete root CSS for `defaultColor: false`. Use this instead of `fg` and `bg`. */
  rootStyle?: string;
}

/** An initialized highlighter backed by one WebAssembly instance. */
export interface Highlighter {
  /**
   * Return highlighted HTML as UTF-8 bytes. Byte input must use UTF-8.
   * The result can share WebAssembly memory that the next call overwrites.
   * Use `.slice()` to retain a copy before another call to this highlighter.
   */
  codeToHtml(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToHtmlOptions
  ): Uint8Array;
  /**
   * Return themed tokens for each line and the root theme styles.
   * Byte input must use UTF-8. Token offsets use UTF-16 code units from the input.
   */
  codeToTokens(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToTokensOptions
  ): TokensResult;
}

export {
  codeToHtml,
  codeToTokens,
  createHighlighter,
  init,
  isSupportedLanguage,
  StreamTokenizer,
} from './highlighter';
export type {
  HighlightedToken,
  LiveLineChange,
  Position as LivePosition,
  TextEdit as LiveTextEdit,
  LiveTokenizerOptions,
  LiveTokenizerUpdate,
  LiveTokenRecords,
  LiveUpdateOptions,
} from './live';
export { LiveTokenizer, tokenNames } from './live';
