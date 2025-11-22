import type { ElementContent, Element as HASTElement } from 'hast';

import { getSharedHighlighter } from '../SharedHighlighter';
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
import { renderFileWithHighlighter } from '../utils/renderFileWithHighlighter';
import { WorkerPool } from './WorkerPool';
import type {
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

  constructor(
    private options: WorkerPoolOptions,
    private highlighterOptions: WorkerHighlighterOptions
  ) {
    // TODO(amadeus): Allow the worker pool to be scaled up and down mb?
    this.pool = new WorkerPool(this.options, this.highlighterOptions);
  }

  async initialize(): Promise<this> {
    this.currentTheme = this.highlighterOptions.theme;
    const [highlighter] = await Promise.all([
      getSharedHighlighter({
        themes: getThemes(this.currentTheme),
        preferWasmHighlighter: this.highlighterOptions.preferWasmHighlighter,
        langs: ['text'],
      }),
      this.ensureInitialized(),
    ]);
    this.highlighter = highlighter;
    return this;
  }

  private async ensureInitialized(): Promise<WorkerPool> {
    await this.pool.initialize();
    return this.pool;
  }

  async renderFileToHast(
    file: FileContents,
    options?: WorkerRenderFileOptions
  ): Promise<ElementContent[]> {
    const pool = await this.ensureInitialized();
    const { lines } = await pool.submitTask<RenderFileResult>({
      type: 'file',
      file,
      options,
    });
    return lines;
  }

  renderPlainFileToHast(
    file: FileContents,
    startingLineNumber: number = 1
  ): ElementContent[] | undefined {
    if (this.highlighter == null) {
      return undefined;
    }
    return renderFileWithHighlighter(file, this.highlighter, {
      lang: 'text',
      startingLineNumber,
      theme: this.currentTheme,
    });
  }

  async renderDiffToHast(
    oldFile: FileContents,
    newFile: FileContents,
    options?: WorkerRenderFileOptions
  ): Promise<RenderDiffResult> {
    const pool = await this.ensureInitialized();
    return pool.submitTask<RenderDiffResult>({
      type: 'diff-files',
      oldFile,
      newFile,
      options,
    });
  }

  renderPlainDiffToHast(
    oldFile: FileContents,
    newFile: FileContents
  ): RenderDiffResult | undefined {
    const oldLines = this.renderPlainFileToHast(oldFile, 1);
    const newLines = this.renderPlainFileToHast(newFile, 1);
    if (oldLines == null || newLines == null) {
      return undefined;
    }
    return { oldLines, newLines };
  }

  async renderDiffMetadataToHast(
    diff: FileDiffMetadata,
    options?: WorkerRenderFileOptions
  ): Promise<RenderDiffResult> {
    const pool = await this.ensureInitialized();
    return pool.submitTask<RenderDiffResult>({
      type: 'diff-metadata',
      diff,
      options,
    });
  }

  createPreElement(
    options: Omit<CreatePreWrapperPropertiesProps, 'highlighter' | 'theme'>
  ): HASTElement | undefined {
    if (this.highlighter == null) {
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
    if (this.highlighter == null) return;
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
