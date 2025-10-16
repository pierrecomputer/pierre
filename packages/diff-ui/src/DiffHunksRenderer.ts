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
  BaseRendererOptions,
  CodeToHastOptions,
  DecorationItem,
  FileDiffMetadata,
  Hunk,
  HunkLineType,
  LineAnnotation,
  LineInfo,
  LineSpans,
  PJSHighlighter,
  PJSThemeNames,
  SharedRenderState,
  ShikiTransformer,
  SupportedLanguages,
  ThemeModes,
  ThemeRendererOptions,
  ThemesRendererOptions,
} from './types';
import { getFiletypeFromFileName } from './utils/getFiletypeFromFileName';
import {
  convertLine,
  createAnnotationElement,
  createEmptyRowBuffer,
  createSeparator,
  findCodeElement,
} from './utils/hast_utils';
import { formatCSSVariablePrefix } from './utils/html_render_utils';
import { parseLineType } from './utils/parseLineType';

type AnnotationLineMap<LAnnotation> = Record<
  number,
  LineAnnotation<LAnnotation>[] | undefined
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
  transformer: ShikiTransformer;
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

interface DiffHunkThemeRendererOptions
  extends BaseRendererOptions,
    ThemeRendererOptions {}

interface DiffHunkThemesRendererOptions
  extends BaseRendererOptions,
    ThemesRendererOptions {}

export type DiffHunksRendererOptions =
  | DiffHunkThemeRendererOptions
  | DiffHunkThemesRendererOptions;

export interface HunksRenderResult {
  additionsHTML: string;
  deletionsHTML: string;
  unifiedHTML: string;
}

export class DiffHunksRenderer<LAnnotation = undefined> {
  highlighter: PJSHighlighter | undefined;
  options: DiffHunksRendererOptions;
  diff: FileDiffMetadata | undefined;
  expandedHunks = new Set<number>();

  constructor(options: DiffHunksRendererOptions = { theme: 'none' }) {
    this.options = options;
  }

  cleanUp() {
    this.highlighter = undefined;
    this.diff = undefined;
    this.queuedDiff = undefined;
    this.queuedRender = undefined;
  }

  setOptions(options: DiffHunksRendererOptions) {
    this.options = options;
  }

  expandHunk(index: number) {
    this.expandedHunks.add(index);
  }

