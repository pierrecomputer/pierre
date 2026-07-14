import { getGraphemeSegmenter, h, round } from './utils';

// Upper bound on cached DOM text-width measurements. The cache only holds
// non-ASCII runs (emoji, ZWJ sequences, variation selectors, combining marks),
// so it stays small for ordinary code, but capping it prevents unbounded growth
// on emoji-heavy documents. Past the cap the oldest entry is evicted.
const TEXT_WIDTH_CACHE_LIMIT = 4096;
const TEXT_WIDTH_CACHE_MAX_TEXT_LENGTH = 256;

const COMBINING_MARK_PATTERN = /\p{Mark}/u;

export class Metrics {
  #root?: HTMLElement;
  #canvasCtx?: CanvasRenderingContext2D;
  #font?: string;

  // Memoizes domMeasureTextWidth() results
  #textWidthCache = new Map<string, number>();

  /** Width of the '0' character. */
  ch: number = -1;
  /** Size of a tab(\t) character. */
  tabSize: number = 2;
  /** Height of the code line. */
  lineHeight: number = 20;
  /** Padding top of the root element. */
  paddingTop: number = 0;

  /** initialize the metrics */
  init(root: HTMLElement): void {
    const rootChanged = this.#root !== root;
    this.#root = root;
    this.#canvasCtx ??=
      document.createElement('canvas').getContext('2d') ?? undefined;
    if (this.#canvasCtx === undefined) {
      throw new Error('Could not get canvas context');
    }

    const parent = root.parentElement;
    const paddingTop =
      parent === null ? '' : getComputedStyle(parent).paddingTop;
    this.paddingTop = paddingTop.endsWith('px') ? parseFloat(paddingTop) : 0;

    const {
      fontFamily,
      fontSize,
      fontStretch,
      fontStyle,
      fontWeight,
      lineHeight,
      tabSize,
    } = getComputedStyle(root);
    if (lineHeight.endsWith('px')) {
      this.lineHeight = parseFloat(lineHeight);
    } else if (fontSize.endsWith('px')) {
      const multiplier = parseFloat(lineHeight);
      this.lineHeight = Number.isNaN(multiplier)
        ? 20
        : round(parseFloat(fontSize) * multiplier);
    } else {
      this.lineHeight = 20;
    }
    const font = `${fontStyle === '' ? 'normal' : fontStyle} ${fontWeight === '' ? 'normal' : fontWeight} ${fontStretch === '' ? 'normal' : fontStretch} ${fontSize} ${fontFamily}`;
    if (rootChanged || this.#font !== font || this.ch === -1) {
      this.#font = font;
      this.#canvasCtx.font = font;
      this.ch = this.canvasMeasureTextWidth('0');
      // Cached DOM widths were measured against the previous font.
      this.clearTextWidthCache();
    }
    const nextTabSize = parseInt(tabSize, 10);
    this.tabSize = Number.isNaN(nextTabSize) ? 2 : Math.max(0, nextTabSize);
  }

  /** Release DOM and cached measurements held by this instance. */
  cleanUp(): void {
    this.#root = undefined;
    this.#font = undefined;
    this.#textWidthCache.clear();
    this.ch = -1;
    this.tabSize = 2;
    this.lineHeight = 20;
    this.paddingTop = 0;
  }

  /**
   * Re-measure the '0' character width against the font that is loaded right
   * now, returning true when measurement-dependent UI should refresh.
   *
   * A custom web font can finish loading after the editor first renders.
   * Until then canvas measureText reports the fallback font's width, and
   * getComputedStyle returns the same font-family string before and after the
   * file arrives, so init()'s font guard never re-measures on its own. Call
   * this once fonts have settled (e.g. on document.fonts.ready) to replace a
   * width measured against the fallback font with the real glyph width. Font
   * completion can also change DOM-measured emoji/ZWJ widths while leaving the
   * ASCII width unchanged, and the computed font string stays the same in both
   * cases. The boolean return lets the caller skip re-rendering when there is no
   * measured state to refresh.
   */
  remeasureCharacterWidth(): boolean {
    if (this.#canvasCtx === undefined || this.#font === undefined) {
      return false;
    }
    this.#canvasCtx.font = this.#font;
    const ch = this.canvasMeasureTextWidth('0');
    const characterWidthChanged = ch !== this.ch;
    if (characterWidthChanged) {
      this.ch = ch;
    }
    const textWidthCacheCleared = this.#clearTextWidthCache();
    return characterWidthChanged || textWidthCacheCleared;
  }

