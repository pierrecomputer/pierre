import type { ReactNode } from 'react';

import {
  CUSTOM_HEADER_SLOT_ID,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../../constants';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type { FileContents } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { GutterUtilitySlotStyles } from '../constants';
import type { FileProps } from '../types';

interface RenderFileChildrenProps<LAnnotation> {
  file: FileContents;
  renderCustomHeader: FileProps<LAnnotation>['renderCustomHeader'];
  renderHeaderPrefix: FileProps<LAnnotation>['renderHeaderPrefix'];
  renderHeaderFilenameSuffix?: FileProps<LAnnotation>['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: FileProps<LAnnotation>['renderHeaderMetadata'];
  renderAnnotation: FileProps<LAnnotation>['renderAnnotation'];
  lineAnnotations: FileProps<LAnnotation>['lineAnnotations'];
  renderGutterUtility: FileProps<LAnnotation>['renderGutterUtility'];
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
}

export function renderFileChildren<LAnnotation>({
  file,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  lineAnnotations,
  renderGutterUtility,
  getHoveredLine,
}: RenderFileChildrenProps<LAnnotation>): ReactNode {
  const customHeader = renderCustomHeader?.(file);
  const prefix = renderHeaderPrefix?.(file);
  const suffix = renderHeaderFilenameSuffix?.(file);
  const metadata = renderHeaderMetadata?.(file);
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
          <div key={index} slot={getLineAnnotationName(annotation)}>
            {renderAnnotation(annotation)}
          </div>
        ))}
      {renderGutterUtility != null && (
        <div slot="gutter-utility-slot" style={GutterUtilitySlotStyles}>
          {renderGutterUtility(getHoveredLine)}
        </div>
      )}
    </>
  );
}
