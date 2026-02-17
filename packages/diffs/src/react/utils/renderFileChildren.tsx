import type { ReactNode } from 'react';

import { HEADER_METADATA_SLOT_ID } from '../../constants';
import type { GetHoveredLineResult } from '../../managers/MouseEventManager';
import type { FileContents } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { GutterUtilitySlotStyles } from '../constants';
import type { FileProps } from '../types';

interface RenderFileChildrenProps<LAnnotation> {
  file: FileContents;
  renderHeaderMetadata: FileProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: FileProps<LAnnotation>['renderAnnotation'];
  lineAnnotations: FileProps<LAnnotation>['lineAnnotations'];
  renderGutterUtility: FileProps<LAnnotation>['renderGutterUtility'];
  renderHoverUtility: FileProps<LAnnotation>['renderHoverUtility'];
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}

export function renderFileChildren<LAnnotation>({
  file,
  renderHeaderMetadata,
  renderAnnotation,
  lineAnnotations,
  renderGutterUtility,
  renderHoverUtility,
  getHoveredLine,
}: RenderFileChildrenProps<LAnnotation>): ReactNode {
  const gutterUtility = renderGutterUtility ?? renderHoverUtility;
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
      {gutterUtility != null && (
        <div slot="gutter-utility-slot" style={GutterUtilitySlotStyles}>
          {gutterUtility(getHoveredLine)}
        </div>
      )}
    </>
  );
}
