'use client';

import { type FileOptions } from '../File';
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
  className,
  style,
  renderAnnotation,
  renderHeaderMetadata,
  prerenderedHTML,
  renderHoverDecoration,
}: FileProps<LAnnotation>): React.JSX.Element {
  const { ref, getHoveredLine } = useFileInstance({
    file,
    options,
    lineAnnotations,
    selectedLines,
  });
  const children = renderFileChildren({
    file,
    renderAnnotation,
    renderHeaderMetadata,
    renderHoverDecoration,
    lineAnnotations,
    getHoveredLine,
  });
  return (
    <file-diff ref={ref} className={className} style={style}>
      {templateRender(children, prerenderedHTML)}
    </file-diff>
  );
}
