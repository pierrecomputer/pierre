import { getSharedHighlighter, hasLoadedThemes } from './SharedHighlighter';
import type {
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  RenderCustomFileMetadata,
  ThemeModes,
  ThemeRendererOptions,
  ThemesRendererOptions,
} from './types';
import { renderFileHeader } from './utils/html_render_utils';

interface BaseProps {
  themeMode?: ThemeModes;
  renderCustomMetadata?: RenderCustomFileMetadata;
}

interface DiffHeaderThemeRendererOptions
  extends ThemeRendererOptions,
    BaseProps {}

interface DiffHeaderThemesRendererOptions
  extends ThemesRendererOptions,
    BaseProps {}

export type DiffHeaderRendererOptions =
  | DiffHeaderThemeRendererOptions
  | DiffHeaderThemesRendererOptions;

export class DiffHeaderRenderer {
  private highlighter: PJSHighlighter | undefined;

  constructor(public options: DiffHeaderRendererOptions) {}

  cleanUp() {
    this.highlighter = undefined;
    this.queuedRenderDiff = undefined;
    this.queuedRender = undefined;
  }

  private mergeOptions(options: Partial<DiffHeaderRendererOptions>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setOptions(options: DiffHeaderRendererOptions) {
    this.options = options;
  }

  setThemeMode(themeMode: ThemeModes) {
    if ((this.options.themeMode ?? 'system') === themeMode) {
      return;
    }
    this.mergeOptions({ themeMode });
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private getHighlighterOptions() {
    const themes: PJSThemeNames[] = [];
    if (this.options.theme != null) {
      themes.push(this.options.theme);
    }
    if (this.options.themes != null) {
      themes.push(this.options.themes.dark);
      themes.push(this.options.themes.light);
    }
    return { themes, langs: [] };
  }

  diff: FileDiffMetadata | undefined;
  private queuedRenderDiff: FileDiffMetadata | undefined;
  private queuedRender: Promise<string | undefined> | undefined;
  async render(diff: FileDiffMetadata): Promise<string | undefined> {
    this.queuedRenderDiff = diff;
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      if (!hasLoadedThemes(this.getThemes())) {
        this.highlighter = undefined;
      }
      this.highlighter ??= await this.initializeHighlighter();
      if (this.queuedRenderDiff == null) {
        // If we get in here, it's likely we called cleanup and therefore we
        // should just return early with empty result
        return undefined;
      }
      return this.renderHeader(this.queuedRenderDiff, this.highlighter);
    })();
    const result = await this.queuedRender;
    this.queuedRenderDiff = undefined;
    this.queuedRender = undefined;
    return result;
  }

  private renderHeader(
    diff: FileDiffMetadata,
    highlighter: PJSHighlighter
  ): string {
    this.diff = diff;
    const header = renderFileHeader({
      ...this.options,
      file: diff,
      highlighter,
    });

    // FIXME(amadeus): This is hacky af lol
    return header.outerHTML;
  }

  private getThemes(): PJSThemeNames[] {
    const themes: PJSThemeNames[] = [];
    const { theme, themes: _themes } = this.options;
    if (theme != null) {
      themes.push(theme);
    }
    if (_themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return themes;
  }
}
