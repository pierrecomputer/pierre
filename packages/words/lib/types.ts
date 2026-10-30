/** Options for the HTML renderer. */
export interface RenderOptions extends HtmlSessionOptions {
  skipHtml?: boolean;
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
