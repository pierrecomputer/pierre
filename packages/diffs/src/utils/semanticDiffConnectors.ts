import type { ConnectorKind } from '../components/SemanticConnector';
import type {
  FileDiffMetadata,
  LineTypes,
  SemanticDiffConnectorAttachment,
  SemanticDiffFold,
} from '../types';
import { semanticLineType } from './semanticDiffLines';

/** Inclusive source line numbers, starting at 1. */
export interface SemanticDiffConnectorRange {
  start: number;
  end: number;
}

interface BaseSemanticDiffConnectorRegion {
  id: string;
  kind: ConnectorKind;
  rank: number;
  /**
   * Set when the region is drawn in only one state of a semantic fold.
   * `start` is the fold's first old line. A region with `closed: true` is
   * drawn while that fold is closed, and stands for several regions that end
   * in the fold. Those have `closed: false`, and are drawn while it is open.
   */
  fold?: { start: number; closed: boolean };
}

/** The old lines and the new lines that one band joins. */
interface SemanticDiffPairedConnectorRegion extends BaseSemanticDiffConnectorRegion {
  base: SemanticDiffConnectorRange;
  target: SemanticDiffConnectorRange;
}

/** Added lines. Their connector ends at a point in the old column. */
interface SemanticDiffAddedConnectorRegion extends BaseSemanticDiffConnectorRegion {
  base?: never;
  target: SemanticDiffConnectorRange;
  /** Where the connector ends in the old column. */
  attachment: SemanticDiffConnectorAttachment;
}

/** Removed lines. Their connector ends at a point in the new column. */
interface SemanticDiffRemovedConnectorRegion extends BaseSemanticDiffConnectorRegion {
  base: SemanticDiffConnectorRange;
  target?: never;
  /** Where the connector ends in the new column. */
  attachment: SemanticDiffConnectorAttachment;
}

/**
 * The lines one connector joins, in line numbers. Measuring it against the
 * rendered rows gives the connector that is drawn.
 */
export type SemanticDiffConnectorRegion =
  | SemanticDiffPairedConnectorRegion
  | SemanticDiffAddedConnectorRegion
  | SemanticDiffRemovedConnectorRegion;

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

