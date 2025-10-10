import type {
  CodeToHastOptions,
  DecorationItem,
  HighlighterGeneric,
  ShikiTransformer,
} from '@shikijs/core';
import { type ChangeObject, diffChars, diffWordsWithSpace } from 'diff';
import type { Element, ElementContent, Root, RootContent } from 'hast';
import { toHtml } from 'hast-util-to-html';
import type { BundledTheme } from 'shiki';

import { getSharedHighlighter } from './SharedHighlighter';
import type {
  BaseRendererOptions,
  FileDiffMetadata,
  HUNK_LINE_TYPE,
  Hunk,
  LineAnnotation,
  SupportedLanguages,
  ThemeRendererOptions,
  ThemeTypes,
  ThemesRendererOptions,
} from './types';
import {
  createCodeNode,
  createHunkSeparator,
  formatCSSVariablePrefix,
  setupPreNode,
} from './utils/html_render_utils';
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

  codeAdditions: HTMLElement;
  codeDeletions: HTMLElement;
  codeUnified: HTMLElement;
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

interface ObservedAnnotationNodes {
  type: 'annotations';
  column1: {
    container: HTMLElement;
    child: HTMLElement;
    childHeight: number;
  };
  column2: {
    container: HTMLElement;
    child: HTMLElement;
    childHeight: number;
  };
  currentHeight: number | 'auto';
}

interface ObservedGridNodes {
  type: 'code';
  codeElement: HTMLElement;
  numberElement: HTMLElement | null;
  codeWidth: number | 'auto';
  numberWidth: number;
}

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

export class DiffHunksRenderer<LAnnotation = undefined> {
  highlighter: HighlighterGeneric<SupportedLanguages, BundledTheme> | undefined;
  options: DiffHunksRendererOptions;
  pre: HTMLPreElement | undefined;
  diff: FileDiffMetadata | undefined;

  constructor(options: DiffHunksRendererOptions) {
    this.options = options;
  }

