import deepEquals from 'fast-deep-equal';
import type { Element, ElementContent } from 'hast';

import { DiffHunksRenderer } from './DiffHunksRenderer';
import type { FileDiffOptions } from './FileDiff';
import { FileHeaderRenderer } from './FileHeaderRenderer';
import { DEFAULT_THEMES, HEADER_METADATA_SLOT_ID } from './constants';
import { PJSContainerLoaded } from './custom-components/Container';
import { SVGSpriteSheet } from './sprite';
import type { FileDiffMetadata, PJSHighlighter, RenderRange } from './types';
import { getTotalLineCountFromHunks } from './utils/getTotalLineCountFromHunks';
import { createCodeNode, setWrapperProps } from './utils/html_render_utils';

export type { FileDiffOptions };

let instanceId = -1;

const LINE_HUNK_COUNT = 200;
const LINE_HEIGHT = 20;
const LINE_HEADER_HEIGHT = 44;
const HUNK_SEPARATOR_HEIGHT = 30;
const FILE_GAP = 8;

interface ComputeRenderRange {
  renderRange: RenderRange;
  containerOffset: number;
}

interface RenderCache {
  chunk: number;
  containerOffset: number;
  additionsAST: ElementContent[] | undefined;
  deletionsAST: ElementContent[] | undefined;
  unifiedAST: ElementContent[] | undefined;
}

interface RenderWindow {
  top: number;
  bottom: number;
}

interface RenderProps {
  fileContainer?: HTMLElement;
  renderWindow: RenderWindow;
}

interface PositionProps {
  unifiedTop: number;
  splitTop: number;
  fileDiff: FileDiffMetadata;
}

export class VirtualizedFileDiff<LAnnotation = undefined> {
  static LoadedCustomComponent: boolean = PJSContainerLoaded;

  readonly __id: number = ++instanceId;

  unifiedTop: number;
  splitTop: number;
  unifiedHeight: number = 0;
  splitHeight: number = 0;

  fileDiff: FileDiffMetadata;

  private fileContainer: HTMLElement | undefined;
  private spriteSVG: SVGElement | undefined;
  private pre: HTMLPreElement | undefined;
  private codeUnified: HTMLElement | undefined;
  private codeAdditions: HTMLElement | undefined;
  private codeDeletions: HTMLElement | undefined;

  private headerElement: HTMLElement | undefined;
  private headerMetadata: HTMLElement | undefined;

  private hunksRenderer: DiffHunksRenderer<LAnnotation> | undefined;
  private headerRenderer: FileHeaderRenderer | undefined;

  constructor(
    { unifiedTop, splitTop, fileDiff }: PositionProps,
    public options: FileDiffOptions<LAnnotation> = { theme: DEFAULT_THEMES }
  ) {
    this.fileDiff = fileDiff;
    this.unifiedTop = unifiedTop;
    this.splitTop = splitTop;
    this.computeSize();
    void this.setup();
  }

  async setup(): Promise<PJSHighlighter> {
    const { disableFileHeader = false } = this.options;
    this.hunksRenderer ??= new DiffHunksRenderer({
      ...this.options,
      hunkSeparators:
        typeof this.options.hunkSeparators === 'function'
          ? 'custom'
          : this.options.hunkSeparators,
    });
    this.hunksRenderer.setDiff(this.fileDiff);
    this.headerRenderer ??= new FileHeaderRenderer(this.options);
    if (this.highlighter == null) {
      const [highligher, headerResult] = await Promise.all([
        this.hunksRenderer.initializeHighlighter(),
        !disableFileHeader
          ? this.headerRenderer.render(this.fileDiff)
          : undefined,
      ]);
      this.highlighter = highligher;
      this.headerCache = headerResult;
    }
    return this.highlighter;
  }

  setOptions(options: FileDiffOptions<LAnnotation> | undefined): void {
    if (options == null) return;
    this.options = options;
    this.hunksRenderer?.setOptions({
      ...this.options,
      hunkSeparators:
        typeof options.hunkSeparators === 'function'
          ? 'custom'
          : options.hunkSeparators,
    });
  }

  cleanUp(): void {
    this.hunksRenderer?.cleanUp();
    this.headerRenderer?.cleanUp();
    this.astCache.clear();
    this.highlighter = undefined;
    this.spriteSVG = undefined;
    if (this.pre != null) {
      this.pre.innerHTML = '';
    }
    this.pre = undefined;
    this.fileContainer = undefined;
    this.headerElement = undefined;
    this.lastRenderRanges = undefined;
    this.lastOffset = undefined;
  }

