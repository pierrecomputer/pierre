'use client';

import { DEFAULT_THEMES } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  IconArrow,
  IconChevronSm,
  IconCommentFill,
  IconFileCode,
  IconSparkle,
  IconX,
} from '@pierre/icons';
import {
  type CSSProperties,
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button } from '@/components/ui/button';

interface SelectionDemoProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// `renderSelectionAction` returns a plain DOM node, not React, so IconCommentFill
// is inlined as markup and painted with `currentColor`.
const ICON_COMMENT_FILL_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.19406e-05 8C2.19406e-05 3.58172 3.58174 0 8.00002 0C9.17929 0 10.3009 0.255639 11.3107 0.715237C13.4225 1.67636 15.0429 3.52827 15.6917 5.79351C15.8926 6.49527 16 7.23572 16 8C16 12.4183 12.4183 16 8.00002 16H0.750022C0.446675 16 0.173198 15.8173 0.0571123 15.537C-0.0589735 15.2568 0.00519335 14.9342 0.219692 14.7197L1.83763 13.1017C0.690449 11.7174 2.19406e-05 9.93877 2.19406e-05 8Z" fill="currentColor"/></svg>`;

// The actions render into the editor's shadow DOM, where the page's Tailwind
// classes don't reach, so they're styled inline.
const PRIMARY_BUTTON_STYLE =
  'display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 500; padding: 4px 10px 4px 8px; border-radius: 6px; border: 0; background-color: #6366f1; color: #fff; cursor: pointer;';
const SECONDARY_BUTTON_STYLE =
  'display: inline-flex; align-items: center; font-size: 12px; padding: 4px 8px; border-radius: 6px; border: 0; background-color: color-mix(in lab, currentColor 25%, transparent); color: inherit; cursor: pointer;';

// Shared Tailwind classes for the inert composer's model/agent picker pills.
const COMPOSER_PILL_CLASS =
  'inline-flex h-7 items-center gap-1.5 rounded-md bg-neutral-800 px-2 text-xs text-neutral-400';

// Tighter type scale so more snippet code fits in the narrow chat panel.
const CHAT_SNIPPET_STYLE = {
  '--diffs-font-size': '12px',
  '--diffs-line-height': '18px',
} as CSSProperties;

interface ChatSnippet {
  fileName: string;
  id: number;
  lineEnd: number;
  lineStart: number;
  text: string;
}

interface ChatSnippetSource {
  selection: {
    end: {
      character: number;
      line: number;
    };
    start: {
      line: number;
    };
  };
}

function getSelectionLineRange(selection: ChatSnippetSource['selection']): {
  lineEnd: number;
  lineStart: number;
} {
  const endLine =
    selection.end.character === 0 && selection.end.line > selection.start.line
      ? selection.end.line - 1
      : selection.end.line;
  const lineStart = Math.min(selection.start.line, endLine) + 1;
  const lineEnd = Math.max(selection.start.line, endLine) + 1;
  return { lineEnd, lineStart };
}

function formatSelectionLineLabel(
  snippet: Pick<ChatSnippet, 'lineEnd' | 'lineStart'>
): string {
  return snippet.lineStart === snippet.lineEnd
    ? `(${String(snippet.lineStart)})`
    : `(${String(snippet.lineStart)}-${String(snippet.lineEnd)})`;
}

