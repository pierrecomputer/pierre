'use client';

import {
  type FileDiffMetadata,
  type FileDiffOptions,
  VirtualizedFileDiff,
  Virtualizer,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { useWorkerPool } from '@pierre/diffs/react';
import { useEffect, useRef } from 'react';

import { ITEM_UNSAFE_CSS } from './constants';

interface PlaygroundVirtualizerViewProps {
  diffs: FileDiffMetadata[];
  options: FileDiffOptions<undefined>;
}

// Builds the per-file "Edit" checkbox rendered into a diff header's metadata
// slot. The header lives in the diff's shadow root (outside app CSS), so the
// control is styled inline. Returns the label element plus its input so the
// caller can wire the change handler once the diff instance exists.
function createEditToggle(): { element: HTMLElement; input: HTMLInputElement } {
  const label = document.createElement('label');
  label.style.display = 'inline-flex';
  label.style.alignItems = 'center';
  label.style.gap = '4px';
  label.style.cursor = 'pointer';
  label.style.fontSize = '12px';
  label.style.userSelect = 'none';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.style.cursor = 'pointer';

  const text = document.createElement('span');
  text.textContent = 'Edit';

  label.append(input, text);
  return { element: label, input };
}

const VIRTUALIZER_CUSTOM_CSS = `${ITEM_UNSAFE_CSS}
[data-diffs-header] {
  top: 60px;
}
`;

// Renders a list of full diffs through the vanilla Virtualizer using the
// document/window as the scroll container, so the list flows in the page (like
// the Normal view) rather than scrolling inside its own box. The React
// <Virtualizer> wrapper always scrolls inside its own element, so we drive the
// imperative API directly to get window/body scroll.
//
// Each diff header carries its own "Edit" checkbox (in the header metadata
// slot); toggling it attaches a per-file Editor to that diff and flips its
// new-file surface into contentEditable. Files are edited independently because
// one Editor only binds to one instance at a time.
export function PlaygroundVirtualizerView({
  diffs,
  options,
}: PlaygroundVirtualizerViewProps) {
  const pool = useWorkerPool();
  const contentRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<VirtualizedFileDiff[]>([]);

  // Build the virtualizer and one VirtualizedFileDiff (+ editor) per diff once
  // the content container and worker pool are available. Rebuilds only when the
  // diff list or pool identity changes; live option edits go through the effect
  // below so we don't tear down the virtualizer on every toggle.
  useEffect(() => {
    const content = contentRef.current;
    if (content == null || pool == null) {
      return;
    }

    const virtualizer = new Virtualizer();
    // Passing `document` makes the page/window the scroll container.
    virtualizer.setup(document);

    const editors: Editor<undefined>[] = [];
    const instances = diffs.map((fileDiff) => {
      // `diffs-container` is the library's default (registered) container
      // element. We create and append it ourselves so the virtualizer can
      // observe it within the page flow.
      const fileContainer = document.createElement('diffs-container');
      fileContainer.style.display = 'block';
      content.appendChild(fileContainer);

      const editor = new Editor<undefined>({});
      editors.push(editor);
      const { element: editToggle, input } = createEditToggle();

      const instance = new VirtualizedFileDiff(
        {
          ...options,
          renderHeaderMetadata: () => editToggle,
          stickyHeader: true,
          unsafeCSS: VIRTUALIZER_CUSTOM_CSS,
        },
        virtualizer,
        undefined,
        pool
      );

      // Attaching the editor flips the new-file surface to contentEditable;
      // detaching restores read-only review.
      input.addEventListener('change', () => {
        if (input.checked) {
          editor.edit(instance);
        } else {
          editor.cleanUp();
        }
      });

      instance.render({ fileDiff, fileContainer });
      return instance;
    });
    instancesRef.current = instances;

    return () => {
      // cleanUp is a safe no-op on editors that were never attached.
      for (const editor of editors) {
        editor.cleanUp();
      }
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

  // Apply live option changes to the existing instances. Spreading over
  // `instance.options` preserves each file's `renderHeaderMetadata` (the edit
  // checkbox). No rerender is needed while virtualized.
  useEffect(() => {
    for (const instance of instancesRef.current) {
      instance.setOptions({ ...instance.options, ...options });
    }
  }, [options]);

  return (
    <div
      ref={contentRef}
      className="space-y-4 overflow-clip rounded-lg border"
    />
  );
}
