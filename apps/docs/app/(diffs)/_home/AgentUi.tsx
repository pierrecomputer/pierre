'use client';

import { DEFAULT_THEMES } from '@pierre/diffs';
import { Editor } from '@pierre/diffs/editor';
import { EditorProvider, FileDiff } from '@pierre/diffs/react';
import { IconArrow, IconChevronSm, IconSparkle } from '@pierre/icons';
import { FileTree, type FileTreeRowDecoration } from '@pierre/trees';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

// Renders the active session's changed files as a @pierre/trees FileTree, with
// git-status colours and per-row +/- decorations. The tree is an imperative web
// component, so it's created in an effect and torn down on session change.
function ChangesTree({
  session,
  activePath,
  onSelect,
}: {
  session: AuiSession;
  activePath: string | null;
  onSelect: (path: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const treeRef = useRef<FileTree | null>(null);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

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
        // `light-dark()` resolves against the tree host's color-scheme, which we
        // pin to the demo's own toggle, so jade/red adapt across light and dark.
        // Skip a zero count entirely so rows only show the side that changed.
        const parts: { text: string; color: string }[] = [];
        if (file.additions > 0) {
          parts.push({
            text: `+${String(file.additions)}`,
            color: 'light-dark(#0f9d6b, #34d399)',
          });
        }
        if (file.deletions > 0) {
          const prefix = parts.length > 0 ? '\u00a0' : '';
          parts.push({
            text: `${prefix}\u2212${String(file.deletions)}`,
            color: 'light-dark(#dc2626, #f87171)',
          });
        }
        if (parts.length === 0) {
          return null;
        }
        return {
          text: parts.map((part) => part.text).join(''),
          title: `${String(file.additions)} additions, ${String(file.deletions)} deletions`,
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

  // Persisted in-editor edits keyed by path, so switching files keeps the
  // agent's tweaked output.
  const editsRef = useRef<Map<string, string>>(new Map());
  // The editor's debounced onChange fires without a path argument, so we track
  // the live target here.
  const activeTargetRef = useRef<string | null>(null);
  useEffect(() => {
    activeTargetRef.current = activePath;
  }, [activePath]);

  // The FileDiff is never remounted per file (no `key`): a client-side remount
  // would drop the server `prerenderedHTML` (templateRender only injects it
  // during SSR), so switching files just swaps the `fileDiff` prop and the
  // FileDiff re-renders the new diff in place on the same surface.
  //
  // The editor, however, IS recreated per file (note `activePath` in the deps).
  // The library only attaches the editor — via `editor.edit(instance)`, which
  // builds the editor's TextDocument from the file currently rendered — when the
  // `editor` reference itself changes (see useFileDiffInstance's attach effect,
  // keyed on `[contentEditable, editor]`). It does NOT re-attach when only the
  // `fileDiff` prop changes. So a single stable editor would keep the first
  // file's document while the surface shows a different file, mis-positioning the
  // caret/selection and breaking edits. Recreating the editor per file forces a
  // re-attach that rebuilds the document against the newly rendered file — the
  // same pattern the LiveDiffEditor demo uses when its layout/mode changes.
  const editor = useMemo(
    () =>
      new Editor({
        enabledSelectionAction: true,
        renderSelectionAction({
          close,
          getSelectionText,
          replaceSelectionText,
        }) {
          const container = document.createElement('div');
          const button = document.createElement('button');
          container.className = 'aui-selection-action';
          button.type = 'button';
          button.textContent = 'Wrap selection in TODO()';
          button.addEventListener('click', () => {
            replaceSelectionText(`TODO(${getSelectionText()})`);
            close();
          });
          container.append(button);
          return container;
        },
        onChange(file) {
          const target = activeTargetRef.current;
          if (target == null) {
            return;
          }
          editsRef.current.set(target, file.contents);
        },
      }),
    // Recreate the editor whenever the active file changes so it re-attaches and
    // rebuilds its document against the newly rendered surface (same reasoning as
    // the LiveDiffEditor demo's layout/mode dep).
    [activePath]
  );

  // The changes tree shows one file at a time; selecting a file swaps the
  // active surface.
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
              onSelect={openFile}
            />
          </aside>
        </div>
      </div>
    </EditorProvider>
  );
}
