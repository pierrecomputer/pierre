import type { SVGSpriteNames } from '../sprite';
import type {
  LineTypes,
  SemanticDiffOperation,
  SemanticDiffOperationType,
  SemanticDiffSpan,
} from '../types';

/** The line types a semantic range can give its lines. */
type SemanticLineType = Exclude<LineTypes, 'context' | 'context-expanded'>;

/** Glyphs that have both a tinted (`-duo`) and a solid (`-fill`) icon. */
type SemanticIconGlyph =
  | 'added'
  | 'deleted'
  | 'moved'
  | 'extracted'
  | 'inlined'
  | 'modified';

type SemanticLineIcon = Extract<
  SVGSpriteNames,
  | `diffs-icon-symbol-${SemanticIconGlyph}-${'duo' | 'fill'}`
  | 'diffs-icon-eye-slash'
>;

interface SemanticDiffLine {
  start: number;
  end: number;
  lineType: SemanticLineType;
  operation: SemanticDiffOperation;
  span: SemanticDiffSpan;
  /**
   * Whether this range's first line starts a region and shows its gutter icon:
   * it does unless the line above is drawn with the same icon and color.
   */
  showsIcon: boolean;
}

export interface SemanticDiffLineLookup {
  additions: readonly SemanticDiffLine[];
  deletions: readonly SemanticDiffLine[];
}

const LINE_TYPE_BY_OPERATION: Record<
  SemanticDiffOperationType,
  SemanticLineType
> = {
  moved: 'change-moved',
  movedWithEdit: 'change-moved-with-edit',
  edited: 'change-edited',
  added: 'change-addition',
  deleted: 'change-deletion',
  renamed: 'change-renamed',
  reordered: 'change-reordered',
  reformatted: 'change-reformatted',
  extractedFunction: 'change-extracted-function',
  inlinedFunction: 'change-inlined-function',
};

/** The color groups in `style.css`: one background, bar, and number color. */
type SemanticLineColor =
  | 'addition'
  | 'deletion'
  | 'moved'
  | 'edited'
  | 'reformatted';

interface SemanticLineGutterStyle {
  /** `eye-slash` (reformatted) exists only as an outline icon. */
  glyph: SemanticIconGlyph | 'eye-slash';
  color: SemanticLineColor;
}

// How each line type looks in the gutter. `color` must match the line type
// groups in style.css.
const GUTTER_STYLE_BY_LINE_TYPE: Record<
  SemanticLineType,
  SemanticLineGutterStyle
> = {
  'change-addition': { glyph: 'added', color: 'addition' },
  'change-deletion': { glyph: 'deleted', color: 'deletion' },
  'change-moved': { glyph: 'moved', color: 'moved' },
  'change-reordered': { glyph: 'moved', color: 'moved' },
  'change-extracted-function': { glyph: 'extracted', color: 'moved' },
  'change-inlined-function': { glyph: 'inlined', color: 'moved' },
  'change-moved-with-edit': { glyph: 'moved', color: 'edited' },
  'change-edited': { glyph: 'modified', color: 'edited' },
  'change-renamed': { glyph: 'modified', color: 'edited' },
  'change-reformatted': { glyph: 'eye-slash', color: 'reformatted' },
};

// Resolve supplied ownership runs once, preserving the original operation and
// span objects. Sorting the runs avoids expanding them into individual lines.
export function createSemanticDiffLineLookup(
  operations: SemanticDiffOperation[]
): SemanticDiffLineLookup {
  const additions: SemanticDiffLine[] = [];
  const deletions: SemanticDiffLine[] = [];
  for (const operation of operations) {
    for (const side of ['old', 'new'] as const) {
      const entries = side === 'old' ? deletions : additions;
      for (const range of operation.lines[side]) {
        const span = operation.spans[range.spanIndex];
        entries.push({
          start: range.start,
          end: range.end,
          lineType: semanticLineType(operation, span),
          operation,
          span,
          showsIcon: true,
        });
      }
    }
  }
  additions.sort((a, b) => a.start - b.start);
  deletions.sort((a, b) => a.start - b.start);
  hideContinuedRegionIcons(additions);
  hideContinuedRegionIcons(deletions);
  return { additions, deletions };
}

// Hide the icon of a range that starts directly below a range with the same
// glyph and color, such as an edit below a rename. Ranges on one side never
// overlap, so only the previous sorted entry can end on the line above.
function hideContinuedRegionIcons(entries: SemanticDiffLine[]): void {
  for (let index = 1; index < entries.length; index++) {
    const previous = entries[index - 1];
    const entry = entries[index];
    const previousStyle = GUTTER_STYLE_BY_LINE_TYPE[previous.lineType];
    const entryStyle = GUTTER_STYLE_BY_LINE_TYPE[entry.lineType];
    if (
      previous.end === entry.start - 1 &&
      previousStyle.glyph === entryStyle.glyph &&
      previousStyle.color === entryStyle.color
    ) {
      entry.showsIcon = false;
    }
  }
}

// Decides a LineType based on the semantic operation and span data we have
export function semanticLineType(
  operation: SemanticDiffOperation,
  span: SemanticDiffSpan
): SemanticLineType {
  if (span.role === 'focus' && span.kind === 'reformatted') {
    return 'change-reformatted';
  }
  if (span.relation === 'introduced') {
    return 'change-addition';
  }
  if (span.relation === 'removed') {
    return 'change-deletion';
  }
  if (span.role === 'call' && span.relation === 'replaced') {
    return 'change-edited';
  }
  if (span.role === 'focus') {
    switch (span.relation) {
      case 'moved':
        return 'change-moved';
      case 'replaced':
        return operation.type === 'renamed'
          ? 'change-renamed'
          : 'change-edited';
    }
  }
  return LINE_TYPE_BY_OPERATION[operation.type];
}

// The gutter icon for the first row of a semantic region. The glyph follows the
// line type (see GUTTER_STYLE_BY_LINE_TYPE). Old-side rows use the
// tinted icon and new-side rows the solid one.
export function getSemanticLineIcon(
  lineType: SemanticLineType,
  side: 'additions' | 'deletions'
): SemanticLineIcon {
  const { glyph } = GUTTER_STYLE_BY_LINE_TYPE[lineType];
  if (glyph === 'eye-slash') {
    return 'diffs-icon-eye-slash';
  }
  return `diffs-icon-symbol-${glyph}-${side === 'deletions' ? 'duo' : 'fill'}`;
}

// FOLLOWUP: This is dumb, and goes back to my thinking that we should probably
// pre-compute most of this data on the server somehow and pass it through,
// which probably means a lot of the architecture for what we send to the
// client, the way we are doing it right now, is probably not great. But trying
// to forge ahead here...
// Find ownership by source line, including when rendering starts inside a run.
export function getSemanticDiffLine(
  lookup: SemanticDiffLineLookup,
  side: 'additions' | 'deletions',
  sourceLine: number
): SemanticDiffLine | undefined {
  const entries = lookup[side];
  let low = 0;
  let high = entries.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const entry = entries[middle];
    if (sourceLine < entry.start) {
      high = middle - 1;
    } else if (sourceLine > entry.end) {
      low = middle + 1;
    } else {
      return entry;
    }
  }
  return undefined;
}
