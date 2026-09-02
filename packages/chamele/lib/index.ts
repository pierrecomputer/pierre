/** A language name or alias supported by a built-in lexer. */
export type Lang =
  | 'asm'
  | 'assembly'
  | 'astro'
  | 'bash'
  | 'c'
  | 'c++'
  | 'cc'
  | 'cjs'
  | 'comp'
  | 'cpp'
  | 'css'
  | 'cts'
  | 'cxx'
  | 'diff'
  | 'frag'
  | 'geom'
  | 'glsl'
  | 'go'
  | 'golang'
  | 'h'
  | 'haskell'
  | 'hh'
  | 'hpp'
  | 'hs'
  | 'htm'
  | 'html'
  | 'hxx'
  | 'javascript'
  | 'js'
  | 'json'
  | 'jsonc'
  | 'jsx'
  | 'kotlin'
  | 'kt'
  | 'kts'
  | 'lua'
  | 'markdown'
  | 'md'
  | 'mdx'
  | 'mjs'
  | 'mts'
  | 'patch'
  | 'php'
  | 'plain'
  | 'plaintext'
  | 'py'
  | 'python'
  | 'rs'
  | 'rust'
  | 's'
  | 'sh'
  | 'shell'
  | 'sql'
  | 'svelte'
  | 'svg'
  | 'swift'
  | 'text'
  | 'toml'
  | 'ts'
  | 'tsx'
  | 'txt'
  | 'typescript'
  | 'vert'
  | 'vue'
  | 'wasm'
  | 'wat'
  | 'xml'
  | 'xsd'
  | 'yaml'
  | 'yml'
  | 'zig'
  | 'zsh';

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
  cssVariables?: true;
}

/** A Zed-compatible collection of themes. */
export interface ThemeFamily {
  name?: string;
  author?: string;
  themes: readonly Theme[];
}

/** Options for highlighting source code. */
export interface CodeToHtmlOptions {
  lang: Lang;
  theme: Theme | ThemeFamily;
}

/**
 * A Shiki-compatible styled run within one line. `offset` is the absolute
 * UTF-16 index in the input.
 */
export interface ThemedToken {
  content: string;
  offset: number;
  /** Six- or eight-digit hex color, or `var(--cha-*)` for CSS-variable themes. */
  color?: string;
  /** Background color. Chamele never emits it, but transformers may set it. */
  bgColor?: string;
  /**
   * Shiki flags: italic 1, bold 2, underline 4, strikethrough 8.
   * Chamele emits italic and bold; transformers can set the rest.
   */
  fontStyle?: number;
  /** Custom-property styles for multi-theme output, keyed by `${cssVariablePrefix}${themeColor}`. */
  htmlStyle?: Record<string, string>;
  /** Extra attributes for the token's `<span>` (`htmlAttrs` in Shiki). */
  htmlAttrs?: Record<string, string>;
  /** Standard token type: 0 or omitted for other; 1 comment; 2 string; 3 regex. */
  type?: number;
}

/** Options shared by every tokenization entry point. */
export interface CodeToTokensBaseOptions {
  lang: Lang;
  /** Prefix for per-theme custom properties. Defaults to `--cha-`. */
  cssVariablePrefix?: string;
  /** Only `false` has an effect: emit all theme colors as custom properties. */
  defaultColor?: string | false;
  /**
   * Lines at or above this length become one unthemed token, matching Shiki's
   * `tokenizeMaxLineLength` DOM-safety limit. `0` or undefined disables it.
   */
  tokenizeMaxLineLength?: number;
}

/**
 * Choose exactly one: `theme` for one theme, or `themes` for named color
 * schemes such as `{ dark, light }`. `themes` uses CSS custom properties.
 */
export type CodeToTokensOptions = CodeToTokensBaseOptions &
  (
    | { theme: Theme | ThemeFamily; themes?: undefined }
    | { theme?: undefined; themes: Record<string, Theme | ThemeFamily> }
  );

/** Result of `codeToTokens`, matching Shiki's `TokensResult`. */
export interface TokensResult {
  tokens: ThemedToken[][];
  fg?: string;
  bg?: string;
  themeName?: string;
  rootStyle?: string;
}

/** Minimal structural HAST nodes compatible with the `hast` package types. */
export interface HastText {
  type: 'text';
  value: string;
}
export interface HastElement {
  type: 'element';
  tagName: string;
  properties: Record<string, string | number | boolean | (string | number)[]>;
  children: (HastElement | HastText)[];
}
export interface HastRoot {
  type: 'root';
  children: HastElement[];
}

/**
 * The transformer `this` context shared by every hook, including `preprocess`.
 * Matches Shiki's `ShikiTransformerContextCommon`.
 */
export interface TransformerContextCommon {
  readonly source: string;
  readonly options: CodeToHastOptions;
  /** Mutable per-call scratch data shared by every hook. */
  meta: Record<string, unknown>;
  codeToHast(input: string, options: CodeToHastOptions): HastRoot;
  codeToTokens(input: string, options: CodeToTokensOptions): TokensResult;
}

/**
 * The `this` context for tree hooks. It exposes live tree views and
 * `addClassToHast`, matching Shiki's `ShikiTransformerContext`.
 */
export interface TransformerContext extends TransformerContextCommon {
  readonly structure: 'classic';
  readonly tokens: ThemedToken[][];
  readonly root: HastRoot;
  readonly pre: HastElement;
  readonly code: HastElement;
  readonly lines: HastElement[];
  addClassToHast(node: HastElement, className: string | string[]): HastElement;
}

/**
 * Shiki-style hooks for `codeToHast` may mutate or replace nodes. Hooks use a
 * Shiki-compatible `this`; most transformers are structurally compatible.
 * Chamele supports only the classic structure and omits `postprocess`.
 */
export interface Transformer {
  name?: string;
  preprocess?(
    this: TransformerContextCommon,
    code: string,
    options: CodeToHastOptions
  ): string | void;
  tokens?(
    this: TransformerContext,
    lines: ThemedToken[][]
  ): ThemedToken[][] | void;
  span?(
    this: TransformerContext,
    node: HastElement,
    line: number,
    col: number,
    lineElement: HastElement,
    token: ThemedToken
  ): HastElement | void;
  line?(
    this: TransformerContext,
    node: HastElement,
    line: number
  ): HastElement | void;
  code?(this: TransformerContext, node: HastElement): HastElement | void;
  pre?(this: TransformerContext, node: HastElement): HastElement | void;
  root?(this: TransformerContext, node: HastRoot): HastRoot | void;
}

/** A Shiki-style decoration that wraps a code range in an element. */
export interface Decoration {
  /** Absolute offset or 0-based line and character. */
  start: number | { line: number; character: number };
  end: number | { line: number; character: number };
  tagName?: string;
  properties?: Record<string, string | number | boolean>;
}

export type CodeToHastOptions = CodeToTokensOptions & {
  transformers?: Transformer[];
  decorations?: Decoration[];
  /**
   * Extra `<pre>` properties and initial transformer `meta`.
   * Keys starting with `_` stay off `<pre>`, like Shiki's `meta` option.
   */
  meta?: Record<string, unknown>;
};

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
  codeToHast(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToHastOptions
  ): HastRoot;
}

export {
  codeToHast,
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
