import type { EditorSelection, TextEdit } from '../types';
import type { TextDocument } from './textDocument';

const DEFAULT_LINE_COMMENT = '//';
const DEFAULT_BLOCK_COMMENT = ['/*', '*/'] as const;

export interface LanguageConfig {
  lineComment?: string | null;
  blockComment?: readonly [open: string, close: string];
}

export type LanguageConfigMap = Readonly<Record<string, LanguageConfig>>;

interface ResolvedLanguageConfig {
  lineComment: string | null;
  blockComment: readonly [open: string, close: string];
}

// Language comment configurations
// Languages matching DEFAULT_LINE_COMMENT and DEFAULT_BLOCK_COMMENT are omitted.
const LANGUAGE_COMMENT_CONFIGS: LanguageConfigMap = {
  sql: { lineComment: '--' },
  ruby: { lineComment: '#', blockComment: ['=begin', '=end'] },
  rst: { lineComment: '..' },
  coffeescript: { lineComment: '#', blockComment: ['###', '###'] },
  cmd: { lineComment: '@REM' },
  julia: { lineComment: '#', blockComment: ['#=', '=#'] },
  yaml: { lineComment: '#' },
  yml: { lineComment: '#' },
  markdown: { lineComment: null, blockComment: ['<!--', '-->'] },
  zsh: { lineComment: '#' },
  makefile: { lineComment: '#' },
  handlebars: { lineComment: null, blockComment: ['{{!--', '--}}'] },
  ini: { lineComment: ';', blockComment: [';', ' '] },
  powershell: { lineComment: '#', blockComment: ['<#', '#>'] },
  vb: { lineComment: "'" },
  xml: { lineComment: null, blockComment: ['<!--', '-->'] },
  lua: { lineComment: '--', blockComment: ['--[[', ']]'] },
  html: { lineComment: null, blockComment: ['<!--', '-->'] },
  diff: { lineComment: '#', blockComment: ['#', ' '] },
  r: { lineComment: '#' },
  fsharp: { blockComment: ['(*', '*)'] },
  pug: { lineComment: '//-' },
  perl: { lineComment: '#' },
  tex: { lineComment: '%' },
  clojure: { lineComment: ';;' },
  css: { lineComment: null },
  python: { lineComment: '#', blockComment: ['"""', '"""'] },
  dotenv: { lineComment: '#' },
  dockerfile: { lineComment: '#' },
  razor: { lineComment: null, blockComment: ['<!--', '-->'] },
  prompt: { lineComment: null, blockComment: ['<!--', '-->'] },
};

/** Resolves language-specific comment tokens over the editor defaults. */
export function resolveCommentConfig(
  languageId: string,
  overrides?: LanguageConfigMap
): ResolvedLanguageConfig {
  const config = {
    ...LANGUAGE_COMMENT_CONFIGS[languageId],
    ...overrides?.[languageId],
  };
  return {
    lineComment:
      config.lineComment === undefined
        ? DEFAULT_LINE_COMMENT
        : config.lineComment,
    blockComment: config.blockComment ?? DEFAULT_BLOCK_COMMENT,
  };
}

interface LineCommentInfo {
  line: number;
  comment: number;
  empty: boolean;
  indent: number;
  single: boolean;
}

/** Builds one aligned batch of line-comment edits for all selected lines. */
export function resolveLineCommentEdits(
  textDocument: TextDocument<unknown>,
  selections: readonly EditorSelection[],
  token: string
): TextEdit[] {
  const lines: LineCommentInfo[] = [];
  const seenLines = new Set<number>();

  for (const selection of selections) {
    let endLine = selection.end.line;
    if (selection.start.line < endLine && selection.end.character === 0) {
      endLine--;
    }

    const startIndex = lines.length;
    let minIndent = Infinity;
    for (let line = selection.start.line; line <= endLine; line++) {
      if (seenLines.has(line)) {
        continue;
      }
      seenLines.add(line);
      const text = textDocument.getLineText(line);
      const indent = text.length - text.trimStart().length;
      const empty = indent === text.length;
      if (!empty) {
        minIndent = Math.min(minIndent, indent);
      }
      lines.push({
        line,
        comment:
          text.slice(indent, indent + token.length) === token ? indent : -1,
        empty,
        indent,
        single: false,
      });
    }

    if (minIndent !== Infinity) {
      for (let index = startIndex; index < lines.length; index++) {
        if (!lines[index].empty) {
          lines[index].indent = minIndent;
        }
      }
    }
    if (lines.length === startIndex + 1) {
      lines[startIndex].single = true;
    }
  }

  const shouldComment = lines.some(
    (line) => line.comment < 0 && (!line.empty || line.single)
  );
  const edits: TextEdit[] = [];
  if (shouldComment) {
    for (const line of lines) {
      if (line.empty && !line.single) {
        continue;
      }
      const position = { line: line.line, character: line.indent };
      edits.push({
        range: { start: position, end: position },
        newText: token + ' ',
      });
    }
    return edits;
  }

  for (const line of lines) {
    if (line.comment < 0) {
      continue;
    }
    const text = textDocument.getLineText(line.line);
    const start = line.comment;
    const end =
      start + token.length + (text[start + token.length] === ' ' ? 1 : 0);
    edits.push({
      range: {
        start: { line: line.line, character: start },
        end: { line: line.line, character: end },
      },
      newText: '',
    });
  }
  return edits;
}

