export interface AnimateOptions {
  animation?: 'fadeIn';
  duration?: number;
}

/** A trusted application hook receives and returns generated HTML, not a node tree. */
export type Components = Partial<Record<string, (html: string) => string>>;

export interface CodeOptions {
  code: string;
  language: string;
  isIncomplete: boolean;
}

export interface CodeHighlighterSession {
  highlight(options: CodeOptions): string | null;
  dispose(): void;
}

export interface CodeHighlighterPlugin {
  /** Return escaped HTML for the inside of a code element. */
  highlight(options: CodeOptions): string | null;
  createSession?(): CodeHighlighterSession;
}

export interface PluginConfig {
  code?: CodeHighlighterPlugin;
  renderers?: {
    language: string | string[];
    render(options: CodeOptions): string;
  }[];
}

export interface ControlsConfig {
  code?: boolean | { copy?: boolean; download?: boolean };
}

export interface HtmlOptions {
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
