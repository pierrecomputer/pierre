import type { ConnectorKind } from '../components/SemanticConnector';
import type {
  FileDiffMetadata,
  LineTypes,
  SemanticDiffConnectorAttachment,
  SemanticDiffLineRange,
  SemanticDiffOperation,
  SemanticDiffSpan,
} from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import { mergeSemanticDiffLinePairs } from './mergeSemanticDiffLinePairs';
import { semanticLineType } from './semanticDiffLines';

/** Inclusive source line numbers, starting at 1. */
export interface SemanticDiffConnectorRange {
  start: number;
  end: number;
}

interface OwnedConnectorRun extends SemanticDiffConnectorRange {
  attachment: SemanticDiffConnectorAttachment;
}

interface BaseSemanticDiffConnector {
  id: string;
  kind: ConnectorKind;
  rank: number;
}

/** A band between a region in the old column and one in the new column. */
interface SemanticDiffPairedConnector extends BaseSemanticDiffConnector {
  base: SemanticDiffConnectorRange;
  target: SemanticDiffConnectorRange;
}

/** A nub for added lines; it ends at an edge in the old column. */
interface SemanticDiffAddedConnector extends BaseSemanticDiffConnector {
  base?: never;
  target: SemanticDiffConnectorRange;
  /** Where the connector ends in the old column. */
  attachment: SemanticDiffConnectorAttachment;
}

/** A nub for removed lines; it ends at an edge in the new column. */
interface SemanticDiffRemovedConnector extends BaseSemanticDiffConnector {
  base: SemanticDiffConnectorRange;
  target?: never;
  /** Where the connector ends in the new column. */
  attachment: SemanticDiffConnectorAttachment;
}

/** A connector's source regions, before measurement against mounted rows. */
export type SemanticDiffConnector =
  | SemanticDiffPairedConnector
  | SemanticDiffAddedConnector
  | SemanticDiffRemovedConnector;

const CONNECTOR_KIND_BY_LINE_TYPE: Record<
  LineTypes,
  ConnectorKind | undefined
> = {
  context: undefined,
  'context-expanded': undefined,
  'change-addition': 'added',
  'change-deletion': 'deleted',
  'change-moved': 'moved',
  'change-moved-with-edit': 'modified',
  'change-edited': 'modified',
  'change-renamed': 'modified',
  'change-reordered': 'moved',
  'change-reformatted': 'reformatted',
  'change-extracted-function': 'moved',
  'change-inlined-function': 'moved',
};

// Build a diff's connectors from its metadata alone: a band for each line pair
// of a paired span, and a nub for each run a one-sided span owns, ending at the
// run's attachment. Nothing here depends on which rows are mounted, so the
// connectors and their IDs stay the same while the viewport changes. Measuring
// them against the DOM happens separately.
export function prepareSemanticDiffConnectors(
  fileDiff: FileDiffMetadata
): SemanticDiffConnector[] {
  const operations = fileDiff.semanticOperations;
  if (operations == null || operations.length === 0) return [];
  const breaks = getSourceRunBreaks(fileDiff);
  const connectors: SemanticDiffConnector[] = [];
  for (const [operationIndex, operation] of operations.entries()) {
    for (const [spanIndex, span] of operation.spans.entries()) {
      if (span.role === 'body' && span.relation === 'mapped') continue;
      const kind =
        CONNECTOR_KIND_BY_LINE_TYPE[semanticLineType(operation, span)];
      if (kind == null) continue;
      if (span.relation === 'introduced' || span.relation === 'removed') {
        const side = span.relation === 'introduced' ? 'new' : 'old';
        const runs = groupOwnedRuns(
          operation,
          span,
          spanIndex,
          operation.lines[side],
          breaks[side]
        );
        for (const run of runs) {
          const region = { start: run.start, end: run.end };
          const id = `${operationIndex}:${spanIndex}:${side}:${run.start}-${run.end}`;
          connectors.push(
            side === 'new'
              ? {
                  id,
                  kind,
                  rank: 2,
                  target: region,
                  attachment: run.attachment,
                }
              : { id, kind, rank: 2, base: region, attachment: run.attachment }
          );
        }
        continue;
      }
      // A paired span draws only with text on both sides, and a focus span
      // only for a rename.
      if (
        span.old.length === 0 ||
        span.new.length === 0 ||
        (span.role === 'focus' && operation.type !== 'renamed')
      ) {
        continue;
      }
      const rank =
        operation.type === 'inlinedFunction' && kind === 'moved' ? 1 : 0;
      for (const pair of mergeSemanticDiffLinePairs(span.linePairs, breaks)) {
        const { old: base, new: target } = pair;
        connectors.push({
          id: `${operationIndex}:${spanIndex}:${base.start}-${base.end}:${target.start}-${target.end}`,
          kind,
          rank,
          base,
          target,
        });
      }
    }
  }
  return connectors.sort((a, b) => a.rank - b.rank);
}

