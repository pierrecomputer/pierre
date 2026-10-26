/** Options for the HTML renderer. */
export interface RenderOptions {
  /**
   * Parse a leading YAML frontmatter block (`---` … `---`) instead of treating
   * it as markdown. Changes the return value to `[meta, output]`, where `meta`
   * is the parsed document or `null` when the input has no frontmatter.
   */
  frontmatter?: boolean;
}

/** Options for the terminal renderer. */
export interface AnsiOptions {
  /** Wrap text at this column. Zero, the default, leaves the terminal to wrap. */
  width?: number;
}

/** An initialized renderer backed by one WebAssembly instance. */
export interface Renderer {
  render(
    input: string | Uint8Array | ArrayBuffer,
    mode: number,
    options?: AnsiOptions & RenderOptions
  ): { output: Uint8Array; meta?: Uint8Array };
}

/** Initializes the shared renderer from a compiled WebAssembly module. */
export function init(wasmModule: WebAssembly.Module): Renderer;

/**
 * Renders GitHub Flavored Markdown as an HTML fragment.
 * Returns a `Uint8Array` view of the result in WebAssembly memory, valid until
 * the next render call.
 *
 * ```js
 * renderToHtml("# Hello, **world**!");
 * // <h1>Hello, <strong>world</strong>!</h1>
 * ```
 */
export function renderToHtml(
  input: string | Uint8Array | ArrayBuffer
): Uint8Array;
export function renderToHtml<T = Record<string, any>>(
  input: string | Uint8Array | ArrayBuffer,
  options: RenderOptions & { frontmatter: true }
): [T, Uint8Array];
export function renderToHtml(
  input: string | Uint8Array | ArrayBuffer,
  options?: RenderOptions
): Uint8Array;

/**
 * Renders GitHub Flavored Markdown as ANSI-styled text for a terminal.
 * Returns a `Uint8Array` view of the result in WebAssembly memory, valid until
 * the next render call.
 *
 * ```js
 * process.stdout.write(renderToAnsi("# Hello, **world**!", { width: 80 }));
 * ```
 */
export function renderToAnsi(
  input: string | Uint8Array | ArrayBuffer,
  options?: AnsiOptions
): Uint8Array;

/** Options for incremental HTML rendering. */
export interface HtmlSessionOptions {
  /** Complete common unfinished inline syntax in the display copy of the input. */
  incomplete?: boolean;
}

/** Direct HTML output; only a completed prefix and mutable suffix are retained. */
export interface HtmlUpdate {
  /** Complete output, assembled lazily when read. */
  html: string;
  stable: string;
  /** Newly completed HTML since the preceding revision; resets replace the prefix. */
  addition: string;
  pending: string;
  reset: boolean;
  /** Increasing output version. Use full stable HTML if a revision was skipped. */
  revision: number;
}
/** Incremental HTML strings, without constructing owned JavaScript nodes.
 * Raw source HTML is omitted. Consumers must apply their navigation URL policy.
 */
export function createHtmlSession(): {
  render(input: string, options?: HtmlSessionOptions): HtmlUpdate;
};