  private mergeOptions(options: Partial<DiffHunksRendererOptions>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setThemeMode(themeMode: ThemeModes) {
    if (this.getOptionsWithDefaults().themeMode === themeMode) {
      return;
    }
    this.mergeOptions({ themeMode });
  }

  private deletionAnnotations: AnnotationLineMap<LAnnotation> = {};
  private additionAnnotations: AnnotationLineMap<LAnnotation> = {};
  setLineAnnotations(lineAnnotations: LineAnnotation<LAnnotation>[]) {
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

  getOptionsWithDefaults() {
    const {
      diffStyle = 'split',
      disableLineNumbers = false,
      hunkSeparators = 'line-info',
      lineDiffType = 'word-alt',
      maxLineDiffLength = 1000,
      maxLineLengthForHighlighting = 1000,
      overflow = 'scroll',
      theme,
      themeMode = 'system',
      themes,
    } = this.options;
    if (themes != null) {
      return {
        diffStyle,
        disableLineNumbers,
        hunkSeparators,
        lineDiffType,
        maxLineDiffLength,
        maxLineLengthForHighlighting,
        overflow,
        themeMode,
        themes,
      };
    }
    return {
      diffStyle,
      disableLineNumbers,
      hunkSeparators,
      lineDiffType,
      maxLineDiffLength,
      maxLineLengthForHighlighting,
      overflow,
      themeMode,
      theme,
    };
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedDiff: FileDiffMetadata | undefined;
  private queuedRender: Promise<HunksRenderResult | undefined> | undefined;
  private computedLang: SupportedLanguages = 'text';
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
    const { disableLineNumbers } = this.getOptionsWithDefaults();

    this.diff = fileDiff;
    let additionsHTML = '';
    let deletionsHTML = '';
    let unifiedHTML = '';
    const { state, transformer } =
      createTransformerWithState(disableLineNumbers);
    let hunkIndex = 0;

    let prevHunk: Hunk | undefined;
    for (const hunk of fileDiff.hunks) {
      const hunkResult = this.renderHunks({
        hunk,
        prevHunk,
        hunkIndex,
        highlighter,
        state,
        transformer,
        isLastHunk: hunkIndex === fileDiff.hunks.length - 1,
      });
      additionsHTML += hunkResult.additionsHTML;
      deletionsHTML += hunkResult.deletionsHTML;
      unifiedHTML += hunkResult.unifiedHTML;
      hunkIndex++;
      prevHunk = hunk;
    }

    return { additionsHTML, deletionsHTML, unifiedHTML };
  }

  private createHastOptions(
    transformer: ShikiTransformer,
    decorations?: DecorationItem[],
    forceTextLang: boolean = false
  ): CodeToHastOptions<PJSThemeNames> {
    if (this.options.theme != null) {
      return {
        theme: this.options.theme,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: forceTextLang ? 'text' : this.computedLang,
        defaultColor: this.options.defaultColor ?? false,
        transformers: [transformer],
        decorations,
      };
    }
    return {
      themes: this.options.themes,
      cssVariablePrefix: formatCSSVariablePrefix(),
      lang: forceTextLang ? 'text' : this.computedLang,
      defaultColor: this.options.defaultColor ?? false,
      transformers: [transformer],
      decorations,
    };
  }

  private renderHunks({
    hunk,
    hunkIndex,
    highlighter,
    state,
    transformer,
    prevHunk,
    isLastHunk,
  }: RenderHunkProps): HunksRenderResult {
    const { hunkSeparators } = this.getOptionsWithDefaults();
    let additionsHTML = '';
    let deletionsHTML = '';
    let unifiedHTML = '';

    if (hunk.hunkContent == null) {
      return { additionsHTML, deletionsHTML, unifiedHTML };
    }

    const { additions, deletions, unified, hasLongLines } = this.processLines(
      hunk,
      hunkIndex,
      prevHunk,
      isLastHunk
    );

    const generateHTML = (computed: ComputedContent) => {
      // Remove trailing blank line
      const content = computed.content.join('').replace(/\n$/, '');
      state.lineInfo = computed.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(transformer, computed.decorations, hasLongLines)
      );
      const transformedNodes = this.getNodesToRender(nodes);
      if (!this.expandedHunks.has(hunkIndex)) {
        if (hunkSeparators === 'line-info') {
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
            transformedNodes.unshift(
              createSeparator({
                type: 'line-info',
                content: getModifiedLinesString(lines),
                expandIndex:
                  this.diff?.newLines != null ? hunkIndex : undefined,
              })
            );
          }
        } else if (hunkSeparators === 'metadata') {
          transformedNodes.unshift(
            createSeparator({ type: 'metadata', content: hunk.hunkSpecs })
          );
        } else if (hunkSeparators === 'simple' && hunkIndex > 0) {
          transformedNodes.unshift(createSeparator({ type: 'empty' }));
        }
      }

      if (
        isLastHunk &&
        !this.expandedHunks.has(hunkIndex + 1) &&
        this.diff?.newLines != null
      ) {
        const lines =
          this.diff.newLines.length -
          (hunk.additionStart + hunk.additionCount - 1);
        if (lines > 0) {
          transformedNodes.push(
            createSeparator({
              type: 'line-info',
              content: getModifiedLinesString(lines),
              expandIndex: hunkIndex + 1,
            })
          );
        }
      }
      // FIXME(amadeus): Implement the final gap if needed, maybe generate a
      // padded lad if nothing else...
      return toHtml(transformedNodes);
    };

    if (unified.content.length > 0) {
      unifiedHTML = generateHTML(unified);
    }

    if (deletions.content.length > 0) {
      deletionsHTML = generateHTML(deletions);
    }

    if (additions.content.length > 0) {
      additionsHTML = generateHTML(additions);
    }

    return { additionsHTML, deletionsHTML, unifiedHTML };
  }

