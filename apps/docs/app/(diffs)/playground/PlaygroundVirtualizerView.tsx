'use client';

import {
  type DiffLineAnnotation,
  type FileDiffMetadata,
  type FileDiffOptions,
  isDiffAnnotationCollection,
  VirtualizedFileDiff,
  Virtualizer,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { useWorkerPool } from '@pierre/diffs/react';
import { useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';

import { ITEM_UNSAFE_CSS } from './constants';
import { CommentForm, CommentThread } from './PlaygroundComments';

interface PlaygroundVirtualizerViewProps {
  diffs: FileDiffMetadata[];
  options: FileDiffOptions<VirtualizerAnnotationMetadata>;
  enableLineSelection: boolean;
  enableGutterComments: boolean;
  showAnnotations: boolean;
}

// Both edit-toggle state icons, inlined as SVG markup. @pierre/icons ships
// React components (used by the CodeView and React-Virtualizer toggles), but
// this vanilla view builds DOM directly, so the same two glyphs
// (IconCheckboxFill / IconSquircleLg) are inlined here. The shared
// `.playground-edit-toggle` styles show whichever matches `aria-pressed`.
const EDIT_TOGGLE_ICON_ON = `<svg class="playground-edit-toggle-icon-on" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 0C1.412 0 0 1.412 0 8s1.412 8 8 8 8-1.412 8-8-1.412-8-8-8m4.08 5.975a.75.75 0 0 0-1.16-.95L6.943 9.884 5.03 7.97a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.11-.055z"/></svg>`;
const EDIT_TOGGLE_ICON_OFF = `<svg class="playground-edit-toggle-icon-off" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M1.788 4.296C1.588 5.194 1.5 6.387 1.5 8s.088 2.806.288 3.704c.196.88.478 1.381.802 1.706s.826.607 1.706.802c.898.2 2.091.288 3.704.288s2.806-.088 3.704-.288c.88-.195 1.381-.478 1.706-.802s.607-.826.802-1.706c.2-.898.288-2.091.288-3.704s-.088-2.806-.288-3.704c-.195-.88-.478-1.381-.802-1.706s-.826-.606-1.706-.802C10.806 1.588 9.613 1.5 8 1.5s-2.806.088-3.704.288c-.88.196-1.381.478-1.706.802s-.606.826-.802 1.706M0 8c0-6.588 1.412-8 8-8s8 1.412 8 8-1.412 8-8 8-8-1.412-8-8"/></svg>`;

// Builds the per-file "Edit" toggle rendered into a diff header's metadata
// slot. Slotted content is a light-DOM child of the diffs container, so the
// app stylesheet reaches it: styling lives in the shared
// `.playground-edit-toggle` class (globals.css), matching the CodeView and
// React-Virtualizer toggles. Both state icons and both labels ("Edit" /
// "Editing") are always present; CSS shows the pair matching `aria-pressed`,
// so the caller only flips the attribute (and wires edit/cleanup) once the diff
// instance exists.
function createEditToggle(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'playground-edit-toggle';
  button.setAttribute('aria-pressed', 'false');
  button.innerHTML = `${EDIT_TOGGLE_ICON_ON}${EDIT_TOGGLE_ICON_OFF}<span class="playground-edit-toggle-label-on">Editing</span><span class="playground-edit-toggle-label-off">Edit</span>`;
  return button;
}

const VIRTUALIZER_CUSTOM_CSS = `${ITEM_UNSAFE_CSS}
[data-diffs-header] {
  top: 60px;
}
`;

// Annotations carry a stable key in metadata so their React roots survive
// edit-session remaps: line numbers move when lines are inserted above a
// comment, but the metadata reference rides through the editor's remap
// untouched.
interface VirtualizerAnnotationMetadata {
  key: string;
  /** Submitted comment text. Present once the comment form was submitted;
   * absent while the form is still open. */
  body?: string;
}

type VirtualizerAnnotation = DiffLineAnnotation<VirtualizerAnnotationMetadata>;

function annotationKey(
  index: number,
  annotation: VirtualizerAnnotation
): string {
  return `${index}:${annotation.metadata.key}`;
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
  enableLineSelection,
  enableGutterComments,
  showAnnotations,
}: PlaygroundVirtualizerViewProps) {
  const pool = useWorkerPool();
  const contentRef = useRef<HTMLDivElement>(null);
  const instancesRef = useRef<
    VirtualizedFileDiff<VirtualizerAnnotationMetadata>[]
  >([]);
  const annotationsRef = useRef<VirtualizerAnnotation[][]>([]);
  const annotationRootsRef = useRef(new Map<string, Root>());
  const annotationKeyCounterRef = useRef(0);

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
    const editors: Editor<VirtualizerAnnotationMetadata>[] = [];
    const instances = diffs.map((fileDiff, index) => {
      // `diffs-container` is the library's default (registered) container
      // element. We create and append it ourselves so the virtualizer can
      // observe it within the page flow.
      const fileContainer = document.createElement('diffs-container');
      fileContainer.style.display = 'block';
      content.appendChild(fileContainer);

      // Edits remap annotation line numbers; onChange hands the remapped set
      // back so this view's annotation source of truth follows the edit —
      // otherwise the next host-driven render snaps comments back to their
      // pre-edit lines. An annotation whose line was deleted is dropped from
      // the set; retire its orphaned React root.
      const editor = new Editor<VirtualizerAnnotationMetadata>({
        onChange: (_file, lineAnnotations) => {
          if (
            lineAnnotations == null ||
            !isDiffAnnotationCollection(lineAnnotations)
          ) {
            return;
          }
          const previous = annotationsRef.current[index];
          if (previous === lineAnnotations) {
            return;
          }
          annotationsRef.current[index] = lineAnnotations;
          const liveKeys = new Set(
            lineAnnotations.map((annotation) =>
              annotationKey(index, annotation)
            )
          );
          for (const annotation of previous) {
            const key = annotationKey(index, annotation);
            if (!liveKeys.has(key)) {
              unmountAnnotationRoot(key);
            }
          }
        },
      });
      editors.push(editor);
      const editToggle = createEditToggle();

      const rerenderWithAnnotations = () => {
        instance.render({
          fileDiff,
          lineAnnotations: [...annotationsRef.current[index]],
        });
      };

      const removeAnnotation = (annotation: VirtualizerAnnotation) => {
        annotationsRef.current[index] = annotationsRef.current[index].filter(
          (existing) => existing.metadata.key !== annotation.metadata.key
        );
        instance.setSelectedLines(null);
        rerenderWithAnnotations();
        unmountAnnotationRoot(annotationKey(index, annotation));
      };

      // Submitting persists the form in place: the annotation keeps its key
      // and position and gains the typed body, which flips its rendering to a
      // comment thread. The fresh metadata object fails the diff's annotation
      // equality check, so the re-render rebuilds the wrapper and
      // renderAnnotation swaps the root's content.
      const submitAnnotation = (
        annotation: VirtualizerAnnotation,
        body: string
      ) => {
        annotationsRef.current[index] = annotationsRef.current[index].map(
          (existing) =>
            existing.metadata.key === annotation.metadata.key
              ? { ...existing, metadata: { ...existing.metadata, body } }
              : existing
        );
        instance.setSelectedLines(null);
        rerenderWithAnnotations();
      };

      const instance: VirtualizedFileDiff<VirtualizerAnnotationMetadata> =
        new VirtualizedFileDiff<VirtualizerAnnotationMetadata>(
          {
            ...options,
            renderHeaderMetadata: () => editToggle,
            stickyHeader: true,
            unsafeCSS: VIRTUALIZER_CUSTOM_CSS,
            enableLineSelection: enableLineSelection && !enableGutterComments,
            enableGutterUtility: enableGutterComments && showAnnotations,
            onGutterUtilityClick: (range) => {
              const side = range.endSide ?? range.side;
              if (side == null) {
                return;
              }
              const lineNumber = range.end;
              const annotations = annotationsRef.current[index];
              if (
                annotations.some(
                  (annotation) =>
                    annotation.side === side &&
                    annotation.lineNumber === lineNumber
                )
              ) {
                return;
              }
              annotations.push({
                side,
                lineNumber,
                metadata: {
                  key: `comment-${annotationKeyCounterRef.current++}`,
                },
              });
              rerenderWithAnnotations();
            },
            renderAnnotation: (annotation) => {
              // A remap re-renders the same annotation under the same key; the
              // previous wrapper (and the root inside it) is being discarded by
              // the diff, so retire that root before mounting the replacement.
              const key = annotationKey(index, annotation);
              unmountAnnotationRoot(key);
              const container = document.createElement('div');
              const root = createRoot(container);
              annotationRootsRef.current.set(key, root);
              // Render synchronously so the recreated comment paints in the
              // same frame as the row that hosts it.
              flushSync(() => {
                root.render(
                  annotation.metadata.body != null ? (
                    <CommentThread
                      body={annotation.metadata.body}
                      onDelete={() => removeAnnotation(annotation)}
                    />
                  ) : (
                    <CommentForm
                      side={annotation.side}
                      lineNumber={annotation.lineNumber}
                      onCancel={() => removeAnnotation(annotation)}
                      onSubmit={(_side, _lineNumber, body) =>
                        submitAnnotation(annotation, body)
                      }
                    />
                  )
                );
              });
              return container;
            },
          },
          virtualizer,
          undefined,
          pool
        );

      // Attaching the editor flips the new-file surface to contentEditable;
      // detaching restores read-only review. The button tracks its own state on
      // `aria-pressed` (which also drives the shared toggle styles).
      editToggle.addEventListener('click', () => {
        const editing = editToggle.getAttribute('aria-pressed') !== 'true';
        editToggle.setAttribute('aria-pressed', editing ? 'true' : 'false');
        if (editing) {
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
        enableLineSelection: enableLineSelection && !enableGutterComments,
        enableGutterUtility: enableGutterComments && showAnnotations,
      });
    }
  }, [options, enableLineSelection, enableGutterComments, showAnnotations]);

  // Annotations are demo state: turning the toggle off clears them.
  useEffect(() => {
    if (showAnnotations) {
      return;
    }
    instancesRef.current.forEach((instance, index) => {
      instance.setSelectedLines(null);
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