  cleanUp() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.highlighter = undefined;
    this.pre = undefined;
    this.diff = undefined;
    this.queuedRenderArgs = undefined;
    this.queuedRender = undefined;
  }

  setOptions(
    options: DiffHunksRendererOptions,
    disableRerender: boolean = false
  ) {
    this.options = options;
    if (this.pre == null || this.diff == null) {
      return;
    }
    // TODO(amadeus): Probably figure out what requires a re-render and what just
    // requires some prop changes
    if (!disableRerender) {
      void this.render(this.diff, this.pre);
    }
  }

  private mergeOptions(options: Partial<DiffHunksRendererOptions>) {
    // @ts-expect-error FIXME
    this.options = { ...this.options, ...options };
  }

  setThemeType(themeType: ThemeTypes) {
    if (this.getOptionsWithDefaults().themeType === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    if (this.pre == null) {
      return;
    }
    switch (themeType) {
      case 'system':
        delete this.pre.dataset.theme;
        break;
      case 'light':
      case 'dark':
        this.pre.dataset.theme = themeType;
        break;
    }
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
      themeType = 'system',
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
        themeType,
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
      theme,
      themeType,
    };
  }

  private async initializeHighlighter() {
    this.highlighter = await getSharedHighlighter(this.getHighlighterOptions());
    return this.highlighter;
  }

  private queuedRenderArgs: [FileDiffMetadata, HTMLPreElement] | undefined;
  private queuedRender: Promise<void> | undefined;
  async render(diff: FileDiffMetadata, wrapper: HTMLPreElement) {
    this.queuedRenderArgs = [diff, wrapper];
    if (this.queuedRender != null) {
      return this.queuedRender;
    }
    this.queuedRender = (async () => {
      this.highlighter ??= await this.initializeHighlighter();
      if (this.queuedRenderArgs == null) {
        // If we get in here, it's likely we called cleanup and therefore we
        // should just return early
        return;
      }
      const [diff, wrapper] = this.queuedRenderArgs;
      this.queuedRenderArgs = undefined;
      this.renderDiff(diff, wrapper, this.highlighter);
    })();
    await this.queuedRender;
    this.queuedRender = undefined;
  }

  private renderDiff(
    diff: FileDiffMetadata,
    pre: HTMLPreElement,
    highlighter: HighlighterGeneric<SupportedLanguages, BundledTheme>
  ) {
    const {
      themes,
      overflow,
      theme,
      diffStyle,
      disableLineNumbers,
      themeType,
    } = this.getOptionsWithDefaults();
    const unified = diffStyle === 'unified';
    const split = unified
      ? false
      : diff.type === 'change' || diff.type === 'rename-changed';
    const wrap = overflow === 'wrap';
    pre = setupPreNode(
      themes != null
        ? { highlighter, pre, split, themeType, themes, wrap }
        : { highlighter, pre, split, theme, themeType, wrap }
    );

    this.diff = diff;
    this.pre = pre;
    this.resizeObserver?.disconnect();
    this.observedNodes.clear();
    const codeAdditions = createCodeNode({ columnType: 'additions' });
    const codeDeletions = createCodeNode({ columnType: 'deletions' });
    const codeUnified = createCodeNode({ columnType: 'unified' });
    const { state, transformer } =
      createTransformerWithState(disableLineNumbers);
    let hunkIndex = 0;
    for (const hunk of diff.hunks) {
      if (hunkIndex > 0) {
        if (unified) {
          codeUnified.appendChild(createHunkSeparator());
        } else {
          codeAdditions.appendChild(createHunkSeparator());
          codeDeletions.appendChild(createHunkSeparator());
        }
      }
      this.renderHunks({
        hunk,
        hunkIndex,
        highlighter,
        state,
        transformer,
        codeAdditions,
        codeDeletions,
        codeUnified,
      });
      hunkIndex++;
    }

    this.pre.innerHTML = '';
    if (codeDeletions.childNodes.length > 0) {
      this.pre.appendChild(codeDeletions);
    }
    if (codeAdditions.childNodes.length > 0) {
      this.pre.appendChild(codeAdditions);
    }
    if (codeUnified.childNodes.length > 0) {
      this.pre.appendChild(codeUnified);
    }
    this.postRender(pre);
  }

  observedNodes = new Map<
    HTMLElement,
    ObservedAnnotationNodes | ObservedGridNodes
  >();
  resizeObserver: ResizeObserver | undefined;
  private postRender(pre: HTMLPreElement) {
    // NOTE(amadeus): The resize logic is only necessary when the view is
    // scrollable to prevent annotations from scrolling around and use the
    // non-scrollable code width as our target width
    if (this.getOptionsWithDefaults().overflow === 'wrap') {
      return;
    }
    const annotationElements = pre.querySelectorAll(
      '[data-line-annotation*=","]'
    );
    // If there are no annotation nodes, then we shouldn't setup anything with
    // our resize observations
    if (annotationElements.length === 0) {
      return;
    }
    this.resizeObserver ??= new ResizeObserver(this.handleResizeObserver);
    const codeElements = pre.querySelectorAll('code');
    for (const codeElement of codeElements) {
      let numberElement = codeElement.querySelector('[data-column-number]');
      if (!(numberElement instanceof HTMLElement)) {
        numberElement = null;
      }
      const item: ObservedGridNodes = {
        type: 'code',
        codeElement,
        numberElement,
        codeWidth: 'auto',
        numberWidth: 0,
      };
      this.observedNodes.set(codeElement, item);
      this.resizeObserver.observe(codeElement);
      if (numberElement != null) {
        this.observedNodes.set(numberElement, item);
        this.resizeObserver.observe(numberElement);
      }
    }
    if (codeElements.length <= 1) {
      return;
    }
    const elementMap = new Map<string, HTMLElement[]>();
    for (const element of annotationElements) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      const { lineAnnotation = '' } = element.dataset;
      if (!/^\d+,\d+$/.test(lineAnnotation)) {
        console.error(
          'DiffHunksRenderer.ayyLmao: Invalid element or annotation',
          { lineAnnotation, element }
        );
        continue;
      }
      let pairs = elementMap.get(lineAnnotation);
      if (pairs == null) {
        pairs = [];
        elementMap.set(lineAnnotation, pairs);
      }
      pairs.push(element);
    }
    for (const [key, pair] of elementMap) {
      if (pair.length !== 2) {
        console.error('DiffHunksRenderer.ayyLmao: Bad Pair', key, pair);
        continue;
      }
      const [container1, container2] = pair;
      const child1 = container1.firstElementChild;
      const child2 = container2.firstElementChild;
      if (
        !(container1 instanceof HTMLElement) ||
        !(container2 instanceof HTMLElement) ||
        !(child1 instanceof HTMLElement) ||
        !(child2 instanceof HTMLElement)
      ) {
        continue;
      }
      const item: ObservedAnnotationNodes = {
        type: 'annotations',
        column1: {
          container: container1,
          child: child1,
          childHeight: 0,
        },
        column2: {
          container: container2,
          child: child2,
          childHeight: 0,
        },
        currentHeight: 'auto',
      };
      this.observedNodes.set(child1, item);
      this.observedNodes.set(child2, item);
      this.resizeObserver.observe(child1);
      this.resizeObserver.observe(child2);
    }
  }

  handleResizeObserver = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      const { target, borderBoxSize } = entry;
      if (!(target instanceof HTMLElement)) {
        console.error(
          'DiffHunksRenderer.handleResizeObserver: Invalid element for ResizeObserver',
          entry
        );
        continue;
      }
      const item = this.observedNodes.get(target);
      if (item == null) {
        console.error(
          'DiffHunksRenderer.handleResizeObserver: Not a valid observed node',
          entry
        );
        continue;
      }
      const specs = borderBoxSize[0];
      if (item.type === 'annotations') {
        const column = (() => {
          if (target === item.column1.child) {
            return item.column1;
          }
          if (target === item.column2.child) {
            return item.column2;
          }
          return undefined;
        })();

        if (column == null) {
          console.error(
            `DiffHunksRenderer.handleResizeObserver: Couldn't find a column for`,
            { item, target }
          );
          continue;
        }

        column.childHeight = specs.blockSize;
        const newHeight = Math.max(
          item.column1.childHeight,
          item.column2.childHeight
        );
        if (newHeight !== item.currentHeight) {
          item.currentHeight = Math.max(newHeight, 0);
          item.column1.container.style.setProperty(
            '--pjs-annotation-min-height',
            `${item.currentHeight}px`
          );
          item.column2.container.style.setProperty(
            '--pjs-annotation-min-height',
            `${item.currentHeight}px`
          );
        }
      } else if (item.type === 'code') {
        if (target === item.codeElement) {
          if (specs.inlineSize !== item.codeWidth) {
            item.codeWidth = specs.inlineSize;
            item.codeElement.style.setProperty(
              '--pjs-annotation-content-width',
              `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
            );
          }
        } else if (target === item.numberElement) {
          if (specs.inlineSize !== item.numberWidth) {
            item.numberWidth = specs.inlineSize;
            item.codeElement.style.setProperty(
              '--pjs-number-column-width',
              `${item.numberWidth}px`
            );
            // We probably need to update code width variable if
            // `numberWidth` changed
            if (item.codeWidth !== 'auto') {
              item.codeElement.style.setProperty(
                '--pjs-annotation-content-width',
                `${Math.max(item.codeWidth - item.numberWidth, 0)}px`
              );
            }
          }
        }
      }
    }
  };

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
    codeAdditions,
    codeDeletions,
    codeUnified,
  }: RenderHunkProps) {
    if (hunk.hunkContent == null) return;
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
      codeUnified.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
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
      codeDeletions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
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
      codeAdditions.insertAdjacentHTML(
        'beforeend',
        toHtml(this.getNodesToRender(nodes))
      );
    }
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
          ? [{ type: 'text', value: `${lineInfo.number} ` }]
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
