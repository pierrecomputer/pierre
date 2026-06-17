'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { IconArrowLeftBar } from '@pierre/icons';
import { useCallback, useMemo, useRef, useState } from 'react';

import { SELECTION_DEMO_FILE } from './constants';
import { Button } from '@/components/ui/button';

interface SelectionDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Custom element the File renders into; its shadow DOM is open, so we can reach
// in to read the live selection.
const DIFFS_TAG_NAME = 'diffs-container';

// The pristine document text the Reset button restores the surface to.
const ORIGINAL_CONTENTS = SELECTION_DEMO_FILE.contents;

// Inline styles keep the injected widget self-contained: it slots into light DOM
// where the page's Tailwind classes don't reach, so we ship its look with it.
const ACTION_STYLE =
  'display: flex; flex-wrap: wrap; gap: 8px; padding: 8px 0;';
const BUTTON_STYLE =
  'font-size: 12px; padding: 4px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, currentColor 35%, transparent); background-color: color-mix(in srgb, currentColor 8%, transparent); color: inherit; cursor: pointer;';

// Normalize trailing newlines so a wrapped-then-restored document compares equal
// to the original regardless of how the editor serializes its final newline.
function normalize(text: string): string {
  return text.replace(/\n+$/, '');
}

// The {line, character} position one past the last character of `text`. The
// Reset button selects from the document start to here, then types the original
// contents over the whole range to revert every applied wrap in one edit.
function endPosition(text: string): { line: number; character: number } {
  const lines = text.split('\n');
  const line = lines.length - 1;
  return { line, character: lines[line].length };
}

// Demo of the editor's opt-in Selection Action: with `enabledSelectionAction`,
// selecting text reveals a gutter icon whose click runs `renderSelectionAction`
// inline. The toolbar drives the same transforms programmatically. With no
// public API to read the selection or push an edit from outside the action, we
// drive the editor as a user would—reading the shadow-DOM selection and
// dispatching `beforeinput`.
export function SelectionDemo({ prerenderedFile }: SelectionDemoProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // The editor's live text, kept current by `onChange`, so Reset knows the
  // range to overwrite and we can tell whether any wrap has been applied.
  const currentTextRef = useRef(ORIGINAL_CONTENTS);
  const [changed, setChanged] = useState(false);

  const editor = useMemo(
    () =>
      new Editor<undefined>({
        onChange(file) {
          currentTextRef.current = file.contents;
          setChanged(normalize(file.contents) !== normalize(ORIGINAL_CONTENTS));
        },
        enabledSelectionAction: true,
        renderSelectionAction({
          close,
          getSelectionText,
          replaceSelectionText,
        }) {
          const container = document.createElement('div');
          container.style.cssText = ACTION_STYLE;

          const addAction = (
            label: string,
            transform: (text: string) => string
          ) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.style.cssText = BUTTON_STYLE;
            button.addEventListener('click', () => {
              replaceSelectionText(transform(getSelectionText()));
              close();
            });
            container.append(button);
          };

          addAction('Wrap in t()', (text) => `t(${text})`);
          addAction('Uppercase', (text) => text.toUpperCase());

          return container;
        },
      }),
    []
  );

  // Resolve the editor's editable content element inside the open shadow root,
  // or null until the File has highlighted and attached.
  const getContent = useCallback((): HTMLElement | null => {
    const host = wrapperRef.current?.querySelector<HTMLElement>(DIFFS_TAG_NAME);
    return (
      host?.shadowRoot?.querySelector<HTMLElement>('[data-content]') ?? null
    );
  }, []);

  // Read the currently selected text straight from the editor's shadow root.
  // Chromium exposes `getSelection()` on a ShadowRoot, which is what the editor
  // renders into; this returns '' when nothing is selected.
  const getSelectedText = useCallback((): string => {
    const host = wrapperRef.current?.querySelector<HTMLElement>(DIFFS_TAG_NAME);
    const shadow = host?.shadowRoot as
      | (ShadowRoot & { getSelection?: () => Selection | null })
      | null
      | undefined;
    return shadow?.getSelection?.()?.toString() ?? '';
  }, []);

  // Type `replacement` over the editor's current selection by dispatching the
  // same `beforeinput` the browser emits while typing, so the edit lands on the
  // undo stack exactly as a hand-typed one would.
  const typeOverSelection = useCallback(
    (content: HTMLElement, replacement: string) => {
      content.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: replacement,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    },
    []
  );

  // Wrap the live selection in `t(...)`, mirroring the inline action but driven
  // from the toolbar. The button suppresses its default mousedown so clicking it
  // doesn't blur the editor and drop the selection we're about to read.
  const wrapSelection = useCallback(() => {
    const content = getContent();
    const text = getSelectedText();
    if (content == null || text === '') {
      return;
    }
    typeOverSelection(content, `t(${text})`);
  }, [getContent, getSelectedText, typeOverSelection]);

  // Restore the original document by selecting the whole thing and typing the
  // pristine contents over it. We capture and restore the window scroll around
  // `setSelections` because selecting scrolls the caret into view, which would
  // otherwise yank the page down to this (below-the-fold) demo.
  const reset = useCallback(() => {
    const content = getContent();
    if (content == null) {
      return;
    }
    const { scrollX, scrollY } = window;
    editor.setSelections([
      {
        start: { line: 0, character: 0 },
        end: endPosition(currentTextRef.current),
        direction: 'forward',
      },
    ]);
    typeOverSelection(content, ORIGINAL_CONTENTS);
    editor.setSelections([
      {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
        direction: 'none',
      },
    ]);
    window.scrollTo(scrollX, scrollY);
  }, [editor, getContent, typeOverSelection]);

  return (
    <div className="not-prose" ref={wrapperRef}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onMouseDown={(event) => event.preventDefault()}
          onClick={wrapSelection}
        >
          Wrap in t()
        </Button>
        <Button variant="outline" size="sm" onClick={reset} disabled={!changed}>
          <IconArrowLeftBar />
          Reset
        </Button>
      </div>
      <EditorProvider editor={editor}>
        <File {...prerenderedFile} className="diff-container" contentEditable />
      </EditorProvider>
    </div>
  );
}
