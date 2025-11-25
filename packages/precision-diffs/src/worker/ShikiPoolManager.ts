import type { ElementContent, Element as HASTElement } from 'hast';

import { getSharedHighlighter, hasLoadedThemes } from '../SharedHighlighter';
import { DEFAULT_THEMES } from '../constants';
import type {
  CreatePreWrapperPropertiesProps,
  FileContents,
  FileDiffMetadata,
  PJSHighlighter,
  PJSThemeNames,
  ThemesType,
} from '../types';
import { createPreElement } from '../utils/createPreElement';
import { getThemes } from '../utils/getThemes';
import {
  type CreateFileHeaderElementProps,
  createFileHeaderElement,
} from '../utils/hast_utils';
import {
  type SetupWrapperNodesProps,
  setWrapperProps,
} from '../utils/html_render_utils';
import { renderDiffWithHighlighter } from '../utils/renderDiffWithHighlighter';
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { WorkerPool } from './WorkerPool';
import type {
  RenderDiffFilesResult,
  RenderDiffResult,
  RenderFileResult,
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
  ): Promise<ElementContent[]> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    const { lines } = await this.pool.submitTask<RenderFileResult>({
      type: 'file',
      file,
      options,
    });
    return lines;
  }

  renderPlainFileToAST(
    file: FileContents,
    startingLineNumber: number = 1
  ): ElementContent[] | undefined {
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
  ): Promise<RenderDiffFilesResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.pool.submitTask<RenderDiffFilesResult>({
      type: 'diff-files',
      oldFile,
      newFile,
      options,
    });
  }

  renderPlainDiffToAST(
    oldFile: FileContents,
    newFile: FileContents
  ): RenderDiffResult | undefined {
    const oldLines = this.renderPlainFileToAST(oldFile, 1);
    const newLines = this.renderPlainFileToAST(newFile, 1);
    if (oldLines == null || newLines == null) {
      return undefined;
    }
    return { oldLines, newLines };
  }

  async renderDiffMetadataToAST(
    diff: FileDiffMetadata,
    options: WorkerRenderFileOptions
  ): Promise<RenderDiffResult> {
    if (!this.isInitialized()) {
      await this.initialize();
    }
    return this.pool.submitTask<RenderDiffResult>({
      type: 'diff-metadata',
      diff,
      options,
    });
  }

  renderPlainDiffMetadataToAST(
    diff: FileDiffMetadata,
    disableLineNumbers = false
  ): RenderDiffResult | undefined {
    return this.highlighter != null
      ? renderDiffWithHighlighter(diff, this.highlighter, {
          theme: this.currentTheme,
          lang: 'text',
          disableLineNumbers,
          tokenizeMaxLineLength: 1000,
        })
      : undefined;
  }

  createPreElement(
    options: Omit<CreatePreWrapperPropertiesProps, 'highlighter' | 'theme'>
  ): HASTElement | undefined {
    if (this.highlighter == null) {
      void this.initialize();
      return undefined;
    }
    return createPreElement({
      ...options,
      theme: this.currentTheme,
      highlighter: this.highlighter,
    });
  }

  setPreNodeAttributes(
    options: Omit<SetupWrapperNodesProps, 'highlighter'>
  ): void {
    if (this.highlighter == null) {
      void this.initialize();
      return;
    }
    setWrapperProps({
      ...options,
      highlighter: this.highlighter,
    });
  }

  createHeaderElement(
    props: Omit<CreateFileHeaderElementProps, 'highlighter'>
  ): HASTElement | undefined {
    const { highlighter } = this;
    return highlighter != null
      ? createFileHeaderElement({ ...props, highlighter })
      : undefined;
  }

  terminate(): void {
    this.pool.terminate();
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
