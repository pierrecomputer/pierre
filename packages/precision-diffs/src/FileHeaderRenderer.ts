import type { Element } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { getSharedHighlighter, hasLoadedThemes } from './SharedHighlighter';
import type {
  FileContents,
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  ThemeRendererOptions,
  ThemeTypes,
  ThemesRendererOptions,
} from './types';
import { createFileHeaderElement } from './utils/hast_utils';

interface BaseProps {
  themeType?: ThemeTypes;
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

  constructor(
    public options: FileHeaderRendererOptions = {
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
    }
  ) {}

  cleanUp(): void {
    this.highlighter = undefined;
    this.queuedRenderFileOrDiff = undefined;
    this.queuedRender = undefined;
  }

  private mergeOptions(options: Partial<FileHeaderRendererOptions>): void {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setOptions(options: FileHeaderRendererOptions): void {
    this.options = options;
  }

  setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  private async initializeHighlighter(): Promise<PJSHighlighter> {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private getHighlighterOptions(): { themes: PJSThemeNames[]; langs: [] } {
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

  fileOrDiff: FileDiffMetadata | FileContents | undefined;
  private queuedRenderFileOrDiff: FileDiffMetadata | FileContents | undefined;
  private queuedRender: Promise<Element | undefined> | undefined;
  async render(
    fileOrDiff: FileDiffMetadata | FileContents
  ): Promise<Element | undefined> {
    this.queuedRenderFileOrDiff = fileOrDiff;
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      if (!hasLoadedThemes(this.getThemes())) {
        this.highlighter = undefined;
      }
      this.highlighter ??= await this.initializeHighlighter();
      if (this.queuedRenderFileOrDiff == null) {
        // If we get in here, it's likely we called cleanup and therefore we
        // should just return early with empty result
        return undefined;
      }
      return this.renderHeader(this.queuedRenderFileOrDiff, this.highlighter);
    })();
    const result = await this.queuedRender;
    this.queuedRenderFileOrDiff = undefined;
    this.queuedRender = undefined;
    return result;
  }

  private renderHeader(
    fileOrDiff: FileDiffMetadata | FileContents,
    highlighter: PJSHighlighter
  ): Element {
    this.fileOrDiff = fileOrDiff;
    return createFileHeaderElement({
      ...this.options,
      fileOrDiff,
      highlighter,
    });
  }

  renderResultToHTML(element: Element): string {
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
