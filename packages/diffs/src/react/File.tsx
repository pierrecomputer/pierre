'use client';

import { type FileOptions } from '../components/File';
import { DIFFS_TAG_NAME } from '../constants';
import type { FileProps } from './types';
import { renderFileChildren } from './utils/renderFileChildren';
import { templateRender } from './utils/templateRender';
import { useFileInstance } from './utils/useFileInstance';

export type { FileOptions };

export function File<LAnnotation = undefined>({
  file,
  lineAnnotations,
  selectedLines,
  options,
  metrics,
  className,
  style,
  renderAnnotation,
  renderHeaderMetadata,
  prerenderedHTML,
  renderHoverUtility,
}: FileProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileInstance({
    file,
    options,
    metrics,
    lineAnnotations,
    selectedLines,
    prerenderedHTML,
  });
  const children = renderFileChildren({
    file,
    renderAnnotation,
    renderHeaderMetadata,
    renderHoverUtility,
    lineAnnotations,
    getHoveredLine,
  });
  return (
    <DIFFS_TAG_NAME ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </DIFFS_TAG_NAME>
  );
}
