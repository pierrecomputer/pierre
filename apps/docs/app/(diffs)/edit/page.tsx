import { preloadFile, preloadFileDiff } from '@pierre/diffs/ssr';
import type { Metadata } from 'next';

import {
  FIND_DEMO_FILE_EXAMPLE,
  HISTORY_DEMO_FILE_EXAMPLE,
  MARKER_DEMO_FILE_EXAMPLE,
  SELECTION_DEMO_FILE_EXAMPLE,
  SHORTCUTS_DEMO_FILE_EXAMPLE,
} from '../_edit/constants';
import { EditPage } from '../_edit/EditPage';
import { LIVE_DIFF_EDITOR_EXAMPLE } from '../_examples/LiveDiffEditor/constants';
import { LIVE_EDITOR_FILE_EXAMPLE } from '../_examples/LiveEditor/constants';

const editTitle = 'Pierre Diffs — now with edit';
const editDescription =
  'A lightweight, SSR, mobile-friendly editable file and diff layer for @pierre/diffs. Edit files and diffs in place with selection management, multiple cursors, undo history, find/replace, and lint markers.';

export const metadata: Metadata = {
  title: editTitle,
  description: editDescription,
  openGraph: {
    title: editTitle,
    description: editDescription,
  },
  twitter: {
    card: 'summary_large_image',
    title: editTitle,
    description: editDescription,
  },
};

// Server-renders every edit demo so they all paint highlighted on first load
// and hydrate cleanly (no flash): the "Live editing" File surface, and the
// lint-marker, find-in-file, undo-history, shortcuts, and selection files.
export default async function EditRoute() {
  const [
    liveFile,
    liveDiffEditorDiff,
    markerFile,
    findFile,
    historyFile,
    shortcutsFile,
    selectionFile,
  ] = await Promise.all([
    preloadFile(LIVE_EDITOR_FILE_EXAMPLE),
    preloadFileDiff(LIVE_DIFF_EDITOR_EXAMPLE),
    preloadFile(MARKER_DEMO_FILE_EXAMPLE),
    preloadFile(FIND_DEMO_FILE_EXAMPLE),
    preloadFile(HISTORY_DEMO_FILE_EXAMPLE),
    preloadFile(SHORTCUTS_DEMO_FILE_EXAMPLE),
    preloadFile(SELECTION_DEMO_FILE_EXAMPLE),
  ]);

  return (
    <EditPage
      liveEditorFile={liveFile}
      liveDiffEditorDiff={liveDiffEditorDiff}
      markerFile={markerFile}
      findFile={findFile}
      historyFile={historyFile}
      shortcutsFile={shortcutsFile}
      selectionFile={selectionFile}
    />
  );
}
