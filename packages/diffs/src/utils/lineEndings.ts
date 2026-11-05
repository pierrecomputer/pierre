export type LineEnding = '\n' | '\r\n' | '\r';

/** The line ending a file uses, read from its first line break. */
export function lineEndingOf(text: string): LineEnding {
  const first = /\r\n|\r|\n/.exec(text)?.[0];
  return first === '\r\n' || first === '\r' ? first : '\n';
}

/** `text` with every line break rewritten to `\n`. */
export function normalizeLineBreaks(text: string): string {
  return text.includes('\r') ? text.replace(/\r\n|\r/g, '\n') : text;
}

/** `text` with every line break rewritten to the one its first line uses. */
export function uniformLineEndings(text: string): string {
  if (!text.includes('\r')) {
    return text;
  }
  const eol = lineEndingOf(text);
  return text.replace(/\r\n|\r|\n/g, eol);
}
