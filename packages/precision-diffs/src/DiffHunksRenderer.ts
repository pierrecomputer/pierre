import type { ElementContent, Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  getSharedHighlighter,
  hasLoadedLanguage,
  hasLoadedThemes,
} from './SharedHighlighter';
import { DEFAULT_THEMES } from './constants';
import type {
  AnnotationLineMap,
  AnnotationSpan,
  BaseDiffOptions,
  DiffLineAnnotation,
  ExpansionDirections,
  FileDiffMetadata,
  Hunk,
  HunkData,
  PJSHighlighter,
  RenderedDiffASTCache,
  SupportedLanguages,
  ThemeTypes,
} from './types';
import { createPreElement } from './utils/createPreElement';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getHunkSeparatorSlotName } from './utils/getHunkSeparatorSlotName';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import { getTotalLineCountFromHunks } from './utils/getTotalLineCountFromHunks';
import {
  createAnnotationElement,
  createEmptyRowBuffer,
  createFileHeaderElement,
  createHastElement,
  createSeparator,
} from './utils/hast_utils';
import {
  type SetupWrapperNodesProps,
  setWrapperProps,
} from './utils/html_render_utils';
import { renderDiffWithHighlighter } from './utils/renderDiffWithHighlighter';
import type { RenderDiffResult, ShikiPoolManager } from './worker';

const FULLY_EXPANDED = {
  fromStart: Infinity,
  fromEnd: Infinity,
};

interface PushHunkSeparatorProps {
  type: 'additions' | 'deletions' | 'unified';
  linesAST: ElementContent[];
  hunkIndex: number;
  collapsedLines: number;
  chunked: boolean;
  isFirstHunk: boolean;
  isLastHunk: boolean;
}

interface RenderHunkProps {
  ast: RenderDiffResult;
  hunk: Hunk;
  prevHunk: Hunk | undefined;
  isLastHunk: boolean;
  isFirstHunk: boolean;
  hunkIndex: number;
  additionsAST: ElementContent[];
  deletionsAST: ElementContent[];
  unifiedAST: ElementContent[];
  hunkData: HunkData[];
  lineIndex: number;
}

type OptionsWithDefaults = Required<
  Omit<BaseDiffOptions, 'lang' | 'preferWasmHighlighter' | 'unsafeCSS'>
>;

interface ExpansionRegion {
  fromStart: number;
  fromEnd: number;
}

export interface HunksRenderResult {
  additionsAST: ElementContent[] | undefined;
  deletionsAST: ElementContent[] | undefined;
  unifiedAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: HASTElement;
  totalLines: number;
}

export class DiffHunksRenderer<LAnnotation = undefined> {
  private highlighter: PJSHighlighter | undefined;
  private diff: FileDiffMetadata | undefined;

