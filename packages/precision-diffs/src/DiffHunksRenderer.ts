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
  PrePropertiesConfig,
  RenderedDiffASTCache,
  SupportedLanguages,
  ThemeTypes,
} from './types';
import { createAnnotationElement } from './utils/createAnnotationElement';
import { createEmptyRowBuffer } from './utils/createEmptyRowBuffer';
import { createFileHeaderElement } from './utils/createFileHeaderElement';
import { createNoNewlineElement } from './utils/createNoNewlineElement';
import { createPreElement } from './utils/createPreElement';
import { createSeparator } from './utils/createSeparator';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getHunkSeparatorSlotName } from './utils/getHunkSeparatorSlotName';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import { getThemes } from './utils/getThemes';
import { getTotalLineCountFromHunks } from './utils/getTotalLineCountFromHunks';
import { createHastElement } from './utils/hast_utils';
import { renderDiffWithHighlighter } from './utils/renderDiffWithHighlighter';
import {
  type SetPreNodePropertiesProps,
  setPreNodeProperties,
} from './utils/setWrapperNodeProps';
import type { RenderDiffResult, ShikiPoolManager } from './worker';

const EXPANDED_REGION: ExpansionRegion = {
  fromStart: 0,
  fromEnd: 0,
};

interface PushHunkSeparatorProps {
  type: 'additions' | 'deletions' | 'unified';
  linesAST: ElementContent[];
}

interface RenderRangeProps {
  rangeLen: number;
  fromStart: boolean;
}

interface PushLineWithAnnotation {
  newLine?: ElementContent;
  oldLine?: ElementContent;

  unifiedAST?: ElementContent[];
  deletionsAST?: ElementContent[];
  additionsAST?: ElementContent[];

  unifiedSpan?: AnnotationSpan;
  deletionSpan?: AnnotationSpan;
  additionSpan?: AnnotationSpan;
}

interface RenderCollapsedHunksProps {
  ast: RenderDiffResult;
  hunkData: HunkData[];
  hunkIndex: number;
  hunkSpecs: string | undefined;
  isFirstHunk: boolean;
  isLastHunk: boolean;
  rangeSize: number;

  lineIndex: number;
  additionLineNumber: number;
  deletionLineNumber: number;

  additionsAST: ElementContent[];
  deletionsAST: ElementContent[];
  unifiedAST: ElementContent[];
}

interface RenderHunkProps {
  hunk: Hunk;
  hunkData: HunkData[];
  hunkIndex: number;
  lineIndex: number;
  isLastHunk: boolean;
  prevHunk: Hunk | undefined;

