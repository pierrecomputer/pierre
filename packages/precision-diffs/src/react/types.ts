import { type CSSProperties, type ReactNode } from 'react';
import type { SelectedLineRange } from 'src/LineSelectionManager';

import type { FileDiffOptions } from '../FileDiff';
import type { DiffLineAnnotation, RenderHeaderMetadataProps } from '../types';

export interface DiffBasePropsReact<LAnnotation> {
  options?: FileDiffOptions<LAnnotation>;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selectedLines?: SelectedLineRange | null;
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(props: RenderHeaderMetadataProps): ReactNode;
  className?: string;
  style?: CSSProperties;
  prerenderedHTML?: string;
}
