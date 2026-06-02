import { h, round } from './utils';

export class Metrics {
  #root?: HTMLElement;
  #canvasCtx?: CanvasRenderingContext2D;
  #font?: string;

  /** Width of the '0' character. */
  ch: number = -1;
  /** Size of a tab(\t) character. */
  tabSize: number = 2;
  /** Height of the code line. */
  lineHeight: number = 20;

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
    }
    this.tabSize = parseInt(tabSize, 10);
  }

  /** measure the width of the text */
  measureTextWidth(text: string): number {
    const textWithExpandedTabs = text.replaceAll(
      '\t',
      ' '.repeat(this.tabSize)
    );
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
   * this is slow because it cause a reflow, use it for non-ascii text
   */
  domMeasureTextWidth(text: string): number {
    if (this.#root === undefined) {
      throw new Error('Metrics not initialized');
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
    try {
      return measureEl.getBoundingClientRect().width;
    } finally {
      measureEl.remove();
    }
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
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });
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

/** get the offsets of the Unicode grapheme clusters in the text */
export function getUnicodeMeasurementOffsets(
  text: string
): number[] | undefined {
  if (!needsDomTextMeasurement(text)) {
    return undefined;
  }
  const offsets = [0];
  const segmenter = new Intl.Segmenter(undefined, {
    granularity: 'grapheme',
  });
  for (const segment of segmenter.segment(text)) {
    offsets.push(segment.index + segment.segment.length);
  }
  return offsets;
}

/** get the number of columns of the ASCII text */
export function getExpandedAsciiTextColumns(
  text: string,
  tabSize: number
): number {
  let columns = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 127) {
      return -1;
    }
    columns += text.charCodeAt(i) === /* '\t' */ 9 ? tabSize : 1;
  }
  return columns;
}
