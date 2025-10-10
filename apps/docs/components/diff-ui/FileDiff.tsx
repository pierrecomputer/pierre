'use client';

import {
  DiffFileRenderer,
  type DiffFileRendererOptions,
  type FileContents,
  parseDiffFromFiles,
} from '@pierre/diff-ui';
import deepEqual from 'fast-deep-equal';
import { useLayoutEffect, useRef, useState } from 'react';

const BLANK_FILE = { name: '__', contents: '' };

interface FileDiffProps<LAnnotation = undefined> {
  oldFile: FileContents;
  newFile: FileContents;
  options: DiffFileRendererOptions<LAnnotation>;
}

export function FileDiff({ oldFile, newFile, options }: FileDiffProps) {
  const [diffRenderer] = useState(() => new DiffFileRenderer(options));
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

    if (!deepEqual(optionsRef.current, options)) {
      optionsRef.current = options;
      diffRenderer.setOptions(options, hasFileChange);
    }
    if (hasFileChange) {
      filesRef.current = [oldFile, newFile];
      const [fileDiff] = parseDiffFromFiles(oldFile, newFile);
      diffRenderer.render({
        fileDiff: fileDiff.files[0],
        fileContainer: ref.current ?? undefined,
      });
    }
  });
  return <pjs-container ref={ref} />;
}
