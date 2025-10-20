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
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const BLANK_FILE = { name: '__', contents: '' };

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
  const [diffRenderer] = useState(
    () => new FileDiffUI<LAnnotation>(options, true)
  );
  const ref = useRef<HTMLElement>(null);
  const optionsRef = useRef(options);
  const filesRef = useRef<[FileContents, FileContents]>([
    BLANK_FILE,
    BLANK_FILE,
  ]);

  // NOTE(amadeus): This is all a temporary hack until we can figure out proper
  // innerHTML shadow dom stuff
  useLayoutEffect(() => {
    const [prevOldFile, prevNewFile] = filesRef.current;
    const hasFileChange =
      !deepEqual(prevOldFile, oldFile) || !deepEqual(prevNewFile, newFile);

    let hasOptionsChange = false;
    if (!deepEqual(optionsRef.current, options)) {
      optionsRef.current = options;
      hasOptionsChange = true;
      diffRenderer.setOptions(options);
    }
    if (hasFileChange || hasOptionsChange) {
      filesRef.current = [oldFile, newFile];
      void diffRenderer.render({
        forceRender: true,
        oldFile,
        newFile,
        fileContainer: ref.current ?? undefined,
        lineAnnotations: annotations,
      });
    }
  });
  useEffect(() => () => diffRenderer.cleanUp(), [diffRenderer]);
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
