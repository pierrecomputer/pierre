import type {
  DiffsStreamTokenizer,
  DiffsStreamTokenizerEnqueueResult,
} from './tokenizer-types';
import type { ThemedToken } from './types';

/**
 * Chunk bookkeeping shared by the backend stream tokenizers. A carriage
 * return ending a chunk waits for the next chunk, since it may start a CRLF
 * pair; token offsets count from the start of the whole stream; and the last,
 * unterminated line stays provisional so a later chunk can recall its tokens.
 * Subclasses tokenize one chunk's text and report each completed line.
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
    // The held-back carriage return is still part of the provisional line's
    // source, so token text keeps round-tripping the streamed input.
    if (this.pendingCarriageReturn !== '')
      unstable.push({ content: '\r', offset: this.stableOffset + tailLength });
    this.unstable = unstable;
    return { recall, stable, unstable };
  }

  /**
   * Tokenize `chunk` appended to the provisional line. Completed lines and
   * their line breaks go to `stable` through `pushLineBreak`; the new
   * provisional line's tokens and UTF-16 length are returned.
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

  /** Copy the shared bookkeeping into a clone a subclass created. */
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

  /** Release backend resources; the tokenizer is not used afterwards. */
  protected abstract releaseSource(): void;
}
