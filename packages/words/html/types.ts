export interface AnimateOptions {
  animation?: 'fadeIn';
  duration?: number;
}

/** Hooks that take and return the HTML of generated elements. These are trusted code. */
export type Components = Partial<Record<string, (html: string) => string>>;

export interface CodeOptions {
  /**
   * Code lines, each ending with LF. For a `MermaidPlugin` or `renderers`, the
   * last line of an open fence has no LF while it is still being written.
   */
  code: string;
  language: string;
  isIncomplete: boolean;
}

/** Changed lines of a code block. Lines before `firstLine` did not change. */
export interface CodeHighlightUpdate {
  /**
   * First changed line, zero-based, and not after the last line with content.
   * Equals `lineCount` when nothing changed.
   */
  firstLine: number;
  /** Total lines, including an empty final line after a trailing LF. */
  lineCount: number;
  /** Lines from `firstLine` on, joined by LF. Each line is balanced inline HTML. */
  html: string;
  /** Offset in `html` of the last line with content. */
  lastLineOffset: number;
  /** All lines as HTML, built on first read. */
  readonly fullHtml: string;
}

export interface CodeHighlighterSession {
  highlight(options: CodeOptions): string | null;
  highlightLines?(options: CodeOptions): CodeHighlightUpdate | null;
  dispose(): void;
}

export interface CodeHighlighterPlugin {
  /** Return escaped HTML for the inside of `<code>`, or null for plain text. */
  highlight(options: CodeOptions): string | null;
  createSession?(): CodeHighlighterSession;
}

export interface MermaidPlugin {
  /** Return HTML for a `mermaid` code block, or null to show the code. */
  render(options: CodeOptions): string | null;
}

export interface PluginConfig {
  code?: CodeHighlighterPlugin;
  /** Diagrams for `mermaid` code blocks. See `createMermaidPlugin`. */
  mermaid?: MermaidPlugin;
  /**
   * Renderers return HTML for a code block, or null to show the code. A closed
   * block's output is reused while its language and code stay the same.
   */
  renderers?: {
    language: string | string[];
    /** Show the output in the code block frame, with its header and buttons. */
    frame?: boolean;
    render(options: CodeOptions): string | null;
  }[];
}

export interface ControlsConfig {
  code?: boolean | { copy?: boolean; download?: boolean };
}

export type IslandData = Readonly<{ id: string; [key: string]: unknown }>;

/** Plain loading text or a CSS-styled skeleton with an optional accessible label. */
export type IslandPending = string | { className: string; label?: string };

export interface HtmlIsland {
  /** Displayed while a registered fence is streaming. Defaults to no content. */
  pending?: IslandPending;
  /** Text shown before the island mounts. */
  fallback?: string;
  /** Return false to show the original fence. */
  accepts(data: IslandData): boolean;
}

export interface HtmlOptions {
  /** Registered island-NAME fences, keyed by NAME. */
  islands?: Readonly<Record<string, HtmlIsland>>;
  /** CJK-friendly emphasis. See `HtmlSessionOptions.cjk`. */
  cjk?: boolean;
  /** Math as SVG. See `HtmlSessionOptions.math`. */
  math?: boolean;
  components?: Components;
  plugins?: PluginConfig;
  controls?: boolean | ControlsConfig;
  lineNumbers?: boolean;
  allowedElements?: string[];
  disallowedElements?: string[];
  unwrapDisallowed?: boolean;
  urlTransform?: (
    url: string,
    key: 'href' | 'src'
  ) => string | null | undefined;
  idPrefix?: string;
}
