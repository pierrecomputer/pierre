import type { TextDocumentChange } from '../editor/textDocument';
import type { ThemedToken } from '../types';

/** Preserve cached token rows between edits, then apply newly tokenized rows. */
export function realignTokenLines(
  previousLines: string[],
  nextLines: string[],
  tokens: ThemedToken[][],
  lineChanges?: TextDocumentChange['changedLineChanges'],
  pendingTokens?: Map<number, ThemedToken[]>
): ThemedToken[][] {
  const realigned: ThemedToken[][] = new Array(nextLines.length);
  if (lineChanges !== undefined) {
    let nextLine = 0;
    let delta = 0;
    for (const [start, end, lineDelta] of lineChanges) {
      // Ranges use post-edit indexes. Skip rewritten rows and copy the
      // untouched intervals from their original indexes without cloning tokens.
      for (; nextLine < start; nextLine++) {
        realigned[nextLine] = tokens[nextLine - delta];
      }
      nextLine = Math.max(nextLine, end + 1);
      delta += lineDelta;
    }
    for (; nextLine < nextLines.length; nextLine++) {
      realigned[nextLine] = tokens[nextLine - delta];
    }
  } else {
    // Calls without edit metadata can only retain the common prefix/suffix.
    // Parsed diffs omit the trailing empty row that editor documents include.
    const previousLength =
      previousLines.length - (previousLines.at(-1) === '' ? 1 : 0);
    const nextLength = nextLines.length - (nextLines.at(-1) === '' ? 1 : 0);
    const maxShared = Math.min(previousLength, nextLength);
    let prefix = 0;
    while (prefix < maxShared && previousLines[prefix] === nextLines[prefix]) {
      realigned[prefix] = tokens[prefix];
      prefix++;
    }
    let suffix = 0;
    while (
      suffix < maxShared - prefix &&
      previousLines[previousLength - 1 - suffix] ===
        nextLines[nextLength - 1 - suffix]
    ) {
      realigned[nextLength - 1 - suffix] = tokens[previousLength - 1 - suffix];
      suffix++;
    }
    if (
      previousLength < previousLines.length &&
      nextLength < nextLines.length
    ) {
      realigned[nextLines.length - 1] = tokens[previousLines.length - 1];
    }
  }
  if (pendingTokens !== undefined) {
    for (const [line, row] of pendingTokens) {
      if (line < nextLines.length) realigned[line] = row;
    }
  }
  for (let line = 0; line < nextLines.length; line++) {
    if (realigned[line] !== undefined) continue;
    const content = nextLines[line].replace(/(?:\r\n|\r|\n)$/, '');
    realigned[line] =
      content === ''
        ? []
        : [
            {
              offset: 0,
              content,
              htmlAttrs: { 'data-char': '0' },
            },
          ];
  }
  return realigned;
}
