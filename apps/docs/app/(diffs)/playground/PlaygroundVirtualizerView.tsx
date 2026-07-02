'use client';

import {
  type FileDiffMetadata,
  type FileDiffOptions,
  VirtualizedFileDiff,
  Virtualizer,
} from '@pierre/diffs';
import { useWorkerPool } from '@pierre/diffs/react';
import { useEffect, useRef } from 'react';

interface PlaygroundVirtualizerViewProps {
  diffs: FileDiffMetadata[];
  options: FileDiffOptions<undefined>;
}

// Renders a list of full diffs through the vanilla Virtualizer using the
// document/window as the scroll container, so the list flows in the page (like
// the Normal view) rather than scrolling inside its own box. The React
// <Virtualizer> wrapper always scrolls inside its own element, so we drive the
// imperative API directly to get window/body scroll.
export function PlaygroundVirtualizerView({
  diffs,
  options,
}: PlaygroundVirtualizerViewProps) {
  const pool = useWorkerPool();
  const contentRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<VirtualizedFileDiff[]>([]);

  // Build the virtualizer and one VirtualizedFileDiff per diff once the content
  // container and worker pool are available. Rebuilds only when the diff list or
  // pool identity changes; live option edits go through the effect below so we
  // don't tear down the virtualizer on every toggle.
  useEffect(() => {
    const content = contentRef.current;
    if (content == null || pool == null) {
      return;
    }

    const virtualizer = new Virtualizer();
    // Passing `document` makes the page/window the scroll container.
    virtualizer.setup(document);

    const instances = diffs.map((fileDiff) => {
      // `diffs-container` is the library's default (registered) container
      // element. We create and append it ourselves so the virtualizer can
      // observe it within the page flow.
      const fileContainer = document.createElement('diffs-container');
      fileContainer.style.display = 'block';
      content.appendChild(fileContainer);

      const instance = new VirtualizedFileDiff(
        options,
        virtualizer,
        undefined,
        pool
      );
      instance.render({ fileDiff, fileContainer });
      return instance;
    });
    instancesRef.current = instances;

    return () => {
      for (const instance of instances) {
        instance.cleanUp();
      }
      instancesRef.current = [];
      virtualizer.cleanUp();
      content.replaceChildren();
    };
    // Option changes are applied imperatively in the effect below rather than by
    // rebuilding the whole virtualizer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffs, pool]);

  // Apply live option changes to the existing instances. No rerender is needed
  // while virtualized — the virtualizer repaints visible instances itself.
  useEffect(() => {
    for (const instance of instancesRef.current) {
      instance.setOptions({ ...instance.options, ...options });
    }
  }, [options]);

  return <div ref={contentRef} className="space-y-4" />;
}
