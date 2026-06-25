'use client';

import {
  DEFAULT_THEMES,
  getFiletypeFromFileName,
  getHighlighterIfLoaded,
  preloadHighlighter,
} from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  IconApproved,
  IconArrowLeftBar,
  IconArrowRightBar,
  IconArrowRightShort,
  IconArrowShort,
  IconCommit,
  IconRefresh,
} from '@pierre/icons';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HISTORY_DEMO_EDITS, HISTORY_DEMO_FILE } from './constants';
import { Button } from '@/components/ui/button';

interface HistoryDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// Custom element the File renders into; its shadow DOM is open, so we can reach in.
const DIFFS_TAG_NAME = 'diffs-container';

const TOTAL_EDITS = HISTORY_DEMO_EDITS.length;

// SNAPSHOTS[i] is the document with the first `i` edits applied (0 = original,
// TOTAL_EDITS = fully refactored), built with the same find/replace the replay
// uses. Mapping the editor's live text back to its index drives the step count
// from real content rather than a click tally, so it can't drift on undo/redo.
const SNAPSHOTS: readonly string[] = (() => {
  const result = [HISTORY_DEMO_FILE.contents];
  let text = HISTORY_DEMO_FILE.contents;
  for (const edit of HISTORY_DEMO_EDITS) {
    const index = text.indexOf(edit.find);
    if (index >= 0) {
      text =
        text.slice(0, index) +
        edit.replace +
        text.slice(index + edit.find.length);
    }
    result.push(text);
  }
  return result;
})();

// Normalize line endings and trailing newlines so the editor's serialized text
// matches a snapshot regardless of EOL handling.
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

const NORMALIZED_SNAPSHOTS = SNAPSHOTS.map(normalize);

// Index of the snapshot matching the editor's current text, or -1 if the text
// has been changed in a way the demo doesn't track (e.g. free-form typing).
function snapshotIndexFor(text: string): number {
  const exact = SNAPSHOTS.indexOf(text);
  if (exact >= 0) {
    return exact;
  }
  return NORMALIZED_SNAPSHOTS.indexOf(normalize(text));
}

// Language the editor tokenizes this file as. Editing before its grammar has
// loaded throws ("Grammar not loaded"), so we gate the seeded replay on it.
const LANGUAGE = getFiletypeFromFileName(HISTORY_DEMO_FILE.name);

// Minimum delay after the editor's surface attaches before we seed. The editor
// loads its grammar on a 500ms-debounced pass after attaching, so this clears
// that window even when the language was not already loaded at attach time.
const GRAMMAR_SETTLE_MS = 700;

// True once the shared main-thread highlighter has this file's grammar, which
// is what the editor tokenizes edits with.
function isLanguageReady(): boolean {
  return (
    getHighlighterIfLoaded()?.getLoadedLanguages().includes(LANGUAGE) ?? false
  );
}

function detectMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } })
      .userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

// Convert a string offset into the {line, character} position the editor's
// selection API expects, by counting the newlines that precede it.
function offsetToPosition(
  text: string,
  offset: number
): { line: number; character: number } {
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, character: offset - lineStart };
}

