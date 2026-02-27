import type { ReactNode } from 'react';

import {
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../../constants';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type { FileContents, FileDiffMetadata } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { GutterUtilitySlotStyles } from '../constants';
import type { DiffBasePropsReact } from '../types';

interface RenderDiffChildrenProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  deletionFile?: FileContents;
  additionFile?: FileContents;
  renderHeaderPrefix: DiffBasePropsReact<LAnnotation>['renderHeaderPrefix'];
  renderHeaderMetadata: DiffBasePropsReact<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: DiffBasePropsReact<LAnnotation>['renderAnnotation'];
  renderGutterUtility: DiffBasePropsReact<LAnnotation>['renderGutterUtility'];
  renderHoverUtility: DiffBasePropsReact<LAnnotation>['renderHoverUtility'];
  lineAnnotations: DiffBasePropsReact<LAnnotation>['lineAnnotations'];
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function renderDiffChildren<LAnnotation>({
  fileDiff,
  deletionFile,
  additionFile,
  renderHeaderPrefix,
  renderHeaderMetadata,
  renderAnnotation,
  renderGutterUtility,
  renderHoverUtility,
  lineAnnotations,
  getHoveredLine,
}: RenderDiffChildrenProps<LAnnotation>): ReactNode {
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
      {gutterUtility != null && (
        <div slot="gutter-utility-slot" style={GutterUtilitySlotStyles}>
          {gutterUtility(getHoveredLine)}
        </div>
      )}
    </>
  );
}
