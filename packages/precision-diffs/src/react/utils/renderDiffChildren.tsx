import type { ReactNode } from 'react';

import type { GetHoveredLineResult } from '../../MouseEventManager';
import { HEADER_METADATA_SLOT_ID } from '../../constants';
import type { FileContents, FileDiffMetadata } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { HoverSlotStyles } from '../constants';
import type { DiffBasePropsReact } from '../types';

interface RenderDiffChildrenProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  renderHeaderMetadata: DiffBasePropsReact<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: DiffBasePropsReact<LAnnotation>['renderAnnotation'];
  renderHoverUtility: DiffBasePropsReact<LAnnotation>['renderHoverUtility'];
  lineAnnotations: DiffBasePropsReact<LAnnotation>['lineAnnotations'];
  getHoveredLine(): GetHoveredLineResult<'diff'> | undefined;
}

export function renderDiffChildren<LAnnotation>({
  fileDiff,
  oldFile,
  newFile,
  renderHeaderMetadata,
  renderAnnotation,
  renderHoverUtility,
  lineAnnotations,
  getHoveredLine,
}: RenderDiffChildrenProps<LAnnotation>): ReactNode {
  const metadata = renderHeaderMetadata?.({ fileDiff, oldFile, newFile });
  return (
    <>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        lineAnnotations?.map((annotation, index) => (
          <div key={index} slot={getLineAnnotationName(annotation)}>
            {renderAnnotation(annotation)}
          </div>
        ))}
      {renderHoverUtility != null && (
        <div slot="hover-slot" style={HoverSlotStyles}>
          {renderHoverUtility(getHoveredLine)}
        </div>
      )}
    </>
  );
}
