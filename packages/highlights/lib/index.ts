import type { Lang } from './languages';

export type { Lang } from './languages';

/**
 * Styling for a Zed syntax scope. The `& {}` unions keep literal suggestions
 * while accepting the `string` and `number` types inferred from bundled themes.
 */
export interface ThemeSyntaxSettings {
  color?: string;
  font_style?: 'italic' | 'normal' | (string & {});
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
  cursor?: string;
  selection?: string;
  background?: string;
}

/** Colors and syntax scopes from a Zed-compatible theme. */
export interface ThemeStyle {
  background?: string;
  foreground?: string;
  text?: string;
  'editor.background'?: string;
  'editor.foreground'?: string;
  'editor.active_line.background'?: string;
  'editor.document_highlight.bracket_background'?: string;
  'search.match_background'?: string;
  players?: readonly ThemePlayer[];
  error?: string;
  warning?: string;
  info?: string;
  hint?: string;
  syntax?: Record<string, string | ThemeSyntaxSettings>;
  [key: string]: unknown;
}

/** A Zed-compatible color theme. */
export interface Theme {
  name: string;
  appearance: 'dark' | 'light' | (string & {});
  style: ThemeStyle;
  /** A palette maps syntax colors to variable suffixes and retains font styles. */
  cssVariables?:
    | true
    | {
        prefix?: string;
        defaults?: Record<string, string>;
      };
}

/** A Zed-compatible collection of themes. */
export interface ThemeFamily {
  name?: string;
  author?: string;
  themes: readonly Theme[];
}

/**
 * A Shiki-compatible styled run within one line. `offset` is the absolute
 * UTF-16 index in the input.
 */
export interface ThemedToken {
  content: string;
  offset: number;
  /** A theme color, or a prefixed `var(...)` for CSS-variable themes. */
  color?: string;
  /** Background color. Highlights never emits it, but transformers may set it. */
  bgColor?: string;
  /**
   * Shiki flags: italic 1, bold 2, underline 4, strikethrough 8.
   * Highlights emits italic and bold; transformers can set the rest.
   */
  fontStyle?: number;
  /**
   * Inline styles for multi-theme output: plain `color`, `font-style`, and
   * `font-weight` for the `defaultColor` theme, custom properties keyed by
   * `${cssVariablePrefix}${themeColor}` for the others.
   * Equal runs share this map; replace it when customizing one token's styles.
   */
  htmlStyle?: Record<string, string>;
  /** Extra attributes for the token's `<span>` (`htmlAttrs` in Shiki). */
  htmlAttrs?: Record<string, string>;
  /** Standard token type: 0 or omitted for other; 1 comment; 2 string; 3 regex. */
  type?: number;
}

/** Options shared by every highlighting and tokenization entry point. */
export interface CodeToHtmlBaseOptions {
  lang: Lang;
  /** Prefix for CSS-variable colors and per-theme properties. Defaults to `--hls-`. */
  cssVariablePrefix?: string;
  /**
   * With `themes`, the key of the theme applied inline through plain `color`,
   * `font-style`, and `font-weight`; every other theme becomes custom
   * properties named `${cssVariablePrefix}${key}`. Defaults to `light`, like
   * Shiki, and throws when `themes` lacks that key. `false` makes every theme
   * a custom property, and `'light-dark()'` merges the `light` and `dark`
   * themes into CSS `light-dark()` colors.
   */
  defaultColor?: string | false;
}

/** Options shared by every tokenization entry point. */
export interface CodeToTokensBaseOptions extends CodeToHtmlBaseOptions {
  /**
   * Lines at or above this length become one unthemed token, matching Shiki's
   * `tokenizeMaxLineLength` DOM-safety limit. `0` or undefined disables it.
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
  tokens: ThemedToken[][];
  fg?: string;
  bg?: string;
  themeName?: string;
  rootStyle?: string;
}

/** An initialized highlighter backed by one WebAssembly instance. */
export interface Highlighter {
  codeToHtml(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToHtmlOptions
  ): Uint8Array;
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
