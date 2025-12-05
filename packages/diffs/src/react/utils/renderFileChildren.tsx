import type { ReactNode } from 'react';

import type { GetHoveredLineResult } from '../../MouseEventManager';
import { HEADER_METADATA_SLOT_ID } from '../../constants';
import type { FileContents } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { HoverSlotStyles } from '../constants';
import type { FileProps } from '../types';

interface RenderFileChildrenProps<LAnnotation> {
  file: FileContents;
  renderHeaderMetadata: FileProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: FileProps<LAnnotation>['renderAnnotation'];
  lineAnnotations: FileProps<LAnnotation>['lineAnnotations'];
  renderHoverUtility: FileProps<LAnnotation>['renderHoverUtility'];
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}

export function renderFileChildren<LAnnotation>({
  file,
  renderHeaderMetadata,
  renderAnnotation,
  lineAnnotations,
  renderHoverUtility,
  getHoveredLine,
}: RenderFileChildrenProps<LAnnotation>): ReactNode {
  const metadata = renderHeaderMetadata?.(file);
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
