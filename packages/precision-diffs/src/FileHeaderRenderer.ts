import type { Element } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { getSharedHighlighter, hasLoadedThemes } from './SharedHighlighter';
import type {
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  RenderCustomFileMetadata,
  ThemeRendererOptions,
  ThemeTypes,
  ThemesRendererOptions,
} from './types';
import { createFileHeaderElement } from './utils/hast_utils';

interface BaseProps {
  themeType?: ThemeTypes;
  renderCustomMetadata?: RenderCustomFileMetadata;
}

interface FileHeaderRendererThemeOptions
  extends ThemeRendererOptions,
    BaseProps {}

interface FileHeaderRendererThemesOptions
  extends ThemesRendererOptions,
    BaseProps {}

export type FileHeaderRendererOptions =
  | FileHeaderRendererThemeOptions
  | FileHeaderRendererThemesOptions;

export class FileHeaderRenderer {
  private highlighter: PJSHighlighter | undefined;

  constructor(public options: FileHeaderRendererOptions) {}

  cleanUp() {
    this.highlighter = undefined;
    this.queuedRenderDiff = undefined;
    this.queuedRender = undefined;
  }

  private mergeOptions(options: Partial<FileHeaderRendererOptions>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setOptions(options: FileHeaderRendererOptions) {
    this.options = options;
  }

  setThemeType(themeType: ThemeTypes) {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
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
  private queuedRender: Promise<Element | undefined> | undefined;
  async render(diff: FileDiffMetadata): Promise<Element | undefined> {
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
  ): Element {
    this.diff = diff;
    return createFileHeaderElement({
      ...this.options,
      file: diff,
      highlighter,
    });
  }

  renderResultToHTML(element: Element) {
    return toHtml(element);
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
