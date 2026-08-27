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
  | 'toml'
  | 'ts'
  | 'tsx'
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
 * Styling for a syntax scope in a Zed-compatible theme. The `& {}` widenings keep the
 * literal hints while accepting `string`/`number`, the types TypeScript infers for the
 * bundled JSON themes.
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

/** Colors and syntax scopes from a Zed-compatible theme. */
export interface ThemeStyle {
  background?: string;
  foreground?: string;
  text?: string;
  'editor.background'?: string;
  'editor.foreground'?: string;
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

/** An initialized highlighter backed by one WebAssembly instance. */
export interface Highlighter {
  codeToHtml(
    input: string | Uint8Array | ArrayBuffer,
    options: CodeToHtmlOptions
  ): Uint8Array;
}

/**
 * Initializes the shared highlighter from a compiled WebAssembly module.
 */
export function init(wasmModule: WebAssembly.Module): Highlighter;

/**
 * Highlights source code as a self-contained `<pre class="chamele">...</pre>` fragment
 * with inline colors.
 */
export function codeToHtml(
  input: string | Uint8Array | ArrayBuffer,
  options: CodeToHtmlOptions
): Uint8Array;