export function HistoryDemo({ prerenderedFile }: HistoryDemoProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isMacRef = useRef(false);

  // Number of edits currently applied, derived from the editor's live text on
  // every `onChange` (undo, redo, controls, or keyboard) so it always matches.
  const [applied, setApplied] = useState(0);
  // True once the document no longer matches any seeded snapshot, i.e. the user
  // typed their own edit. The guided step controls and the right-hand list stop
  // mapping to the undo stack in that state, so we surface an off-track UI and a
  // Reset rather than letting the step count freeze at a stale value.
  const [diverged, setDiverged] = useState(false);
  const editor = useMemo(
    () =>
      new Editor<undefined>({
        onChange: (file) => {
          const index = snapshotIndexFor(file.contents);
          if (index >= 0) {
            setApplied(index);
            setDiverged(false);
          } else {
            setDiverged(true);
          }
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

  // The horizontally scrollable code panel (`[data-code]`) wrapping the content.
  const getScroller = useCallback(
    (): HTMLElement | null => getContent()?.closest('[data-code]') ?? null,
    [getContent]
  );

  // Run history dispatches and restore the scroll position afterward. Applying
  // a change reveals the caret via `scrollIntoView`, which would otherwise
  // scroll the code panel sideways and nudge the page.
  const preserveScroll = useCallback(
    (fn: () => void) => {
      const scroller = getScroller();
      const scrollLeft = scroller?.scrollLeft ?? 0;
      const { scrollX, scrollY } = window;
      fn();
      if (scroller != null) {
        scroller.scrollLeft = scrollLeft;
      }
      window.scrollTo(scrollX, scrollY);
    },
    [getScroller]
  );

  // Fire the editor's real undo (Cmd/Ctrl-Z) or redo (adds Shift) shortcut on
  // the content element. The editor applies the change and its `onChange`
  // updates the step count, so the controls and the keyboard share one path.
  const dispatchHistoryKey = useCallback(
    (content: HTMLElement, redo: boolean) => {
      const isMac = isMacRef.current;
      content.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'z',
          bubbles: true,
          cancelable: true,
          composed: true,
          metaKey: isMac,
          ctrlKey: !isMac,
          shiftKey: redo,
        })
      );
    },
    []
  );

  useEffect(() => {
    isMacRef.current = detectMac();
  }, []);

  // Apply a single edit by locating its `find` anchor in that step's snapshot
  // (the document text right before the edit) and replacing it. The editor's
  // `onChange` advances the step count once the edit lands.
  const applyEdit = useCallback(
    (content: HTMLElement, index: number) => {
      const edit = HISTORY_DEMO_EDITS[index];
      const text = SNAPSHOTS[index];
      const at = text.indexOf(edit.find);
      if (at < 0) {
        return;
      }
      editor.setSelections([
        {
          start: offsetToPosition(text, at),
          end: offsetToPosition(text, at + edit.find.length),
          direction: 'forward',
        },
      ]);
      content.dispatchEvent(
        new InputEvent('beforeinput', {
          inputType: 'insertText',
          data: edit.replace,
          bubbles: true,
          cancelable: true,
          composed: true,
        })
      );
    },
    [editor]
  );

  // Apply every edit in one synchronous pass to build the full undo stack. Each
  // `setSelections` scrolls the caret into view, which would yank the page down
  // to this (below-the-fold) demo, so we capture and restore the window scroll
  // position around the burst. Collapsing the selection afterward leaves a clean
  // final state. Reused by both the load seed and Reset, so it assumes the
  // document is at the original snapshot when called.
  const seedAll = useCallback(
    (content: HTMLElement) => {
      const { scrollX, scrollY } = window;
      for (let index = 0; index < TOTAL_EDITS; index++) {
        applyEdit(content, index);
      }
      editor.setSelections([
        {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 0 },
          direction: 'none',
        },
      ]);
      window.scrollTo(scrollX, scrollY);
    },
    [applyEdit, editor]
  );

  // Build the undo stack on load so the surface arrives already fully
  // refactored with history intact. We poll until the content element has
  // attached AND the editor's grammar is ready, because seeding an edit before
  // the editor can tokenize throws ("Grammar not loaded") inside the editor.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper == null) {
      return;
    }

    // Warm the shared highlighter so the grammar is ready as early as possible
    // (ideally before the editor attaches, making its first tokenize sync).
    void preloadHighlighter({
      themes: [DEFAULT_THEMES.dark, DEFAULT_THEMES.light],
      langs: [LANGUAGE],
      preferredHighlighter: 'shiki-wasm',
    }).catch(() => {});

    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;
    let contentSeenAt = 0;

    const waitForReady = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      const content = getContent();
      if (content != null) {
        if (contentSeenAt === 0) {
          contentSeenAt = Date.now();
        }
        if (
          isLanguageReady() &&
          Date.now() - contentSeenAt >= GRAMMAR_SETTLE_MS
        ) {
          seedAll(content);
          return;
        }
      }
      if (attempts < 240) {
        timer = window.setTimeout(waitForReady, 50);
      }
    };

    waitForReady();

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
    };
  }, [getContent, seedAll]);

  const undo = useCallback(() => {
    const content = getContent();
    if (content != null) {
      preserveScroll(() => dispatchHistoryKey(content, false));
    }
  }, [dispatchHistoryKey, getContent, preserveScroll]);

  const redo = useCallback(() => {
    const content = getContent();
    if (content != null) {
      preserveScroll(() => dispatchHistoryKey(content, true));
    }
  }, [dispatchHistoryKey, getContent, preserveScroll]);

  const undoAll = useCallback(() => {
    const content = getContent();
    if (content == null) {
      return;
    }
    preserveScroll(() => {
      for (let i = applied; i > 0; i--) {
        dispatchHistoryKey(content, false);
      }
    });
  }, [applied, dispatchHistoryKey, getContent, preserveScroll]);

  const redoAll = useCallback(() => {
    const content = getContent();
    if (content == null) {
      return;
    }
    preserveScroll(() => {
      for (let i = applied; i < TOTAL_EDITS; i++) {
        dispatchHistoryKey(content, true);
      }
    });
  }, [applied, dispatchHistoryKey, getContent, preserveScroll]);

  // Recover the guided demo after the user typed their own edit. We unwind the
  // whole undo stack (the stray edit plus the seeded steps) back to the original
  // document via the editor's programmatic `undo()`, which is reliable
  // regardless of where focus sits, then replay all seeded edits so the surface
  // lands back at the fully-refactored 7/7 state with its history intact.
  const reset = useCallback(() => {
    const content = getContent();
    if (content == null) {
      return;
    }
    preserveScroll(() => {
      let guard = 0;
      while (editor.canUndo && guard < 1000) {
        editor.undo();
        guard += 1;
      }
      seedAll(content);
    });
  }, [editor, getContent, preserveScroll, seedAll]);

  const canUndo = !diverged && applied > 0;
  const canRedo = !diverged && applied < TOTAL_EDITS;

  return (
    <div className="not-prose" ref={wrapperRef}>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="outline" onClick={undoAll} disabled={!canUndo}>
          <IconArrowLeftBar className="-ml-1" />
          Undo all
        </Button>
        <Button
          variant="outline"
          onClick={undo}
          disabled={!canUndo}
          title="Undo (Cmd/Ctrl-Z)"
        >
          <IconArrowShort className="-ml-1" />
          Undo
        </Button>
        <Button
          variant="outline"
          onClick={redo}
          disabled={!canRedo}
          title="Redo (Cmd/Ctrl-Shift-Z)"
        >
          Redo
          <IconArrowRightShort className="-mr-1" />
        </Button>
        <Button variant="outline" onClick={redoAll} disabled={!canRedo}>
          Redo all
          <IconArrowRightBar className="-mr-1" />
        </Button>
        {diverged ? (
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" onClick={reset}>
              <IconRefresh className="-ml-1" />
              Reset
            </Button>
          </div>
        ) : (
          <span className="text-muted-foreground ml-auto hidden text-xs tabular-nums md:block">
            {applied}/{TOTAL_EDITS} steps
          </span>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1">
          <EditorProvider editor={editor}>
            <File
              {...prerenderedFile}
              className="diff-container"
              contentEditable
            />
          </EditorProvider>
        </div>

        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
          {diverged ? (
            <p className="text-muted-foreground text-sm leading-relaxed">
              Feel free to continue making edits. When ready, reset to restore
              the guided demo.
            </p>
          ) : null}
          {/*
            The applied steps are always the first `applied` rows, so instead of
            faking a box with per-item borders we draw one card behind them: a
            `::before` pinned to the top whose height is `applied` rows tall
            (each row is `h-11` = 2.75rem) and that carries the single
            box-shadow outline. It collapses to nothing when no steps applied.
            While diverged we collapse the card and mute the whole list because
            the step count no longer reflects the undo stack.
          */}
          <ol
            className="bg-muted before:bg-background relative rounded-lg transition-opacity before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-[calc(var(--steps)*2.75rem)] before:rounded-lg before:shadow-[0_0_0_1px_var(--border),0_1px_3px_rgb(0_0_0/0.04),0_6px_16px_-6px_rgb(0_0_0/0.08)] before:transition-[height,opacity] before:duration-200 before:ease-out before:content-[''] data-[diverged=true]:opacity-50 data-[empty=true]:before:opacity-0 dark:bg-neutral-900"
            style={{ '--steps': diverged ? 0 : applied } as CSSProperties}
            data-empty={diverged || applied === 0}
            data-diverged={diverged}
          >
            {HISTORY_DEMO_EDITS.map((edit, index) => {
              const isApplied = !diverged && index < applied;
              const className = [
                'relative z-10 flex h-11 items-center gap-2 px-3 text-[15px]',
                isApplied ? 'text-foreground' : 'text-muted-foreground',
              ].join(' ');
              return (
                <li key={edit.label} className={className}>
                  {isApplied ? (
                    <IconApproved className="mx-[1px] shrink-0 text-green-500 dark:text-green-400" />
                  ) : (
                    <IconCommit className="text-muted-foreground/50 shrink-0" />
                  )}
                  {edit.label}
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </div>
  );
}
