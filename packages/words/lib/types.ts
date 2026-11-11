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
}

/** Options for incremental HTML rendering. */
export interface HtmlSessionOptions {
  /** Complete common unfinished inline syntax. */
  incomplete?: boolean;
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