interface OffsetEdit {
  start: number;
  end: number;
  text: string;
}

interface BlockCommentMatch {
  open: OffsetEdit;
  close: OffsetEdit;
  contentStart: number;
  contentEnd: number;
}

export interface BlockCommentEditResult {
  edits: TextEdit[];
  nextSelectionOffsets: Array<
    readonly [
      start: number,
      end: number,
      direction: EditorSelection['direction'],
    ]
  >;
}

const BLOCK_COMMENT_SEARCH_MARGIN = 50;

function findBlockComment(
  textDocument: TextDocument<unknown>,
  open: string,
  close: string,
  from: number,
  to: number
): BlockCommentMatch | undefined {
  const beforeStart = Math.max(0, from - BLOCK_COMMENT_SEARCH_MARGIN);
  const textBefore = textDocument.getTextSlice(beforeStart, from);
  const textAfter = textDocument.getTextSlice(
    to,
    to + BLOCK_COMMENT_SEARCH_MARGIN
  );
  const spaceBefore = textBefore.length - textBefore.trimEnd().length;
  const spaceAfter = textAfter.length - textAfter.trimStart().length;
  const beforeOffset = textBefore.length - spaceBefore;
  if (
    textBefore.slice(beforeOffset - open.length, beforeOffset) === open &&
    textAfter.slice(spaceAfter, spaceAfter + close.length) === close
  ) {
    return {
      open: {
        start: from - spaceBefore - open.length,
        end: from - spaceBefore + (spaceBefore > 0 ? 1 : 0),
        text: '',
      },
      close: {
        start: to + spaceAfter - (spaceAfter > 0 ? 1 : 0),
        end: to + spaceAfter + close.length,
        text: '',
      },
      contentStart: from,
      contentEnd: to,
    };
  }

  const length = to - from;
  const shortText =
    length <= BLOCK_COMMENT_SEARCH_MARGIN * 2
      ? textDocument.getTextSlice(from, to)
      : undefined;
  const startText =
    shortText ??
    textDocument.getTextSlice(from, from + BLOCK_COMMENT_SEARCH_MARGIN);
  const endText =
    shortText ??
    textDocument.getTextSlice(to - BLOCK_COMMENT_SEARCH_MARGIN, to);
  const startSpace = startText.length - startText.trimStart().length;
  const endSpace = endText.length - endText.trimEnd().length;
  const closeStart = to - endSpace - close.length;
  if (
    startText.slice(startSpace, startSpace + open.length) !== open ||
    textDocument.getTextSlice(closeStart, closeStart + close.length) !== close
  ) {
    return undefined;
  }

  const openStart = from + startSpace;
  const openEnd =
    openStart +
    open.length +
    (/\s/.test(startText[open.length + startSpace] ?? '') ? 1 : 0);
  const closeDeleteStart =
    closeStart -
    (/\s/.test(textDocument.getTextSlice(closeStart - 1, closeStart)) ? 1 : 0);
  return {
    open: { start: openStart, end: openEnd, text: '' },
    close: {
      start: closeDeleteStart,
      end: closeStart + close.length,
      text: '',
    },
    contentStart: openEnd,
    contentEnd: closeDeleteStart,
  };
}

function mapOffset(
  offset: number,
  edits: readonly OffsetEdit[],
  cumulativeDeltas: readonly number[],
  association: -1 | 1
): number {
  let low = 0;
  let high = edits.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (edits[middle].end < offset) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }

  let delta = cumulativeDeltas[low];
  for (let index = low; index < edits.length; index++) {
    const edit = edits[index];
    if (offset < edit.start) {
      break;
    }
    if (edit.start === edit.end && offset === edit.start) {
      if (association < 0) {
        break;
      }
      delta += edit.text.length;
      continue;
    }
    if (offset > edit.end) {
      delta += edit.text.length - (edit.end - edit.start);
      continue;
    }
    if (offset === edit.end) {
      return edit.start + delta + edit.text.length;
    }
    return edit.start + delta + (association > 0 ? edit.text.length : 0);
  }
  return offset + delta;
}

