'use client';

import { DEFAULT_THEMES, type FileDiffMetadata } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, File, FileDiff } from '@pierre/diffs/react';
import { IconArrow, IconChevronSm, IconSparkle, IconX } from '@pierre/icons';
import { FileTree, type FileTreeRowDecoration } from '@pierre/trees';
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import './agent-ui.css';
import {
  AUI_DIFF_OPTIONS,
  AUI_SESSIONS,
  type AuiChangedFile,
  type AuiSession,
  getFileDiff,
  getSessionDirectoryPaths,
  getSessionGitStatus,
  getSessionPaths,
} from './mockData';

// Runs as a layout effect in the browser (so DOM reads/writes land before the
// next paint) but falls back to useEffect during SSR, where useLayoutEffect
// would warn. The demo is server-rendered, so the fallback matters.
const useIsomorphicLayoutEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

// Added/removed line totals for a single file's diff.
interface DiffStats {
  additions: number;
  deletions: number;
}

// Sums the added and removed line counts across every hunk of a parsed diff so
// the Changes tree can show live +/- totals that track in-editor edits, rather
// than the static snapshot counts baked into the mock data.
function countDiffStats(diff: FileDiffMetadata): DiffStats {
  let additions = 0;
  let deletions = 0;
  for (const hunk of diff.hunks) {
    additions += hunk.additionLines;
    deletions += hunk.deletionLines;
  }
  return { additions, deletions };
}

// The editor's stylesheet flattens every line number to one neutral colour
// (`--diffs-editor-line-number-fg`) and is injected as an unlayered <style>,
// so it overrides the library's per-line colouring (which lives in @layer
// base). We adopt this extra, higher-specificity unlayered sheet into the
// editor's shadow root to restore jade/red numbers for added and deleted
// lines, while leaving the active/selected line to the editor's own styling.
const LINE_NUMBER_COLOR_CSS = `
[data-column-number][data-line-type='change-addition']:not([data-selected-line]):not([data-active]) {
  color: var(--diffs-addition-base);
}
[data-column-number][data-line-type='change-deletion']:not([data-selected-line]):not([data-active]) {
  color: var(--diffs-deletion-base);
}
`;

let lineNumberColorSheet: CSSStyleSheet | null = null;
function getLineNumberColorSheet(): CSSStyleSheet | null {
  if (typeof CSSStyleSheet === 'undefined') {
    return null;
  }
  if (lineNumberColorSheet == null) {
    lineNumberColorSheet = new CSSStyleSheet();
    lineNumberColorSheet.replaceSync(LINE_NUMBER_COLOR_CSS);
  }
  return lineNumberColorSheet;
}

// `renderSelectionAction` returns a plain DOM node, not React, and renders into
// the editor's shadow DOM where the page's CSS (including agent-ui.css) doesn't
// reach, so the comment icon is inlined as markup painted with `currentColor`
// and the buttons are styled inline.
const ICON_COMMENT_FILL_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.19406e-05 8C2.19406e-05 3.58172 3.58174 0 8.00002 0C9.17929 0 10.3009 0.255639 11.3107 0.715237C13.4225 1.67636 15.0429 3.52827 15.6917 5.79351C15.8926 6.49527 16 7.23572 16 8C16 12.4183 12.4183 16 8.00002 16H0.750022C0.446675 16 0.173198 15.8173 0.0571123 15.537C-0.0589735 15.2568 0.00519335 14.9342 0.219692 14.7197L1.83763 13.1017C0.690449 11.7174 2.19406e-05 9.93877 2.19406e-05 8Z" fill="currentColor"/></svg>`;

const SELECTION_PRIMARY_BUTTON_STYLE =
  'display: inline-flex; align-items: center; gap: 2px; font-size: 12px; font-weight: 500; padding: 4px 10px 4px 8px; border-radius: 6px; border: 0; background-color: #6366f1; color: #fff; cursor: pointer;';
