import type { ThemedToken } from '../types';

/** Keep cached token offsets relative to the document after windows or edits. */
export function updateTokenOffsets(
  tokens: ThemedToken[][],
  lines: string[]
): void {
  let offset = 0;
  const end = Math.min(tokens.length, lines.length);
  for (let index = 0; index < end; index++) {
    const line = tokens[index];
    if (line?.length > 0) {
      const shift = offset - line[0].offset;
      if (shift !== 0) {
        tokens[index] = line.map((token) => ({
          ...token,
          offset: token.offset + shift,
        }));
      }
    }
    offset += lines[index].length;
  }
}
