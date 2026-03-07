import type { ReactNode } from 'react';

import {
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../../constants';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type { FileContents, FileDiffMetadata } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { getMergeConflictActionSlotName } from '../../utils/getMergeConflictActionSlotName';
import type { MergeConflictDiffAction } from '../../utils/parseMergeConflictDiffFromFile';
import { GutterUtilitySlotStyles, MergeConflictSlotStyles } from '../constants';
import type { DiffBasePropsReact } from '../types';

interface RenderDiffChildrenProps<LAnnotation, T> {
  fileDiff?: FileDiffMetadata;
  actions?: MergeConflictDiffAction[];
  deletionFile?: FileContents;
  additionFile?: FileContents;
  renderHeaderPrefix: DiffBasePropsReact<LAnnotation>['renderHeaderPrefix'];
  renderHeaderMetadata: DiffBasePropsReact<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: DiffBasePropsReact<LAnnotation>['renderAnnotation'];
  renderGutterUtility: DiffBasePropsReact<LAnnotation>['renderGutterUtility'];
  renderHoverUtility: DiffBasePropsReact<LAnnotation>['renderHoverUtility'];
  renderMergeConflictUtility?(
    action: MergeConflictDiffAction,
    getInstance: () => T | undefined
  ): ReactNode;
  lineAnnotations: DiffBasePropsReact<LAnnotation>['lineAnnotations'];
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getInstance?(): T | undefined;
}

export function renderDiffChildren<LAnnotation, T>({
  fileDiff,
  actions,
  deletionFile,
  additionFile,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
  renderHoverUtility,
  renderMergeConflictUtility,
  lineAnnotations,
  getHoveredLine,
  getInstance,
}: RenderDiffChildrenProps<LAnnotation, T>): ReactNode {
  const gutterUtility = renderGutterUtility ?? renderHoverUtility;
  const prefix = renderHeaderPrefix?.({
    fileDiff,
    deletionFile,
    additionFile,
  });
  const metadata = renderHeaderMetadata?.({
    fileDiff,
    deletionFile,
    additionFile,
  });
  return (
    <>
      {prefix != null && <div slot={HEADER_PREFIX_SLOT_ID}>{prefix}</div>}
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        lineAnnotations?.map((annotation, index) => (
          <div key={index} slot={getLineAnnotationName(annotation)}>
            {renderAnnotation(annotation)}
          </div>
        ))}
      {actions != null &&
        renderMergeConflictUtility != null &&
        getInstance != null &&
        actions.map((action) => {
          const slot = getSlotName(action);
          return (
            <div key={slot} slot={slot} style={MergeConflictSlotStyles}>
              {renderMergeConflictUtility(action, getInstance)}
            </div>
          );
        })}
      {gutterUtility != null && (
        <div slot="gutter-utility-slot" style={GutterUtilitySlotStyles}>
          {gutterUtility(getHoveredLine)}
        </div>
      )}
    </>
  );
}

function getSlotName(action: MergeConflictDiffAction): string | undefined {
  // NOTE(amadeus): This is pretty annoying, we need to figure out how
  // to not depend on all these transforms of data.  Ideally actions
  // should have everything you need in any context...
  const metadata = (() => {
    if (action.incomingLineNumber != null) {
      return {
        side: 'additions' as const,
        lineNumber: action.incomingLineNumber,
      };
    }
    if (action.currentLineNumber != null) {
      return {
        side: 'deletions' as const,
        lineNumber: action.currentLineNumber,
      };
    }
    return undefined;
  })();
  if (metadata == null) {
    return undefined;
  }
  // NOTE(amadeus): We need to make it so this just takes an action
  // object probably...
  return getMergeConflictActionSlotName({
    ...metadata,
    conflictIndex: action.conflictIndex,
  });
}
