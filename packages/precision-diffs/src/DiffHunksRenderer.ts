import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  getSharedHighlighter,
  hasLoadedLanguage,
  hasLoadedThemes,
} from './SharedHighlighter';
import type {
  AnnotationSpan,
  BaseDiffProps,
  CodeToHastOptions,
  DecorationItem,
  DiffLineAnnotation,
  FileDiffMetadata,
  Hunk,
  HunkData,
  HunkLineType,
  LineInfo,
  LineSpans,
  PJSHighlighter,
  PJSThemeNames,
  SharedRenderState,
  ShikiTransformer,
  SupportedLanguages,
  ThemeRendererOptions,
  ThemeTypes,
  ThemesRendererOptions,
} from './types';
import { createTransformerWithState } from './utils/createTransformerWithState';
import { formatCSSVariablePrefix } from './utils/formatCSSVariablePrefix';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import { getHunkSeparatorSlotName } from './utils/getHunkSeparatorSlotName';
import { getLineAnnotationName } from './utils/getLineAnnotationName';
import {
  createHastElement,
  createPreWrapperProperties,
  createSeparator,
} from './utils/hast_utils';
import { parseLineType } from './utils/parseLineType';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  DiffLineAnnotation<LAnnotation>[] | undefined
>;

interface ChangeHunk {
  diffGroupStartIndex: number;
  deletionStartIndex: number;
  additionStartIndex: number;
  deletionLines: string[];
  additionLines: string[];
}

interface RenderHunkProps {
  hunk: Hunk;
  prevHunk: Hunk | undefined;
  isLastHunk: boolean;
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

interface DiffHunkRendererThemeOptions
  extends BaseDiffProps,
    ThemeRendererOptions {}

interface DiffHunkRendererThemesOptions
  extends BaseDiffProps,
    ThemesRendererOptions {}

export type DiffHunksRendererOptions =
  | DiffHunkRendererThemeOptions
  | DiffHunkRendererThemesOptions;

type OptionsWithDefaults =
  | Required<Omit<DiffHunkRendererThemeOptions, 'theme'>>
  | Required<Omit<DiffHunkRendererThemesOptions, 'themes'>>;

export interface HunksRenderResult {
  additionsAST: ElementContent[] | undefined;
  deletionsAST: ElementContent[] | undefined;
  unifiedAST: ElementContent[] | undefined;
  hunkData: HunkData[];
  css: string;
  preNode: Element;
}

export class DiffHunksRenderer<LAnnotation = undefined> {
  highlighter: PJSHighlighter | undefined;
  options: DiffHunksRendererOptions;
  diff: FileDiffMetadata | undefined;
  expandedHunks: Set<number> = new Set();

  constructor(
    options: DiffHunksRendererOptions = {
      themes: { dark: 'pierre-dark', light: 'pierre-light' },
    }
  ) {
    this.options = options;
  }

  cleanUp(): void {
    this.highlighter = undefined;
    this.diff = undefined;
    this.queuedDiff = undefined;
    this.queuedRender = undefined;
  }

