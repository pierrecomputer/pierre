import type {
  HighlighterCore,
  CodeToTokensOptions as ShikiTokenOptions,
} from 'shiki/core';

import type { ThemedToken } from '../../types';

const decorations = new Set([1, 2, 3, 4, 7, 8, 9, 53]);

/** Carry ANSI styles as a bounded SGR prefix while Shiki renders each chunk. */
export function getShikiAnsiTokens(
  highlighter: HighlighterCore,
  code: string,
  options: ShikiTokenOptions,
  state = ''
): { tokens: ThemedToken[][]; state: string } {
  const prefix = state === '' ? '' : state + '\n';
  const { tokens } = highlighter.codeToTokens(prefix + code, options);
  if (prefix !== '') {
    tokens.shift();
    for (const line of tokens) {
      for (const token of line) token.offset -= prefix.length;
    }
  }
  const active = new Map<number, string>();
  for (const line of [state, ...code.split(/\r?\n/)]) {
    let position = 0;
    while (position < line.length) {
      const start = line.indexOf('\x1b', position);
      if (start === -1 || line[start + 1] !== '[') break;
      const end = line.indexOf('m', start + 2);
      if (end === -1) break;
      const values = line.slice(start + 2, end).split(';');
      const added = new Map<number, string>();
      // Shiki applies every reset in a sequence before applying its settings.
      for (let i = 0; i < values.length; i++) {
        const value = Number.parseInt(values[i]);
        if (value === 0) active.clear();
        else if (decorations.has(value)) added.set(value, String(value));
        else if (value === 39 || value === 49) active.delete(value - 9);
        else if (value === 55 || (value >= 21 && value <= 29)) {
          active.delete(value === 55 ? 53 : value - 20);
          if (value === 22) active.delete(1);
        } else if (value === 38 || value === 48) {
          const mode = values[++i];
          if (mode === '2') {
            const rgb = values
              .slice(i + 1, i + 4)
              .map((value) => Number.parseInt(value));
            i += 3;
            if (
              rgb.length === 3 &&
              rgb.every((value) => !Number.isNaN(value))
            ) {
              added.set(
                value - 8,
                `${value};2;${rgb.map((value) => Math.max(0, Math.min(value, 255))).join(';')}`
              );
            }
          } else if (mode === '5') {
            const index = values[++i];
            if (index != null && index !== '')
              added.set(value - 8, `${value};5;${Number(index)}`);
          }
        } else if (
          (value >= 30 && value <= 37) ||
          (value >= 90 && value <= 97)
        ) {
          added.set(30, String(value));
        } else if (
          (value >= 40 && value <= 47) ||
          (value >= 100 && value <= 107)
        ) {
          added.set(40, String(value));
        }
      }
      for (const [key, value] of added) active.set(key, value);
      position = end + 1;
    }
  }
  return {
    tokens,
    state:
      active.size === 0
        ? ''
        : `\x1b[${[...active]
            .sort(([a], [b]) => a - b)
            .map(([, value]) => value)
            .join(';')}m`,
  };
}