// The 1-based source lines where a run must break: the first line after a gap
// in its column, plus each hunk's first line and the line after it, so that
// expanding a hunk never changes the cuts. Hunk counts give the gaps without
// walking rows.
function getSourceRunBreaks(fileDiff: FileDiffMetadata): {
  old: number[];
  new: number[];
} {
  const oldBreaks = new Set<number>();
  const newBreaks = new Set<number>();
  let oldLine = 1;
  let newLine = 1;
  for (const hunk of fileDiff.hunks) {
    const oldStart =
      getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) + 1;
    const newStart =
      getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount) + 1;
    if (oldStart > oldLine || newStart > newLine) {
      oldBreaks.add(oldLine);
      oldBreaks.add(oldStart);
      newBreaks.add(newLine);
      newBreaks.add(newStart);
    }
    oldLine = oldStart;
    newLine = newStart;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        oldLine += content.lines;
        newLine += content.lines;
      } else {
        oldLine += content.deletions;
        newLine += content.additions;
        if (content.deletions < content.additions) oldBreaks.add(oldLine);
        if (content.additions < content.deletions) newBreaks.add(newLine);
      }
    }
  }
  if (fileDiff.hunks.length > 0) {
    oldBreaks.add(oldLine);
    newBreaks.add(newLine);
  }
  return {
    old: [...oldBreaks].sort((a, b) => a - b),
    new: [...newBreaks].sort((a, b) => a - b),
  };
}

// The nubs a one-sided span draws: its owned runs, split at cuts and where the
// attachment changes, with adjacent pieces sharing one attachment joined.
// `ranges` is sorted by line. A run without an attachment is a converter bug.
function groupOwnedRuns(
  operation: SemanticDiffOperation,
  span: SemanticDiffSpan,
  spanIndex: number,
  ranges: readonly SemanticDiffLineRange[],
  breaks: readonly number[]
): OwnedConnectorRun[] {
  const runs: OwnedConnectorRun[] = [];
  for (const range of ranges) {
    if (range.spanIndex !== spanIndex) continue;
    const { attachment } = range;
    if (attachment == null) {
      throw new Error(
        `prepareSemanticDiffConnectors: ${operation.type} ${span.role}/${span.relation} span owns lines ${range.start}-${range.end} without an attachment`
      );
    }
    let start = range.start;
    let breakIndex = firstBreakAtOrAfter(breaks, start);
    let splitBefore = breaks[breakIndex] === start;
    if (splitBefore) breakIndex++;
    while (start <= range.end) {
      const nextBreak = breaks[breakIndex];
      const end =
        nextBreak != null && nextBreak <= range.end ? nextBreak - 1 : range.end;
      const previous = runs[runs.length - 1];
      if (
        !splitBefore &&
        previous != null &&
        previous.end + 1 === start &&
        areAttachmentsEqual(previous.attachment, attachment)
      ) {
        previous.end = end;
      } else {
        runs.push({ start, end, attachment });
      }
      start = end + 1;
      breakIndex++;
      splitBefore = true;
    }
  }
  return runs;
}

function areAttachmentsEqual(
  left: SemanticDiffConnectorAttachment,
  right: SemanticDiffConnectorAttachment
): boolean {
  if ('empty' in left || 'empty' in right) {
    return 'empty' in left && 'empty' in right;
  }
  return left.line === right.line && left.edge === right.edge;
}

// Index of the first cut at or after `line`.
function firstBreakAtOrAfter(breaks: readonly number[], line: number): number {
  let low = 0;
  let high = breaks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (breaks[middle] < line) {
      low = middle + 1;
    } else {
      high = middle;
    }
  }
  return low;
}
