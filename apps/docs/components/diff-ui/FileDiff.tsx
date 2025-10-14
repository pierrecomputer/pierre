'use client';

import {
  type DiffFileRendererOptions,
  type FileContents,
  FileDiff as FileDiffUI,
  type LineAnnotation,
  parseDiffFromFiles,
} from '@pierre/diff-ui';
import deepEqual from 'fast-deep-equal';
import { useLayoutEffect, useRef, useState } from 'react';

const BLANK_FILE = { name: '__', contents: '' };

interface FileDiffProps<LAnnotation = undefined> {
  oldFile: FileContents;
  newFile: FileContents;
  options: DiffFileRendererOptions<LAnnotation>;
  annotations?: LineAnnotation[];
  className?: string;
}

export function FileDiff({
  oldFile,
  newFile,
  options,
  annotations,
  className,
}: FileDiffProps) {
  const [diffRenderer] = useState(() => new FileDiffUI(options));
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
      const [fileDiff] = parseDiffFromFiles(oldFile, newFile);
      if (annotations != null) diffRenderer.setLineAnnotations(annotations);
      void diffRenderer.render({
        fileDiff: fileDiff.files[0],
        fileContainer: ref.current ?? undefined,
      });
    }
  });
  return <pjs-container ref={ref} className={className} />;
}
