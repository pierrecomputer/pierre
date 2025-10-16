'use client';

import {
  type DiffFileRendererOptions,
  type FileContents,
  FileDiff as FileDiffUI,
  type LineAnnotation,
} from '@pierre/diff-ui';
import deepEqual from 'fast-deep-equal';
import {
  type CSSProperties,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

const BLANK_FILE = { name: '__', contents: '' };

interface FileDiffProps<LAnnotation> {
  oldFile: FileContents;
  newFile: FileContents;
  options?: DiffFileRendererOptions<LAnnotation>;
  annotations?: LineAnnotation<LAnnotation>[];
  renderAnnotation?(annotations: LineAnnotation<LAnnotation>): ReactNode;
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
  return (
    <pjs-container ref={ref} className={className} style={style}>
      {renderAnnotation != null &&
        annotations?.map((annotation) => (
          <div
            key={`${annotation.side}-${annotation.lineNumber}`}
            slot={`${annotation.side}-${annotation.lineNumber}`}
          >
            {renderAnnotation(annotation)}
          </div>
        ))}
    </pjs-container>
  );
}
