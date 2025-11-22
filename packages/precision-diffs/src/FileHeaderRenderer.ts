import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import { getSharedHighlighter, hasLoadedThemes } from './SharedHighlighter';
import { DEFAULT_THEMES } from './constants';
import type {
  FileContents,
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  ThemeTypes,
  ThemesType,
} from './types';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getThemes } from './utils/getThemes';
import { createFileHeaderElement } from './utils/hast_utils';

export interface FileHeaderRendererOptions {
  theme?: PJSThemeNames | ThemesType;
  themeType?: ThemeTypes;
}

export class FileHeaderRenderer {
  private highlighter: PJSHighlighter | undefined;

  constructor(
    public options: FileHeaderRendererOptions = { theme: DEFAULT_THEMES }
  ) {}

  cleanUp(): void {
    this.highlighter = undefined;
    this.queuedRenderFileOrDiff = undefined;
    this.queuedRender = undefined;
  }

  private mergeOptions(options: Partial<FileHeaderRendererOptions>): void {
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
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(undefined, this.options)
    );
    return this.highlighter;
  }

  fileOrDiff: FileDiffMetadata | FileContents | undefined;
  private queuedRenderFileOrDiff: FileDiffMetadata | FileContents | undefined;
  private queuedRender: Promise<HASTElement | undefined> | undefined;
  async render(
    fileOrDiff: FileDiffMetadata | FileContents
  ): Promise<HASTElement | undefined> {
    this.queuedRenderFileOrDiff = fileOrDiff;
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      if (!hasLoadedThemes(getThemes(this.options.theme))) {
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
  ): HASTElement {
    this.fileOrDiff = fileOrDiff;
    return createFileHeaderElement({
      ...this.options,
      fileOrDiff,
      highlighter,
    });
  }

  renderResultToHTML(element: HASTElement): string {
    return toHtml(element);
  }
}
