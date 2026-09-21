import type {
  LineTypes,
  SemanticDiffOperation,
  SemanticDiffOperationType,
  SemanticDiffSpan,
} from '../types';

interface SemanticDiffLine {
  start: number;
  end: number;
  lineType: LineTypes;
  operation: SemanticDiffOperation;
  span: SemanticDiffSpan;
}

export interface SemanticDiffLineLookup {
  additions: readonly SemanticDiffLine[];
  deletions: readonly SemanticDiffLine[];
}

const LINE_TYPE_BY_OPERATION: Record<SemanticDiffOperationType, LineTypes> = {
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
        });
      }
    }
  }
  additions.sort((a, b) => a.start - b.start);
  deletions.sort((a, b) => a.start - b.start);
  return { additions, deletions };
}

// Decides a LineType based on the semantic operation and span data we have
export function semanticLineType(
  operation: SemanticDiffOperation,
  span: SemanticDiffSpan
): LineTypes {
  if (span.role === 'focus' && span.kind === 'reformatted') {
    return 'change-reformatted';
  }
  if (span.relation === 'introduced') {
    return 'change-addition';
  }
  if (span.relation === 'removed') {
    return 'change-deletion';
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
