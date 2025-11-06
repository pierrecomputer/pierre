import type { Element, ElementContent, Root, RootContent } from 'hast';
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
  ChangeHunk,
  CodeToHastOptions,
  DecorationItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  Hunk,
  HunkData,
  HunkLineType,
  LineInfo,
  PJSHighlighter,
  PJSThemeNames,
  SharedRenderState,
  ShikiTransformer,
  SupportedLanguages,
  ThemeTypes,
} from './types';
import { createMirroredAnnotationSpan } from './utils/createMirroredAnnotationSpan';
import { createSingleAnnotationSpan } from './utils/createSingleAnnotationSpan';
import { createTransformerWithState } from './utils/createTransformerWithState';
import { formatCSSVariablePrefix } from './utils/formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHighlighterOptions } from './utils/getHighlighterOptions';
import { getHunkSeparatorSlotName } from './utils/getHunkSeparatorSlotName';
import { getThemes } from './utils/getThemes';
import { getTotalLineCountFromHunks } from './utils/getTotalLineCountFromHunks';
import {
  createHastElement,
  createPreWrapperProperties,
  createSeparator,
} from './utils/hast_utils';
import { parseDecorations } from './utils/parseDiffDecorations';
import { parseLineType } from './utils/parseLineType';
import { pushOrMergeSpan } from './utils/pushOrMergeSpan';

interface RenderHunkProps {
  hunk: Hunk;
  prevHunk: Hunk | undefined;
  isLastHunk: boolean;
  isFirstHunk: boolean;
  hunkIndex: number;
  highlighter: PJSHighlighter;
  state: SharedRenderState;
  transformers: ShikiTransformer[];
  additionsAST: ElementContent[];
  deletionsAST: ElementContent[];
  unifiedAST: ElementContent[];
  hunkData: HunkData[];
}

interface UnresolvedAnnotationSpan {
  type: 'addition' | 'deletion';
  hunkIndex: number;
  span: AnnotationSpan;
}

interface ComputedContent {
  content: string[];
  lineInfo: Record<number, LineInfo | undefined>;
  decorations: DecorationItem[];
}

interface ProcessLinesReturn {
  hasLongLines: boolean;
  additions: ComputedContent;
  deletions: ComputedContent;
  unified: ComputedContent;
}

type OptionsWithDefaults = Required<
  Omit<BaseDiffOptions, 'lang' | 'preferWasmHighlighter'>
>;

export interface HunksRenderResult {
  additionsAST: ElementContent[] | undefined;
  deletionsAST: ElementContent[] | undefined;
  unifiedAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: Element;
  totalLines: number;
}

export class DiffHunksRenderer<LAnnotation = undefined> {
  private highlighter: PJSHighlighter | undefined;
  private options: BaseDiffOptions;
  private diff: FileDiffMetadata | undefined;

