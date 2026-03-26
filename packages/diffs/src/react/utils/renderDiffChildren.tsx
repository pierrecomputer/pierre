import type { ReactNode } from 'react';

import {
  CUSTOM_HEADER_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../../constants';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type { FileDiffMetadata } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { getMergeConflictActionSlotName } from '../../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionAnchor,
  type MergeConflictDiffAction,
} from '../../utils/parseMergeConflictDiffFromFile';
import { GutterUtilitySlotStyles, MergeConflictSlotStyles } from '../constants';
import type { DiffBasePropsReact } from '../types';

interface RenderDiffChildrenProps<LAnnotation, T> {
  fileDiff: FileDiffMetadata;
  actions?: (MergeConflictDiffAction | undefined)[];
  renderCustomHeader: DiffBasePropsReact<LAnnotation>['renderCustomHeader'];
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
  renderCustomHeader,
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
  const customHeader = renderCustomHeader?.(fileDiff);
  const prefix = renderHeaderPrefix?.(fileDiff);
  const metadata = renderHeaderMetadata?.(fileDiff);
  return (
    <>
      {customHeader != null ? (
        <div slot={CUSTOM_HEADER_SLOT_ID}>{customHeader}</div>
      ) : (
        <>
          {prefix != null && <div slot={HEADER_PREFIX_SLOT_ID}>{prefix}</div>}
          {metadata != null && (
            <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>
          )}
        </>
      )}
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
          if (action == null) {
            return undefined;
          }
          const slot = getSlotName(action, fileDiff);
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

function getSlotName(
  action: MergeConflictDiffAction,
  fileDiff: FileDiffMetadata
): string | undefined {
  const anchor = getMergeConflictActionAnchor(action, fileDiff);
  return anchor != null
    ? getMergeConflictActionSlotName({
        hunkIndex: anchor.hunkIndex,
        lineIndex: anchor.lineIndex,
        conflictIndex: action.conflictIndex,
      })
    : undefined;
}
