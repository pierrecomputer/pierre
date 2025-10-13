import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type {
  BundledTheme,
  CodeToHastOptions,
  DecorationItem,
  HighlighterGeneric,
  ShikiTransformer,
} from 'shiki';

import {
  getSharedHighlighter,
  hasLoadedLanguage,
  hasLoadedThemes,
} from './SharedHighlighter';
import type {
  BaseRendererOptions,
  FileDiffMetadata,
  HUNK_LINE_TYPE,
  Hunk,
  LineAnnotation,
  SupportedLanguages,
  ThemeModes,
  ThemeRendererOptions,
  ThemesRendererOptions,
} from './types';
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
  hunkIndex: number;
  highlighter: HighlighterGeneric<SupportedLanguages, BundledTheme>;
  state: SharedRenderState;
  transformer: ShikiTransformer;
}

interface LineInfo {
  type: 'change-deletion' | 'change-addition' | 'context';
  number: number;
  diffLineIndex: number;
  metadataContent?: string;
  spans?: Span[];
}

interface UnresolvedSpan {
  type: 'addition' | 'deletion';
  hunkIndex: number;
  span: AnnotationSpan;
}

interface GapSpan {
  type: 'gap';
  rows: number;
}

interface AnnotationSpan {
  type: 'annotation';
  hunkIndex: number;
  diffLineIndex: number;
  annotations: string[];
}

type Span = GapSpan | AnnotationSpan;

interface SharedRenderState {
  lineInfo: Record<number, LineInfo | undefined>;
  decorations: DecorationItem[];
  disableLineNumbers: boolean;
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
  highlighter: HighlighterGeneric<SupportedLanguages, BundledTheme> | undefined;
  options: DiffHunksRendererOptions;
  diff: FileDiffMetadata | undefined;

  constructor(options: DiffHunksRendererOptions) {
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
  async render(diff: FileDiffMetadata): Promise<HunksRenderResult | undefined> {
    this.queuedDiff = diff;
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      // If we have changed theme or language on our diff instance, we need to
      // double check the highlighter has loaded the appropriate languages and
      // themes
      if (
        !hasLoadedLanguage(this.options.lang ?? 'text') ||
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
    diff: FileDiffMetadata,
    highlighter: HighlighterGeneric<SupportedLanguages, BundledTheme>
  ): HunksRenderResult {
    const { diffStyle, disableLineNumbers } = this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';

    this.diff = diff;
    let additionsHTML = '';
    let deletionsHTML = '';
    let unifiedHTML = '';
    const { state, transformer } =
      createTransformerWithState(disableLineNumbers);
    let hunkIndex = 0;
    const hunkSeparatorHTML = '<div data-separator=""></div>';

    for (const hunk of diff.hunks) {
      if (hunkIndex > 0) {
        if (unified) {
          unifiedHTML += hunkSeparatorHTML;
        } else {
          additionsHTML += hunkSeparatorHTML;
          deletionsHTML += hunkSeparatorHTML;
        }
      }
      const hunkResult = this.renderHunks({
        hunk,
        hunkIndex,
        highlighter,
        state,
        transformer,
      });
      additionsHTML += hunkResult.additionsHTML;
      deletionsHTML += hunkResult.deletionsHTML;
      unifiedHTML += hunkResult.unifiedHTML;
      hunkIndex++;
    }

    return { additionsHTML, deletionsHTML, unifiedHTML };
  }

  private createHastOptions(
    transformer: ShikiTransformer,
    decorations?: DecorationItem[],
    forceTextLang: boolean = false
  ): CodeToHastOptions {
    if ('theme' in this.options && this.options.theme != null) {
      return {
        theme: this.options.theme,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: forceTextLang ? 'text' : (this.options.lang ?? 'text'),
        defaultColor: this.options.defaultColor ?? false,
        transformers: [transformer],
        decorations,
      };
    }

    if ('themes' in this.options) {
      return {
        themes: this.options.themes,
        cssVariablePrefix: formatCSSVariablePrefix(),
        lang: forceTextLang ? 'text' : (this.options.lang ?? 'text'),
        defaultColor: this.options.defaultColor ?? false,
        transformers: [transformer],
        decorations,
      };
    }
    throw new Error();
  }

  private renderHunks({
    hunk,
    hunkIndex,
    highlighter,
    state,
    transformer,
  }: RenderHunkProps): HunksRenderResult {
    let additionsHTML = '';
    let deletionsHTML = '';
    let unifiedHTML = '';

    if (hunk.hunkContent == null) {
      return { additionsHTML, deletionsHTML, unifiedHTML };
    }

    const { additions, deletions, unified, hasLongLines } = this.processLines(
      hunk,
      hunkIndex
    );

    if (unified.content.length > 0) {
      // Remove trailing blank line
      const content = unified.content.join('').replace(/\n$/, '');
      state.lineInfo = unified.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(transformer, unified.decorations, hasLongLines)
      );
      unifiedHTML = toHtml(this.getNodesToRender(nodes));
    }

    if (deletions.content.length > 0) {
      // Remove trailing blank line
      const content = deletions.content.join('').replace(/\n$/, '');
      state.lineInfo = deletions.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(
          transformer,
          deletions.decorations.length > 0 ? deletions.decorations : undefined,
          hasLongLines
        )
      );
      deletionsHTML = toHtml(this.getNodesToRender(nodes));
    }

    if (additions.content.length > 0) {
      // Remove trailing blank line
      const content = additions.content.join('').replace(/\n$/, '');
      state.lineInfo = additions.lineInfo;
      const nodes = highlighter.codeToHast(
        content,
        this.createHastOptions(
          transformer,
          additions.decorations.length > 0 ? additions.decorations : undefined,
          hasLongLines
        )
      );
      additionsHTML = toHtml(this.getNodesToRender(nodes));
    }

    return { additionsHTML, deletionsHTML, unifiedHTML };
  }

