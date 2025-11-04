import deepEquals from 'fast-deep-equal';
import type { Element } from 'hast';

import { DiffHunksRenderer, type HunksRenderResult } from './DiffHunksRenderer';
import type { FileDiffOptions } from './FileDiff';
import { FileHeaderRenderer } from './FileHeaderRenderer';
import { getSharedHighlighter } from './SharedHighlighter';
import { DEFAULT_THEMES, HEADER_METADATA_SLOT_ID } from './constants';
import { PJSContainerLoaded } from './custom-components/Container';
import { SVGSpriteSheet } from './sprite';
import type { FileDiffMetadata, PJSHighlighter, RenderRange } from './types';
import { getThemes } from './utils/getThemes';
import { createCodeNode, setWrapperProps } from './utils/html_render_utils';

export type { FileDiffOptions };

let instanceId = -1;

const LINE_HUNK_COUNT = 50;
const LINE_HEIGHT = 20;
const LINE_HEADER_HEIGHT = 44;
const HUNK_SEPARATOR_HEIGHT = 30;
const FILE_GAP = 8;

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

export class VirtulizedFileDiff<LAnnotation = undefined> {
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
    this.spriteSVG = undefined;
    if (this.pre != null) {
      this.pre.innerHTML = '';
    }
    this.pre = undefined;
    this.fileContainer = undefined;
    this.headerElement = undefined;
    this.lastRenderRange = undefined;
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
      if (firstHunk.additionStart > 1 || firstHunk.deletedStart > 1) {
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

  private lastRenderRange: RenderRange | undefined;
  private lastOffset: number | undefined;

  async render({ renderWindow, fileContainer }: RenderProps): Promise<void> {
    const { disableFileHeader = false, diffStyle = 'split' } = this.options;
    this.hunksRenderer ??= new DiffHunksRenderer({
      ...this.options,
      hunkSeparators:
        typeof this.options.hunkSeparators === 'function'
          ? 'custom'
          : this.options.hunkSeparators,
    });
    this.headerRenderer ??= new FileHeaderRenderer(this.options);

    // TODO(amadeus): Figure out how to convert the renderWindow into the
    // renderRange for DiffHunksRenderer
    const { renderRange, containerOffset } =
      this.computeRenderRangeFromWindow(renderWindow);

    if (
      containerOffset === this.lastOffset &&
      this.lastRenderRange != null &&
      deepEquals(renderRange, this.lastRenderRange)
    ) {
      return;
    }
    this.lastRenderRange = renderRange;
    this.lastOffset = containerOffset;

    const [highlighter, headerResult, hunksResult] = await Promise.all([
      getSharedHighlighter({
        themes: getThemes(this.options.theme),
        langs: [],
      }),
      !disableFileHeader
        ? this.headerRenderer.render(this.fileDiff)
        : undefined,
      this.hunksRenderer.render(this.fileDiff, renderRange),
    ]);

    if (headerResult == null && hunksResult == null) {
      return;
    }

    fileContainer = this.getOrCreateFileContainer(fileContainer);

    if (headerResult != null) {
      this.applyHeaderToDOM(headerResult, fileContainer);
    }

    if (hunksResult != null) {
      const pre = this.getOrCreatePre(fileContainer);
      this.applyHunksToDOM(hunksResult, pre, highlighter);
      // this.renderSeparators(hunksResult.hunkData);
      // this.renderAnnotations();
    }

    fileContainer.style.top = `${(diffStyle === 'split' ? this.splitTop : this.unifiedTop) + containerOffset}px`;
  }

  private computeRenderRangeFromWindow({ top, bottom }: RenderWindow): {
    renderRange: RenderRange;
    containerOffset: number;
  } {
    const { diffStyle = 'split', disableFileHeader = false } = this.options;
    const lineCount =
      diffStyle === 'split'
        ? this.fileDiff.splitLineCount
        : this.fileDiff.unifiedLineCount;
    const fileTop = diffStyle === 'split' ? this.splitTop : this.unifiedTop;
    const fileHeight =
      diffStyle === 'split' ? this.splitHeight : this.unifiedHeight;

    // We should never hit this theoretically, but if so, gtfo and yell loudly,
    // so we can fix
    if (fileTop < top - fileHeight || fileTop > bottom) {
      console.error(
        'VirtulizedFileDiff.computeRenderRangeFromWindow: invalid render',
        this.fileDiff.name
      );
      return {
        renderRange: { startingLine: -1, endingLine: -1 },
        containerOffset: 0,
      };
    }

    // Whole file is under LINE_HUNK_COUNT, just render it all
    if (lineCount <= LINE_HUNK_COUNT) {
      return {
        renderRange: { startingLine: 0, endingLine: Infinity },
        containerOffset: 0,
      };
    }

    let currentLineTop =
      fileTop + (disableFileHeader ? FILE_GAP : LINE_HEADER_HEIGHT);
    let currentLine = 0;
    const containerOffsets: number[] = [];
    let startingLine: number | undefined;
    let endingLine: number | undefined;
    outerLoop: for (const hunk of this.fileDiff.hunks) {
      let hunkGap = 0;
      if (hunk.additionStart > 1 || hunk.deletedStart > 1) {
        hunkGap = HUNK_SEPARATOR_HEIGHT + FILE_GAP * 2;
        // FIXME(amadeus): I might need to apply a fix for for the first hunk
        // because i don't think it gaps on top and bottom...
        currentLineTop += hunkGap;
      }
      const hunkLineCount =
        diffStyle === 'split' ? hunk.splitLineCount : hunk.unifiedLineCount;
      for (let l = 0; l < hunkLineCount; l++) {
        if (currentLine % LINE_HUNK_COUNT === 0) {
          containerOffsets.push(
            currentLineTop - (fileTop + LINE_HEADER_HEIGHT + hunkGap)
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
      return {
        renderRange: { startingLine: -1, endingLine: -1 },
        containerOffset: 0,
      };
    }

    startingLine = Math.floor(startingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT;
    endingLine =
      endingLine != null
        ? Math.ceil(endingLine / LINE_HUNK_COUNT) * LINE_HUNK_COUNT
        : startingLine + LINE_HUNK_COUNT;

    return {
      renderRange: { startingLine, endingLine },
      containerOffset: containerOffsets[startingLine / LINE_HUNK_COUNT] ?? 0,
    };
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

  private applyHunksToDOM(
    result: Partial<HunksRenderResult>,
    pre: HTMLPreElement,
    highlighter: PJSHighlighter
  ): void {
    if (this.hunksRenderer == null) return;
    this.setPreAttributes(pre, highlighter);

    // Clear existing content
    pre.innerHTML = '';

    let codeDeletions: HTMLElement | undefined;
    let codeAdditions: HTMLElement | undefined;
    // Create code elements and insert HTML content
    if (result.unifiedAST != null) {
      const codeUnified = createCodeNode({ columnType: 'unified' });
      codeUnified.innerHTML = this.hunksRenderer.renderPartialHTML(
        result.unifiedAST
      );
      pre.appendChild(codeUnified);
    } else {
      if (result.deletionsAST != null) {
        codeDeletions = createCodeNode({ columnType: 'deletions' });
        codeDeletions.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.deletionsAST
        );
        pre.appendChild(codeDeletions);
      }
      if (result.additionsAST != null) {
        codeAdditions = createCodeNode({ columnType: 'additions' });
        codeAdditions.innerHTML = this.hunksRenderer.renderPartialHTML(
          result.additionsAST
        );
        pre.appendChild(codeAdditions);
      }
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
    highlighter: PJSHighlighter
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
