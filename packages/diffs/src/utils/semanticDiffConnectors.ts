import type { ConnectorKind } from '../components/SemanticConnector';
import type {
  FileDiffMetadata,
  LineTypes,
  SemanticDiffConnectorAttachment,
} from '../types';
import { semanticLineType } from './semanticDiffLines';

/** Inclusive source line numbers, starting at 1. */
export interface SemanticDiffConnectorRange {
  start: number;
  end: number;
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

// A band for each line pair of a paired span that colors its lines, and a nub
// for each run a one-sided span owns, ending at the run's attachment. Runs and
// pairs arrive in drawn form, so this depends on the metadata only, not on
// rows, hunks, or what is mounted.
export function prepareSemanticDiffConnectors(
  fileDiff: FileDiffMetadata
): SemanticDiffConnector[] {
  const operations = fileDiff.semanticOperations;
  if (operations == null || operations.length === 0) return [];
  const connectors: SemanticDiffConnector[] = [];
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
              `prepareSemanticDiffConnectors: ${operation.type} ${span.role}/${span.relation} span owns lines ${run.start}-${run.end} without an attachment`
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
  return connectors.sort((a, b) => a.rank - b.rank);
}
