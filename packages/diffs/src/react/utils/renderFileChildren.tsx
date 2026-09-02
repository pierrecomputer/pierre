import type { ReactNode } from 'react';

import {
  CUSTOM_HEADER_SLOT_ID,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
} from '../../constants';
import type { GetHoveredLineResult } from '../../managers/InteractionManager';
import type { FileContents, LineAnnotation } from '../../types';
import { getLineAnnotationName } from '../../utils/getLineAnnotationName';
import { GutterUtilitySlotStyles } from '../constants';
import type { FileProps } from '../types';

interface RenderFileChildrenProps<LAnnotation, LDecoration> {
  file: FileContents;
  renderCustomHeader: FileProps<LAnnotation, LDecoration>['renderCustomHeader'];
  renderHeaderPrefix: FileProps<LAnnotation, LDecoration>['renderHeaderPrefix'];
  renderHeaderFilenameSuffix?: FileProps<
    LAnnotation,
    LDecoration
  >['renderHeaderFilenameSuffix'];
  renderHeaderMetadata: FileProps<
    LAnnotation,
    LDecoration
  >['renderHeaderMetadata'];
  renderAnnotation: FileProps<LAnnotation, LDecoration>['renderAnnotation'];
  lineAnnotations: FileProps<LAnnotation, LDecoration>['lineAnnotations'];
  renderGutterUtility: FileProps<
    LAnnotation,
    LDecoration
  >['renderGutterUtility'];
  getHoveredLine(): GetHoveredLineResult<'file'> | undefined;
  getAnnotationSlotName?(annotation: LineAnnotation<LAnnotation>): string;
}

export function renderFileChildren<LAnnotation, LDecoration>({
  file,
  renderCustomHeader,
  renderHeaderPrefix,
  renderHeaderFilenameSuffix,
  renderHeaderMetadata,
  renderAnnotation,
  lineAnnotations,
  renderGutterUtility,
  getHoveredLine,
  getAnnotationSlotName = getLineAnnotationName,
}: RenderFileChildrenProps<LAnnotation, LDecoration>): ReactNode {
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
          <div key={index} slot={getAnnotationSlotName(annotation)}>
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
