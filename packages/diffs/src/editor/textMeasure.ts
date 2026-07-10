import { getGraphemeSegmenter, h, round } from './utils';

// Upper bound on cached DOM text-width measurements. The cache only holds
// non-ASCII runs (emoji, ZWJ sequences, variation selectors), so it stays
// small for ordinary code, but capping it prevents unbounded growth on
// emoji-heavy documents. Past the cap the oldest entry is evicted.
const TEXT_WIDTH_CACHE_LIMIT = 4096;

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
    if (
      this.#root === root &&
      this.#canvasCtx !== undefined &&
      this.ch !== -1
    ) {
      // already initialized
      return;
    }

    this.#root = root;
    this.#canvasCtx ??=
      document.createElement('canvas').getContext('2d') ?? undefined;
    if (this.#canvasCtx === undefined) {
      throw new Error('Could not get canvas context');
    }

    const parent = root.parentElement;
    if (parent !== null) {
      const { paddingTop } = getComputedStyle(parent);
      if (paddingTop.endsWith('px')) {
        this.paddingTop = parseFloat(paddingTop.slice(0, -2));
      }
    }

    const { fontSize, fontFamily, tabSize, lineHeight } =
      getComputedStyle(root);
    if (lineHeight.endsWith('px')) {
      this.lineHeight = parseFloat(lineHeight.slice(0, -2));
    } else if (fontSize.endsWith('px')) {
      this.lineHeight = round(
        parseFloat(fontSize.slice(0, -2)) * parseFloat(lineHeight)
      );
    }
    const font = fontSize + ' ' + fontFamily;
    if (this.#font !== font || this.ch === -1) {
      this.#font = font;
      this.#canvasCtx.font = font;
      this.ch = this.canvasMeasureTextWidth('0');
      // Cached DOM widths were measured against the previous font.
      this.clearTextWidthCache();
    }
    const nextTabSize = parseInt(tabSize, 10);
    if (!Number.isNaN(nextTabSize)) {
      this.tabSize = nextTabSize;
    }
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
    const textWithExpandedTabs = expandTabsToSpaces(text, this.tabSize);
    if (needsDomTextMeasurement(textWithExpandedTabs)) {
      return this.domMeasureTextWidth(textWithExpandedTabs);
    }
    return this.canvasMeasureTextWidth(textWithExpandedTabs);
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
    const cacheKey = text + '|' + this.#font;
    const cached = this.#textWidthCache.get(cacheKey);
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
    if (this.#textWidthCache.size >= TEXT_WIDTH_CACHE_LIMIT) {
      const oldestKey = this.#textWidthCache.keys().next().value;
      if (oldestKey !== undefined) {
        this.#textWidthCache.delete(oldestKey);
      }
    }
    this.#textWidthCache.set(cacheKey, width);
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
      code === 0xfe0f
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
 * Expand tab characters to spaces using fixed tab stops: each tab advances to
 * the next multiple of tabSize from its running column, matching how the
 * rendered text expands tabs via CSS `tab-size`. Expanding every tab to a flat
 * tabSize would mis-measure tabs that follow other characters on the same line
 * (e.g. an alignment tab in `foo\tbar`).
 */
export function expandTabsToSpaces(text: string, tabSize: number): string {
  if (!text.includes('\t')) {
    return text;
  }
  let result = '';
  let column = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === /* '\t' */ 9) {
      const advance = tabSize - (column % tabSize);
      result += ' '.repeat(advance);
      column += advance;
    } else {
      result += text[i];
      column += 1;
    }
  }
  return result;
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
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 127) {
      return -1;
    }
    columns += code === /* '\t' */ 9 ? tabSize - (columns % tabSize) : 1;
  }
  return columns;
}