  private processLines(
    hunk: Hunk,
    hunkIndex: number,
    prevHunk: Hunk | undefined,
    isLastHunk: boolean
  ): ProcessLinesReturn {
    const { maxLineLengthForHighlighting, diffStyle } =
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
          diffLineIndex: unresolvedSpan.span.diffLineIndex,
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
          diffGroupStartIndex: diffLineIndex,
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
      if (type === 'context') {
        createGapSpanIfNecessary();
      }
      if (type === 'context') {
        if (currentChangeGroup != null) {
          diffLineIndex =
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
            number: additionLineNumber + 1,
            diffLineIndex,
          };
          const span = createMirroredAnnotationSpan({
            deletionLineNumber,
            additionLineNumber,
            hunkIndex,
            diffLineIndex: unifiedContent.length,
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
            number: deletionLineNumber + 1,
            diffLineIndex,
          };
          additionLineInfo[additionContent.length] = {
            type: isExpandedContext ? 'context-expanded' : 'context',
            number: additionLineNumber + 1,
            diffLineIndex,
          };
          const [deletionSpan, additionSpan] = createMirroredAnnotationSpan({
            deletionLineNumber,
            additionLineNumber,
            hunkIndex,
            diffLineIndex,
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
          number: -1,
          diffLineIndex: -1,
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
          rowNumber: deletionLineNumber,
          hunkIndex,
          diffLineIndex,
          annotationMap: this.deletionAnnotations,
        });
        addToChangeGroup('deletion', line, span);
        content.push(line);
        lineInfo[content.length] = {
          type: 'change-deletion',
          number: deletionLineNumber + 1,
          diffLineIndex,
        };
        pushOrMergeSpan(span, content.length, lineInfo);
        deletionLineNumber++;
      } else if (type === 'addition') {
        // Reset diffLineIndex back to start if we are jumping columns
        if (lastType === 'deletion' && !unified) {
          diffLineIndex =
            currentChangeGroup?.diffGroupStartIndex ?? diffLineIndex;
        }
        const { content, lineInfo } = (() =>
          unified
            ? { content: unifiedContent, lineInfo: unifiedLineInfo }
            : { content: additionContent, lineInfo: additionLineInfo })();
        const span = createSingleAnnotationSpan({
          rowNumber: additionLineNumber,
          hunkIndex,
          diffLineIndex,
          annotationMap: this.additionAnnotations,
        });
        addToChangeGroup('addition', line, span);
        content.push(line);
        lineInfo[content.length] = {
          type: 'change-addition',
          number: additionLineNumber + 1,
          diffLineIndex,
        };
        pushOrMergeSpan(span, content.length, lineInfo);
        additionLineNumber++;
      }

      lastType = type;
    };

    let diffLineIndex = -1;
    let lastType: HunkLineType | undefined;

    // Proses hunk expanded content if expanded
    if (this.expandedHunks.has(hunkIndex) && this.diff?.newLines != null) {
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
          processRawLine(line, 'context', true);
        }
      }
    }

    // Process diff content
    for (const rawLine of hunk.hunkContent ?? []) {
      diffLineIndex++;
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
      this.expandedHunks.has(hunkIndex + 1) &&
      this.diff?.newLines != null
    ) {
      for (let i = additionLineNumber; i < this.diff.newLines.length; i++) {
        const line = this.diff.newLines[i];
        processRawLine(line, 'context', true);
      }
    }

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

  private getNodesToRender(nodes: Root): ElementContent[] {
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

function createTransformerWithState(disableLineNumbers: boolean): {
  state: SharedRenderState;
  transformer: ShikiTransformer;
} {
  const state: SharedRenderState = {
    lineInfo: {},
    decorations: [],
    disableLineNumbers,
  };
  return {
    state,
    transformer: {
      line(hast) {
        // Remove the default class
        delete hast.properties.class;
        return hast;
      },
      pre(pre) {
        // NOTE(amadeus): This kinda sucks -- basically we can't apply our
        // line node changes until AFTER decorations have been applied
        const code = findCodeElement(pre);
        const children: ElementContent[] = [];
        if (code != null) {
          let index = 1;
          for (const node of code.children) {
            if (node.type !== 'element') {
              continue;
            }
            // Do we need to inject an empty span above the first line line?
            if (index === 1 && state.lineInfo[0]?.spans != null) {
              for (const span of state.lineInfo[0]?.spans ?? []) {
                if (span.type === 'gap') {
                  children.push(createEmptyRowBuffer(span.rows));
                } else {
                  children.push(createAnnotationElement(span));
                }
              }
            }
            children.push(convertLine(node, index, state));
            const lineInfo = state.lineInfo[index];
            if (lineInfo?.spans != null) {
              for (const span of lineInfo.spans) {
                if (span.type === 'gap') {
                  children.push(createEmptyRowBuffer(span.rows));
                } else {
                  children.push(createAnnotationElement(span));
                }
              }
            }
            index++;
          }
          code.children = children;
        }
        return pre;
      },
    },
  };
}

interface CreateSingleAnnotationProps<LAnnotation> {
  hunkIndex: number;
  diffLineIndex: number;
  rowNumber: number;
  annotationMap: AnnotationLineMap<LAnnotation>;
}

function createSingleAnnotationSpan<LAnnotation>({
  rowNumber,
  hunkIndex,
  diffLineIndex,
  annotationMap,
}: CreateSingleAnnotationProps<LAnnotation>): AnnotationSpan | undefined {
  const span: AnnotationSpan = {
    type: 'annotation',
    hunkIndex,
    diffLineIndex,
    annotations: [],
  };
  for (const anno of annotationMap[rowNumber] ?? []) {
    span.annotations.push(`${anno.side}-${anno.lineNumber}`);
  }
  return span.annotations.length > 0 ? span : undefined;
}

interface CreateMirroredAnnotationSpanProps<LAnnotation> {
  deletionLineNumber: number;
  additionLineNumber: number;
  hunkIndex: number;
  diffLineIndex: number;
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
  diffLineIndex,
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
    dAnnotations.push(`${anno.side}-${anno.lineNumber}`);
  }
  const aAnnotations: string[] = [];
  for (const anno of additionAnnotations[additionLineNumber] ?? []) {
    (unified ? dAnnotations : aAnnotations).push(
      `${anno.side}-${anno.lineNumber}`
    );
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
      diffLineIndex,
      annotations: dAnnotations,
    };
  }
  return [
    {
      type: 'annotation',
      hunkIndex,
      diffLineIndex,
      annotations: dAnnotations,
    },
    {
      type: 'annotation',
      hunkIndex,
      diffLineIndex,
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
      number: -1,
      diffLineIndex: -1,
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
        if (
          span.type === 'annotation' &&
          span.diffLineIndex === item.diffLineIndex
        ) {
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
      const annotationIndex = annotation.diffLineIndex - lineInfo.diffLineIndex;
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