  private expandedHunks = new Set<number>();

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};

  private queuedDiff: FileDiffMetadata | undefined;
  private queuedRender: Promise<HunksRenderResult | undefined> | undefined;
  private computedLang: SupportedLanguages = 'text';

  constructor(options: BaseDiffOptions = { theme: DEFAULT_THEMES }) {
    this.options = options;
  }

  cleanUp(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.queuedDiff = undefined;
    this.queuedRender = undefined;
  }

  setOptions(options: BaseDiffOptions): void {
    this.options = options;
  }

  expandHunk(index: number): void {
    this.expandedHunks.add(index);
  }

  private isHunkExpanded(index: number): boolean {
    return (
      this.getOptionsWithDefaults().expandUnchanged ||
      this.expandedHunks.has(index)
    );
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
      hunkSeparators = 'line-info',
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      maxLineLengthForHighlighting = 1000,
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
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      maxLineLengthForHighlighting,
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

  async render(diff: FileDiffMetadata): Promise<HunksRenderResult | undefined> {
    this.queuedDiff = diff;
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      this.computedLang =
        this.options.lang ?? getFiletypeFromFileName(diff.name);
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
      if (this.queuedDiff == null) {
        // If we get in here, it's likely we called cleanup and therefore we
        // should just return early with empty result
        return undefined;
      }
      return this.renderDiff(this.queuedDiff, this.highlighter);
    })();
    const result = await this.queuedRender;
    this.queuedDiff = undefined;
    this.queuedRender = undefined;
    return result;
  }

  private renderDiff(
    fileDiff: FileDiffMetadata,
    highlighter: PJSHighlighter
  ): HunksRenderResult {
    const {
      disableLineNumbers,
      diffStyle,
      overflow,
      themeType,
      disableBackground,
      diffIndicators,
      expandUnchanged,
      useCSSClasses,
      theme,
    } = this.getOptionsWithDefaults();

    this.diff = fileDiff;
    const additionsAST: ElementContent[] = [];
    const deletionsAST: ElementContent[] = [];
    const unifiedAST: ElementContent[] = [];
    const { state, transformers, toClass } = createTransformerWithState({
      disableLineNumbers: disableLineNumbers,
      useCSSClasses,
    });
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
            additionCount: 0,
            additionStart: lineCount,
            deletedCount: 0,
            deletedStart: lineCount,
            hunkContent: [],
            hunkContext: undefined,
            hunkSpecs: undefined,
          },
        ];
      }
      return [];
    })();
    for (const hunk of hunks) {
      this.renderHunks({
        hunk,
        prevHunk,
        hunkIndex,
        highlighter,
        state,
        transformers,
        isFirstHunk: hunkIndex === 0,
        isLastHunk: hunkIndex === fileDiff.hunks.length - 1,
        additionsAST,
        deletionsAST,
        unifiedAST,
        hunkData,
      });
      hunkIndex++;
      prevHunk = hunk;
    }

    const totalLines = Math.max(
      getTotalLineCountFromHunks(fileDiff.hunks),
      fileDiff.newLines?.length ?? 0,
      fileDiff.oldLines?.length ?? 0
    );

    return {
      additionsAST: additionsAST.length > 0 ? additionsAST : undefined,
      deletionsAST: deletionsAST.length > 0 ? deletionsAST : undefined,
      unifiedAST: unifiedAST.length > 0 ? unifiedAST : undefined,
      hunkData,
      css: toClass.getCSS(),
      preNode: createHastElement({
        tagName: 'pre',
        properties: createPreWrapperProperties({
          diffIndicators,
          disableBackground,
          highlighter,
          overflow,
          split:
            diffStyle === 'unified'
              ? false
              : additionsAST.length > 0 && additionsAST.length > 0,
          theme,
          themeType,
          totalLines,
        }),
      }),
      totalLines,
    };
  }

  renderFullAST(
    result: HunksRenderResult,
    children: ElementContent[] = []
  ): Element {
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

  private createHastOptions(
    transformers: ShikiTransformer[],
    decorations?: DecorationItem[],
    forceTextLang: boolean = false
  ): CodeToHastOptions<PJSThemeNames> {
    const { theme } = this.getOptionsWithDefaults();
    if (typeof theme === 'string') {
      return {
        theme,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: forceTextLang ? 'text' : this.computedLang,
        defaultColor: false,
        transformers,
        decorations,
      };
    }
    return {
      themes: theme,
      cssVariablePrefix: formatCSSVariablePrefix(),
      lang: forceTextLang ? 'text' : this.computedLang,
      defaultColor: false,
      transformers,
      decorations,
    };
  }

  private renderHunks({
    hunk,
    hunkIndex,
    highlighter,
    state,
    transformers,
    prevHunk,
    isFirstHunk,
    isLastHunk,
    additionsAST,
    deletionsAST,
    unifiedAST,
    hunkData,
  }: RenderHunkProps) {
    if (hunk.hunkContent == null) {
      return;
    }

    const { hunkSeparators } = this.getOptionsWithDefaults();
    const { additions, deletions, unified, hasLongLines } = this.processLines(
      hunk,
      hunkIndex,
      prevHunk,
      isLastHunk
    );
    const expandable = this.diff?.newLines != null;

    const generateLinesAST = (
      type: 'additions' | 'deletions' | 'unified',
      computed: ComputedContent,
      linesAST: ElementContent[]
    ) => {
      // Remove trailing blank line
      const content = computed.content.join('').replace(/\n$/, '');
      state.lineInfo = computed.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(transformers, computed.decorations, hasLongLines)
      );
      if (!this.isHunkExpanded(hunkIndex)) {
        if (hunkSeparators === 'line-info' || hunkSeparators === 'custom') {
          const lines = (() => {
            const hunkStart = hunk.additionStart;
            if (prevHunk == null) {
              return hunkStart - 1;
            }
            return (
              hunkStart - (prevHunk.additionStart + prevHunk.additionCount)
            );
          })();
          if (lines > 0) {
            const slotName = getHunkSeparatorSlotName(type, hunkIndex);
            linesAST.push(
              createSeparator({
                type: hunkSeparators,
                content: getModifiedLinesString(lines),
                expandIndex: expandable ? hunkIndex : undefined,
                slotName,
                isFirstHunk,
                isLastHunk: false,
              })
            );
            hunkData.push({ slotName, lines, type, expandable });
          }
        } else if (hunkSeparators === 'metadata' && hunk.hunkSpecs != null) {
          linesAST.push(
            createSeparator({
              type: 'metadata',
              content: hunk.hunkSpecs,
              isFirstHunk,
              isLastHunk: false,
            })
          );
        } else if (hunkSeparators === 'simple' && hunkIndex > 0) {
          linesAST.push(
            createSeparator({ type: 'simple', isFirstHunk, isLastHunk: false })
          );
        }
      }
      for (const line of getLineNodes(nodes)) {
        linesAST.push(line);
      }
      if (
        isLastHunk &&
        !this.isHunkExpanded(hunkIndex + 1) &&
        this.diff?.newLines != null &&
        (hunkSeparators === 'line-info' || hunkSeparators === 'custom')
      ) {
        const lines =
          this.diff.newLines.length -
          (hunk.additionStart + hunk.additionCount - 1);
        if (lines > 0) {
          const slotName = getHunkSeparatorSlotName(type, hunkIndex + 1);
          linesAST.push(
            createSeparator({
              type: hunkSeparators,
              content: getModifiedLinesString(lines),
              expandIndex: expandable ? hunkIndex + 1 : undefined,
              slotName,
              isFirstHunk: false,
              isLastHunk,
            })
          );
          hunkData.push({ slotName, lines, type, expandable });
        }
      }
    };

    if (unified.content.length > 0) {
      generateLinesAST('unified', unified, unifiedAST);
    }

    if (deletions.content.length > 0) {
      generateLinesAST('deletions', deletions, deletionsAST);
    }

    if (additions.content.length > 0) {
      generateLinesAST('additions', additions, additionsAST);
    }
  }

  private processLines(
    hunk: Hunk,
    hunkIndex: number,
    prevHunk: Hunk | undefined,
    isLastHunk: boolean
  ): ProcessLinesReturn {
    const {
      maxLineLengthForHighlighting,
      diffStyle,
      expandUnchanged,
      lineDiffType,
      maxLineDiffLength,
    } = this.getOptionsWithDefaults();
    const { deletionAnnotations, additionAnnotations } = this;
    // NOTE(amadeus): We will probably need to rectify this
    // for full additions/deletions
    const unified = diffStyle === 'unified';
    let hasLongLines = false;

    const additionContent: string[] = [];
    const additionLineInfo: Record<number, LineInfo | undefined> = {};
    let additionLineNumber = hunk.additionStart - 1;

    const deletionContent: string[] = [];
    const deletionLineInfo: Record<number, LineInfo | undefined> = {};
    let deletionLineNumber = hunk.deletedStart - 1;

    const unifiedContent: string[] = [];
    const unifiedLineInfo: Record<number, LineInfo | undefined> = {};

    const diffGroups: ChangeHunk[] = [];
    const unresolvedSpans: UnresolvedAnnotationSpan[] = [];
    let currentChangeGroup: ChangeHunk | undefined;

    function resolveUnresolvedSpans() {
      if (currentChangeGroup == null) {
        if (unresolvedSpans.length > 0) {
          console.error(
            'DiffHunksRenderer.processLines: resolveUnresolvedSpans: In a weird state...',
            unresolvedSpans
          );
        }
        return;
      }
      for (const unresolvedSpan of unresolvedSpans) {
        const deletionIndex =
          currentChangeGroup.deletionStartIndex + unresolvedSpan.hunkIndex;
        const additionIndex =
          currentChangeGroup.additionStartIndex + unresolvedSpan.hunkIndex;
        const resolvedSpan: AnnotationSpan = {
          type: 'annotation',
          hunkIndex,
          lineIndex: unresolvedSpan.span.lineIndex,
          annotations: [],
        };
        if (unresolvedSpan.type === 'addition') {
          pushOrMergeSpan(
            resolvedSpan,
            Math.min(
              deletionIndex,
              currentChangeGroup.deletionStartIndex +
                currentChangeGroup.deletionLines.length
            ),
            deletionLineInfo
          );
        } else {
          pushOrMergeSpan(
            resolvedSpan,
            Math.min(
              additionIndex,
              currentChangeGroup.additionStartIndex +
                currentChangeGroup.additionLines.length
            ),
            additionLineInfo
          );
        }
      }
      unresolvedSpans.length = 0;
    }

    function addToChangeGroup(
      type: 'addition' | 'deletion',
      line: string,
      span?: AnnotationSpan
    ): ChangeHunk {
      if (currentChangeGroup == null) {
        currentChangeGroup = {
          // In unified layout, deletionLineIndex and additionLineIndex won't
          // be usable, and we will have to compute start indexes as we are
          // iterating
          deletionStartIndex: unified ? -1 : deletionContent.length,
          additionStartIndex: unified ? -1 : additionContent.length,
          deletionLines: [],
          additionLines: [],
          diffGroupStartIndex: lineIndex,
        };
        diffGroups.push(currentChangeGroup);
      }

      if (unified) {
        if (
          type === 'deletion' &&
          currentChangeGroup.deletionStartIndex === -1
        ) {
          currentChangeGroup.deletionStartIndex = unifiedContent.length;
        }
        if (
          type === 'addition' &&
          currentChangeGroup.additionStartIndex === -1
        ) {
          currentChangeGroup.additionStartIndex = unifiedContent.length;
        }
      }
      if (type === 'addition') {
        currentChangeGroup.additionLines.push(line);
      } else {
        currentChangeGroup.deletionLines.push(line);
      }

      if (span != null && !unified) {
        unresolvedSpans.push({
          type,
          hunkIndex:
            type === 'deletion'
              ? currentChangeGroup.deletionLines.length
              : currentChangeGroup.additionLines.length,
          span,
        });
      }
      return currentChangeGroup;
    }

    function createGapSpanIfNecessary() {
      if (
        !unified &&
        lastType !== 'context' &&
        lastType != null &&
        currentChangeGroup != null
      ) {
        const additionGroupSize = currentChangeGroup.additionLines.length;
        const deletionGroupSize = currentChangeGroup.deletionLines.length;
        if (additionGroupSize > deletionGroupSize) {
          pushOrMergeSpan(
            { type: 'gap', rows: additionGroupSize - deletionGroupSize },
            deletionContent.length,
            deletionLineInfo
          );
        } else if (deletionGroupSize > additionGroupSize) {
          pushOrMergeSpan(
            { type: 'gap', rows: deletionGroupSize - additionGroupSize },
            additionContent.length,
            additionLineInfo
          );
        }
      }
      resolveUnresolvedSpans();
    }

    const processRawLine = (
      line: string,
      type: HunkLineType,
      isExpandedContext: boolean = false
    ) => {
      lineIndex++;
      if (type === 'context') {
        createGapSpanIfNecessary();
      }
      if (type === 'context') {
        if (currentChangeGroup != null) {
          lineIndex =
            currentChangeGroup.diffGroupStartIndex +
            Math.max(
              currentChangeGroup.additionLines.length,
              currentChangeGroup.deletionLines.length
            );
        }
        currentChangeGroup = undefined;
        if (unified) {
          unifiedContent.push(line);
          unifiedLineInfo[unifiedContent.length] = {
            type: isExpandedContext ? 'context-expanded' : 'context',
            lineNumber: additionLineNumber + 1,
            lineIndex,
          };
          const span = createMirroredAnnotationSpan({
            deletionLineNumber: deletionLineNumber + 1,
            additionLineNumber: additionLineNumber + 1,
            hunkIndex,
            lineIndex: unifiedContent.length,
            deletionAnnotations,
            additionAnnotations,
            unified: true,
          });
          pushOrMergeSpan(span, unifiedContent.length, unifiedLineInfo);
        } else {
          deletionContent.push(line);
          additionContent.push(line);
          deletionLineInfo[deletionContent.length] = {
            type: isExpandedContext ? 'context-expanded' : 'context',
            lineNumber: deletionLineNumber + 1,
            lineIndex,
          };
          additionLineInfo[additionContent.length] = {
            type: isExpandedContext ? 'context-expanded' : 'context',
            lineNumber: additionLineNumber + 1,
            lineIndex,
          };
          const [deletionSpan, additionSpan] = createMirroredAnnotationSpan({
            deletionLineNumber: deletionLineNumber + 1,
            additionLineNumber: additionLineNumber + 1,
            hunkIndex,
            lineIndex,
            deletionAnnotations,
            additionAnnotations,
            unified: false,
          });
          pushOrMergeSpan(
            deletionSpan,
            deletionContent.length,
            deletionLineInfo
          );
          pushOrMergeSpan(
            additionSpan,
            additionContent.length,
            additionLineInfo
          );
        }
        additionLineNumber++;
        deletionLineNumber++;
      }
      // TODO(amadeus): Metadata shouldn't render it's own line, as that could
      // theoretically mess with code output... we should stuff it into the
      // appropriate line info
      else if (type === 'metadata') {
        const lineInfo: LineInfo = {
          type:
            lastType === 'addition'
              ? 'change-addition'
              : lastType === 'deletion'
                ? 'change-deletion'
                : 'context',
          // NOTE(amadeus): Metadata lines do not have line numbers associated
          // with them
          lineNumber: -1,
          lineIndex: -1,
          metadataContent: line.trim(),
        };
        // Push a filler blank line so we have something to render
        if (unified) {
          unifiedContent.push('\n');
          unifiedLineInfo[unifiedContent.length] = lineInfo;
        } else {
          if (lastType === 'context' || lastType === 'deletion') {
            deletionContent.push('\n');
            deletionLineInfo[deletionContent.length] = lineInfo;
            addToChangeGroup('deletion', '\n');
          }
          if (lastType === 'context' || lastType === 'addition') {
            additionContent.push('\n');
            additionLineInfo[additionContent.length] = lineInfo;
            addToChangeGroup('addition', '\n');
          }
        }
      } else if (type === 'deletion') {
        const { content, lineInfo } = (() =>
          unified
            ? { content: unifiedContent, lineInfo: unifiedLineInfo }
            : { content: deletionContent, lineInfo: deletionLineInfo })();
        const span = createSingleAnnotationSpan({
          rowNumber: deletionLineNumber + 1,
          hunkIndex,
          lineIndex,
          annotationMap: this.deletionAnnotations,
        });
        addToChangeGroup('deletion', line, span);
        content.push(line);
        lineInfo[content.length] = {
          type: 'change-deletion',
          lineNumber: deletionLineNumber + 1,
          lineIndex,
        };
        pushOrMergeSpan(span, content.length, lineInfo);
        deletionLineNumber++;
      } else if (type === 'addition') {
        // Reset diffLineIndex back to start if we are jumping columns
        if (lastType === 'deletion' && !unified) {
          lineIndex = currentChangeGroup?.diffGroupStartIndex ?? lineIndex;
        }
        const { content, lineInfo } = (() =>
          unified
            ? { content: unifiedContent, lineInfo: unifiedLineInfo }
            : { content: additionContent, lineInfo: additionLineInfo })();
        const span = createSingleAnnotationSpan({
          rowNumber: additionLineNumber + 1,
          hunkIndex,
          lineIndex,
          annotationMap: this.additionAnnotations,
        });
        addToChangeGroup('addition', line, span);
        content.push(line);
        lineInfo[content.length] = {
          type: 'change-addition',
          lineNumber: additionLineNumber + 1,
          lineIndex,
        };
        pushOrMergeSpan(span, content.length, lineInfo);
        additionLineNumber++;
      }

      lastType = type;
    };

    let lineIndex = -1;
    let lastType: HunkLineType | undefined;

    // Proses hunk expanded content if expanded
    if (this.isHunkExpanded(hunkIndex) && this.diff?.newLines != null) {
      const { expandAddedStart, expandDeletedStart } = (() => {
        if (prevHunk != null) {
          return {
            expandAddedStart:
              prevHunk.additionStart + prevHunk.additionCount - 1,
            expandDeletedStart:
              prevHunk.deletedStart + prevHunk.deletedCount - 1,
          };
        }
        return { expandAddedStart: 0, expandDeletedStart: 0 };
      })();
      if (additionLineNumber - expandAddedStart > 0) {
        additionLineNumber = expandAddedStart;
        deletionLineNumber = expandDeletedStart;
        for (let i = additionLineNumber; i < hunk.additionStart - 1; i++) {
          const line = this.diff.newLines[i];
          hasLongLines =
            hasLongLines || line.length > maxLineLengthForHighlighting;
          processRawLine(line, 'context', expandUnchanged ? false : true);
        }
      }
    }

    // Process diff content
    for (const rawLine of hunk.hunkContent ?? []) {
      const { line, type, longLine } = parseLineType(
        rawLine,
        maxLineLengthForHighlighting
      );
      hasLongLines = hasLongLines || longLine;
      processRawLine(line, type);
    }
    createGapSpanIfNecessary();

    // Process final expansion hunk if necessary
    if (
      isLastHunk &&
      this.isHunkExpanded(hunkIndex + 1) &&
      this.diff?.newLines != null
    ) {
      for (let i = additionLineNumber; i < this.diff.newLines.length; i++) {
        const line = this.diff.newLines[i];
        hasLongLines =
          hasLongLines || line.length > maxLineLengthForHighlighting;
        processRawLine(line, 'context', expandUnchanged ? false : true);
      }
    }
    resolveUnresolvedSpans();

    const { unifiedDecorations, deletionDecorations, additionDecorations } =
      parseDecorations({
        diffGroups,
        lineDiffType,
        diffStyle,
        maxLineDiffLength,
      });
    return {
      hasLongLines,
      additions: {
        content: additionContent,
        lineInfo: additionLineInfo,
        decorations: additionDecorations,
      },
      deletions: {
        content: deletionContent,
        lineInfo: deletionLineInfo,
        decorations: deletionDecorations,
      },
      unified: {
        content: unifiedContent,
        lineInfo: unifiedLineInfo,
        decorations: unifiedDecorations,
      },
    };
  }
}

function getLineNodes(nodes: Root): ElementContent[] {
  let firstChild: RootContent | Element | Root | null = nodes.children[0];
  while (firstChild != null) {
    if (firstChild.type === 'element' && firstChild.tagName === 'code') {
      return firstChild.children;
    }
    if ('children' in firstChild) {
      firstChild = firstChild.children[0];
    } else {
      firstChild = null;
    }
  }
  console.error(nodes);
  throw new Error(
    'DiffHunksRenderer.getNodesToRender: Unable to find children'
  );
}

function getModifiedLinesString(lines: number) {
  return `${lines} unmodified line${lines > 1 ? 's' : ''}`;
}
