import type { DecorationItem, LineInfo, ThemedToken } from '../types';
import { attributesToHTML, escapeHTML, type RenderedLine } from './html';
import { tokensToHtml, tokenStyle } from './tokensToHtml';

/** Serialize visible tokens with the current line metadata and decorations. */
export function renderTokenLines(
  lines: ThemedToken[][],
  lineInfo: (LineInfo | undefined)[] | ((line: number) => LineInfo),
  useTokenTransformer: boolean,
  decorations: DecorationItem[] = []
): RenderedLine[] {
  const byLine = new Map<number, DecorationItem[]>();
  for (const decoration of decorations) {
    const line = decoration.start.line;
    const ranges = byLine.get(line) ?? [];
    ranges.push(decoration);
    byLine.set(line, ranges);
  }
  return lines.map((originalTokens, index) => {
    const info =
      typeof lineInfo === 'function' ? lineInfo(index + 1) : lineInfo[index];
    if (info == null)
      throw new Error(
        `renderTokenLines: line ${index + 1} contains no line info`
      );
    // Preserve Shiki's whitespace behavior, including standalone whitespace for token events.
    const tokens: ThemedToken[] = [];
    if (useTokenTransformer) {
      for (const token of originalTokens) {
        if (token.htmlAttrs?.['data-char'] != null) {
          tokens.push(token);
          continue;
        }
        const match = token.content.match(/^(\s*)(\S[\s\S]*?)(\s*)$/);
        if (match == null || (match[1] === '' && match[3] === '')) {
          tokens.push(token);
          continue;
        }
        if (match[1] !== '')
          tokens.push({ content: match[1], offset: token.offset });
        tokens.push({
          ...token,
          content: match[2],
          offset: token.offset + match[1].length,
        });
        if (match[3] !== '')
          tokens.push({
            content: match[3],
            offset: token.offset + match[1].length + match[2].length,
          });
      }
    } else {
      let carry = '';
      let offset = 0;
      for (let i = 0; i < originalTokens.length; i++) {
        const token = originalTokens[i];
        const merge = ((token.fontStyle ?? 0) & 12) === 0;
        if (
          merge &&
          /^\s+$/.test(token.content) &&
          i + 1 < originalTokens.length
        ) {
          if (carry === '') offset = token.offset;
          carry += token.content;
        } else {
          if (carry !== '') {
            if (merge)
              tokens.push({ ...token, offset, content: carry + token.content });
            else tokens.push({ content: carry, offset }, token);
            carry = '';
          } else tokens.push(token);
        }
      }
    }
    const ranges = byLine.get(index) ?? [];
    let html = '';
    if (ranges.length === 0 && !useTokenTransformer) {
      html = tokensToHtml([tokens]);
    } else if (!useTokenTransformer) {
      // Decoration wrappers stay open across token boundaries so rounded
      // emphasis backgrounds cover the complete changed range.
      let char = 0;
      let rangeIndex = 0;
      let openRange = false;
      for (const token of tokens) {
        const end = char + token.content.length;
        let offset = 0;
        while (char < end) {
          while (
            ranges[rangeIndex] != null &&
            ranges[rangeIndex].end.character <= char
          )
            rangeIndex++;
          const range = ranges[rangeIndex];
          if (range != null && range.start.character === char) {
            html += `<span${attributesToHTML(range.properties ?? {})}>`;
            openRange = true;
          }
          const next = Math.min(
            end,
            range == null
              ? end
              : openRange
                ? range.end.character
                : range.start.character
          );
          html += tokensToHtml([
            [
              {
                ...token,
                content: token.content.slice(offset, offset + next - char),
              },
            ],
          ]);
          offset += next - char;
          char = next;
          if (openRange && range?.end.character === char) {
            html += '</span>';
            openRange = false;
          }
        }
        if (token.content === '') html += tokensToHtml([[token]]);
      }
      if (openRange) html += '</span>';
    } else {
      let char = 0;
      for (const token of tokens) {
        const start = char;
        const end = (char += token.content.length);
        const cuts = [start, end];
        for (const range of ranges) {
          if (range.start.character > start && range.start.character < end)
            cuts.push(range.start.character);
          if (range.end.character > start && range.end.character < end)
            cuts.push(range.end.character);
        }
        cuts.sort((a, b) => a - b);
        const style = tokenStyle(token);
        const attrs = {
          ...token.htmlAttrs,
          'data-char': start,
          ...(style !== '' ? { style } : undefined),
        };
        let content = '';
        for (let i = 1; i < cuts.length; i++) {
          const from = cuts[i - 1];
          const to = cuts[i];
          if (from === to) continue;
          let part = escapeHTML(token.content.slice(from - start, to - start));
          for (const range of ranges) {
            if (from >= range.start.character && to <= range.end.character) {
              // Token wrappers must stay intact for interactions. Square the
              // adjoining fragments so only the actual range ends are rounded.
              const properties = {
                ...range.properties,
                'data-diff-span-start':
                  range.properties?.['data-diff-span'] != null &&
                  from > range.start.character
                    ? 'continued'
                    : undefined,
                'data-diff-span-end':
                  range.properties?.['data-diff-span'] != null &&
                  to < range.end.character
                    ? 'continued'
                    : undefined,
              };
              part = `<span${attributesToHTML(properties)}>${part}</span>`;
            }
          }
          content += part;
        }
        html += `<span${attributesToHTML(attrs)}>${content}</span>`;
      }
    }
    if (tokens.length === 0) html = useTokenTransformer ? '<br>' : '\n';
    return {
      html,
      properties: {
        'data-line': info.lineNumber,
        'data-alt-line': info.altLineNumber,
        'data-line-type': info.type,
        'data-line-index': info.lineIndex,
      },
    };
  });
}
