import { getSharedHighlighter, hasLoadedThemes } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  FileContents,
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  RenderDiffResult,
  RenderFileResult,
  ThemesType,
} from '../types';
import { getThemes } from '../utils/getThemes';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { WorkerPool } from './WorkerPool';
import type {
  WorkerHighlighterOptions,
  WorkerPoolOptions,
  WorkerRenderFileOptions,
  WorkerStats,
} from './types';

export class ShikiPoolManager {
  private pool: WorkerPool;
  private highlighter: PJSHighlighter | undefined;
  private currentTheme: PJSThemeNames | ThemesType = DEFAULT_THEMES;
  private initialized: Promise<void> | boolean = false;

  constructor(
    private options: WorkerPoolOptions,
    private highlighterOptions: WorkerHighlighterOptions
  ) {
    // TODO(amadeus): Allow the worker pool to be scaled up and down mb?
    this.pool = new WorkerPool(this.options, this.highlighterOptions);
  }

  async setTheme(theme: PJSThemeNames | ThemesType): Promise<void> {
    if (hasLoadedThemes(getThemes(theme)) && this.highlighter != null) {
      this.currentTheme = theme;
    } else {
      this.highlighter = await getSharedHighlighter({
        themes: getThemes(theme),
        langs: ['text'],
      });
      this.currentTheme = theme;
    }
  }

  isInitialized(): boolean {
    return this.initialized === true;
  }

  async initialize(): Promise<void> {
    if (this.initialized === true) {
      return;
    } else if (this.initialized === false) {
      this.initialized = new Promise((resolve) => {
        void (async () => {
          const [highlighter] = await Promise.all([
            getSharedHighlighter({
              themes: getThemes(this.currentTheme),
              preferWasmHighlighter:
                this.highlighterOptions.preferWasmHighlighter,
              langs: ['text'],
            }),
            this.pool.initialize(),
          ]);
          this.currentTheme = this.highlighterOptions.theme;
          this.highlighter = highlighter;
          this.initialized = true;
          resolve();
        })();
      });
    } else {
      return this.initialized;
    }
  }

  async renderFileToAST(
    file: FileContents,
    options: WorkerRenderFileOptions
  ): Promise<RenderFileResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.pool.submitTask({
      type: 'file',
      file,
      options,
    });
  }

  renderPlainFileToAST(
    file: FileContents,
    startingLineNumber: number = 1
  ): RenderFileResult | undefined {
    if (this.highlighter == null) {
      void this.initialize();
      return undefined;
    }
    return renderFileWithHighlighter(file, this.highlighter, {
      lang: 'text',
      startingLineNumber,
      theme: this.currentTheme,
      tokenizeMaxLineLength: 1000,
    });
  }

  async renderDiffFilesToAST(
    oldFile: FileContents,
    newFile: FileContents,
    options: WorkerRenderFileOptions
  ): Promise<RenderDiffResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.pool.submitTask({
      type: 'diff-files',
      oldFile,
      newFile,
      options,
    });
  }

  // NOTE(amadeus): Do we even need this API?
  // Currently nothing is using this function
  renderPlainDiffToAST(
    oldFile: FileContents,
    newFile: FileContents
  ): RenderDiffResult | undefined {
    const oldResult = this.renderPlainFileToAST(oldFile, 1);
    const newResult = this.renderPlainFileToAST(newFile, 1);
    if (oldResult == null || newResult == null) {
      return undefined;
    }
    return {
      code: { oldLines: oldResult.code, newLines: newResult.code },
      themeStyles: newResult.themeStyles,
      baseThemeType: newResult.baseThemeType,
    };
  }

  async renderDiffMetadataToAST(
    diff: FileDiffMetadata,
    options: WorkerRenderFileOptions
  ): Promise<RenderDiffResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.pool.submitTask({
      type: 'diff-metadata',
      diff,
      options,
    });
  }

  renderPlainDiffMetadataToAST(
    diff: FileDiffMetadata
  ): RenderDiffResult | undefined {
    return this.highlighter != null
      ? renderDiffWithHighlighter(diff, this.highlighter, {
          theme: this.currentTheme,
          lang: 'text',
          tokenizeMaxLineLength: 1000,
        })
      : undefined;
  }

  terminate(): void {
    this.pool.terminate();
    this.highlighter = undefined;
    this.initialized = false;
  }

  getStats(): WorkerStats {
    return (
      this.pool.getStats() ?? {
        totalWorkers: 0,
        busyWorkers: 0,
        queuedTasks: 0,
        pendingTasks: 0,
      }
    );
  }
}