/** Builds block-comment edits and content-preserving post-edit selections. */
export function resolveBlockCommentEdits(
  textDocument: TextDocument<unknown>,
  selections: readonly EditorSelection[],
  [open, close]: readonly [string, string],
  linewise = false
): BlockCommentEditResult | undefined {
  const ranges = selections.map((selection) => {
    let { start, end } = selection;
    if (linewise) {
      let endLine = end.line;
      if (start.line < endLine && end.character === 0) {
        endLine--;
      }
      const firstLine = textDocument.getLineText(start.line);
      const indent = firstLine.length - firstLine.trimStart().length;
      start = { line: start.line, character: indent };
      end = {
        line: endLine,
        character: textDocument.getLineLength(endLine),
      };
    }
    return {
      from: textDocument.offsetAt(start),
      to: textDocument.offsetAt(end),
      direction: selection.direction,
      comment: undefined as BlockCommentMatch | undefined,
    };
  });
  if (linewise && ranges.length > 1) {
    ranges.sort((a, b) => {
      const startOrder = a.from - b.from;
      return startOrder !== 0 ? startOrder : a.to - b.to;
    });
    let lastRangeIndex = 0;
    for (let index = 1; index < ranges.length; index++) {
      const previous = ranges[lastRangeIndex];
      const current = ranges[index];
      if (current.from <= previous.to) {
        previous.to = Math.max(previous.to, current.to);
      } else {
        ranges[++lastRangeIndex] = current;
      }
    }
    ranges.length = lastRangeIndex + 1;
  }
  for (const range of ranges) {
    range.comment = findBlockComment(
      textDocument,
      open,
      close,
      range.from,
      range.to
    );
  }

  const shouldUncomment = ranges.every((range) => range.comment !== undefined);
  const offsetEdits: OffsetEdit[] = [];
  for (const range of ranges) {
    const comment = range.comment;
    if (shouldUncomment && comment !== undefined) {
      offsetEdits.push(comment.open, comment.close);
      continue;
    }
    if (comment !== undefined) {
      continue;
    }
    if (range.from === range.to) {
      offsetEdits.push({
        start: range.from,
        end: range.to,
        text: open + '  ' + close,
      });
      continue;
    }
    offsetEdits.push(
      { start: range.from, end: range.from, text: open + ' ' },
      { start: range.to, end: range.to, text: ' ' + close }
    );
  }

  if (offsetEdits.length === 0) {
    return undefined;
  }
  offsetEdits.sort((a, b) => {
    const startOrder = a.start - b.start;
    return startOrder !== 0 ? startOrder : a.end - b.end;
  });
  const edits = offsetEdits.map((edit) => ({
    range: {
      start: textDocument.positionAt(edit.start),
      end: textDocument.positionAt(edit.end),
    },
    newText: edit.text,
  }));
  if (linewise) {
    return { edits, nextSelectionOffsets: [] };
  }

  const logicalRanges: Array<{
    start: number;
    end: number;
    startAssociation: -1 | 1;
    endAssociation: -1 | 1;
    collapsedInset?: number;
  }> = ranges.map((range) => {
    const comment = range.comment;
    if (shouldUncomment && comment !== undefined) {
      return {
        start: comment.contentStart,
        end: comment.contentEnd,
        startAssociation: 1,
        endAssociation: -1,
      };
    }
    if (comment !== undefined) {
      return {
        start: range.from,
        end: range.to,
        startAssociation: 1,
        endAssociation: 1,
      };
    }
    if (range.from === range.to) {
      return {
        start: range.from,
        end: range.to,
        startAssociation: -1,
        endAssociation: -1,
        collapsedInset: open.length + 1,
      };
    }
    return {
      start: range.from,
      end: range.to,
      startAssociation: 1,
      endAssociation: -1,
    };
  });
  const cumulativeDeltas = new Array<number>(offsetEdits.length + 1);
  cumulativeDeltas[0] = 0;
  for (let index = 0; index < offsetEdits.length; index++) {
    const edit = offsetEdits[index];
    cumulativeDeltas[index + 1] =
      cumulativeDeltas[index] + edit.text.length - (edit.end - edit.start);
  }
  const nextSelectionOffsets = logicalRanges.map((range, index) => {
    const start =
      mapOffset(
        range.start,
        offsetEdits,
        cumulativeDeltas,
        range.startAssociation
      ) + (range.collapsedInset ?? 0);
    const end =
      range.collapsedInset === undefined
        ? mapOffset(
            range.end,
            offsetEdits,
            cumulativeDeltas,
            range.endAssociation
          )
        : start;
    return [start, end, ranges[index].direction] as const;
  });

  return {
    edits,
    nextSelectionOffsets,
  };
}
