'use client';

import {
  type DiffFileRendererOptions,
  type DiffLineAnnotation,
  type FileContents,
  FileDiff as FileDiffUI,
  HEADER_METADATA_SLOT_ID,
  type RenderHeaderMetadataProps,
  getLineAnnotationId,
} from '@pierre/precision-diffs';
import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

interface FileDiffProps<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: DiffFileRendererOptions<LAnnotation>;
  annotations?: DiffLineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: DiffLineAnnotation<LAnnotation>): ReactNode;
  renderHeaderMetadata?(props: RenderHeaderMetadataProps): ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function FileDiff<LAnnotation = undefined>({
  oldFile,
  newFile,
  options,
  annotations,
  className,
  style,
  renderAnnotation,
  renderHeaderMetadata,
}: FileDiffProps<LAnnotation>) {
  'use no memo';
  const [diffRenderer] = useState(
    () => new FileDiffUI<LAnnotation>(options, true)
  );
  const ref = useRef<HTMLElement>(null);
  // NOTE(amadeus): This is all a temporary hack until we can figure out proper
  // innerHTML shadow dom stuff
  useLayoutEffect(() => {
    let forceRender = false;
    if (!deepEqual(diffRenderer.options, options)) {
      forceRender = true;
      diffRenderer.setOptions(options);
    }
    void diffRenderer.render({
      forceRender,
      oldFile,
      newFile,
      fileContainer: ref.current ?? undefined,
      lineAnnotations: annotations,
    });
  });
  // useEffect(() => () => diffRenderer.cleanUp(), [diffRenderer]);
  const metadata = renderHeaderMetadata?.({ oldFile, newFile });
  return (
    <pjs-container ref={ref} className={className} style={style}>
      {metadata != null && <div slot={HEADER_METADATA_SLOT_ID}>{metadata}</div>}
      {renderAnnotation != null &&
        annotations?.map((annotation) => (
          <div
            key={getLineAnnotationId(annotation)}
            slot={getLineAnnotationId(annotation)}
          >
            {renderAnnotation(annotation)}
          </div>
        ))}
    </pjs-container>
  );
}