// A band for each line pair of a paired span that colors its lines, and a nub
// for each run a one-sided span owns, ending at the run's attachment. Runs and
// pairs arrive in drawn form, so this depends on the metadata only, not on
// rows, hunks, or what is mounted. Regions that end in one semantic fold also
// get a joined region, to draw while the fold is closed.
export function prepareSemanticDiffConnectorRegions(
  fileDiff: FileDiffMetadata
): SemanticDiffConnectorRegion[] {
  const operations = fileDiff.semanticOperations;
  if (operations == null || operations.length === 0) return [];
  const connectors: SemanticDiffConnectorRegion[] = [];
  for (const [operationIndex, operation] of operations.entries()) {
    for (const [spanIndex, span] of operation.spans.entries()) {
      const kind =
        CONNECTOR_KIND_BY_LINE_TYPE[semanticLineType(operation, span)];
      if (kind == null) continue;
      if (span.relation === 'introduced' || span.relation === 'removed') {
        const side = span.relation === 'introduced' ? 'new' : 'old';
        for (const run of operation.lines[side]) {
          if (run.spanIndex !== spanIndex) continue;
          const { attachment } = run;
          // The converter resolves an attachment for every one-sided run.
          if (attachment == null) {
            throw new Error(
              `prepareSemanticDiffConnectorRegions: ${operation.type} ${span.role}/${span.relation} span owns lines ${run.start}-${run.end} without an attachment`
            );
          }
          const region = { start: run.start, end: run.end };
          const id = `${operationIndex}:${spanIndex}:${side}:${run.start}-${run.end}`;
          connectors.push(
            side === 'new'
              ? { id, kind, rank: 2, target: region, attachment }
              : { id, kind, rank: 2, base: region, attachment }
          );
        }
        continue;
      }
      // A paired span draws only with text on both sides.
      if (span.old.length === 0 || span.new.length === 0) continue;
      const rank =
        operation.type === 'inlinedFunction' && kind === 'moved' ? 1 : 0;
      for (const pair of span.linePairs) {
        const base = { ...pair.old };
        const target = { ...pair.new };
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
  const { semanticFolds } = fileDiff;
  if (semanticFolds != null && semanticFolds.length > 0) {
    joinRegionsInFolds(connectors, semanticFolds);
  }
  return connectors.sort((a, b) => a.rank - b.rank);
}

// A region whose old end is hidden in a fold, and where its new end is.
interface FoldedRegion {
  region: SemanticDiffConnectorRegion;
  /** The new end, in lines. A range of lines 3 to 5 is 3 to 6. */
  top: number;
  bottom: number;
}

// While a fold is closed, every region whose old end it hides ends on the
// fold row's 1px line, and their see-through colors would stack up there.
// This adds one joined region for each group of them that has the same color
// and whose new ends follow each other, to draw in their place. Regions whose
// new ends do not follow each other stay separate, so a band is never drawn
// over rows it has nothing to do with.
function joinRegionsInFolds(
  regions: SemanticDiffConnectorRegion[],
  folds: readonly SemanticDiffFold[]
): void {
  // Group the regions by fold, and then by color.
  const groups = new Map<number, Map<ConnectorKind, FoldedRegion[]>>();
  for (const region of regions) {
    const fold = findFold(folds, region);
    if (fold == null) continue;
    let byKind = groups.get(fold.old.start);
    if (byKind == null) {
      byKind = new Map();
      groups.set(fold.old.start, byKind);
    }
    const entry = { region, ...getNewEnd(region) };
    const group = byKind.get(region.kind);
    if (group == null) {
      byKind.set(region.kind, [entry]);
    } else {
      group.push(entry);
    }
  }
  // In each group, go from top to bottom and join the neighbors that follow
  // each other.
  for (const [start, byKind] of groups) {
    for (const group of byKind.values()) {
      group.sort((a, b) => a.top - b.top);
      let run: FoldedRegion[] = [];
      let bottom = 0;
      for (const entry of group) {
        if (run.length > 0 && entry.top > bottom) {
          addJoinedRegion(regions, start, run, bottom);
          run = [];
        }
        bottom = run.length > 0 ? Math.max(bottom, entry.bottom) : entry.bottom;
        run.push(entry);
      }
      addJoinedRegion(regions, start, run, bottom);
    }
  }
}

// Adds the region that stands for `run` while the fold is closed, and marks
// the regions of `run` as drawn only while it is open. A run of one region
// needs neither: that region is drawn in both states.
function addJoinedRegion(
  regions: SemanticDiffConnectorRegion[],
  start: number,
  run: FoldedRegion[],
  bottom: number
): void {
  const [first] = run;
  if (first == null || run.length < 2) return;
  let { rank } = first.region;
  for (const { region } of run) {
    region.fold = { start, closed: false };
    rank = Math.min(rank, region.rank);
  }
  const { id, kind } = first.region;
  const fold = { start, closed: true };
  // The joined region keeps the first region's old end. All of the run's old
  // ends are at the same place while the fold is closed.
  if (bottom === first.top) {
    // Every new end is the same point.
    regions.push({ ...first.region, rank, fold });
    return;
  }
  const target = { start: first.top, end: bottom - 1 };
  regions.push(
    first.region.base != null
      ? { id, kind, rank, fold, base: first.region.base, target }
      : { id, kind, rank, fold, target, attachment: first.region.attachment }
  );
}

// The fold that hides all of a region's old end, if one does. `folds` is in
// line order.
function findFold(
  folds: readonly SemanticDiffFold[],
  region: SemanticDiffConnectorRegion
): SemanticDiffFold | undefined {
  let start: number;
  let end: number;
  if (region.base != null) {
    ({ start, end } = region.base);
  } else if ('empty' in region.attachment) {
    return undefined;
  } else {
    start = region.attachment.line;
    end = start;
  }
  // Find the last fold that starts at or before the old end's first line.
  let low = 0;
  let high = folds.length - 1;
  let found: SemanticDiffFold | undefined;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const fold = folds[middle];
    if (fold.old.start <= start) {
      found = fold;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found != null && end <= found.old.end ? found : undefined;
}

// Where a region's new end is, in lines. A range of lines covers from its
// first line to the line after its last. A point is at its line, or at the
// next line when it sits under its line.
function getNewEnd(region: SemanticDiffConnectorRegion): {
  top: number;
  bottom: number;
} {
  if (region.target != null) {
    return { top: region.target.start, bottom: region.target.end + 1 };
  }
  const { attachment } = region;
  if ('empty' in attachment) {
    return { top: 0, bottom: 0 };
  }
  const at =
    attachment.edge === 'before' ? attachment.line : attachment.line + 1;
  return { top: at, bottom: at };
}