  ast: RenderDiffResult;
  unifiedAST: ElementContent[];
  deletionsAST: ElementContent[];
  additionsAST: ElementContent[];
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
        // TODO(amadeus): Figure out how to only fire this on a per file
        // basis... (maybe the poolManager can figure it out based on file name
        // and file contents probably?)
        if (!this.renderCache.highlighted || this.renderCache.diff !== diff) {
          void this.poolManager
            .renderDiffMetadataToAST(diff, {
              lang,
              theme,
              disableLineNumbers,
              tokenizeMaxLineLength,
            })
            .then((results) => this.handleAsyncHighlight(diff, results));
        }
      } else {
        if (
          this.highlighter != null &&
          (this.renderCache.diff !== diff || !this.renderCache.highlighted)
        ) {
          this.renderCache.ast = this.renderDiffWithHighlighter(
            diff,
            this.highlighter
          );
          this.renderCache.highlighted = true;
        } else if (
          this.renderCache.diff !== diff ||
          !this.renderCache.highlighted
        ) {
          void this.asyncHighlight(diff).then((result) => {
            this.handleAsyncHighlight(diff, result);
          });
        }
      }
      return this.renderCache.ast;
    })();
    this.renderCache.diff = diff;

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
    const {
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      theme,
      themeType,
    } = this.getOptionsWithDefaults();
    const options: Omit<PrePropertiesConfig, 'theme'> = {
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      split,
      themeType,
      totalLines,
    };
    if (this.poolManager != null) {
      return this.poolManager.createPreElement(options);
    }
    if (this.highlighter != null) {
      return createPreElement({
        ...options,
        highlighter: this.highlighter,
        theme,
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
      lineIndex = this.renderHunks({
        ast,
        hunk,
        prevHunk,
        hunkIndex,
        isLastHunk: hunkIndex === fileDiff.hunks.length - 1,
        additionsAST,
        deletionsAST,
        unifiedAST,
        hunkData,
        lineIndex,
      });
      hunkIndex++;
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

  private renderCollapsedHunks({
    ast,
    hunkData,
    hunkIndex,
    hunkSpecs,
    isFirstHunk,
    isLastHunk,
    rangeSize,
    lineIndex,
    additionLineNumber,
    deletionLineNumber,
    unifiedAST,
    deletionsAST,
    additionsAST,
  }: RenderCollapsedHunksProps) {
    const { hunkSeparators, expandUnchanged, diffStyle, expansionLineCount } =
      this.getOptionsWithDefaults();
    const expandable =
      ast.hunks == null && ast.newLines.length > 0 && ast.oldLines.length > 0;
    const expandedRegion = this.expandedHunks.get(hunkIndex) ?? EXPANDED_REGION;
    const chunked = rangeSize > expansionLineCount;
    const collapsedLines = Math.max(
      !expandUnchanged
        ? rangeSize - (expandedRegion.fromEnd + expandedRegion.fromStart)
        : 0,
      0
    );

    const pushHunkSeparator = ({ type, linesAST }: PushHunkSeparatorProps) => {
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
      } else if (hunkSeparators === 'metadata' && hunkSpecs != null) {
        linesAST.push(
          createSeparator({
            type: 'metadata',
            content: hunkSpecs,
            isFirstHunk,
            isLastHunk,
          })
        );
      } else if (hunkSeparators === 'simple' && hunkIndex > 0) {
        linesAST.push(
          createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
        );
      }
    };

    const renderRange = ({ rangeLen, fromStart }: RenderRangeProps) => {
      if (ast.newLines == null || ast.oldLines == null) {
        return;
      }

      const offset = isLastHunk ? 0 : fromStart ? rangeSize : rangeLen;
      let dLineNumber = deletionLineNumber - offset;
      let aLineNumber = additionLineNumber - offset;
      let lIndex = lineIndex - offset;

      for (let i = 0; i < rangeLen; i++) {
        const oldLine = ast.oldLines[dLineNumber];
        const newLine = ast.newLines[aLineNumber];
        if (oldLine == null || newLine == null) {
          console.error({ aLineNumber, dLineNumber, ast });
          throw new Error(
            'DiffHunksRenderer.renderHunks prefill context invalid. Must include data for old and new lines'
          );
        }
        dLineNumber++;
        aLineNumber++;

        if (diffStyle === 'unified') {
          this.pushLineWithAnnotation({
            newLine,
            unifiedAST,
            unifiedSpan: this.getAnnotations(
              'unified',
              dLineNumber,
              aLineNumber,
              hunkIndex,
              lIndex
            ),
          });
        } else {
          this.pushLineWithAnnotation({
            newLine,
            oldLine,
            additionsAST,
            deletionsAST,
            ...this.getAnnotations(
              'split',
              dLineNumber,
              aLineNumber,
              hunkIndex,
              lIndex
            ),
          });
        }
        lIndex++;
      }
    };

    if (expandable) {
      renderRange({
        rangeLen: Math.min(
          collapsedLines === 0 || expandUnchanged
            ? rangeSize
            : expandedRegion.fromStart,
          rangeSize
        ),
        fromStart: true,
      });
    }

    if (collapsedLines > 0) {
      if (diffStyle === 'unified') {
        pushHunkSeparator({ type: 'unified', linesAST: unifiedAST });
      } else {
        pushHunkSeparator({ type: 'deletions', linesAST: deletionsAST });
        pushHunkSeparator({ type: 'additions', linesAST: additionsAST });
      }
    }

    if (collapsedLines > 0 && expandedRegion.fromEnd > 0 && !isLastHunk) {
      renderRange({
        rangeLen: Math.min(expandedRegion.fromEnd, rangeSize),
        fromStart: false,
      });
    }
  }

  private renderHunks({
    hunk,
    hunkData,
    hunkIndex,
    lineIndex,
    isLastHunk,
    prevHunk,
    ast,
    deletionsAST,
    additionsAST,
    unifiedAST,
  }: RenderHunkProps): number {
    const { diffStyle } = this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';
    let additionLineNumber = hunk.additionStart - 1;
    let deletionLineNumber = hunk.deletionStart - 1;

    this.renderCollapsedHunks({
      additionLineNumber,
      additionsAST,
      ast,
      deletionLineNumber,
      deletionsAST,
      hunkData,
      hunkIndex,
      hunkSpecs: hunk.hunkSpecs,
      isFirstHunk: prevHunk == null,
      isLastHunk: false,
      lineIndex,
      rangeSize: hunk.collapsedBefore,
      unifiedAST,
    });

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
    for (const hunkContent of hunk.hunkContent) {
      if (hunkContent.type === 'context') {
        const { length: len } = hunkContent.lines;
        for (let i = 0; i < len; i++) {
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
            this.pushLineWithAnnotation({
              newLine,
              unifiedAST,
              unifiedSpan: this.getAnnotations(
                'unified',
                deletionLineNumber,
                additionLineNumber,
                hunkIndex,
                lineIndex
              ),
            });
          } else {
            if (newLine == null || oldLine == null) {
              throw new Error(
                'DiffHunksRenderer.renderHunks: newLine or oldLine doesnt exist for context...'
              );
            }
            this.pushLineWithAnnotation({
              oldLine,
              newLine,
              deletionsAST,
              additionsAST,
              ...this.getAnnotations(
                'split',
                deletionLineNumber,
                additionLineNumber,
                hunkIndex,
                lineIndex
              ),
            });
          }
          lineIndex++;
        }
        if (hunkContent.noEOFCR) {
          const node = createNoNewlineElement('context');
          if (unified) {
            unifiedAST.push(node);
          } else {
            deletionsAST.push(node);
            additionsAST.push(node);
          }
        }
      } else {
        const { length: dLen } = hunkContent.deletions;
        const { length: aLen } = hunkContent.additions;
        const len = unified ? dLen + aLen : Math.max(dLen, aLen);
        let spanSize = 0;
        for (let i = 0; i < len; i++) {
          const { oldLine, newLine } = (() => {
            let oldLine: ElementContent | undefined = oldLines[oldIndex];
            let newLine: ElementContent | undefined = newLines[newIndex];
            if (unified) {
              if (i < dLen) {
                newLine = undefined;
              } else {
                oldLine = undefined;
              }
            } else {
              if (i >= dLen) {
                oldLine = undefined;
              }
              if (i >= aLen) {
                newLine = undefined;
              }
            }
            if (oldLine == null && newLine == null) {
              console.error({ i, len, ast, hunkContent });
              throw new Error(
                'renderHunks: oldLine and newLine are null, something is wrong'
              );
            }
            return { oldLine, newLine };
          })();

          if (oldLine != null) {
            oldIndex++;
            deletionLineNumber++;
          }
          if (newLine != null) {
            newIndex++;
            additionLineNumber++;
          }

          if (unified) {
            this.pushLineWithAnnotation({
              oldLine,
              newLine,
              unifiedAST,
              unifiedSpan: this.getAnnotations(
                'unified',
                oldLine != null ? deletionLineNumber : undefined,
                newLine != null ? additionLineNumber : undefined,
                hunkIndex,
                lineIndex
              ),
            });
            lineIndex++;
          } else {
            if (oldLine == null || newLine == null) {
              spanSize++;
            }
            const annotationSpans = this.getAnnotations(
              'split',
              oldLine != null ? deletionLineNumber : undefined,
              newLine != null ? additionLineNumber : undefined,
              hunkIndex,
              lineIndex
            );
            if (annotationSpans != null) {
              if (spanSize > 0) {
                if (aLen > dLen) {
                  deletionsAST.push(createEmptyRowBuffer(spanSize));
                } else {
                  additionsAST.push(createEmptyRowBuffer(spanSize));
                }
                spanSize = 0;
              }
            }
            this.pushLineWithAnnotation({
              newLine,
              oldLine,
              deletionsAST,
              additionsAST,
              ...annotationSpans,
            });
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
          if (hunkContent.noEOFCRDeletions) {
            deletionsAST.push(createNoNewlineElement('change-deletion'));
            if (!hunkContent.noEOFCRAdditions) {
              additionsAST.push(createEmptyRowBuffer(1));
            }
          }
          if (hunkContent.noEOFCRAdditions) {
            additionsAST.push(createNoNewlineElement('change-addition'));
            if (!hunkContent.noEOFCRDeletions) {
              deletionsAST.push(createEmptyRowBuffer(1));
            }
          }
        }
      }
    }

    if (isLastHunk && ast.newLines != null) {
      this.renderCollapsedHunks({
        additionLineNumber,
        additionsAST,
        ast,
        deletionLineNumber,
        deletionsAST,
        hunkData,
        hunkIndex: hunkIndex + 1,
        hunkSpecs: undefined,
        isFirstHunk: false,
        isLastHunk: true,
        lineIndex,
        rangeSize:
          ast.newLines.length - (hunk.additionStart + hunk.additionCount - 1),
        unifiedAST,
      });
    }
    return lineIndex;
  }

  private pushLineWithAnnotation({
    newLine,
    oldLine,
    unifiedAST,
    additionsAST,
    deletionsAST,
    unifiedSpan,
    deletionSpan,
    additionSpan,
  }: PushLineWithAnnotation) {
    if (unifiedAST != null) {
      if (oldLine != null) {
        unifiedAST.push(oldLine);
      } else if (newLine != null) {
        unifiedAST.push(newLine);
      }
      if (unifiedSpan != null) {
        unifiedAST.push(createAnnotationElement(unifiedSpan));
      }
    } else if (deletionsAST != null && additionsAST != null) {
      if (oldLine != null) {
        deletionsAST.push(oldLine);
      }
      if (newLine != null) {
        additionsAST.push(newLine);
      }
      if (deletionSpan != null) {
        deletionsAST.push(createAnnotationElement(deletionSpan));
      }
      if (additionSpan != null) {
        additionsAST.push(createAnnotationElement(additionSpan));
      }
    }
  }

  private getAnnotations(
    type: 'unified',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): AnnotationSpan | undefined;
  private getAnnotations(
    type: 'split',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ): { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan } | undefined;
  private getAnnotations(
    type: 'unified' | 'split',
    oldLineNumber: number | undefined,
    newLineNumber: number | undefined,
    hunkIndex: number,
    lineIndex: number
  ):
    | AnnotationSpan
    | { deletionSpan: AnnotationSpan; additionSpan: AnnotationSpan }
    | undefined {
    const deletionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (oldLineNumber != null) {
      for (const anno of this.deletionAnnotations[oldLineNumber] ?? []) {
        deletionSpan.annotations.push(getLineAnnotationName(anno));
      }
    }
    const additionSpan: AnnotationSpan = {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: [],
    };
    if (newLineNumber != null) {
      for (const anno of this.additionAnnotations[newLineNumber] ?? []) {
        (type === 'unified' ? deletionSpan : additionSpan).annotations.push(
          getLineAnnotationName(anno)
        );
      }
    }
    if (type === 'unified') {
      if (deletionSpan.annotations.length > 0) {
        return deletionSpan;
      }
      return undefined;
    }
    if (
      additionSpan.annotations.length === 0 &&
      deletionSpan.annotations.length === 0
    ) {
      return undefined;
    }
    return { deletionSpan, additionSpan };
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
    const {
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      theme,
      themeType,
    } = this.getOptionsWithDefaults();
    const options: Omit<SetPreNodePropertiesProps, 'highlighter'> = {
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      pre,
      split,
      theme,
      themeType,
      totalLines,
    };
    if (this.poolManager != null) {
      this.poolManager.setPreNodeAttributes(options);
    } else if (this.highlighter != null) {
      setPreNodeProperties({ ...options, highlighter: this.highlighter });
    }
  }
}

function getModifiedLinesString(lines: number) {
  return `${lines} unmodified line${lines > 1 ? 's' : ''}`;
}
