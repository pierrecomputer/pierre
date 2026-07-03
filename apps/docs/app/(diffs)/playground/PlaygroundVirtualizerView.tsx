'use client';

import {
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type FileDiffOptions,
  VirtualizedFileDiff,
  Virtualizer,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { useWorkerPool } from '@pierre/diffs/react';
import { useEffect, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ITEM_UNSAFE_CSS } from './constants';
import { CommentForm } from './PlaygroundComments';

interface PlaygroundVirtualizerViewProps {
  diffs: FileDiffMetadata[];
  options: FileDiffOptions<undefined>;
  enableGutterComments: boolean;
  showAnnotations: boolean;
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

function annotationKey(
  index: number,
  annotation: DiffLineAnnotation<undefined>
): string {
  return `${index}:${annotation.side}:${annotation.lineNumber}`;
}

// The "Virtualizer (window)" mode: renders a list of full diffs through the
// vanilla Virtualizer using the document/window as the scroll container, so
// the list flows in the page (like the Normal view) rather than scrolling
// inside its own box. The React <Virtualizer> wrapper always scrolls inside
// its own element — that variant is demoed by
// PlaygroundVirtualizerElementView — so this view drives the imperative API
// directly to get window/body scroll.
//
// Each diff header carries its own "Edit" checkbox (in the header metadata
// slot); toggling it attaches a per-file Editor to that diff and flips its
// new-file surface into contentEditable. Files are edited independently because
// one Editor only binds to one instance at a time.
//
// Gutter comments reuse the shared React CommentForm: the vanilla
// renderAnnotation callback returns an element hosting a small React root.
// Annotation elements are slotted light-DOM children of the diffs container,
// so the app's stylesheet reaches them exactly like in the React views.
export function PlaygroundVirtualizerView({
  diffs,
  options,
  enableGutterComments,
  showAnnotations,
}: PlaygroundVirtualizerViewProps) {
  const pool = useWorkerPool();
  const contentRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<VirtualizedFileDiff[]>([]);
  const annotationsRef = useRef<DiffLineAnnotation<undefined>[][]>([]);
  const annotationRootsRef = useRef(new Map<string, Root>());

  // React forbids synchronously unmounting a root from inside its own event
  // handler (the Cancel button lives in the root being removed), so unmounts
  // are deferred a tick.
  const unmountAnnotationRoot = (key: string) => {
    const root = annotationRootsRef.current.get(key);
    if (root == null) {
      return;
    }
    annotationRootsRef.current.delete(key);
    setTimeout(() => root.unmount(), 0);
  };

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

    annotationsRef.current = diffs.map(() => []);
    const editors: Editor<undefined>[] = [];
    const instances = diffs.map((fileDiff, index) => {
      // `diffs-container` is the library's default (registered) container
      // element. We create and append it ourselves so the virtualizer can
      // observe it within the page flow.
      const fileContainer = document.createElement('diffs-container');
      fileContainer.style.display = 'block';
      content.appendChild(fileContainer);

      const editor = new Editor<undefined>({});
      editors.push(editor);
      const { element: editToggle, input } = createEditToggle();

      const rerenderWithAnnotations = () => {
        instance.render({
          fileDiff,
          lineAnnotations: [...annotationsRef.current[index]],
        });
      };

      const removeAnnotation = (annotation: DiffLineAnnotation<undefined>) => {
        annotationsRef.current[index] = annotationsRef.current[index].filter(
          (existing) =>
            !(
              existing.side === annotation.side &&
              existing.lineNumber === annotation.lineNumber
            )
        );
        rerenderWithAnnotations();
        unmountAnnotationRoot(annotationKey(index, annotation));
      };

      const instance: VirtualizedFileDiff = new VirtualizedFileDiff(
        {
          ...options,
          renderHeaderMetadata: () => editToggle,
          stickyHeader: true,
          unsafeCSS: VIRTUALIZER_CUSTOM_CSS,
          enableGutterUtility: enableGutterComments && showAnnotations,
          onGutterUtilityClick: (range) => {
            if (range.side == null) {
              return;
            }
            const annotations = annotationsRef.current[index];
            if (
              annotations.some(
                (annotation) =>
                  annotation.side === range.side &&
                  annotation.lineNumber === range.start
              )
            ) {
              return;
            }
            annotations.push({ side: range.side, lineNumber: range.start });
            rerenderWithAnnotations();
          },
          renderAnnotation: (annotation) => {
            const container = document.createElement('div');
            const root = createRoot(container);
            annotationRootsRef.current.set(
              annotationKey(index, annotation),
              root
            );
            root.render(
              <CommentForm
                side={annotation.side}
                lineNumber={annotation.lineNumber}
                onCancel={() => removeAnnotation(annotation)}
              />
            );
            return container;
          },
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

    const annotationRoots = annotationRootsRef.current;
    return () => {
      // cleanUp is a safe no-op on editors that were never attached.
      for (const editor of editors) {
        editor.cleanUp();
      }
      for (const instance of instances) {
        instance.cleanUp();
      }
      for (const root of annotationRoots.values()) {
        setTimeout(() => root.unmount(), 0);
      }
      annotationRoots.clear();
      instancesRef.current = [];
      annotationsRef.current = [];
      virtualizer.cleanUp();
      content.replaceChildren();
    };
    // Option changes are applied imperatively in the effect below rather than by
    // rebuilding the whole virtualizer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffs, pool]);

  // Apply live option changes to the existing instances. Spreading over
  // `instance.options` preserves each file's per-instance callbacks (edit
  // checkbox, gutter/annotation handlers). No rerender is needed while
  // virtualized.
  useEffect(() => {
    for (const instance of instancesRef.current) {
      instance.setOptions({
        ...instance.options,
        ...options,
        enableGutterUtility: enableGutterComments && showAnnotations,
      });
    }
  }, [options, enableGutterComments, showAnnotations]);

  // Annotations are demo state: turning the toggle off clears them.
  useEffect(() => {
    if (showAnnotations) {
      return;
    }
    instancesRef.current.forEach((instance, index) => {
      const annotations = annotationsRef.current[index] ?? [];
      if (annotations.length === 0) {
        return;
      }
      for (const annotation of annotations) {
        unmountAnnotationRoot(annotationKey(index, annotation));
      }
      annotationsRef.current[index] = [];
      instance.render({ fileDiff: diffs[index], lineAnnotations: [] });
    });
  }, [showAnnotations, diffs]);

  return (
    <div
      ref={contentRef}
      className="space-y-4 overflow-clip rounded-lg border"
    />
  );
}