  /** measure the width of the text */
  measureTextWidth(text: string): number {
    if (!text.includes('\t')) {
      return this.#measureTextWidthWithoutTabs(text);
    }
    if (this.#canvasCtx === undefined) {
      throw new Error('Metrics not initialized');
    }
    const asciiColumns = getExpandedAsciiTextColumns(text, this.tabSize);
    if (asciiColumns !== -1) {
      return asciiColumns * this.ch;
    }

    let width = 0;
    let runStart = 0;
    const tabStopWidth = this.tabSize * this.ch;
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) !== /* '\t' */ 9) {
        continue;
      }

      if (i > runStart) {
        width += this.#measureTextWidthWithoutTabs(text.slice(runStart, i));
      }
      // CSS tab stops are pixel positions, so wide glyphs before a tab must
      // contribute their measured width rather than one logical column.
      if (tabStopWidth > 0) {
        const remainder = width % tabStopWidth;
        width += remainder === 0 ? tabStopWidth : tabStopWidth - remainder;
      }
      runStart = i + 1;
    }

    if (runStart < text.length) {
      width += this.#measureTextWidthWithoutTabs(text.slice(runStart));
    }
    return round(width);
  }

  #measureTextWidthWithoutTabs(text: string): number {
    if (needsDomTextMeasurement(text)) {
      return this.domMeasureTextWidth(text);
    }
    return this.canvasMeasureTextWidth(text);
  }

  /** measure the width of the text using the canvas measureText API */
  canvasMeasureTextWidth(text: string): number {
    if (this.#canvasCtx === undefined) {
      throw new Error('Metrics not initialized');
    }
    return round(this.#canvasCtx.measureText(text).width);
  }

  /**
   * measure the width of the text using the DOM
   * this is slow because it cause a reflow, use it for non-ascii text;
   * results are memoized per text so repeated measurements skip the reflow
   */
  domMeasureTextWidth(text: string): number {
    if (this.#root === undefined) {
      throw new Error('Metrics not initialized');
    }
    const shouldCache = text.length <= TEXT_WIDTH_CACHE_MAX_TEXT_LENGTH;
    const cached = shouldCache ? this.#textWidthCache.get(text) : undefined;
    if (cached !== undefined) {
      return cached;
    }
    const measureEl = h(
      'span',
      {
        style: {
          position: 'absolute',
          top: '0',
          left: '0',
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre',
          font: 'inherit',
        },
        textContent: text,
      },
      this.#root
    );
    let width: number;
    try {
      // round() to match canvasMeasureTextWidth and ch; otherwise the DOM path
      // returns raw sub-pixel widths and caret/selection offsets drift between
      // ASCII and non-ASCII runs on the same line.
      width = round(measureEl.getBoundingClientRect().width);
    } finally {
      measureEl.remove();
    }
    if (shouldCache) {
      if (this.#textWidthCache.size >= TEXT_WIDTH_CACHE_LIMIT) {
        const oldestKey = this.#textWidthCache.keys().next().value;
        if (oldestKey !== undefined) {
          this.#textWidthCache.delete(oldestKey);
        }
      }
      this.#textWidthCache.set(text, width);
    }
    return width;
  }

  /**
   * discard memoized DOM text widths
   * call this when the inherited font may have changed without re-running
   * init(), e.g. on a layout reflow, so stale widths are not reused
   */
  clearTextWidthCache(): void {
    this.#clearTextWidthCache();
  }

  #clearTextWidthCache(): boolean {
    const hadCachedTextWidths = this.#textWidthCache.size > 0;
    this.#textWidthCache.clear();
    return hadCachedTextWidths;
  }
}

/** Check if the text needs DOM text measurement. */
export function needsDomTextMeasurement(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0xd800 && code <= 0xdfff) ||
      code === 0x200d ||
      code === 0xfe0e ||
      code === 0xfe0f ||
      (code > 0x7f && COMBINING_MARK_PATTERN.test(text.charAt(i)))
    ) {
      return true;
    }
  }
  return false;
}

/** snap the text offset to the Unicode boundary */
export function snapTextOffsetToUnicodeBoundary(
  text: string,
  offset: number
): number {
  const boundedOffset = Math.max(0, Math.min(offset, text.length));
  if (
    boundedOffset === 0 ||
    boundedOffset === text.length ||
    !needsDomTextMeasurement(text)
  ) {
    return boundedOffset;
  }
  // Avoid measuring a caret position inside one visual emoji/grapheme.
  // Browser caret movement can report offsets around UTF-16 surrogate
  // pairs and emoji joiners; measuring a partial sequence gives a
  // replacement-glyph width.
  const segmenter = getGraphemeSegmenter();
  if (segmenter !== undefined) {
    for (const segment of segmenter.segment(text)) {
      const segmentStart = segment.index;
      const segmentEnd = segmentStart + segment.segment.length;
      if (boundedOffset > segmentStart && boundedOffset < segmentEnd) {
        return segmentEnd;
      }
      if (boundedOffset <= segmentStart) {
        break;
      }
    }
    return boundedOffset;
  }
  // Degraded path for engines lacking Intl.Segmenter: snap out of a
  // surrogate pair by stepping over code points.
  let segmentStart = 0;
  for (const codePoint of text) {
    const segmentEnd = segmentStart + codePoint.length;
    if (boundedOffset > segmentStart && boundedOffset < segmentEnd) {
      return segmentEnd;
    }
    if (boundedOffset <= segmentStart) {
      break;
    }
    segmentStart = segmentEnd;
  }
  return boundedOffset;
}

/** get the offsets of the Unicode grapheme clusters in the text */
export function getUnicodeMeasurementOffsets(
  text: string
): number[] | undefined {
  if (!needsDomTextMeasurement(text)) {
    return undefined;
  }
  const offsets = [0];
  const segmenter = getGraphemeSegmenter();
  if (segmenter !== undefined) {
    for (const segment of segmenter.segment(text)) {
      offsets.push(segment.index + segment.segment.length);
    }
    return offsets;
  }
  // Degraded path for engines lacking Intl.Segmenter: step by code point.
  let offset = 0;
  for (const codePoint of text) {
    offset += codePoint.length;
    offsets.push(offset);
  }
  return offsets;
}

/**
 * Count the rendered columns of ASCII text, advancing each tab to the next
 * fixed tab stop (a multiple of tabSize) to match CSS `tab-size`. Returns -1
 * for non-ASCII text, which must be measured glyph-by-glyph instead.
 */
export function getExpandedAsciiTextColumns(
  text: string,
  tabSize: number
): number {
  let columns = 0;
  const hasTabStops = tabSize > 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      return -1;
    }
    if (code === /* '\t' */ 9) {
      if (hasTabStops) {
        columns += tabSize - (columns % tabSize);
      }
    } else {
      columns++;
    }
  }
  return columns;
}