  private processLines(hunk: Hunk, hunkIndex: number) {
    const { maxLineLengthForHighlighting, diffStyle } =
      this.getOptionsWithDefaults();
    const { deletionAnnotations, additionAnnotations } = this;
    // NOTE(amadeus): We will probably need to rectify this
    // for full additions/deletions
    const unified = diffStyle === 'unified';
    let hasLongLines = false;

    const additionContent: string[] = [];
    const additionLineInfo: Record<number, LineInfo | undefined> = {};
    let additionLineNumber = hunk.additionStart;

    const deletionContent: string[] = [];
    const deletionLineInfo: Record<number, LineInfo | undefined> = {};
    let deletionLineNumber = hunk.deletedStart;

    const unifiedContent: string[] = [];
    const unifiedLineInfo: Record<number, LineInfo | undefined> = {};

    const diffGroups: ChangeHunk[] = [];
    const unresolvedSpans: UnresolvedSpan[] = [];
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

    let diffLineIndex = -1;
    let lastType: HUNK_LINE_TYPE | undefined;
    for (const rawLine of hunk.hunkContent ?? []) {
      diffLineIndex++;
      const { line, type, longLine } = parseLineType(
        rawLine,
        maxLineLengthForHighlighting
      );
      hasLongLines = hasLongLines || longLine;
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
            type: 'context',
            number: additionLineNumber,
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
            type: 'context',
            number: deletionLineNumber,
            diffLineIndex,
          };
          additionLineInfo[additionContent.length] = {
            type: 'context',
            number: additionLineNumber,
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
          number: deletionLineNumber,
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
          number: additionLineNumber,
          diffLineIndex,
        };
        pushOrMergeSpan(span, content.length, lineInfo);
        additionLineNumber++;
      }

      lastType = type;
    }
    createGapSpanIfNecessary();
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

  private getNodesToRender(nodes: Root) {
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
    return nodes;
  }

  private getHighlighterOptions() {
    const {
      lang,
      themes: _themes,
      theme,
      preferWasmHighlighter,
    } = this.options;
    const langs: SupportedLanguages[] = [];
    if (lang != null) {
      langs.push(lang);
    }
    const themes: BundledTheme[] = [];
    if (theme != null) {
      themes.push(theme);
    } else if (themes != null) {
      themes.push(_themes.dark);
      themes.push(_themes.light);
    }
    return { langs, themes, preferWasmHighlighter };
  }

  private getThemes(): BundledTheme[] {
    const themes: BundledTheme[] = [];
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

function convertLine(
  node: Element,
  line: number,
  state: SharedRenderState
): ElementContent {
  const lineInfo = state.lineInfo[line];
  if (lineInfo == null) {
    throw new Error(`convertLine: line ${line}, contains no state.lineInfo`);
  }
  // We need to convert the current line to a div but keep all the decorations
  // that may be applied
  node.tagName = 'span';
  node.properties['data-column-content'] = '';
  if (lineInfo.metadataContent != null) {
    node.children.push({
      type: 'element',
      tagName: 'span',
      properties: { 'data-no-newline': '' },
      children: [{ type: 'text', value: lineInfo.metadataContent }],
    });
  }
  // NOTE(amadeus): We need to push newline characters into empty rows or else
  // copy/pasta will have issues
  else if (node.children.length === 0) {
    node.children.push({ type: 'text', value: '\n' });
  }
  const children = [node];
  if (!state.disableLineNumbers) {
    children.unshift({
      tagName: 'span',
      type: 'element',
      properties: { 'data-column-number': '' },
      children:
        lineInfo.metadataContent == null
          ? [{ type: 'text', value: `${lineInfo.number}` }]
          : [],
    });
  }
  return {
    tagName: 'div',
    type: 'element',
    properties: {
      'data-line': lineInfo.metadataContent == null ? `${lineInfo.number}` : '',
      'data-line-type': lineInfo.type,
    },
    children,
  };
}

function findCodeElement(nodes: Root | Element): Element | undefined {
  let firstChild: RootContent | Element | Root | null = nodes.children[0];
  while (firstChild != null) {
    if (firstChild.type === 'element' && firstChild.tagName === 'code') {
      return firstChild;
    }
    if ('children' in firstChild) {
      firstChild = firstChild.children[0];
    } else {
      firstChild = null;
    }
  }
  return undefined;
}

function createEmptyRowBuffer(size: number): Element {
  return {
    tagName: 'div',
    type: 'element',
    properties: {
      'data-buffer': '',
      style: `grid-row: span ${size};min-height:calc(${size} * 1lh)`,
    },
    children: [],
  };
}

function createAnnotationElement(span: AnnotationSpan): Element {
  return {
    tagName: 'div',
    type: 'element',
    properties: {
      'data-line-annotation': `${span.hunkIndex},${span.diffLineIndex}`,
    },
    children: [
      {
        tagName: 'div',
        type: 'element',
        properties: { 'data-annotation-content': '' },
        children:
          span.annotations?.map((slotId) => ({
            type: 'element',
            tagName: 'slot',
            properties: { name: slotId },
            children: [],
          })) ?? [],
      },
    ],
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
  span: Span | undefined,
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
    const newSpans: Span[] = [];
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
