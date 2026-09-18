import type { ThemedToken } from '../types';

const WHITESPACE_ONLY = /^\s+$/;
// Underline (4) and strikethrough (8) draw across whitespace, so tokens with
// either style keep whitespace separate.
const STYLES_DRAWN_ACROSS_WHITESPACE = 4 | 8;

/**
 * Fold whitespace-only tokens into the token that follows them, matching the
 * `mergeWhitespaces` behavior of Shiki's HTML output. Without this, every
 * indentation run renders as its own styled element with no visible
 * difference, which inflates rendered HTML and element counts.
 */
export function mergeWhitespaceTokens(line: ThemedToken[]): ThemedToken[] {
  const merged: ThemedToken[] = [];
  let carried = '';
  let carriedOffset = 0;
  for (let index = 0; index < line.length; index++) {
    const token = line[index];
    const couldMerge =
      ((token.fontStyle ?? 0) & STYLES_DRAWN_ACROSS_WHITESPACE) === 0;
    if (
      couldMerge &&
      index + 1 < line.length &&
      WHITESPACE_ONLY.test(token.content)
    ) {
      if (carried === '') carriedOffset = token.offset;
      carried += token.content;
    } else if (carried !== '') {
      if (couldMerge) {
        merged.push({
          ...token,
          offset: carriedOffset,
          content: carried + token.content,
        });
      } else {
        merged.push({ content: carried, offset: carriedOffset }, token);
      }
      carried = '';
    } else {
      merged.push(token);
    }
  }
  return merged;
}
