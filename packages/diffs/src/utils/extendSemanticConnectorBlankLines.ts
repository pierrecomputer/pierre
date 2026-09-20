import type { FileDiffMetadata } from '../types';
import { getHunkSideStartBoundary } from './getHunkSideBoundaries';
import type {
  SemanticDiffConnector,
  SemanticDiffConnectorRange,
} from './semanticDiffConnectors';
import {
  createSemanticDiffLineLookup,
  getSemanticDiffLine,
} from './semanticDiffLines';

interface SourceRunBreaks {
  old: readonly number[];
  new: readonly number[];
}

interface ChangeSegment extends SemanticDiffConnectorRange {
  lineIndex: number;
}

// Include neighboring blank lines that keep the ordinary addition/deletion color.
// Only prepared nub bounds change; supplied semantic ownership stays untouched.
export function extendSemanticConnectorBlankLines(
  fileDiff: FileDiffMetadata,
  connectors: readonly SemanticDiffConnector[],
  breaks: SourceRunBreaks
): void {
  const nubs: {
    old: SemanticDiffConnectorRange[];
    new: SemanticDiffConnectorRange[];
  } = { old: [], new: [] };
  for (const connector of connectors) {
    if (connector.kind === 'added' && connector.base == null) {
      nubs.new.push(connector.target);
    } else if (connector.kind === 'deleted' && connector.target == null) {
      nubs.old.push(connector.base);
    }
  }
  if (nubs.old.length === 0 && nubs.new.length === 0) return;
  const lookup = createSemanticDiffLineLookup(
    fileDiff.semanticOperations ?? []
  );
  const segments = getChangeSegments(fileDiff);
  for (const side of ['old', 'new'] as const) {
    const ranges = nubs[side];
    if (ranges.length === 0) continue;
    ranges.sort((a, b) => a.start - b.start);
    const cuts = new Set(breaks[side]);
    const lookupSide = side === 'old' ? 'deletions' : 'additions';
    const source =
      side === 'old' ? fileDiff.deletionLines : fileDiff.additionLines;
    const canExtend = (line: number): boolean => {
      const segment = findChangeSegment(segments[side], line);
      return (
        segment != null &&
        !/\S/.test(source[segment.lineIndex + line - segment.start]) &&
        getSemanticDiffLine(lookup, lookupSide, line) == null
      );
    };
    let previousEnd = 0;
    for (const range of ranges) {
      // A blank run between two nubs belongs to the preceding nub's geometry.
      // Do not let the following nub grow back over those same lines.
      while (
        range.start > previousEnd + 1 &&
        !cuts.has(range.start) &&
        canExtend(range.start - 1)
      ) {
        range.start--;
      }
      while (!cuts.has(range.end + 1) && canExtend(range.end + 1)) {
        range.end++;
      }
      previousEnd = range.end;
    }
  }
}

// Map only change blocks to source text. Their array indexes also work for
// partial patches, whose line arrays omit unchanged regions outside the hunks.
function getChangeSegments(fileDiff: FileDiffMetadata): {
  old: ChangeSegment[];
  new: ChangeSegment[];
} {
  const old: ChangeSegment[] = [];
  const added: ChangeSegment[] = [];
  for (const hunk of fileDiff.hunks) {
    let oldLine =
      getHunkSideStartBoundary(hunk.deletionStart, hunk.deletionCount) + 1;
    let newLine =
      getHunkSideStartBoundary(hunk.additionStart, hunk.additionCount) + 1;
    for (const content of hunk.hunkContent) {
      if (content.type === 'context') {
        oldLine += content.lines;
        newLine += content.lines;
        continue;
      }
      if (content.deletions > 0) {
        old.push({
          start: oldLine,
          end: oldLine + content.deletions - 1,
          lineIndex: content.deletionLineIndex,
        });
      }
      if (content.additions > 0) {
        added.push({
          start: newLine,
          end: newLine + content.additions - 1,
          lineIndex: content.additionLineIndex,
        });
      }
      oldLine += content.deletions;
      newLine += content.additions;
    }
  }
  return { old, new: added };
}

function findChangeSegment(
  segments: readonly ChangeSegment[],
  line: number
): ChangeSegment | undefined {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const segment = segments[middle];
    if (line < segment.start) {
      high = middle - 1;
    } else if (line > segment.end) {
      low = middle + 1;
    } else {
      return segment;
    }
  }
  return undefined;
}
