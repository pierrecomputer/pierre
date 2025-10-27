import { type CSSProperties, type ReactNode } from 'react';

import type { DiffFileRendererOptions } from '../FileDiff';
import type { DiffLineAnnotation, RenderHeaderMetadataProps } from '../types';

export interface DiffBaseReactProps<LAnnotation> {
  options?: DiffFileRendererOptions<LAnnotation>;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(props: RenderHeaderMetadataProps): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}
