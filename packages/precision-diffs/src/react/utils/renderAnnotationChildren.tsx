import type { ReactNode } from 'react';

import { HEADER_METADATA_SLOT_ID } from '../../constants';
import type { FileContents, FileDiffMetadata } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import type { DiffBasePropsReact } from '../types';

interface RenderDiffChildrenProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  oldFile?: FileContents;
  newFile?: FileContents;
  renderHeaderMetadata: DiffBasePropsReact<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: DiffBasePropsReact<LAnnotation>['renderAnnotation'];
  lineAnnotations: DiffBasePropsReact<LAnnotation>['lineAnnotations'];
}

export function renderAnnotationChildren<LAnnotation>({
  fileDiff,
  oldFile,
  newFile,
  renderHeaderMetadata,
  renderAnnotation,
  lineAnnotations,
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
    </>
  );
}