const SELECTION_SECONDARY_BUTTON_STYLE =
  'display: inline-flex; align-items: center; font-size: 12px; padding: 4px 8px; border-radius: 6px; border: 0; background-color: color-mix(in lab, currentColor 25%, transparent); color: inherit; cursor: pointer;';

// Tighter type scale so a snippet code block fits in the narrow composer.
const SNIPPET_STYLE = {
  '--diffs-font-size': '12px',
  '--diffs-line-height': '18px',
} as CSSProperties;

interface AuiSnippet {
  id: number;
  text: string;
}

// Renders the active session's changed files as a @pierre/trees FileTree, with
// git-status colours and per-row +/- decorations. The tree is an imperative web
// component, so it's created in an effect and torn down on session change.
function ChangesTree({
  session,
  activePath,
  statsByPath,
  onSelect,
}: {
  session: AuiSession;
  activePath: string | null;
  statsByPath: Record<string, DiffStats>;
  onSelect: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  // The FileTree lives for the whole session, so its renderRowDecoration closure
  // is created once. Reading the latest stats through a ref keeps the decoration
  // in sync with edits without recreating the tree.
  const statsRef = useRef(statsByPath);
  statsRef.current = statsByPath;

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      return;
    }

    const filesByPath = new Map<string, AuiChangedFile>(
      session.changedFiles.map((file) => [file.path, file])
    );
    const tree = new FileTree({
      paths: getSessionPaths(session),
      gitStatus: getSessionGitStatus(session),
      initialExpandedPaths: getSessionDirectoryPaths(session),
      density: 'compact',
      renderRowDecoration: ({ item }): FileTreeRowDecoration | null => {
        const file = filesByPath.get(item.path);
        if (file == null) {
          return null;
        }
        // Prefer the live counts (which track in-editor edits) and fall back to
        // the file's static snapshot counts before any edit has been recorded.
        const stats = statsRef.current[item.path] ?? {
          additions: file.additions,
          deletions: file.deletions,
        };
        // `light-dark()` resolves against the tree host's color-scheme, which we
        // pin to the demo's own toggle, so jade/red adapt across light and dark.
        // Skip a zero count entirely so rows only show the side that changed.
        const parts: { text: string; color: string }[] = [];
        if (stats.additions > 0) {
          parts.push({
            text: `+${String(stats.additions)}`,
            color: 'light-dark(#0f9d6b, #34d399)',
          });
        }
        if (stats.deletions > 0) {
          const prefix = parts.length > 0 ? '\u00a0' : '';
          parts.push({
            text: `${prefix}\u2212${String(stats.deletions)}`,
            color: 'light-dark(#dc2626, #f87171)',
          });
        }
        if (parts.length === 0) {
          return null;
        }
        return {
          text: parts.map((part) => part.text).join(''),
          title: `${String(stats.additions)} additions, ${String(stats.deletions)} deletions`,
          parts,
        };
      },
      onSelectionChange: (selectedPaths) => {
        for (let index = selectedPaths.length - 1; index >= 0; index -= 1) {
          const path = selectedPaths[index];
          if (!path.endsWith('/')) {
            onSelectRef.current(path);
            break;
          }
        }
      },
    });
    treeRef.current = tree;
    container.innerHTML = '';
    tree.render({ fileTreeContainer: container });

    return () => {
      tree.cleanUp();
      treeRef.current = null;
    };
  }, [session]);

  // Inline color-scheme beats the tree's `:host { color-scheme: light dark }`,
  // pinning its light-dark() colours to the demo's dark mode.
  useEffect(() => {
    if (containerRef.current != null) {
      containerRef.current.style.colorScheme = 'dark';
    }
  }, [session]);

  // When the live stats change, force the tree to re-run renderRowDecoration.
  // setComposition deliberately rerenders even with the same composition, and
  // the controller owns selection/expansion so the active row stays highlighted.
  useEffect(() => {
    const tree = treeRef.current;
    if (tree == null) {
      return;
    }
    tree.setComposition(tree.getComposition());
  }, [statsByPath, session]);

  // Keep the highlighted row matched to the active file.
  useEffect(() => {
    const tree = treeRef.current;
    if (tree == null || activePath == null) {
      return;
    }
    const item = tree.getItem(activePath);
    if (item == null) {
      return;
    }
    for (const selectedPath of tree.getSelectedPaths()) {
      if (selectedPath !== activePath) {
        tree.getItem(selectedPath)?.deselect();
      }
    }
    if (!item.isSelected()) {
      item.select();
    }
  }, [activePath, session]);

  return <div ref={containerRef} className="aui-tree" />;
}