// Demo of the editor's opt-in Selection Action: with `enabledSelectionAction`,
// selecting text immediately reveals a floating popover (anchored below the
// selection) whose contents come from `renderSelectionAction`. Here it mimics an
// editor's "Add to chat": the primary action sends the selected snippet to a
// mock chat panel beside the surface, and a secondary action copies it.
export function SelectionDemo({ prerenderedFile }: SelectionDemoProps) {
  const [snippets, setSnippets] = useState<ChatSnippet[]>([]);
  const snippetIdRef = useRef(0);

  // The popover lives inside the editor instance, which is created once. Route
  // its "Add to chat" click through a ref so it always calls the latest setter
  // without recreating the editor.
  const addSnippet = useCallback(
    (text: string, source: ChatSnippetSource) => {
      const trimmed = text.trim();
      if (trimmed === '') {
        return;
      }
      snippetIdRef.current += 1;
      const id = snippetIdRef.current;
      setSnippets((prev) => [
        ...prev,
        {
          id,
          fileName: prerenderedFile.file.name,
          ...getSelectionLineRange(source.selection),
          text: trimmed,
        },
      ]);
    },
    [prerenderedFile.file.name]
  );
  const addSnippetRef = useRef(addSnippet);
  addSnippetRef.current = addSnippet;

  const editor = useMemo(
    () =>
      new Editor<undefined>({
        enabledSelectionAction: true,
        renderSelectionAction(selectionAction) {
          const container = document.createElement('div');
          container.style.cssText = 'display: flex; gap: 4px;';

          const addToChat = document.createElement('button');
          addToChat.type = 'button';
          addToChat.style.cssText = PRIMARY_BUTTON_STYLE;
          addToChat.innerHTML = `${ICON_COMMENT_FILL_SVG} Add to chat`;
          // Suppress the default mousedown so clicking the action doesn't blur
          // the editor and collapse the selection we're about to read.
          addToChat.addEventListener('mousedown', (event) =>
            event.preventDefault()
          );
          addToChat.addEventListener('click', () => {
            addSnippetRef.current(selectionAction.getSelectionText(), {
              selection: selectionAction.selection,
            });
            selectionAction.close();
          });

          const copy = document.createElement('button');
          copy.type = 'button';
          copy.textContent = 'Copy';
          copy.style.cssText = SECONDARY_BUTTON_STYLE;
          copy.addEventListener('mousedown', (event) => event.preventDefault());
          copy.addEventListener('click', () => {
            void navigator.clipboard?.writeText(
              selectionAction.getSelectionText()
            );
            selectionAction.close();
          });

          container.append(addToChat, copy);
          return container;
        },
      }),
    []
  );

  const clearChat = useCallback(() => setSnippets([]), []);

  return (
    <div className="not-prose grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-[minmax(0,1fr)_20rem]">
      <EditorProvider editor={editor}>
        <File {...prerenderedFile} className="diff-container" contentEditable />
      </EditorProvider>

      {/* The wrapper takes its height from the editor column (its only in-flow
          sibling); the aside fills it absolutely at md+ so a long snippet list
          scrolls inside instead of stretching the panel. On mobile it falls back
          to normal flow. */}
      <div className="relative">
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-lg border border-neutral-800 bg-neutral-950 md:absolute md:inset-0">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <span className="flex items-center gap-1 text-sm font-medium text-white">
              <IconCommentFill className="size-4" />
              Chat
            </span>
            {snippets.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto gap-1 px-0 text-neutral-400 hover:bg-transparent hover:text-neutral-200"
                onClick={clearChat}
              >
                <IconX />
                Clear
              </Button>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {snippets.length === 0 ? (
              <p className="p-4 text-sm text-neutral-400">
                Select code in the editor, then choose{' '}
                <span className="font-medium text-white">Add to chat</span> to
                send the snippet here.
              </p>
            ) : (
              <ul className="flex flex-col gap-2 p-3">
                {snippets.map((snippet) => (
                  <li
                    key={snippet.id}
                    className="overflow-hidden rounded-md border border-neutral-800"
                  >
                    <div className="flex h-7 min-w-0 items-center gap-1.5 border-b border-neutral-800 px-2 pr-3 text-xs leading-none text-neutral-400">
                      <IconFileCode className="size-3.5 shrink-0" />
                      <span className="min-w-0 truncate font-medium text-neutral-200">
                        {snippet.fileName}
                      </span>
                      <span className="shrink-0">
                        {formatSelectionLineLabel(snippet)}
                      </span>
                    </div>
                    <File
                      file={{
                        name: snippet.fileName,
                        contents: snippet.text,
                      }}
                      options={{
                        theme: DEFAULT_THEMES,
                        themeType: 'dark',
                        disableFileHeader: true,
                        disableLineNumbers: true,
                      }}
                      // The page's shared worker pool is wired up for the editable
                      // editor surface; a dynamically mounted read-only File isn't
                      // highlighted through it, so highlight on the main thread.
                      disableWorkerPool
                      className="max-h-32 overflow-auto"
                      style={CHAT_SNIPPET_STYLE}
                    />
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-b-md border-t border-neutral-800 bg-neutral-900 p-2.5 focus-within:border-neutral-600">
            <textarea
              className="min-h-10 w-full resize-none bg-transparent px-1 text-[13px] leading-normal text-white placeholder:text-neutral-500 focus:outline-none"
              placeholder="Ask for changes…"
              rows={2}
              disabled
            />
            <div className="flex items-center gap-1.5">
              <button type="button" className={COMPOSER_PILL_CLASS} disabled>
                <IconSparkle className="opacity-50" />
                Agent
                <IconChevronSm className="opacity-50" />
              </button>
              <button type="button" className={COMPOSER_PILL_CLASS} disabled>
                Mythos 5
                <IconChevronSm className="opacity-50" />
              </button>
              <button
                type="button"
                aria-label="Send"
                className="ml-auto inline-flex size-7 items-center justify-center rounded-lg bg-indigo-500 text-white opacity-60"
                disabled
              >
                <IconArrow className="rotate-90" />
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
