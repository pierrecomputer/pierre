import type { BundledTheme, HighlighterGeneric } from 'shiki';

import { getSharedHighlighter, hasLoadedThemes } from './SharedHighlighter';
import type {
  FileDiffMetadata,
  RenderCustomFileMetadata,
  SupportedLanguages,
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
  private highlighter:
    | HighlighterGeneric<SupportedLanguages, BundledTheme>
    | undefined;

  constructor(public options: DiffHeaderRendererOptions) {}

  cleanUp() {
    this.headerInstance?.parentNode?.removeChild(this.headerInstance);
    this.highlighter = undefined;
    this.queuedRenderArgs = undefined;
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
    if (this.headerInstance == null) {
      return;
    }
    switch (themeMode) {
      case 'system':
        delete this.headerInstance.dataset.themeMode;
        break;
      case 'light':
      case 'dark':
        this.headerInstance.dataset.themeMode = themeMode;
        break;
    }
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private getHighlighterOptions() {
    const themes: BundledTheme[] = [];
    if (this.options.theme != null) {
      themes.push(this.options.theme);
    }
    if (this.options.themes != null) {
      themes.push(this.options.themes.dark);
      themes.push(this.options.themes.light);
    }
    return { themes, langs: [] };
  }

  private diff: FileDiffMetadata | undefined;
  private queuedRenderArgs: [FileDiffMetadata, HTMLElement] | undefined;
  private queuedRender: Promise<void> | undefined;
  async render(diff: FileDiffMetadata, wrapper: HTMLElement) {
    this.queuedRenderArgs = [diff, wrapper];
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      if (!hasLoadedThemes(this.getThemes())) {
        this.highlighter = undefined;
      }
      this.highlighter ??= await this.initializeHighlighter();
      if (this.queuedRenderArgs == null) {
        // If we get in here, it's likely we called cleanup and therefore we
        // should just return early
        return;
      }
      const [diff, wrapper] = this.queuedRenderArgs;
      this.queuedRenderArgs = undefined;
      this.diff = diff;
      this.renderHeader(this.diff, wrapper, this.highlighter);
    })();
    await this.queuedRender;
    this.queuedRender = undefined;
  }

  private headerInstance: HTMLElement | undefined;
  private renderHeader(
    diff: FileDiffMetadata,
    wrapper: HTMLElement,
    highlighter: HighlighterGeneric<SupportedLanguages, BundledTheme>
  ) {
    const newHeader = renderFileHeader({
      ...this.options,
      file: diff,
      highlighter,
    });
    if (this.headerInstance != null) {
      wrapper.shadowRoot?.replaceChild(newHeader, this.headerInstance);
    } else {
      wrapper.shadowRoot?.prepend(newHeader);
    }
    this.headerInstance = newHeader;
  }

  private getThemes(): BundledTheme[] {
    const themes: BundledTheme[] = [];
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