export interface AgentUiProps {
  // Highlight themes the surrounding worker pool was initialized with. Defaults
  // to the shared homepage pool's themes.
  theme?: { dark: string; light: string };
  // Server-rendered diff HTML keyed by file path. When present the matching
  // FileDiff hydrates from this markup (already syntax-highlighted) instead of
  // waiting on the client worker, which also avoids an SSR/client mismatch.
  prerenderedDiffs?: Record<string, string>;
}

// The demo is always dark: the snapshot is prerendered dark and matching it
// avoids theme flashing, so there is no light/dark toggle.
export function AgentUi({
  theme = DEFAULT_THEMES,
  prerenderedDiffs,
}: AgentUiProps) {
  const session = AUI_SESSIONS[0];

  const [activePath, setActivePath] = useState<string | null>(
    () => session.changedFiles[0]?.path ?? null
  );

  // Per-file added/removed line totals shown in the Changes tree. Seeded from
  // the snapshot counts and recomputed from the live diff as the user edits.
  const [liveStats, setLiveStats] = useState<Record<string, DiffStats>>(() =>
    Object.fromEntries(
      session.changedFiles.map((file) => [
        file.path,
        { additions: file.additions, deletions: file.deletions },
      ])
    )
  );

  // Snippets sent from the selection action's "Add to chat" land here as
  // composer attachments. The editor is recreated per file, but routing the add
  // through a ref keeps the latest setter without depending on that lifecycle.
  const [snippets, setSnippets] = useState<AuiSnippet[]>([]);
  const snippetIdRef = useRef(0);
  const addSnippet = useCallback((text: string) => {
    const trimmed = text.trim();
    if (trimmed === '') {
      return;
    }
    snippetIdRef.current += 1;
    const id = snippetIdRef.current;
    setSnippets((prev) => [...prev, { id, text: trimmed }]);
  }, []);
  const addSnippetRef = useRef(addSnippet);
  addSnippetRef.current = addSnippet;
  const removeSnippet = useCallback((id: number) => {
    setSnippets((prev) => prev.filter((snippet) => snippet.id !== id));
  }, []);

  // Recomputes a file's +/- totals from its live edits. Routed through a ref so
  // the per-file editor (recreated on `activePath`) can call the latest version
  // without listing `session` as a dependency.
  const recordEditedStats = useCallback(
    (target: string, contents: string) => {
      const changed = session.changedFiles.find(
        (entry) => entry.path === target
      );
      if (changed == null) {
        return;
      }
      const stats = countDiffStats(getFileDiff(changed, contents));
      setLiveStats((prev) => ({ ...prev, [target]: stats }));
    },
    [session]
  );
  const recordEditedStatsRef = useRef(recordEditedStats);
  recordEditedStatsRef.current = recordEditedStats;

  // Persisted in-editor edits keyed by path, so switching files keeps the
  // agent's tweaked output.
  const editsRef = useRef<Map<string, string>>(new Map());
  // The editor's debounced onChange fires without a path argument, so we track
  // the live target here.
  const activeTargetRef = useRef<string | null>(null);
  useEffect(() => {
    activeTargetRef.current = activePath;
  }, [activePath]);

  // The FileDiff is never remounted per file (no `key`), so switching files just
  // swaps the `fileDiff` prop and re-renders in place, preserving the server
  // `prerenderedHTML` (which SSR injects only on mount).
  //
  // The editor, however, IS recreated per file (`activePath` in the deps). The
  // library rebuilds the editor's TextDocument only when the `editor` reference
  // changes, not when `fileDiff` changes, so a stable editor would keep the
  // first file's document while the surface shows another file — mis-positioning
  // the caret and breaking edits.
  const editor = useMemo(
    () =>
      new Editor({
        enabledSelectionAction: true,
        renderSelectionAction({ close, getSelectionText }) {
          const container = document.createElement('div');
          container.style.cssText = 'display: flex; gap: 4px;';

          const addToChat = document.createElement('button');
          addToChat.type = 'button';
          addToChat.style.cssText = SELECTION_PRIMARY_BUTTON_STYLE;
          addToChat.innerHTML = `${ICON_COMMENT_FILL_SVG} Add to chat`;
          // Suppress the default mousedown so clicking the action doesn't blur
          // the editor and collapse the selection we're about to read.
          addToChat.addEventListener('mousedown', (event) =>
            event.preventDefault()
          );
          addToChat.addEventListener('click', () => {
            addSnippetRef.current(getSelectionText());
            close();
          });

          const copy = document.createElement('button');
          copy.type = 'button';
          copy.textContent = 'Copy';
          copy.style.cssText = SELECTION_SECONDARY_BUTTON_STYLE;
          copy.addEventListener('mousedown', (event) => event.preventDefault());
          copy.addEventListener('click', () => {
            void navigator.clipboard?.writeText(getSelectionText());
            close();
          });

          container.append(addToChat, copy);
          return container;
        },
        onChange(file) {
          const target = activeTargetRef.current;
          if (target == null) {
            return;
          }
          editsRef.current.set(target, file.contents);
          // Recompute the edited file's diff against its original snapshot so the
          // Changes tree's +/- totals reflect the live edits.
          recordEditedStatsRef.current(target, file.contents);
        },
      }),
    [activePath]
  );

  const openFile = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const activeFile: AuiChangedFile | null = useMemo(
    () =>
      activePath != null
        ? (session.changedFiles.find((file) => file.path === activePath) ??
          null)
        : null,
    [session, activePath]
  );

  const editKey = activeFile?.path ?? '';

  // Rebuild the diff surface whenever the active file changes, substituting any
  // persisted edits for the snapshot's `after`.
  const fileDiff = useMemo(
    () =>
      activeFile != null
        ? getFileDiff(activeFile, editsRef.current.get(editKey))
        : null,
    [activeFile, editKey]
  );

  // Server-rendered, already-highlighted HTML for the active diff. Only safe
  // when the file is unedited so the markup matches `fileDiff`.
  const activePrerenderedHTML =
    activePath != null && editsRef.current.get(editKey) == null
      ? prerenderedDiffs?.[activePath]
      : undefined;

  const breadcrumbSegments = activePath != null ? activePath.split('/') : [];

  // Re-adopt the jade/red line-number override whenever the diff surface is
  // rebuilt (each file switch remounts the diffs-container with a fresh shadow
  // root).
  const surfaceWrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const sheet = getLineNumberColorSheet();
    if (sheet == null) {
      return;
    }
    const container = surfaceWrapRef.current?.querySelector('.aui-surface');
    const shadowRoot = container?.shadowRoot;
    if (shadowRoot == null) {
      return;
    }
    if (!shadowRoot.adoptedStyleSheets.includes(sheet)) {
      shadowRoot.adoptedStyleSheets = [...shadowRoot.adoptedStyleSheets, sheet];
    }
  }, [activePath]);

  // The FileDiff surface and its host scroll container (`.aui-surface-wrap`) are
  // reused across file switches — only the `fileDiff` prop changes — so without
  // this the previous file's scroll offset carries over to the next file. Reset
  // to the top whenever the active file changes. A layout effect resets after
  // the new diff is laid out but before paint, so there's no flash of the new
  // file at the old offset. Editing a file doesn't change `activePath`, so this
  // never disturbs the scroll position mid-edit.
  useIsomorphicLayoutEffect(() => {
    const wrap = surfaceWrapRef.current;
    if (wrap != null) {
      wrap.scrollTop = 0;
    }
  }, [activePath]);

  return (
    <EditorProvider editor={editor}>
      <div className="aui" data-theme-type="dark" data-embedded="true">
        <div className="aui-body">
          <section className="aui-center">
            <header className="aui-center-header">
              <nav className="aui-breadcrumb" aria-label="File path">
                {breadcrumbSegments.length > 0 ? (
                  breadcrumbSegments.map((segment, index) => (
                    <span
                      // Path segments are positional; index keys are stable here.
                      key={`${segment}-${String(index)}`}
                      className="aui-crumb"
                      data-leaf={
                        index === breadcrumbSegments.length - 1
                          ? 'true'
                          : undefined
                      }
                    >
                      {segment}
                    </span>
                  ))
                ) : (
                  <span className="aui-crumb">No file selected</span>
                )}
              </nav>
            </header>

            <div className="aui-surface-wrap" ref={surfaceWrapRef}>
              {activeFile != null && fileDiff != null ? (
                <FileDiff
                  fileDiff={fileDiff}
                  className="aui-surface"
                  options={{ ...AUI_DIFF_OPTIONS, theme }}
                  prerenderedHTML={activePrerenderedHTML}
                  contentEditable
                />
              ) : (
                <div className="aui-empty">
                  Select a changed file to review.
                </div>
              )}
            </div>

            <div className="aui-composer">
              {snippets.length > 0 && (
                <ul className="aui-composer-attachments">
                  {snippets.map((snippet) => (
                    <li key={snippet.id} className="aui-attachment">
                      <File
                        file={{
                          name: 'snippet.ts',
                          contents: snippet.text,
                        }}
                        options={{
                          theme,
                          themeType: 'dark',
                          disableFileHeader: true,
                          disableLineNumbers: true,
                        }}
                        // The page's shared worker pool is wired up for the
                        // editable editor surface; a dynamically mounted
                        // read-only File isn't highlighted through it, so
                        // highlight on the main thread.
                        disableWorkerPool
                        className="aui-attachment-code"
                        style={SNIPPET_STYLE}
                      />
                      <button
                        type="button"
                        className="aui-attachment-remove"
                        aria-label="Remove snippet"
                        onClick={() => {
                          removeSnippet(snippet.id);
                        }}
                      >
                        <IconX />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <textarea
                className="aui-composer-input"
                placeholder="Ask for changes, @mention files, or run commands…"
                rows={2}
                disabled
              />
              <div className="aui-composer-toolbar">
                <button type="button" className="aui-composer-select" disabled>
                  <IconSparkle className="opacity-50" />
                  Agent
                  <IconChevronSm className="opacity-50" />
                </button>
                <button type="button" className="aui-composer-select" disabled>
                  Mythos 5
                  <IconChevronSm className="opacity-50" />
                </button>
                <button
                  type="button"
                  className="aui-composer-send ml-auto"
                  aria-label="Send"
                  disabled
                >
                  <IconArrow className="rotate-[90deg]" />
                </button>
              </div>
            </div>
          </section>

          <aside className="aui-changes">
            <div className="aui-changes-tabs" role="tablist">
              <button type="button" role="tab" disabled>
                All files
              </button>
              <button type="button" role="tab" aria-selected="true">
                Changes
              </button>
              <button type="button" role="tab" disabled>
                Checks
              </button>
            </div>
            <ChangesTree
              session={session}
              activePath={activePath}
              statsByPath={liveStats}
              onSelect={openFile}
            />
          </aside>
        </div>
      </div>
    </EditorProvider>
  );
}
