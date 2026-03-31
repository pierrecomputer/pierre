import type { ReactNode } from 'react';

import {
  CUSTOM_HEADER_SLOT_ID,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../../constants';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type { DiffLineAnnotation, FileDiffMetadata } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { getMergeConflictActionSlotName } from '../../utils/getMergeConflictActionSlotName';
import {
  getMergeConflictActionAnchor,
  type MergeConflictDiffAction,
} from '../../utils/parseMergeConflictDiffFromFile';
import { GutterUtilitySlotStyles, MergeConflictSlotStyles } from '../constants';
import type { DiffBasePropsReact } from '../types';

interface RenderDiffChildrenProps<LAnnotation, LDecoration, T> {
  fileDiff: FileDiffMetadata;
  actions?: (MergeConflictDiffAction | undefined)[];
  renderCustomHeader: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['renderCustomHeader'];
  renderHeaderPrefix: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['renderHeaderPrefix'];
  renderHeaderFilenameSuffix?: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['renderHeaderMetadata'];
  renderAnnotation: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['renderAnnotation'];
  renderGutterUtility: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['renderGutterUtility'];
  renderMergeConflictUtility?(
    action: MergeConflictDiffAction,
    getInstance: () => T | undefined
  ): ReactNode;
  lineAnnotations: DiffBasePropsReact<
    LAnnotation,
    LDecoration
  >['lineAnnotations'];
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
  getInstance?(): T | undefined;
  getAnnotationSlotName?(annotation: DiffLineAnnotation<LAnnotation>): string;
}

export function renderDiffChildren<LAnnotation, LDecoration, T>({
  fileDiff,
  actions,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
  renderMergeConflictUtility,
  lineAnnotations,
  getHoveredLine,
  getInstance,
  getAnnotationSlotName = getLineAnnotationName,
}: RenderDiffChildrenProps<LAnnotation, LDecoration, T>): ReactNode {
  const customHeader = renderCustomHeader?.(fileDiff);
  const prefix = renderHeaderPrefix?.(fileDiff);
  const suffix = renderHeaderFilenameSuffix?.(fileDiff);
  const metadata = renderHeaderMetadata?.(fileDiff);
  return (
    <>
      {customHeader != null ? (
        <div slot={CUSTOM_HEADER_SLOT_ID}>{customHeader}</div>
      ) : (
        <>
          {prefix != null && <div slot={HEADER_PREFIX_SLOT_ID}>{prefix}</div>}
          {suffix != null && (
            <div slot={HEADER_FILENAME_SUFFIX_SLOT_ID}>{suffix}</div>
          )}
          {metadata != null && (
            <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>
          )}
        </>
      )}
      {renderAnnotation != null &&
        lineAnnotations?.map((annotation, index) => (
          <div key={index} slot={getAnnotationSlotName(annotation)}>
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
      {renderGutterUtility != null && (
        <div slot="gutter-utility-slot" style={GutterUtilitySlotStyles}>
          {renderGutterUtility(getHoveredLine)}
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