  private expandedHunks = new Map<number, ExpansionRegion>();

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};

  private computedLang: SupportedLanguages = 'text';
  private renderCache: RenderedDiffASTCache | undefined;

  constructor(
    public options: BaseDiffOptions = { theme: DEFAULT_THEMES },
    private onRenderUpdate?: () => unknown,
    private poolManager?: ShikiPoolManager | undefined
  ) {}

  cleanUp(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.renderCache = undefined;
    this.poolManager = undefined;
    this.onRenderUpdate = undefined;
  }

  setOptions(options: BaseDiffOptions): void {
    this.options = options;
  }

  private mergeOptions(options: Partial<BaseDiffOptions>) {
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes): void {
    if (this.getOptionsWithDefaults().themeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  expandHunk(index: number, direction: ExpansionDirections): void {
    const { expansionLineCount } = this.getOptionsWithDefaults();
    const region = this.expandedHunks.get(index) ?? {
      fromStart: 0,
      fromEnd: 0,
    };
    if (direction === 'up' || direction === 'both') {
      region.fromStart += expansionLineCount;
    }
    if (direction === 'down' || direction === 'both') {
      region.fromEnd += expansionLineCount;
    }
    this.expandedHunks.set(index, region);
  }

  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void {
    this.additionAnnotations = {};
    this.deletionAnnotations = {};
    for (const annotation of lineAnnotations) {
      const map = ((): AnnotationLineMap<LAnnotation> => {
        switch (annotation.side) {
          case 'deletions':
            return this.deletionAnnotations;
          case 'additions':
            return this.additionAnnotations;
        }
      })();
      const arr = map[annotation.lineNumber] ?? [];
      map[annotation.lineNumber] = arr;
      arr.push(annotation);
    }
  }

  getOptionsWithDefaults(): OptionsWithDefaults {
    const {
      diffIndicators = 'bars',
      diffStyle = 'split',
      disableBackground = false,
      disableLineNumbers = false,
      expandUnchanged = false,
      expansionLineCount = 100,
      hunkSeparators = 'line-info',
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      tokenizeMaxLineLength = 1000,
      overflow = 'scroll',
      theme = DEFAULT_THEMES,
      themeType = 'system',
      useCSSClasses = false,
    } = this.options;
    return {
      diffIndicators,
      diffStyle,
      disableBackground,
      disableLineNumbers,
      expandUnchanged,
      expansionLineCount,
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      tokenizeMaxLineLength,
      overflow,
      theme,
      themeType,
      useCSSClasses,
    };
  }

  async initializeHighlighter(): Promise<PJSHighlighter> {
    this.highlighter = await getSharedHighlighter(
      getHighlighterOptions(this.computedLang, this.options)
    );
    return this.highlighter;
  }

  render(
    diff: FileDiffMetadata | undefined = this.renderCache?.diff
  ): HunksRenderResult | undefined {
    if (diff == null) {
      return undefined;
    }

    const ast = (() => {
      const { lang } = this.options;
      const { theme, disableLineNumbers, tokenizeMaxLineLength } =
        this.getOptionsWithDefaults();
      this.renderCache ??= { diff, highlighted: false, ast: undefined };
      if (this.poolManager != null) {
        this.renderCache.ast ??= this.poolManager.renderPlainDiffMetadataToAST(
          diff,
          disableLineNumbers
        );
        if (!this.renderCache.highlighted) {
          void this.poolManager
            .renderDiffMetadataToAST(diff, {
              lang,
              theme,
              disableLineNumbers,
              tokenizeMaxLineLength,
            })
            .then((results) => this.handleAsyncHighlight(diff, results));
        }
      } else if (this.renderCache.ast == null) {
        if (this.highlighter != null) {
          this.renderCache.ast = this.renderDiffWithHighlighter(
            diff,
            this.highlighter
          );
          this.renderCache.highlighted = true;
        } else {
          void this.asyncHighlight(diff).then((result) => {
            this.handleAsyncHighlight(diff, result);
          });
        }
      }
      return this.renderCache.ast;
    })();

    return ast != null ? this.processDiffResult(diff, ast) : undefined;
  }

  async asyncRender(
    diff: FileDiffMetadata
  ): Promise<HunksRenderResult | undefined> {
    return this.processDiffResult(diff, await this.asyncHighlight(diff));
  }

  private createPreElement(
    split: boolean,
    totalLines: number
  ): HASTElement | undefined {
    const { theme, diffIndicators, disableBackground, overflow, themeType } =
      this.getOptionsWithDefaults();
    if (this.poolManager != null) {
      return this.poolManager.createPreElement({
        diffIndicators,
        disableBackground,
        overflow,
        split,
        themeType,
        totalLines,
      });
    }
    if (this.highlighter != null) {
      return createPreElement({
        theme,
        highlighter: this.highlighter,
        diffIndicators,
        disableBackground,
        overflow,
        split,
        themeType,
        totalLines,
      });
    }
    return undefined;
  }

  private async asyncHighlight(
    diff: FileDiffMetadata
  ): Promise<RenderDiffResult> {
    this.computedLang = this.options.lang ?? getFiletypeFromFileName(diff.name);
    // If we have changed theme or language on our diff instance, we need to
    // double check the highlighter has loaded the appropriate languages and
    // themes
    if (
      !hasLoadedLanguage(this.computedLang) ||
      !hasLoadedThemes(getThemes(this.options.theme))
    ) {
      this.highlighter = undefined;
    }

    this.highlighter ??= await this.initializeHighlighter();
    return this.renderDiffWithHighlighter(diff, this.highlighter);
  }

  private renderDiffWithHighlighter(
    diff: FileDiffMetadata,
    highlighter: PJSHighlighter
  ): RenderDiffResult {
    const { lang } = this.options;
    const { theme, disableLineNumbers, tokenizeMaxLineLength } =
      this.getOptionsWithDefaults();
    return renderDiffWithHighlighter(diff, highlighter, {
      theme,
      lang,
      disableLineNumbers,
      tokenizeMaxLineLength,
    });
  }

  private handleAsyncHighlight(diff: FileDiffMetadata, ast: RenderDiffResult) {
    if (this.poolManager == null) return;
    this.renderCache = {
      diff,
      highlighted: true,
      ast,
    };
    this.onRenderUpdate?.();
  }

  private processDiffResult(
    fileDiff: FileDiffMetadata,
    ast: RenderDiffResult
  ): HunksRenderResult {
    const { expandUnchanged, diffStyle } = this.getOptionsWithDefaults();

    this.diff = fileDiff;
    const unified = diffStyle === 'unified';
    const additionsAST: ElementContent[] = [];
    const deletionsAST: ElementContent[] = [];
    const unifiedAST: ElementContent[] = [];

    let hunkIndex = 0;
    const hunkData: HunkData[] = [];

    let prevHunk: Hunk | undefined;
    const hunks = (() => {
      if (fileDiff.hunks.length > 0) {
        return fileDiff.hunks;
      }
      if (
        expandUnchanged &&
        this.diff?.newLines != null &&
        this.diff.newLines.length > 0
      ) {
        const lineCount = this.diff.newLines.length + 1;
        return [
          {
            collapsedBefore: 0,
            additionCount: 0,
            additionStart: lineCount,
            additionLines: 0,
            deletionCount: 0,
            deletionStart: lineCount,
            deletionLines: 0,
            hunkContent: [],
            hunkContext: undefined,
            hunkSpecs: undefined,
            splitLineCount: 0,
            splitLineStart: 0,
            unifiedLineCount: 0,
            unifiedLineStart: 0,
          } satisfies Hunk,
        ];
      }
      return [];
    })();
    let lineIndex = 0;
    for (const hunk of hunks) {
      lineIndex += hunk.collapsedBefore;
      this.renderHunks({
        ast,
        hunk,
        prevHunk,
        hunkIndex,
        isFirstHunk: hunkIndex === 0,
        isLastHunk: hunkIndex === fileDiff.hunks.length - 1,
        additionsAST,
        deletionsAST,
        unifiedAST,
        hunkData,
        lineIndex,
      });
      hunkIndex++;
      lineIndex += Math.max(hunk.additionCount, hunk.deletionCount);
      prevHunk = hunk;
    }

    const totalLines = Math.max(
      getTotalLineCountFromHunks(fileDiff.hunks),
      fileDiff.newLines?.length ?? 0,
      fileDiff.oldLines?.length ?? 0
    );
    const preNode = this.createPreElement(
      !unified ? deletionsAST.length > 0 && additionsAST.length > 0 : false,
      totalLines
    );
    if (preNode == null) {
      throw new Error(
        'DiffHunksRenderer.processDiffResult: unable to process preNode'
      );
    }

    return {
      additionsAST:
        !unified && (ast.hunks != null || ast.newLines.length > 0)
          ? additionsAST
          : undefined,
      deletionsAST:
        !unified && (ast.hunks != null || ast.oldLines.length > 0)
          ? deletionsAST
          : undefined,
      unifiedAST: unifiedAST.length > 0 ? unifiedAST : undefined,
      hunkData,
      preNode,
      totalLines,
      // FIXME
      css: '',
    };
  }

  renderFullAST(
    result: HunksRenderResult,
    children: ElementContent[] = []
  ): HASTElement {
    if (result.unifiedAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: result.unifiedAST,
          properties: {
            'data-code': '',
            'data-unified': '',
          },
        })
      );
    }
    if (result.deletionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: result.deletionsAST,
          properties: {
            'data-code': '',
            'data-deletions': '',
          },
        })
      );
    }
    if (result.additionsAST != null) {
      children.push(
        createHastElement({
          tagName: 'code',
          children: result.additionsAST,
          properties: {
            'data-code': '',
            'data-additions': '',
          },
        })
      );
    }
    return { ...result.preNode, children };
  }

  renderFullHTML(
    result: HunksRenderResult,
    tempChildren: ElementContent[] = []
  ): string {
    return toHtml(this.renderFullAST(result, tempChildren));
  }

  renderPartialHTML(
    children: ElementContent[],
    columnType?: 'unified' | 'deletions' | 'additions'
  ): string {
    if (columnType == null) {
      return toHtml(children);
    }
    return toHtml(
      createHastElement({
        tagName: 'code',
        children,
        properties: {
          'data-code': '',
          [`data-${columnType}`]: '',
        },
      })
    );
  }

  private renderHunks({
    ast,
    hunk,
    hunkIndex,
    prevHunk,
    isFirstHunk,
    isLastHunk,
    additionsAST,
    deletionsAST,
    unifiedAST,
    hunkData,
    lineIndex,
  }: RenderHunkProps): void {
    const { hunkSeparators, expansionLineCount, expandUnchanged, diffStyle } =
      this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';
    const expandable =
      ast.hunks == null && ast.newLines.length > 0 && ast.oldLines.length > 0;
    let additionLineNumber = hunk.additionStart - 1;
    let deletionLineNumber = hunk.deletionStart - 1;

    const preExpandedRegion = expandUnchanged
      ? FULLY_EXPANDED
      : this.expandedHunks.get(hunkIndex);

    const collapsedLines = !expandUnchanged
      ? hunk.collapsedBefore -
        ((preExpandedRegion?.fromEnd ?? 0) +
          (preExpandedRegion?.fromStart ?? 0))
      : 0;

    function pushHunkSeparator({
      type,
      linesAST,
      hunkIndex,
      chunked,
      collapsedLines,
      isFirstHunk,
      isLastHunk,
    }: PushHunkSeparatorProps) {
      if (hunkSeparators === 'line-info' || hunkSeparators === 'custom') {
        const slotName = getHunkSeparatorSlotName(type, hunkIndex);
        linesAST.push(
          createSeparator({
            type: hunkSeparators,
            content: getModifiedLinesString(collapsedLines),
            expandIndex: expandable ? hunkIndex : undefined,
            chunked,
            slotName,
            isFirstHunk,
            isLastHunk,
          })
        );
        hunkData.push({
          slotName,
          hunkIndex,
          lines: collapsedLines,
          type,
          expandable: expandable
            ? {
                up: expandable && !isFirstHunk,
                down: expandable,
                chunked,
              }
            : undefined,
        });
      } else if (hunkSeparators === 'metadata' && hunk?.hunkSpecs != null) {
        linesAST.push(
          createSeparator({
            type: 'metadata',
            content: hunk.hunkSpecs,
            isFirstHunk,
            isLastHunk,
          })
        );
      } else if (hunkSeparators === 'simple' && hunkIndex > 0) {
        linesAST.push(
          createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
        );
      }
    }

    // Push hunk separator if necessary
    if (collapsedLines > 0) {
      const chunked = expandable && hunk.collapsedBefore > expansionLineCount;
      if (unified) {
        pushHunkSeparator({
          type: 'unified',
          linesAST: unifiedAST,
          hunkIndex,
          chunked,
          collapsedLines,
          isFirstHunk,
          isLastHunk: false,
        });
      } else {
        pushHunkSeparator({
          type: 'deletions',
          linesAST: deletionsAST,
          hunkIndex,
          collapsedLines,
          chunked,
          isFirstHunk,
          isLastHunk: false,
        });
        pushHunkSeparator({
          type: 'additions',
          linesAST: additionsAST,
          hunkIndex,
          collapsedLines,
          chunked,
          isFirstHunk,
          isLastHunk: false,
        });
      }
    }

    // Render pre-expanded content if necessary
    if (
      preExpandedRegion != null &&
      ast.hunks == null &&
      preExpandedRegion.fromEnd > 0 &&
      ((isFirstHunk && expandUnchanged) ||
        // If we already expanded the collapsed rows from the iteration before,
        // there's no need to do anything
        hunk.collapsedBefore - preExpandedRegion.fromStart > 0)
    ) {
      const { expandAdditionStart, expandDeletionStart } = (() => {
        if (prevHunk != null) {
          return {
            expandAdditionStart: Math.max(
              prevHunk.additionStart - 1 + prevHunk.additionCount - 1,
              hunk.additionStart - 1 - preExpandedRegion.fromEnd
            ),
            expandDeletionStart: Math.max(
              prevHunk.deletionStart - 1 + prevHunk.deletionCount - 1,
              hunk.deletionStart - 1 - preExpandedRegion.fromEnd
            ),
          };
        }
        return { expandAdditionStart: 0, expandDeletionStart: 0 };
      })();
      if (additionLineNumber - expandAdditionStart > 0) {
        additionLineNumber = expandAdditionStart;
        deletionLineNumber = expandDeletionStart;
        lineIndex -= hunk.additionStart - 1 - additionLineNumber;
        for (let i = additionLineNumber; i < hunk.additionStart - 1; i++) {
          const line = ast.newLines[i];
          if (line == null) {
            throw new Error('DiffHunksRenderer.renderHunks prefill context');
          }
          deletionLineNumber++;
          additionLineNumber++;
          if (unified) {
            unifiedAST.push(line);
            const annotationSpan = this.getAnnotations(
              'unified',
              deletionLineNumber,
              additionLineNumber,
              hunkIndex,
              lineIndex
            );
            if (annotationSpan != null) {
              unifiedAST.push(createAnnotationElement(annotationSpan));
            }
          } else {
            deletionsAST.push(line);
            additionsAST.push(line);
            const [deletionSpan, additionSpan] = this.getAnnotations(
              'split',
              deletionLineNumber,
              additionLineNumber,
              hunkIndex,
              lineIndex
            );
            if (deletionSpan != null) {
              deletionsAST.push(createAnnotationElement(deletionSpan));
            }
            if (additionSpan != null) {
              additionsAST.push(createAnnotationElement(additionSpan));
            }
          }
          lineIndex++;
        }
      }
    }

    let { oldLines, newLines, oldIndex, newIndex } = (() => {
      if (ast.hunks != null) {
        const lineHunk = ast.hunks[hunkIndex];
        if (lineHunk == null) {
          console.error({ ast, hunkIndex });
          throw new Error(
            `DiffHunksRenderer.renderHunks: lineHunk doesn't exist`
          );
        }
        return {
          oldLines: lineHunk.oldLines,
          newLines: lineHunk.newLines,
          oldIndex: 0,
          newIndex: 0,
        };
      }
      return {
        oldLines: ast.oldLines,
        newLines: ast.newLines,
        oldIndex: deletionLineNumber,
        newIndex: additionLineNumber,
      };
    })();

    // Render hunk/diff content
    // FIXME(amadeus): Add support for `No newline stuff`
    for (const hunkContent of hunk.hunkContent) {
      if (hunkContent.type === 'context') {
        for (const _ of hunkContent.lines) {
          const oldLine = oldLines[oldIndex];
          const newLine = newLines[newIndex];
          oldIndex++;
          newIndex++;
          additionLineNumber++;
          deletionLineNumber++;
          if (unified) {
            if (newLine == null) {
              throw new Error(
                'DiffHunksRenderer.renderHunks: newLine doesnt exist for context...'
              );
            }
            unifiedAST.push(newLine);
            const annotationSpan = this.getAnnotations(
              'unified',
              deletionLineNumber,
              additionLineNumber,
              hunkIndex,
              lineIndex
            );
            if (annotationSpan != null) {
              unifiedAST.push(createAnnotationElement(annotationSpan));
            }
          } else {
            if (newLine == null || oldLine == null) {
              throw new Error(
                'DiffHunksRenderer.renderHunks: newLine or oldLine doesnt exist for context...'
              );
            }
            deletionsAST.push(oldLine);
            additionsAST.push(newLine);
            const [deletionSpan, additionSpan] = this.getAnnotations(
              'split',
              deletionLineNumber,
              additionLineNumber,
              hunkIndex,
              lineIndex
            );
            if (deletionSpan != null && additionSpan != null) {
              deletionsAST.push(createAnnotationElement(deletionSpan));
              additionsAST.push(createAnnotationElement(additionSpan));
            }
          }
          lineIndex++;
        }
      } else {
        const { length: dLen } = hunkContent.deletions;
        const { length: aLen } = hunkContent.additions;
        const len = unified ? dLen + aLen : Math.max(dLen, aLen);
        let spanSize = 0;
        for (let i = 0; i < len; i++) {
          const { oldLine, newLine } = ((): {
            oldLine: ElementContent | undefined;
            newLine: ElementContent | undefined;
          } => {
            let oldLine: ElementContent | undefined = oldLines[oldIndex];
            let newLine: ElementContent | undefined = newLines[newIndex];
            if (unified) {
              if (i < dLen) {
                return { oldLine, newLine: undefined };
              }
              return { oldLine: undefined, newLine };
            }
            if (hunkContent.additions[i] == null) {
              newLine = undefined;
            }
            if (hunkContent.deletions[i] == null) {
              oldLine = undefined;
            }
            if (oldLine == null && newLine == null) {
              throw new Error('YOUR MATH IS OFF, BRUh');
            }
            return { oldLine, newLine };
          })();

          if (unified) {
            if (oldLine != null) {
              unifiedAST.push(oldLine);
              oldIndex++;
              deletionLineNumber++;
            } else if (newLine != null) {
              unifiedAST.push(newLine);
              newIndex++;
              additionLineNumber++;
            }
            const annotationSpan = this.getAnnotations(
              'unified',
              oldLine != null ? deletionLineNumber : undefined,
              newLine != null ? additionLineNumber : undefined,
              hunkIndex,
              lineIndex
            );
            if (annotationSpan != null) {
              unifiedAST.push(createAnnotationElement(annotationSpan));
            }
            lineIndex++;
          } else {
            if (oldLine != null) {
              deletionsAST.push(oldLine);
              oldIndex++;
              deletionLineNumber++;
            } else {
              spanSize++;
            }
            if (newLine != null) {
              additionsAST.push(newLine);
              newIndex++;
              additionLineNumber++;
            } else {
              spanSize++;
            }
            const [deletionSpan, additionSpan] = this.getAnnotations(
              'split',
              oldLine != null ? deletionLineNumber : undefined,
              newLine != null ? additionLineNumber : undefined,
              hunkIndex,
              lineIndex
            );
            if (deletionSpan != null && additionSpan != null) {
              if (spanSize > 0) {
                if (aLen > dLen) {
                  deletionsAST.push(createEmptyRowBuffer(spanSize));
                } else {
                  additionsAST.push(createEmptyRowBuffer(spanSize));
                }
                spanSize = 0;
              }
              deletionsAST.push(createAnnotationElement(deletionSpan));
              additionsAST.push(createAnnotationElement(additionSpan));
            }
            lineIndex++;
          }
        }
        if (!unified) {
          if (spanSize > 0) {
            if (aLen > dLen) {
              deletionsAST.push(createEmptyRowBuffer(spanSize));
            } else {
              additionsAST.push(createEmptyRowBuffer(spanSize));
            }
            spanSize = 0;
          }
        }
      }
    }

    const nextHunk = this.diff?.hunks[hunkIndex + 1];
    const postExpandedRegion = this.expandedHunks.get(hunkIndex + 1);
    // Render expanded content after the change content if necessary
    if (
      ast.hunks == null &&
      expandable &&
      (expandUnchanged ||
        (postExpandedRegion != null && postExpandedRegion.fromStart > 0))
    ) {
      // NOTE(amadeus): There could be some off by one errors here, should
      // probably make sure this is working properly...
      const maxExpansion =
        nextHunk != null ? nextHunk.additionStart - 1 : ast.newLines.length;
      const toExpand =
        Math.min(
          postExpandedRegion != null
            ? additionLineNumber + postExpandedRegion.fromStart
            : maxExpansion,
          maxExpansion
        ) - additionLineNumber;

      for (let i = 0; i < toExpand; i++) {
        const oldLine = ast.oldLines[deletionLineNumber];
        const newLine = ast.newLines[additionLineNumber];
        if (oldLine == null || newLine == null) {
          throw new Error(
            'DiffHunksRenderer.renderHunks: Error rendering post expansion, new or old lines do not exist'
          );
        }
        deletionLineNumber++;
        additionLineNumber++;
        if (unified) {
          unifiedAST.push(newLine);
          const annotationSpan = this.getAnnotations(
            'unified',
            deletionLineNumber,
            additionLineNumber,
            hunkIndex,
            lineIndex
          );
          if (annotationSpan != null) {
            unifiedAST.push(createAnnotationElement(annotationSpan));
          }
        } else {
          deletionsAST.push(oldLine);
          additionsAST.push(newLine);
          const [deletionSpan, additionSpan] = this.getAnnotations(
            'split',
            deletionLineNumber,
            additionLineNumber,
            hunkIndex,
            lineIndex
          );
          if (deletionSpan != null && additionSpan != null) {
            deletionsAST.push(createAnnotationElement(deletionSpan));
            additionsAST.push(createAnnotationElement(additionSpan));
          }
        }
        lineIndex++;
      }
    }

    // Render a final hunk separator if necessary
    if (
      isLastHunk &&
      !expandUnchanged &&
      ast.newLines != null &&
      ast.oldLines != null &&
      ast.newLines.length > 0 &&
      ast.oldLines.length > 0 &&
      (hunkSeparators === 'line-info' || hunkSeparators === 'custom')
    ) {
      const expandedLines =
        this.expandedHunks.get(hunkIndex + 1)?.fromStart ?? 0;
      const fileEnd = ast.newLines.length;
      const hunkEnd = hunk.additionStart + hunk.additionCount - 1;
      const collapsedLines = fileEnd - (hunkEnd + expandedLines);
      if (collapsedLines > 0) {
        const chunked = expandable && fileEnd - hunkEnd > expansionLineCount;
        if (unified) {
          pushHunkSeparator({
            type: 'unified',
            linesAST: unifiedAST,
            hunkIndex: hunkIndex + 1,
            chunked,
            collapsedLines,
            isFirstHunk: false,
            isLastHunk: true,
          });
        } else {
          pushHunkSeparator({
            type: 'deletions',
            linesAST: deletionsAST,
            hunkIndex: hunkIndex + 1,
            collapsedLines,
            chunked,
            isFirstHunk: false,
            isLastHunk: true,
          });
          pushHunkSeparator({
            type: 'additions',
            linesAST: additionsAST,
            hunkIndex: hunkIndex + 1,
            collapsedLines,
            chunked,
            isFirstHunk: false,
            isLastHunk: true,
          });
        }
      }
    }
  }

  renderHeader(
    diff: FileDiffMetadata | undefined,
    highlighter: PJSHighlighter | undefined = this.highlighter
  ): HASTElement | undefined {
    if (diff == null) {
      return undefined;
    }
    if (this.poolManager != null) {
      return this.poolManager.createHeaderElement({
        fileOrDiff: diff,
        theme: this.options.theme,
        themeType: this.options.themeType,
      });
    }
    if (highlighter != null) {
      return createFileHeaderElement({
        fileOrDiff: diff,
        theme: this.options.theme,
        themeType: this.options.themeType,
        highlighter,
      });
    }
    return undefined;
  }

  async asyncRenderHeader(
    diff: FileDiffMetadata | undefined
  ): Promise<HASTElement | undefined> {
    this.highlighter ??= await this.initializeHighlighter();
    return this.renderHeader(diff, this.highlighter);
  }

  applyPreNodeAttributes(
    pre: HTMLPreElement,
    split: boolean,
    totalLines: number
  ): void {
    const { overflow, theme, themeType, disableBackground, diffIndicators } =
      this.getOptionsWithDefaults();
    const options: Omit<SetupWrapperNodesProps, 'highlighter'> = {
      pre,
      theme,
      split,
      wrap: overflow === 'wrap',
      themeType,
      diffIndicators,
      disableBackground,
      totalLines,
    };
    if (this.poolManager != null) {
      this.poolManager.setPreNodeAttributes(options);
    } else if (this.highlighter != null) {
      setWrapperProps({ ...options, highlighter: this.highlighter });
    }
  }

  getAnnotations(
    type: 'unified',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): AnnotationSpan | undefined;
  getAnnotations(
    type: 'split',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): [AnnotationSpan, AnnotationSpan] | [undefined, undefined];
  getAnnotations(
    type: 'unified' | 'split',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ):
    | AnnotationSpan
    | [AnnotationSpan | undefined, AnnotationSpan | undefined]
    | undefined {
    const dAnnotationSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (oldLineNumber != null) {
      for (const anno of this.deletionAnnotations[oldLineNumber] ?? []) {
        dAnnotationSpan.annotations.push(getLineAnnotationName(anno));
      }
    }
    const aAnnotationSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (newLineNumber != null) {
      for (const anno of this.additionAnnotations[newLineNumber] ?? []) {
        (type === 'unified'
          ? dAnnotationSpan
          : aAnnotationSpan
        ).annotations.push(getLineAnnotationName(anno));
      }
    }
    if (type === 'unified') {
      if (dAnnotationSpan.annotations.length > 0) {
        return dAnnotationSpan;
      }
      return undefined;
    }
    if (
      aAnnotationSpan.annotations.length === 0 &&
      dAnnotationSpan.annotations.length === 0
    ) {
      return [undefined, undefined];
    }
    return [dAnnotationSpan, aAnnotationSpan];
  }
}

function getModifiedLinesString(lines: number) {
  return `${lines} unmodified line${lines > 1 ? 's' : ''}`;
}