  setOptions(options: DiffHunksRendererOptions): void {
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

  private mergeOptions(options: Partial<DiffHunksRendererOptions>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes): void {
    if (this.getOptionsWithDefaults().themeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
  }

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};
  setLineAnnotations(lineAnnotations: DiffLineAnnotation<LAnnotation>[]): void {
    this.additionAnnotations = {};
    this.deletionAnnotations = {};
    for (const annotation of lineAnnotations) {
      const map = (() => {
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
      diffStyle = 'split',
      diffIndicators = 'bars',
      expandUnchanged = false,
      disableBackground = false,
      disableLineNumbers = false,
      hunkSeparators = 'line-info',
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      maxLineLengthForHighlighting = 1000,
      overflow = 'scroll',
      theme,
      themeType = 'system',
      themes,
    } = this.options;
    if (themes != null) {
      return {
        diffIndicators,
        diffStyle,
        expandUnchanged,
        disableBackground,
        disableLineNumbers,
        hunkSeparators,
        lineDiffType,
        maxLineDiffLength,
        maxLineLengthForHighlighting,
        overflow,
        themeType,
        themes,
      } as Required<Omit<DiffHunkRendererThemeOptions, 'theme'>>;
    }
    return {
      diffIndicators,
      diffStyle,
      expandUnchanged,
      disableBackground,
      disableLineNumbers,
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      maxLineLengthForHighlighting,
      overflow,
      themeType,
      theme,
    } as Required<Omit<DiffHunkRendererThemesOptions, 'themes'>>;
  }

  async initializeHighlighter(): Promise<PJSHighlighter> {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedDiff: FileDiffMetadata | undefined;
  private queuedRender: Promise<HunksRenderResult | undefined> | undefined;
  private computedLang: SupportedLanguages = 'text';
  async render(
    diff: FileDiffMetadata,
    shouldUseClasses: boolean = false
  ): Promise<HunksRenderResult | undefined> {
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
        !hasLoadedThemes(this.getThemes())
      ) {
        this.highlighter = undefined;
      }

      this.highlighter ??= await this.initializeHighlighter();
      if (this.queuedDiff == null) {
        // If we get in here, it's likely we called cleanup and therefore we
        // should just return early with empty result
        return undefined;
      }
      return this.renderDiff(
        this.queuedDiff,
        this.highlighter,
        shouldUseClasses
      );
    })();
    const result = await this.queuedRender;
    this.queuedDiff = undefined;
    this.queuedRender = undefined;
    return result;
  }

  private renderDiff(
    fileDiff: FileDiffMetadata,
    highlighter: PJSHighlighter,
    useCSSClasses: boolean = false
  ): HunksRenderResult {
    const options = this.getOptionsWithDefaults();
    const {
      disableLineNumbers,
      diffStyle,
      overflow,
      themeType,
      disableBackground,
      diffIndicators,
      expandUnchanged,
    } = options;

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
        isLastHunk: hunkIndex === fileDiff.hunks.length - 1,
        additionsAST,
        deletionsAST,
        unifiedAST,
        hunkData,
      });
      hunkIndex++;
      prevHunk = hunk;
    }

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
          theme: 'theme' in options ? options.theme : undefined,
          themeType,
          themes: 'themes' in options ? options.themes : undefined,
        }),
      }),
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
    if (this.options.theme != null) {
      return {
        theme: this.options.theme,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: forceTextLang ? 'text' : this.computedLang,
        defaultColor: false,
        transformers,
        decorations,
      };
    }
    return {
      themes: this.options.themes,
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
              })
            );
            hunkData.push({ slotName, lines, type, expandable });
          }
        } else if (hunkSeparators === 'metadata' && hunk.hunkSpecs != null) {
          linesAST.push(
            createSeparator({ type: 'metadata', content: hunk.hunkSpecs })
          );
        } else if (hunkSeparators === 'simple' && hunkIndex > 0) {
          linesAST.push(createSeparator({ type: 'simple' }));
        }
      }
      for (const line of this.getLineNodes(nodes)) {
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
    const { maxLineLengthForHighlighting, diffStyle, expandUnchanged } =
      this.getOptionsWithDefaults();
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
      span: AnnotationSpan | undefined
    ) {
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
          }
          if (lastType === 'context' || lastType === 'addition') {
            additionContent.push('\n');
            additionLineInfo[additionContent.length] = lineInfo;
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
      this.parseDecorations(diffGroups);
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

  private parseDecorations(
    diffGroups: ChangeHunk[],
    disableDecorations = false
  ) {
    const { lineDiffType, maxLineDiffLength, diffStyle } =
      this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';
    const unifiedDecorations: DecorationItem[] = [];
    const additionDecorations: DecorationItem[] = [];
    const deletionDecorations: DecorationItem[] = [];
    if (disableDecorations || lineDiffType === 'none') {
      return { unifiedDecorations, deletionDecorations, additionDecorations };
    }
    for (const group of diffGroups) {
      const len = Math.min(
        group.additionLines.length,
        group.deletionLines.length
      );
      for (let i = 0; i < len; i++) {
        const deletionLine = group.deletionLines[i];
        const additionLine = group.additionLines[i];
        if (deletionLine == null || additionLine == null) {
          break;
        }
        // Lets skep running diffs on super long lines because it's probably
        // expensive and hard to follow
        if (
          deletionLine.length > maxLineDiffLength ||
          additionLine.length > maxLineDiffLength
        ) {
          continue;
        }
        const lineDiff =
          lineDiffType === 'char'
            ? diffChars(deletionLine, additionLine)
            : diffWordsWithSpace(deletionLine, additionLine);
        const deletionSpans: [0 | 1, string][] = [];
        const additionSpans: [0 | 1, string][] = [];
        const enableJoin = lineDiffType === 'word-alt';
        for (const item of lineDiff) {
          if (!item.added && !item.removed) {
            pushOrJoinSpan({
              item,
              arr: deletionSpans,
              enableJoin,
              isNeutral: true,
            });
            pushOrJoinSpan({
              item,
              arr: additionSpans,
              enableJoin,
              isNeutral: true,
            });
          } else if (item.removed) {
            pushOrJoinSpan({ item, arr: deletionSpans, enableJoin });
          } else {
            pushOrJoinSpan({ item, arr: additionSpans, enableJoin });
          }
        }
        let spanIndex = 0;
        for (const span of additionSpans) {
          if (span[0] === 1) {
            (unified ? unifiedDecorations : additionDecorations).push(
              createDiffSpanDecoration({
                line: group.additionStartIndex + i,
                spanStart: spanIndex,
                spanLength: span[1].length,
              })
            );
          }
          spanIndex += span[1].length;
        }
        spanIndex = 0;
        for (const span of deletionSpans) {
          if (span[0] === 1) {
            (unified ? unifiedDecorations : deletionDecorations).push(
              createDiffSpanDecoration({
                line: group.deletionStartIndex + i,
                spanStart: spanIndex,
                spanLength: span[1].length,
              })
            );
          }
          spanIndex += span[1].length;
        }
      }
    }
    return { unifiedDecorations, deletionDecorations, additionDecorations };
  }

  private getLineNodes(nodes: Root): ElementContent[] {
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

  private getHighlighterOptions() {
    const { themes: _themes, theme, preferWasmHighlighter } = this.options;
    const themes: PJSThemeNames[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return {
      langs: [this.computedLang],
      themes,
      preferWasmHighlighter,
    };
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

interface CreateDiffSpanDecorationProps {
  line: number;
  spanStart: number;
  spanLength: number;
}

function createDiffSpanDecoration({
  line,
  spanStart,
  spanLength,
}: CreateDiffSpanDecorationProps): DecorationItem {
  return {
    start: { line, character: spanStart },
    end: { line, character: spanStart + spanLength },
    properties: { 'data-diff-span': '' },
    alwaysWrap: true,
  };
}

interface CreateSingleAnnotationProps<LAnnotation> {
  hunkIndex: number;
  lineIndex: number;
  rowNumber: number;
  annotationMap: AnnotationLineMap<LAnnotation>;
}

function createSingleAnnotationSpan<LAnnotation>({
  rowNumber,
  hunkIndex,
  lineIndex,
  annotationMap,
}: CreateSingleAnnotationProps<LAnnotation>): AnnotationSpan | undefined {
  const span: AnnotationSpan = {
    type: 'annotation',
    hunkIndex,
    lineIndex,
    annotations: [],
  };
  for (const anno of annotationMap[rowNumber] ?? []) {
    span.annotations.push(getLineAnnotationName(anno));
  }
  return span.annotations.length > 0 ? span : undefined;
}

interface CreateMirroredAnnotationSpanProps<LAnnotation> {
  deletionLineNumber: number;
  additionLineNumber: number;
  hunkIndex: number;
  lineIndex: number;
  deletionAnnotations: AnnotationLineMap<LAnnotation>;
  additionAnnotations: AnnotationLineMap<LAnnotation>;
}

function createMirroredAnnotationSpan<LAnnotation>(
  props: CreateMirroredAnnotationSpanProps<LAnnotation> & { unified: true }
): AnnotationSpan | undefined;
function createMirroredAnnotationSpan<LAnnotation>(
  props: CreateMirroredAnnotationSpanProps<LAnnotation> & { unified: false }
): [AnnotationSpan, AnnotationSpan] | [undefined, undefined];
function createMirroredAnnotationSpan<LAnnotation>({
  deletionLineNumber,
  additionLineNumber,
  hunkIndex,
  lineIndex,
  deletionAnnotations,
  additionAnnotations,
  unified,
}: CreateMirroredAnnotationSpanProps<LAnnotation> & { unified: boolean }):
  | [AnnotationSpan, AnnotationSpan]
  | [undefined, undefined]
  | AnnotationSpan
  | undefined {
  const dAnnotations: string[] = [];
  for (const anno of deletionAnnotations[deletionLineNumber] ?? []) {
    dAnnotations.push(getLineAnnotationName(anno));
  }
  const aAnnotations: string[] = [];
  for (const anno of additionAnnotations[additionLineNumber] ?? []) {
    (unified ? dAnnotations : aAnnotations).push(getLineAnnotationName(anno));
  }
  if (aAnnotations.length === 0 && dAnnotations.length === 0) {
    if (unified) {
      return undefined;
    }
    return [undefined, undefined];
  }
  if (unified) {
    return {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: dAnnotations,
    };
  }
  return [
    {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: dAnnotations,
    },
    {
      type: 'annotation',
      hunkIndex,
      lineIndex,
      annotations: aAnnotations,
    },
  ];
}

function pushOrMergeSpan(
  span: LineSpans | undefined,
  index: number,
  spanMap: Record<number, LineInfo | undefined>
) {
  if (span == null) {
    return;
  }
  let lineInfo = spanMap[index];
  // If we need to inject a gap at the top of a column, then we'll make a
  // `fake` lineInfo for it.
  if (lineInfo == null && index === 0 && span.type === 'gap') {
    lineInfo = {
      type: 'context',
      lineNumber: -1,
      lineIndex: -1,
      spans: [],
    };
    spanMap[0] = lineInfo;
  } else if (lineInfo == null) {
    console.error('pushOrMergeSpan: Attempting to apply an invalid span', {
      span,
      index,
      spanMap,
    });
    return;
  }
  const spans = lineInfo.spans ?? [];
  lineInfo.spans = spans;
  if (spans.length === 0) {
    spans.push(span);
  }
  // If we get in here, we may need to split up some gaps to split up some gaps
  else {
    let gapSize = span.type === 'gap' ? span.rows : 0;
    const annotations: AnnotationSpan[] = [];
    let merged = false;
    for (const item of spans) {
      if (item.type === 'annotation') {
        if (span.type === 'annotation' && span.lineIndex === item.lineIndex) {
          merged = true;
          item.annotations = mergeAnnotations(
            item.annotations,
            span.annotations
          );
        }
        annotations.push(item);
      } else {
        gapSize += item.rows;
      }
    }
    if (span.type === 'annotation' && !merged) {
      annotations.push(span);
    }
    const spanMarkers: (AnnotationSpan | 0)[] = new Array(gapSize).fill(0);
    for (const annotation of annotations) {
      const annotationIndex = annotation.lineIndex - lineInfo.lineIndex;
      const currentItem = spanMarkers[annotationIndex];
      if (currentItem === 0 || currentItem == null) {
        spanMarkers.splice(annotationIndex, 0, annotation);
      } else {
        // NOTE(amadeus): Hopefully we never get in here, but theoretically
        // it's possible... so we'll merge the annotations together
        currentItem.annotations = mergeAnnotations(
          currentItem.annotations,
          annotation.annotations
        );
      }
    }
    const newSpans: LineSpans[] = [];
    let spanSize = 0;
    for (const item of spanMarkers) {
      if (item === 0) {
        spanSize++;
      } else {
        if (spanSize > 0) {
          newSpans.push({ type: 'gap', rows: spanSize });
          spanSize = 0;
        }
        newSpans.push(item);
      }
    }
    if (spanSize > 0) {
      newSpans.push({ type: 'gap', rows: spanSize });
    }
    lineInfo.spans = newSpans;
  }
}

function mergeAnnotations(base: string[], newAnnotations: string[]): string[] {
  if (newAnnotations.length === 0) {
    return base;
  }
  const baseSet = new Set(base);
  for (const item of newAnnotations) {
    baseSet.add(item);
  }
  return Array.from(baseSet);
}

function getModifiedLinesString(lines: number) {
  return `${lines} unmodified line${lines > 1 ? 's' : ''}`;
}

interface PushOrJoinSpanProps {
  item: ChangeObject<string>;
  arr: [0 | 1, string][];
  enableJoin: boolean;
  isNeutral?: boolean;
}

// For diff decoration spans, we want to be sure that if there is a single
// white-space gap between diffs that we join them together into a longer diff span.
// Spans are basically just a tuple - 1 means the content should be
// highlighted, 0 means it should not, we still need to the span data to figure
// out span positions
function pushOrJoinSpan({
  item,
  arr,
  enableJoin,
  isNeutral = false,
}: PushOrJoinSpanProps) {
  const lastItem = arr[arr.length - 1];
  if (lastItem == null || item.value === '\n' || !enableJoin) {
    arr.push([isNeutral ? 0 : 1, item.value]);
    return;
  }
  const isLastItemNeutral = lastItem[0] === 0;
  if (
    isNeutral === isLastItemNeutral ||
    // If we have a single space neutral item, lets join it to a previously
    // space non-neutral item to avoid single space gaps
    (isNeutral && item.value.length === 1 && !isLastItemNeutral)
  ) {
    lastItem[1] += item.value;
    return;
  }
  arr.push([isNeutral ? 0 : 1, item.value]);
}
