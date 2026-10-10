import type {
  DiffsStreamTokenizer,
  DiffsStreamTokenizerEnqueueResult,
} from './tokenizer-types';
import type { ThemedToken } from './types';

/**
 * The final line stays provisional until a line break or stream close.
 * A trailing CR waits for the next chunk, which may complete a CRLF pair.
 * Token offsets are absolute UTF-16 positions in the stream.
 */
export abstract class BaseStreamTokenizer implements DiffsStreamTokenizer {
  protected disposed = false;
  /** Stream offset of the provisional line's first character. */
  protected stableOffset = 0;
  protected unstable: ThemedToken[] = [];
  protected pendingCarriageReturn = '';

  enqueue(chunk: string): DiffsStreamTokenizerEnqueueResult {
    this.assertActive();
    chunk = this.pendingCarriageReturn + chunk;
    this.pendingCarriageReturn = chunk.endsWith('\r') ? '\r' : '';
    if (this.pendingCarriageReturn !== '') chunk = chunk.slice(0, -1);
    const recall = this.unstable.length;
    const stable: ThemedToken[] = [];
    const { unstable, tailLength } = this.tokenizeChunk(chunk, stable);
    // Include the pending CR so token contents still reproduce the input.
    if (this.pendingCarriageReturn !== '')
      unstable.push({ content: '\r', offset: this.stableOffset + tailLength });
    this.unstable = unstable;
    return { recall, stable, unstable };
  }

  /**
   * Append completed lines to stable, using pushLineBreak for their endings.
   * Return the unfinished line's tokens and UTF-16 length.
   */
  protected abstract tokenizeChunk(
    chunk: string,
    stable: ThemedToken[]
  ): { unstable: ThemedToken[]; tailLength: number };

  /** Emit one token per line-break character and move past the line. */
  protected pushLineBreak(
    stable: ThemedToken[],
    lineLength: number,
    lineBreak: string
  ): void {
    for (let index = 0; index < lineBreak.length; index++) {
      stable.push({
        content: lineBreak[index],
        offset: this.stableOffset + lineLength + index,
      });
    }
    this.stableOffset += lineLength + lineBreak.length;
  }

  close(): { stable: ThemedToken[] } {
    const stable = this.unstable;
    this.dispose();
    return { stable };
  }

  clear(): void {
    this.assertActive();
    this.stableOffset = 0;
    this.unstable = [];
    this.pendingCarriageReturn = '';
    this.resetSource();
  }

  abstract clone(): DiffsStreamTokenizer;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unstable = [];
    this.releaseSource();
  }

  protected copyStateTo(clone: BaseStreamTokenizer): void {
    clone.stableOffset = this.stableOffset;
    clone.unstable = this.unstable.slice();
    clone.pendingCarriageReturn = this.pendingCarriageReturn;
  }

  protected assertActive(): void {
    if (this.disposed) throw new Error('stream tokenizer is disposed');
  }

  /** Forget the provisional line and any lexer state. */
  protected abstract resetSource(): void;

  protected abstract releaseSource(): void;
}
