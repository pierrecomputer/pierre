/** Options for the HTML renderer. */
export interface RenderOptions extends HtmlSessionOptions {
  skipHtml?: boolean;
  /**
   * Parse a leading YAML frontmatter block. The return value becomes
   * `[meta, output]`, where `meta` is `null` when the input has no frontmatter.
   */
  frontmatter?: boolean;
}

/** Parsed YAML frontmatter: usually a mapping, but any JSON value. */
export type Frontmatter =
  | { [key: string]: Frontmatter }
  | Frontmatter[]
  | string
  | number
  | boolean
  | null;

/** Options for the terminal renderer. */
export interface AnsiOptions {
  /** Wrap text at this column. With 0, the default, the terminal wraps it. */
  width?: number;
  /**
   * Let `*` and `~` emphasis open and close next to Chinese, Japanese, and
   * Korean text, as markdown-cjk-friendly does.
   */
  cjk?: boolean;
  /**
   * Read `$…$`, `$$…$$`, `$$` blocks, and `math` code blocks as math. The
   * terminal shows their TeX source.
   */
  math?: boolean;
}

/** Options for incremental HTML rendering. */
export interface HtmlSessionOptions {
  /** Complete common unfinished inline syntax. */
  incomplete?: boolean;
  /**
   * Let `*` and `~` emphasis open and close next to Chinese, Japanese, and
   * Korean text, as markdown-cjk-friendly does.
   */
  cjk?: boolean;
  /** Render `$…$`, `$$…$$`, `$$` blocks, and `math` code blocks as SVG. */
  math?: boolean;
  /**
   * Show raw HTML as escaped text, instead of omitting it (sessions,
   * `skipHtml`) or keeping it as markup (`renderToHtml()`). An HTML block
   * becomes a paragraph of its source lines, without Markdown inside it.
   * Takes precedence over `skipHtml`.
   */
  escapeHtml?: boolean;
}

/** The result of one session render. */
export interface HtmlUpdate {
  /** Full output, built on first read. */
  html: string;
  /** HTML of completed blocks. */
  stable: string;
  /** HTML completed since the previous revision. */
  addition: string;
  /** HTML that can still change. */
  pending: string;
  /** The previous `stable` is no longer valid. */
  reset: boolean;
  /** Output version. After a skipped revision, use `stable` instead of `addition`. */
  revision: number;
}
