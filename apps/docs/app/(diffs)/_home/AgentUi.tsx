'use client';

import { DEFAULT_THEMES, type FileDiffMetadata } from '@pierre/diffs';
import type { EditorOptions } from '@pierre/diffs/editor';
import { File, FileDiff } from '@pierre/diffs/react';
import {
  IconArrow,
  IconChevronSm,
  IconFileCode,
  IconFilePlus,
  IconFolderPlus,
  IconSearch,
  IconSparkle,
  IconX,
} from '@pierre/icons';
import { FileTree, type FileTreeRowDecoration } from '@pierre/trees';
import { useFileTreeSearch } from '@pierre/trees/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  AUI_EXPLORER_NEW_DIR,
  AUI_FULL_TREE_PATHS,
  AUI_SESSIONS,
  type AuiChangedFile,
  type AuiSession,
  getFileDiff,
  getPlaceholderContents,
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
[data-column-number][data-line-type='change-addition']:not([data-selected-line]):not([data-editor-active-line]) {
  color: var(--diffs-addition-base);
}
[data-column-number][data-line-type='change-deletion']:not([data-selected-line]):not([data-editor-active-line]) {
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
  fileName: string;
  lineEnd: number;
  lineStart: number;
  text: string;
}

interface AuiSnippetSource {
  path: string;
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

function getFileName(path: string): string {
  return path.split('/').at(-1) ?? path;
}

function getSelectionLineRange(selection: AuiSnippetSource['selection']): {
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
  snippet: Pick<AuiSnippet, 'lineEnd' | 'lineStart'>
): string {
  return snippet.lineStart === snippet.lineEnd
    ? `(${String(snippet.lineStart)})`
    : `(${String(snippet.lineStart)}-${String(snippet.lineEnd)})`;
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

// The trees library always mounts its search input when `search: true`,
// reflecting the open/closed state on the search container's `data-open`
// attribute rather than unmounting it. Collapse it while closed so the explorer
// shows no search bar until the toolbar's search toggle opens it, then give the
// open input a little breathing room above the tree.
const HIDDEN_SEARCH_CSS = `
[data-file-tree-search-container][data-open='false'] {
  display: none;
}
[data-file-tree-search-container] {
  padding: 8px 8px 4px;
}
`;

// The fullscreen editor's left-hand file explorer: a full project tree (not
// just the changed files) so the standalone /edit/live view reads like a real
// editor sidebar. It reuses the same imperative @pierre/trees FileTree, but
// with search enabled (the input stays hidden until toggled from the toolbar)
// and inline renaming enabled so the toolbar's New file / New folder buttons
// can add an item and immediately drop it into rename mode. Git-status colours
// tint the changed files so they stand out among the surrounding sources;
// selecting one of those opens its diff, while other files are inert (this is a
// demo with diffs only for the session's changed files). The created model is
// handed back via `onModelReady` so the toolbar can drive search/add/rename.
function FilesTree({
  session,
  activePath,
  onModelReady,
  onSelect,
}: {
  session: AuiSession;
  activePath: string | null;
  onModelReady: (model: FileTree | null) => void;
  onSelect: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onModelReadyRef = useRef(onModelReady);
  onModelReadyRef.current = onModelReady;

  useEffect(() => {
    const container = containerRef.current;
    if (container == null) {
      return;
    }

    const tree = new FileTree({
      paths: AUI_FULL_TREE_PATHS,
      gitStatus: getSessionGitStatus(session),
      // Open just the ancestors of the changed files so the explorer lands on
      // the active work, leaving the rest of the project collapsed.
      initialExpandedPaths: getSessionDirectoryPaths(session),
      density: 'compact',
      // Enables the search session. The library always mounts the input, so
      // HIDDEN_SEARCH_CSS collapses it until the toolbar's search toggle opens
      // it — giving the "hidden search" behaviour.
      search: true,
      unsafeCSS: HIDDEN_SEARCH_CSS,
      // Enables inline renaming so the toolbar's New file / New folder buttons
      // can add a placeholder row and immediately put it into rename mode.
      renaming: true,
      onSelectionChange: (selectedPaths) => {
        // Every file opens — changed files show their diff, everything else
        // opens as a placeholder — so only directory rows are ignored here.
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
    onModelReadyRef.current(tree);

    return () => {
      tree.cleanUp();
      treeRef.current = null;
      onModelReadyRef.current(null);
    };
  }, [session]);

  // Inline color-scheme beats the tree's `:host { color-scheme: light dark }`,
  // pinning its light-dark() colours to the demo's dark mode.
  useEffect(() => {
    if (containerRef.current != null) {
      containerRef.current.style.colorScheme = 'dark';
    }
  }, [session]);

  // Keep the highlighted row matched to the active file (when it's one of the
  // changed files that live in this tree).
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

  return <div ref={containerRef} className="aui-files-tree" />;
}

// Picks a path under `dir` that isn't already in the tree, appending `-N` until
// it's unique, so repeated New file / New folder clicks never collide.
function uniqueExplorerPath(
  model: FileTree,
  base: string,
  suffix: string
): string {
  let candidate = `${AUI_EXPLORER_NEW_DIR}${base}${suffix}`;
  let counter = 1;
  while (model.getItem(candidate) != null) {
    candidate = `${AUI_EXPLORER_NEW_DIR}${base}-${String(counter)}${suffix}`;
    counter += 1;
  }
  return candidate;
}

// Line count of a snapshot, ignoring a single trailing newline so an N-line
// file reports N additions rather than N+1.
function countLines(text: string): number {
  if (text === '') {
    return 0;
  }
  const lines = text.split('\n').length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

// A file the user created in the explorer, modeled as an "added" change so it
// shows up in the Changes panel (whole file as additions) and opens as a diff.
function makeAddedFile(path: string): AuiChangedFile {
  const contents = getPlaceholderContents(path);
  return {
    path,
    status: 'added',
    before: '',
    after: contents,
    additions: countLines(contents),
    deletions: 0,
  };
}

// A placeholder file (one outside the agent's change set) that the user edited,
// modeled as a "modified" change diffing the original placeholder contents
// against the live edits. This surfaces it in the Changes panel with tracked
// +/- counts even though it was never part of the original session.
function makeEditedPlaceholder(path: string, after: string): AuiChangedFile {
  const before = getPlaceholderContents(path);
  const stats = countDiffStats(
    getFileDiff(
      {
        path,
        status: 'modified',
        before,
        after: before,
        additions: 0,
        deletions: 0,
      },
      after
    )
  );
  return { path, status: 'modified', before, after, ...stats };
}

// Toolbar above the file explorer: New file, New folder, and the search toggle.
// Lives in its own component (rendered only once we have a model) so
// useFileTreeSearch — which subscribes to the model — is never called against a
// null tree. Creation is owned by the parent (so it can also git-status the new
// row and add files to the Changes panel); the search toggle stays local. The
// parent owns the toolbar shell (with the window controls in place of a title),
// so this renders just the action buttons.
function FilesToolbar({
  model,
  onNewFile,
  onNewFolder,
}: {
  model: FileTree;
  onNewFile: () => void;
  onNewFolder: () => void;
}) {
  const search = useFileTreeSearch(model);

  return (
    <div className="aui-files-actions">
      <button
        type="button"
        className="aui-files-action"
        aria-label="New file"
        title="New file"
        onClick={onNewFile}
      >
        <IconFilePlus />
      </button>
      <button
        type="button"
        className="aui-files-action"
        aria-label="New folder"
        title="New folder"
        onClick={onNewFolder}
      >
        <IconFolderPlus />
      </button>
      <button
        type="button"
        className="aui-files-action"
        aria-label={search.isOpen ? 'Hide file search' : 'Search files'}
        aria-pressed={search.isOpen}
        title="Search files"
        // The search input closes on blur, so without preventDefault the blur
        // fires before this click and toggles the just-opened session back off.
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => {
          if (search.isOpen) {
            search.close();
          } else {
            search.open();
          }
        }}
      >
        <IconSearch />
      </button>
    </div>
  );
}

// The fullscreen, chrome-less route the windowed card's green "zoom" control
// expands into. Kept as a constant so the windowed Link and the fullscreen
// close affordance stay in lockstep.
export const AUI_FULLSCREEN_PATH = '/edit/live';
// Where the fullscreen editor returns to when there's no in-app history to pop
// (e.g. the route was opened directly): the homepage's edit section, which
// hosts the windowed card the fullscreen view morphs back into.
const AUI_WINDOWED_PATH = '/#edit';

// Marks (in sessionStorage) that the fullscreen route was entered by expanding
// the homepage card in this tab. `window.history.length > 1` can't tell that
// apart from opening /edit/live directly in a tab that already has unrelated
// history, so the exit affordance uses this flag instead: only when the card
// pushed us here is a `router.back()` guaranteed to land back on that card
// (restoring its scroll position for the reverse morph). Standalone entries
// leave the flag unset and fall back to navigating to the windowed section.
const AUI_FROM_CARD_KEY = 'aui:entered-from-card';

function markEnteredFromCard() {
  try {
    window.sessionStorage.setItem(AUI_FROM_CARD_KEY, '1');
  } catch {
    // sessionStorage can be unavailable (private mode, storage disabled); the
    // exit path safely falls back to a direct navigation when the flag is gone.
  }
}

// Reads and clears the "entered from the card" flag. Clearing on read keeps a
// single expand/exit round-trip honest: a fresh direct visit won't inherit a
// stale flag from an earlier in-app expansion.
function consumeEnteredFromCard(): boolean {
  try {
    const enteredFromCard =
      window.sessionStorage.getItem(AUI_FROM_CARD_KEY) === '1';
    window.sessionStorage.removeItem(AUI_FROM_CARD_KEY);
    return enteredFromCard;
  } catch {
    return false;
  }
}

// `windowed` is the embedded homepage card; `fullscreen` is the standalone
// /edit/live route that fills the viewport with the file tree on the left.
export type AuiVariant = 'windowed' | 'fullscreen';

// Run an App Router navigation inside a browser View Transition so the shared
// `.aui` element (see `view-transition-name: aui-window` in the CSS) FLIP-morphs
// between the windowed card and the fullscreen route.
//
// We can't lean on React's <ViewTransition> / Next's `experimental.viewTransition`
// here: the pinned stable React (19.2) ships no ViewTransition runtime, so that
// integration never reaches `document.startViewTransition`. Instead we call it
// directly. App Router navigation is async, so the transition callback returns a
// promise that resolves once the destination route has committed (the pathname
// changes), which is when the browser captures the "new" state to animate toward.
//
// Polling MUST use setTimeout, not requestAnimationFrame: while the View
// Transition update callback runs the browser suppresses rendering, which
// starves rAF. An rAF poll therefore never fires, the promise never resolves,
// and the browser aborts with "timeout in DOM update" (no animation at all).
// Timers keep firing during that phase. A short overall timeout guards against a
// navigation that never commits, and unsupported browsers fall back to an
// instant navigation.
function navigateWithViewTransition(navigate: () => void) {
  const startViewTransition =
    typeof document !== 'undefined'
      ? (
          document as Document & {
            startViewTransition?: (
              callback: () => Promise<void> | void
            ) => unknown;
          }
        ).startViewTransition
      : undefined;

  if (typeof startViewTransition !== 'function') {
    navigate();
    return;
  }

  const fromPath = window.location.pathname;
  startViewTransition.call(
    document,
    () =>
      new Promise<void>((resolve) => {
        navigate();
        const startedAt = Date.now();
        const poll = () => {
          if (
            window.location.pathname !== fromPath ||
            Date.now() - startedAt > 1200
          ) {
            // The route has committed (or we've waited long enough); let React
            // settle the new DOM one more tick before the browser captures it.
            setTimeout(resolve, 0);
          } else {
            setTimeout(poll, 16);
          }
        };
        setTimeout(poll, 16);
      })
  );
}

// macOS-style traffic-light window controls. The green "zoom" dot is the
// feature's entry point: in the windowed card it's a Link that morphs the demo
// into the fullscreen editor (the shared view-transition-name does the
// animation); in fullscreen the red and green dots both return to the windowed
// card. The yellow dot is decorative in this demo. Dots are 12px so the green
// Link target is small but still a real, labelled control.
function WindowControls({
  variant,
  onEnterFullscreen,
  onExitFullscreen,
  onPrefetch,
}: {
  variant: AuiVariant;
  onEnterFullscreen: () => void;
  onExitFullscreen: () => void;
  onPrefetch?: () => void;
}) {
  if (variant === 'fullscreen') {
    return (
      <div className="aui-traffic">
        <button
          type="button"
          className="aui-dot is-close"
          aria-label="Exit fullscreen editor"
          title="Exit fullscreen"
          onClick={onExitFullscreen}
        />
        <span className="aui-dot is-min" aria-hidden="true" />
        <button
          type="button"
          className="aui-dot is-zoom"
          aria-label="Exit fullscreen editor"
          title="Restore window"
          onClick={onExitFullscreen}
        />
      </div>
    );
  }

  return (
    <div className="aui-traffic">
      <span className="aui-dot is-close" aria-hidden="true" />
      <span className="aui-dot is-min" aria-hidden="true" />
      <Link
        className="aui-dot is-zoom"
        href={AUI_FULLSCREEN_PATH}
        aria-label="Open fullscreen editor"
        title="Open fullscreen editor"
        onPointerEnter={onPrefetch}
        onFocus={onPrefetch}
        onClick={(event) => {
          // Preserve native behavior for new-tab / non-primary clicks; only the
          // plain left-click drives the in-app morph.
          if (
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey
          ) {
            return;
          }
          event.preventDefault();
          onEnterFullscreen();
        }}
      />
    </div>
  );
}

export interface AgentUiProps {
  // Highlight themes the surrounding worker pool was initialized with. Defaults
  // to the shared homepage pool's themes.
  theme?: { dark: string; light: string };
  // Server-rendered diff HTML keyed by file path. When present the matching
  // FileDiff hydrates from this markup (already syntax-highlighted) instead of
  // waiting on the client worker, which also avoids an SSR/client mismatch.
  prerenderedDiffs?: Record<string, string>;
  // `windowed` (default) renders the embedded homepage card with the changes
  // tree on the right; `fullscreen` fills the viewport with the tree on the
  // left and no surrounding page chrome.
  variant?: AuiVariant;
}

// The demo is always dark: the snapshot is prerendered dark and matching it
// avoids theme flashing, so there is no light/dark toggle.
export function AgentUi({
  theme = DEFAULT_THEMES,
  prerenderedDiffs,
  variant = 'windowed',
}: AgentUiProps) {
  const session = AUI_SESSIONS[0];
  const router = useRouter();

  // Expands the windowed card into the fullscreen route, morphing the shared
  // `.aui` element via the View Transition.
  const enterFullscreen = useCallback(() => {
    markEnteredFromCard();
    navigateWithViewTransition(() => {
      router.push(AUI_FULLSCREEN_PATH);
    });
  }, [router]);

  // Warm the fullscreen route's RSC payload (its async render preloads five
  // highlighted diffs) so the click->commit the View Transition waits on is a
  // cache hit instead of a fresh fetch+render. Prefetch eagerly from the
  // windowed card, and again on intent (hover/focus of the zoom control). In
  // production this makes the forward morph feel as instant as the reverse;
  // Next disables prefetch in dev, so the speedup is a production effect.
  const prefetchFullscreen = useCallback(() => {
    router.prefetch(AUI_FULLSCREEN_PATH);
  }, [router]);
  useEffect(() => {
    if (variant === 'windowed') {
      prefetchFullscreen();
    }
  }, [variant, prefetchFullscreen]);

  // The mirror of the above for the reverse morph. When the fullscreen route is
  // opened standalone (no card in history to pop back to), exitFullscreen falls
  // back to `router.push(AUI_WINDOWED_PATH)` — a fresh homepage render — instead
  // of the instant `router.back()` restore. Without a warmed payload that push
  // renders the heavy homepage during the View Transition's suppressed-render
  // window, so the browser captures a not-yet-laid-out card and the shrink-back
  // morph looks janky. Prefetching the homepage from the fullscreen route makes
  // that push a cache hit so the fallback morph matches the card-entry one (a
  // production effect; Next disables prefetch in dev).
  const prefetchWindowed = useCallback(() => {
    router.prefetch(AUI_WINDOWED_PATH);
  }, [router]);
  useEffect(() => {
    if (variant === 'fullscreen') {
      prefetchWindowed();
    }
  }, [variant, prefetchWindowed]);

  // Leaves the fullscreen route for the windowed card. When we got here by
  // expanding the card (the flag is set), `router.back()` is preferred so Next
  // restores the homepage scroll position (putting the card back on screen for
  // a clean reverse morph). Otherwise the route was opened directly — the
  // previous history entry, if any, is unrelated and popping to it could send
  // the user off-site — so we navigate to the homepage edit section instead.
  // Both paths run through the View Transition so the fullscreen view shrinks
  // back into the card.
  const exitFullscreen = useCallback(() => {
    navigateWithViewTransition(() => {
      if (consumeEnteredFromCard()) {
        router.back();
      } else {
        router.push(AUI_WINDOWED_PATH);
      }
    });
  }, [router]);

  // Escape exits fullscreen, matching the native editor-fullscreen affordance.
  useEffect(() => {
    if (variant !== 'fullscreen') {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        exitFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [variant, exitFullscreen]);

  const [activePath, setActivePath] = useState<string | null>(
    () => session.changedFiles[0]?.path ?? null
  );

  // The fullscreen explorer's imperative tree model, lifted here so the toolbar
  // (New file / New folder / search toggle) can drive the same tree the
  // FilesTree component renders. Only set while the fullscreen variant is
  // mounted.
  const [filesModel, setFilesModel] = useState<FileTree | null>(null);
  const handleFilesModelReady = useCallback((model: FileTree | null) => {
    setFilesModel(model);
  }, []);

  // Items the user created in the fullscreen explorer. Tracked here (not just in
  // the tree) so each new path can be git-statused in the tree and — for files —
  // surfaced in the Changes panel. Renames remap the path and cancels drop it,
  // both via the tree mutation events wired up below.
  const [explorerCreations, setExplorerCreations] = useState<
    { path: string; isFolder: boolean }[]
  >([]);
  // Mirror for the tree mutation handlers (whose closures would otherwise read a
  // stale snapshot) so they can tell explorer-created rows from anything else.
  const creationsRef = useRef(explorerCreations);
  creationsRef.current = explorerCreations;

  // New file / New folder: add a placeholder row, track it, and drop it into
  // inline rename (`removeIfCanceled` discards an unnamed row). Folder paths end
  // with `/`, which is how the tree tells a directory from a file.
  const createExplorerItem = useCallback(
    (isFolder: boolean) => {
      if (filesModel == null) {
        return;
      }
      const path = uniqueExplorerPath(
        filesModel,
        isFolder ? 'new-folder' : 'untitled',
        isFolder ? '/' : '.ts'
      );
      setExplorerCreations((prev) => [...prev, { path, isFolder }]);
      filesModel.add(path);
      // Git-status the row before opening rename: applyGitStatusPatch re-renders
      // the tree, so doing it after startRenaming would tear down (and commit)
      // the freshly opened rename input.
      filesModel.applyGitStatusPatch({ set: [{ path, status: 'added' }] });
      filesModel.startRenaming(path, { removeIfCanceled: true });
    },
    [filesModel]
  );
  const handleNewFile = useCallback(
    () => createExplorerItem(false),
    [createExplorerItem]
  );
  const handleNewFolder = useCallback(
    () => createExplorerItem(true),
    [createExplorerItem]
  );

  // Keep the tracked creations aligned with the tree as the user renames the
  // placeholder (move) or cancels it (remove), so git status and the Changes
  // entry follow the final name and disappear if the row is discarded.
  useEffect(() => {
    if (filesModel == null) {
      return;
    }
    const offMove = filesModel.onMutation('move', (event) => {
      if (!creationsRef.current.some((item) => item.path === event.from)) {
        return;
      }
      // The rename has already committed, so re-rendering the tree here is safe.
      // Carry the added status to the new path (a move drops the old key).
      filesModel.applyGitStatusPatch({
        remove: [event.from],
        set: [{ path: event.to, status: 'added' }],
      });
      setExplorerCreations((prev) =>
        prev.map((item) =>
          item.path === event.from ? { ...item, path: event.to } : item
        )
      );
    });
    const offRemove = filesModel.onMutation('remove', (event) => {
      if (!creationsRef.current.some((item) => item.path === event.path)) {
        return;
      }
      setExplorerCreations((prev) =>
        prev.filter((item) => item.path !== event.path)
      );
    });
    return () => {
      offMove();
      offRemove();
    };
  }, [filesModel]);

  // Files created in the explorer, surfaced in the Changes panel as added files
  // (whole contents counted as additions).
  const addedFiles = useMemo<AuiChangedFile[]>(
    () =>
      explorerCreations
        .filter((item) => !item.isFolder)
        .map((item) => makeAddedFile(item.path)),
    [explorerCreations]
  );

  // The session augmented with the explorer's added files. Drives both the
  // Changes tree and the active-file lookup so newly created files behave like
  // the agent's own changed files.
  const liveSession = useMemo<AuiSession>(
    () => ({
      ...session,
      changedFiles: [...session.changedFiles, ...addedFiles],
    }),
    [session, addedFiles]
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

  // Placeholder files (outside the agent's change set) the user has edited into
  // something that differs from their original contents. Tracked here so they
  // can be surfaced in the Changes panel as modified files; reverting an edit
  // back to the original drops the path again (see recordEditedStats).
  const [editedPlaceholders, setEditedPlaceholders] = useState<string[]>([]);
  // Mirror the latest edits so the stable editor callback can rebuild a
  // placeholder's Changes entry without depending on edit state.
  const editedPlaceholdersRef = useRef(editedPlaceholders);
  editedPlaceholdersRef.current = editedPlaceholders;

  // Snippets sent from the selection action's "Add to chat" land here as
  // composer attachments.
  const [snippets, setSnippets] = useState<AuiSnippet[]>([]);
  const snippetIdRef = useRef(0);
  const addSnippet = useCallback((text: string, source: AuiSnippetSource) => {
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
        fileName: getFileName(source.path),
        ...getSelectionLineRange(source.selection),
        text: trimmed,
      },
    ]);
  }, []);
  const removeSnippet = useCallback((id: number) => {
    setSnippets((prev) => prev.filter((snippet) => snippet.id !== id));
  }, []);

  // Recomputes a file's +/- totals from its live edits. Routed through a ref so
  // the stable edit options can call the latest version without listing
  // `session` as a dependency.
  const recordEditedStats = useCallback(
    (target: string, contents: string) => {
      const changed = liveSession.changedFiles.find(
        (entry) => entry.path === target
      );
      if (changed != null) {
        const stats = countDiffStats(getFileDiff(changed, contents));
        setLiveStats((prev) => ({ ...prev, [target]: stats }));
        return;
      }
      // Not one of the agent's changed files (nor an explorer-added one): it's a
      // placeholder file being edited. Diff it against its original contents and,
      // if it now differs, track it so the Changes panel lists it as modified
      // with live counts. Reverting all edits drops it (and its git tint) again.
      const stats = countDiffStats(
        getFileDiff(
          {
            path: target,
            status: 'modified',
            before: getPlaceholderContents(target),
            after: getPlaceholderContents(target),
            additions: 0,
            deletions: 0,
          },
          contents
        )
      );
      const isEdited = stats.additions > 0 || stats.deletions > 0;
      const wasTracked = editedPlaceholdersRef.current.includes(target);
      if (isEdited) {
        setLiveStats((prev) => ({ ...prev, [target]: stats }));
        if (!wasTracked) {
          setEditedPlaceholders((prev) => [...prev, target]);
          filesModel?.applyGitStatusPatch({
            set: [{ path: target, status: 'modified' }],
          });
        }
      } else if (wasTracked) {
        setEditedPlaceholders((prev) => prev.filter((path) => path !== target));
        setLiveStats((prev) => {
          const next = { ...prev };
          delete next[target];
          return next;
        });
        filesModel?.applyGitStatusPatch({ remove: [target] });
      }
    },
    [liveSession, filesModel]
  );
  const recordEditedStatsRef = useRef(recordEditedStats);
  recordEditedStatsRef.current = recordEditedStats;

  // Persisted in-editor edits keyed by path, so switching files keeps the
  // agent's tweaked output.
  const editsRef = useRef<Map<string, string>>(new Map());
  // The stable onChange callback has no path argument, so track its live target
  // here.
  const activeTargetRef = useRef<string | null>(null);
  useEffect(() => {
    activeTargetRef.current = activePath;
  }, [activePath]);

  // Edited placeholder files modeled as "modified" changes from their live
  // edits. Recomputed when the tracked set changes (each edit also refreshes the
  // displayed counts via `liveStats`, so the row decoration stays current).
  const editedPlaceholderFiles = useMemo<AuiChangedFile[]>(
    () =>
      editedPlaceholders.map((path) =>
        makeEditedPlaceholder(
          path,
          editsRef.current.get(path) ?? getPlaceholderContents(path)
        )
      ),
    [editedPlaceholders]
  );

  // The session shown in the Changes panel: the live session (agent changes plus
  // explorer-added files) augmented with any edited placeholders. Kept separate
  // from `liveSession` so editing a placeholder lists it here without flipping
  // its center surface from the editable File view to a diff.
  const changesSession = useMemo<AuiSession>(
    () => ({
      ...liveSession,
      changedFiles: [...liveSession.changedFiles, ...editedPlaceholderFiles],
    }),
    [liveSession, editedPlaceholderFiles]
  );

  const editOptions = useMemo<EditorOptions<undefined>>(
    () => ({
      enabledSelectionAction: true,
      renderSelectionAction(selectionAction) {
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
          const target = activeTargetRef.current;
          if (target != null) {
            addSnippet(selectionAction.getSelectionText(), {
              path: target,
              selection: selectionAction.selection,
            });
          }
          selectionAction.close();
        });

        const copy = document.createElement('button');
        copy.type = 'button';
        copy.textContent = 'Copy';
        copy.style.cssText = SELECTION_SECONDARY_BUTTON_STYLE;
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
      __debug: true,
    }),
    [addSnippet]
  );

  const openFile = useCallback((path: string) => {
    setActivePath(path);
  }, []);

  const activeFile: AuiChangedFile | null = useMemo(
    () =>
      activePath != null
        ? (liveSession.changedFiles.find((file) => file.path === activePath) ??
          null)
        : null,
    [liveSession, activePath]
  );

  // When the active path isn't a changed/added file (e.g. browsing the root
  // README or another explorer file), open editable placeholder contents
  // instead of a diff so the surface is never blank.
  const placeholderContents = useMemo<string | null>(
    () =>
      activePath != null && activeFile == null
        ? getPlaceholderContents(activePath)
        : null,
    [activePath, activeFile]
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

  // `key={activePath}` remounts the FileDiff or File surface for each file while
  // `.aui-surface-wrap` remains mounted and retains its scroll offset. Reset the
  // outer host after the new surface is laid out but before paint. Editing a
  // file does not change `activePath`, so this never disturbs a session.
  useIsomorphicLayoutEffect(() => {
    const wrap = surfaceWrapRef.current;
    if (wrap != null) {
      wrap.scrollTop = 0;
    }
  }, [activePath]);

  const changedCount = changesSession.changedFiles.length;

  return (
    // Both the windowed card and the fullscreen route render a single `.aui`
    // carrying `view-transition-name: aui-window`, so the manually-driven View
    // Transition (see navigateWithViewTransition) morphs the same element's
    // size/position/corner-radius between routes instead of cutting.
    <div
      className="aui"
      data-theme-type="dark"
      data-embedded="true"
      data-variant={variant}
    >
      <div className="aui-body">
        {variant === 'fullscreen' && (
          <aside className="aui-files">
            {/* Window controls take the slot the "Explorer" title used to
                    occupy; the file actions push to the right. */}
            <div className="aui-files-toolbar">
              <WindowControls
                variant={variant}
                onEnterFullscreen={enterFullscreen}
                onExitFullscreen={exitFullscreen}
              />
              {filesModel != null && (
                <FilesToolbar
                  model={filesModel}
                  onNewFile={handleNewFile}
                  onNewFolder={handleNewFolder}
                />
              )}
            </div>
            <FilesTree
              session={session}
              activePath={activePath}
              onModelReady={handleFilesModelReady}
              onSelect={openFile}
            />
          </aside>
        )}
        <section className="aui-center">
          <header className="aui-center-header">
            {/* The windowed card has no left sidebar, so its window controls
             * sit just left of the breadcrumb. */}
            {variant === 'windowed' && (
              <WindowControls
                variant={variant}
                onEnterFullscreen={enterFullscreen}
                onExitFullscreen={exitFullscreen}
                onPrefetch={prefetchFullscreen}
              />
            )}
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
                key={activePath}
                fileDiff={fileDiff}
                className="aui-surface"
                options={{ ...AUI_DIFF_OPTIONS, theme }}
                prerenderedHTML={activePrerenderedHTML}
                edit
                editOptions={editOptions}
              />
            ) : placeholderContents != null && activePath != null ? (
              // Editable view for explorer files that aren't part of the change
              // set (e.g. the root README or a generated stub). The app-level
              // provider creates an independent editor for this keyed surface.
              // Caller-owned `editsRef` seeds its contents when revisited.
              // Highlighted on the main thread since this File is mounted
              // dynamically outside the editable surface's worker pool.
              <File
                key={activePath}
                file={{
                  name: activePath,
                  contents:
                    editsRef.current.get(activePath) ?? placeholderContents,
                }}
                className="aui-surface"
                options={{
                  theme,
                  themeType: 'dark',
                  disableFileHeader: true,
                  overflow: 'wrap',
                }}
                disableWorkerPool
                edit
                editOptions={editOptions}
              />
            ) : (
              <div className="aui-empty">Select a file to review.</div>
            )}
          </div>

          <div className="aui-composer">
            {snippets.length > 0 && (
              <ul className="aui-composer-attachments">
                {snippets.map((snippet) => (
                  <li key={snippet.id} className="aui-attachment">
                    <div className="aui-attachment-header">
                      <IconFileCode aria-hidden="true" />
                      <span className="aui-attachment-file">
                        {snippet.fileName}
                      </span>
                      <span className="aui-attachment-lines">
                        {formatSelectionLineLabel(snippet)}
                      </span>
                    </div>
                    <File
                      file={{
                        name: snippet.fileName,
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
                Pierre 1
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
              <span className="aui-changes-count">{changedCount}</span>
            </button>
            <button type="button" role="tab" disabled>
              Checks
            </button>
          </div>
          <ChangesTree
            session={changesSession}
            activePath={activePath}
            statsByPath={liveStats}
            onSelect={openFile}
          />
        </aside>
      </div>
    </div>
  );
}
