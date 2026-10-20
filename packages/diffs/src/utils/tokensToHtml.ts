import type { Element, Root } from 'hast';

import type { CodeToHtmlOptions, TokensResult } from '../types';
import { hastToHtml } from './hastToHtml';
import { renderTokenLines } from './renderTokenLines';

/**
 * Renders existing tokens as a pre/code HTML block without highlighting again.
 * Pass the original source to resolve numeric decoration offsets.
 */
export function tokensToHtml(
  source: string,
  result: TokensResult,
  options: CodeToHtmlOptions,
  cacheHtmlStyles: boolean = false
): string {
  const lineOffsets = [0];
  if (
    options.decorations?.some(
      (item) => typeof item.start === 'number' || typeof item.end === 'number'
    ) === true
  ) {
    for (
      let index = source.indexOf('\n');
      index !== -1;
      index = source.indexOf('\n', index + 1)
    )
      lineOffsets.push(index + 1);
  }
  const code: Element = {
    type: 'element',
    tagName: 'code',
    properties: {},
    children: [],
  };
  const lines = renderTokenLines(result.tokens, {
    decorations: options.decorations,
    mergeWhitespaces: options.mergeWhitespaces,
    lineOffsets,
    cacheHtmlStyles,
  });
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) code.children.push({ type: 'text', value: '\n' });
    code.children.push(lines[i]);
  }
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'pre',
        properties: {
          class: 'diffs',
          style:
            result.rootStyle === false
              ? undefined
              : (result.rootStyle ??
                [
                  result.fg != null ? `color:${result.fg}` : '',
                  result.bg != null ? `background-color:${result.bg}` : '',
                ]
                  .filter(Boolean)
                  .join(';')),
          tabIndex: 0,
        },
        children: [code],
      },
    ],
  };
  return hastToHtml(root);
}