  private computeSize() {
    const {
      options: { disableFileHeader = false },
      fileDiff,
    } = this;

    // Add header height
    if (!disableFileHeader) {
      this.unifiedHeight += LINE_HEADER_HEIGHT;
      this.splitHeight += LINE_HEADER_HEIGHT;
    } else {
      this.unifiedHeight += FILE_GAP;
      this.splitHeight += FILE_GAP;
    }

    // Add hunk lines height
    this.unifiedHeight += fileDiff.unifiedLineCount * LINE_HEIGHT;
    this.splitHeight += fileDiff.splitLineCount * LINE_HEIGHT;

    // Add hunk separators height
    const hunkCount = fileDiff.hunks.length;
    const [firstHunk] = fileDiff.hunks;
    if (firstHunk != null) {
      if (firstHunk.additionStart > 1 || firstHunk.deletionStart > 1) {
        let hunkSize = (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
        hunkSize += HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        this.unifiedHeight += hunkSize;
        this.splitHeight += hunkSize;
      } else {
        const hunkSize =
          (HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2) * (hunkCount - 1);
        this.unifiedHeight += hunkSize;
        this.splitHeight += hunkSize;
      }
    }

    // If there are hunks of code, then we gotta render some bottom padding
    if (hunkCount > 0) {
      this.unifiedHeight += FILE_GAP;
      this.splitHeight += FILE_GAP;
    }

    this.unifiedHeight += FILE_GAP;
    this.splitHeight += FILE_GAP;
  }

  private astCache: Map<number, RenderCache> = new Map();

  private lastRenderRanges: ComputeRenderRange[] | undefined;
  private lastOffset: number | undefined;

  private highlighter: PJSHighlighter | undefined;
  private headerCache: Element | undefined;

  async render({ renderWindow, fileContainer }: RenderProps): Promise<void> {
    const { disableFileHeader = false, diffStyle = 'split' } = this.options;
    this.hunksRenderer ??= new DiffHunksRenderer({
      ...this.options,
      hunkSeparators:
        typeof this.options.hunkSeparators === 'function'
          ? 'custom'
          : this.options.hunkSeparators,
    });
    this.hunksRenderer.setDiff(this.fileDiff);
    this.headerRenderer ??= new FileHeaderRenderer(this.options);
    if (this.highlighter == null) {
      const [highligher, headerResult] = await Promise.all([
        this.hunksRenderer.initializeHighlighter(),
        !disableFileHeader
          ? this.headerRenderer.render(this.fileDiff)
          : undefined,
      ]);
      this.highlighter = highligher;
      this.headerCache = headerResult;
    }

    const renderRanges = this.computeRenderRangeFromWindow(renderWindow);

    if (
      renderRanges[0].containerOffset === this.lastOffset &&
      this.lastRenderRanges != null &&
      deepEquals(renderRanges, this.lastRenderRanges)
    ) {
      return;
    }
    this.lastRenderRanges = renderRanges;
    this.lastOffset = renderRanges[0].containerOffset;

    const hunkResults = renderRanges.map(({ renderRange }) => {
      if (this.astCache.has(renderRange.startingLine)) {
        return undefined;
      }
      return this.hunksRenderer?.syncRender(this.fileDiff, renderRange);
    });

    if (
      this.headerCache == null &&
      !hunkResults.some((result) => result != null)
    ) {
      return;
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);

    if (this.headerCache != null) {
      this.applyHeaderToDOM(this.headerCache, fileContainer);
    }

    for (const hunkResult of hunkResults) {
      if (hunkResult == null) continue;
      this.astCache.set(hunkResult.renderRange.startingLine, {
        chunk: hunkResult.renderRange.startingLine,
        containerOffset: 0,
        additionsAST: hunkResult.additionsAST,
        deletionsAST: hunkResult.deletionsAST,
        unifiedAST: hunkResult.unifiedAST,
      });
    }

    const pre = this.getOrCreatePre(fileContainer);
    if (this.codeUnified != null) {
      this.codeUnified.innerHTML = '';
    }
    if (this.codeDeletions != null) {
      this.codeDeletions.innerHTML = '';
    }
    if (this.codeAdditions != null) {
      this.codeAdditions.innerHTML = '';
    }
    for (const renderRange of renderRanges) {
      const cachedData = this.astCache.get(
        renderRange.renderRange.startingLine
      );
      if (cachedData == null) {
        console.warn(
          'ZZZZZ - render cache miss',
          this.fileDiff.name,
          this.astCache,
          renderRange
        );
        continue;
      }
      this.appendCode(cachedData);

      // FIXME(amadeus): Add support for these?
      // this.renderSeparators(hunksResult.hunkData);
      // this.renderAnnotations();
    }

    const totalLines = getTotalLineCountFromHunks(this.fileDiff.hunks);
    this.applyHunksToDOM(pre, this.highlighter, totalLines);
    fileContainer.style.top = `${(diffStyle === 'split' ? this.splitTop : this.unifiedTop) + renderRanges[0].containerOffset}px`;
    console.log('ZZZZZ .renderFinished', this.fileDiff.name);
  }

  private computeRenderRangeFromWindow({
    top,
    bottom,
  }: RenderWindow): ComputeRenderRange[] {
    const { diffStyle = 'split', disableFileHeader = false } = this.options;
    const { lineCount, fileTop, fileHeight } = getSpecs(this, diffStyle);

    // We should never hit this theoretically, but if so, gtfo and yell loudly,
    // so we can fix
    if (fileTop < top - fileHeight || fileTop > bottom) {
      console.error(
        'VirtulizedFileDiff.computeRenderRangeFromWindow: invalid render',
        this.fileDiff.name
      );
      return [
        {
          renderRange: { startingLine: -1, endingLine: -1 },
          containerOffset: 0,
        },
      ];
    }

    // Whole file is under LINE_HUNK_COUNT, just render it all
    if (lineCount <= LINE_HUNK_COUNT) {
      return [
        {
          renderRange: { startingLine: 0, endingLine: Infinity },
          containerOffset: 0,
        },
      ];
    }

    let currentLineTop =
      fileTop + (disableFileHeader ? FILE_GAP : LINE_HEADER_HEIGHT);
    let currentLine = 0;
    const containerOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine: number | undefined;
    outerLoop: for (const hunk of this.fileDiff.hunks) {
      let hunkGap = 0;
      if (hunk.additionStart > 1 || hunk.deletionStart > 1) {
        hunkGap = HUNK_SEPARATOR_HEIGHT + FILE_GAP;
        if (hunk !== this.fileDiff.hunks[0]) {
          hunkGap += FILE_GAP;
        }
        // FIXME(amadeus): I might need to apply a fix for for the first hunk
        // because i don't think it gaps on top and bottom...
        currentLineTop += hunkGap;
      }
      const hunkLineCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      for (let l = 0; l < hunkLineCount; l++) {
        if (currentLine % LINE_HUNK_COUNT === 0) {
          containerOffsets.push(
            currentLineTop -
              (fileTop + LINE_HEADER_HEIGHT + (l === 0 ? hunkGap : 0))
          );
        }
        if (
          startingLine == null &&
          currentLineTop > top - LINE_HEIGHT &&
          currentLineTop < bottom
        ) {
          startingLine = currentLine;
        } else if (startingLine != null && currentLineTop < bottom) {
          endingLine = currentLine;
        } else if (startingLine != null) {
          break outerLoop;
        }
        currentLine++;
        currentLineTop += LINE_HEIGHT;
      }
    }

    if (startingLine == null) {
      return [
        {
          renderRange: { startingLine: -1, endingLine: -1 },
          containerOffset: 0,
        },
      ];
    }

    startingLine = Math.floor(startingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT;
    endingLine =
      endingLine != null
        ? Math.ceil(endingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT
        : startingLine + LINE_HUNK_COUNT;

    const ranges: ComputeRenderRange[] = [];
    for (let i = 0; i < (endingLine - startingLine) / LINE_HUNK_COUNT; i++) {
      const _startingLine = startingLine + i * LINE_HUNK_COUNT;
      ranges.push({
        containerOffset: containerOffsets[_startingLine / LINE_HUNK_COUNT] ?? 0,
        renderRange: {
          startingLine: _startingLine,
          endingLine: _startingLine + LINE_HUNK_COUNT,
        },
      });
    }
    return ranges;
  }

  private applyHeaderToDOM(headerAST: Element, container: HTMLElement): void {
    if (this.headerRenderer == null) {
      return;
    }
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = this.headerRenderer.renderResultToHTML(headerAST);
    const newHeader = tempDiv.firstElementChild;
    if (!(newHeader instanceof HTMLElement)) {
      return;
    }
    if (this.headerElement != null) {
      container.shadowRoot?.replaceChild(newHeader, this.headerElement);
    } else {
      container.shadowRoot?.prepend(newHeader);
    }
    this.headerElement = newHeader;

    const { renderHeaderMetadata } = this.options;
    if (this.headerMetadata != null) {
      this.headerMetadata.parentNode?.removeChild(this.headerMetadata);
    }
    const content =
      renderHeaderMetadata?.({
        fileDiff: this.fileDiff,
      }) ?? undefined;
    if (content != null) {
      this.headerMetadata = document.createElement('div');
      this.headerMetadata.slot = HEADER_METADATA_SLOT_ID;
      if (content instanceof Element) {
        this.headerMetadata.appendChild(content);
      } else {
        this.headerMetadata.innerText = `${content}`;
      }
      container.appendChild(this.headerMetadata);
    }
  }

  private appendCode(result: RenderCache) {
    if (this.hunksRenderer == null) return;
    if (result.unifiedAST != null) {
      this.codeUnified ??= createCodeNode({ columnType: 'unified' });
      this.codeUnified.insertAdjacentHTML(
        'beforeend',
        this.hunksRenderer.renderPartialHTML(result.unifiedAST)
      );
      this.codeAdditions?.parentNode?.removeChild(this.codeAdditions);
      this.codeAdditions = undefined;
      this.codeDeletions?.parentNode?.removeChild(this.codeDeletions);
      this.codeDeletions = undefined;
    } else {
      if (result.deletionsAST != null) {
        this.codeDeletions ??= createCodeNode({ columnType: 'deletions' });
        this.codeDeletions.insertAdjacentHTML(
          'beforeend',
          this.hunksRenderer.renderPartialHTML(result.deletionsAST)
        );
      }
      if (result.additionsAST != null) {
        this.codeAdditions ??= createCodeNode({ columnType: 'additions' });
        this.codeAdditions.insertAdjacentHTML(
          'beforeend',
          this.hunksRenderer.renderPartialHTML(result.additionsAST)
        );
      }
      this.codeUnified?.parentNode?.removeChild(this.codeUnified);
      this.codeUnified = undefined;
    }
  }

  private applyHunksToDOM(
    pre: HTMLPreElement,
    highlighter: PJSHighlighter,
    totalLines: number
  ): void {
    if (this.hunksRenderer == null) return;
    this.setPreAttributes(pre, highlighter, totalLines);

    if (this.codeUnified != null) {
      pre.appendChild(this.codeUnified);
    }
    if (this.codeDeletions != null) {
      pre.appendChild(this.codeDeletions);
    }
    if (this.codeAdditions != null) {
      pre.appendChild(this.codeAdditions);
    }

    // this.mouseEventManager.setup(pre);
    // if ((this.options.overflow ?? 'scroll') === 'scroll') {
    //   this.resizeManager.setup(pre);
    //   this.scrollSyncManager.setup(pre, codeDeletions, codeAdditions);
    // } else {
    //   this.resizeManager.cleanUp();
    //   this.scrollSyncManager.cleanUp();
    // }
  }

  private setPreAttributes(
    pre: HTMLPreElement,
    highlighter: PJSHighlighter,
    totalLines: number
  ): void {
    const {
      diffStyle = 'split',
      overflow = 'scroll',
      theme,
      themeType = 'system',
      diffIndicators = 'bars',
      disableBackground = false,
    } = this.options;
    const unified = diffStyle === 'unified';
    const split = unified
      ? false
      : this.fileDiff?.type === 'change' ||
        this.fileDiff?.type === 'rename-changed';
    const wrap = overflow === 'wrap';
    setWrapperProps({
      pre,
      theme,
      highlighter,
      split,
      wrap,
      themeType,
      diffIndicators,
      disableBackground,
      totalLines,
    });
  }

  private getOrCreateFileContainer(fileContainer?: HTMLElement): HTMLElement {
    this.fileContainer =
      fileContainer ??
      this.fileContainer ??
      document.createElement('file-diff');
    if (this.spriteSVG == null) {
      const fragment = document.createElement('div');
      fragment.innerHTML = SVGSpriteSheet;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
        this.fileContainer.shadowRoot?.appendChild(this.spriteSVG);
      }
    }
    return this.fileContainer;
  }

  private getOrCreatePre(container: HTMLElement): HTMLPreElement {
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      container.shadowRoot?.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== container) {
      container.shadowRoot?.appendChild(this.pre);
    }
    return this.pre;
  }
}

function getSpecs<LAnnotation>(
  instance: VirtualizedFileDiff<LAnnotation>,
  type: 'split' | 'unified' = 'split'
) {
  if (type === 'split') {
    return {
      lineCount: instance.fileDiff.splitLineCount,
      fileTop: instance.splitTop,
      fileHeight: instance.splitHeight,
    };
  }
  return {
    lineCount: instance.fileDiff.unifiedLineCount,
    fileTop: instance.unifiedTop,
    fileHeight: instance.unifiedHeight,
  };
}
