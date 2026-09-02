import { preloadFile, preloadFileDiff } from '@pierre/diffs/ssr';
import type { Metadata } from 'next';

import {
  CARET_DEMO_FILE_EXAMPLE,
  DEFAULT_KEYMAP_FILE_EXAMPLE,
  FIND_DEMO_FILE_EXAMPLE,
  HISTORY_DEMO_FILE_EXAMPLE,
  MARKER_DEMO_FILE_EXAMPLE,
  SELECTION_DEMO_FILE_EXAMPLE,
} from '../_edit/constants';
import { EditPage } from '../_edit/EditPage';
import {
  LIVE_EDITING_FILE_DIFF_EXAMPLE,
  LIVE_EDITING_FILE_EXAMPLE,
} from '../_examples/LiveEditing/constants';
import { pageMetadata } from '@/lib/page-metadata';

const editTitle = 'Pierre Diffs — now with edit';
const editDescription =
  'A lightweight, SSR, mobile-friendly editable file and diff layer for @pierre/diffs. Edit files and diffs in place with selection management, multiple cursors, undo history, find/replace, and lint markers.';

export const metadata: Metadata = pageMetadata({
  title: editTitle,
  description: editDescription,
  path: '/edit',
});

// Server-renders every edit demo so they all paint highlighted on first load
// and hydrate cleanly (no flash): the "Live editing" File surface, and the
// lint-marker, find-in-file, undo-history, shortcuts, and selection surfaces.
export default async function EditRoute() {
  const [
    liveEditingFile,
    liveEditingDiff,
    markerFile,
    findFile,
    historyFile,
    keymapFile,
    selectionFile,
    caretFile,
  ] = await Promise.all([
    preloadFile(LIVE_EDITING_FILE_EXAMPLE),
    preloadFileDiff(LIVE_EDITING_FILE_DIFF_EXAMPLE),
    preloadFile(MARKER_DEMO_FILE_EXAMPLE),
    preloadFile(FIND_DEMO_FILE_EXAMPLE),
    preloadFile(HISTORY_DEMO_FILE_EXAMPLE),
    preloadFile(DEFAULT_KEYMAP_FILE_EXAMPLE),
    preloadFile(SELECTION_DEMO_FILE_EXAMPLE),
    preloadFile(CARET_DEMO_FILE_EXAMPLE),
  ]);

  return (
    <EditPage
      liveEditingFile={liveEditingFile}
      liveEditingDiff={liveEditingDiff}
      markerFile={markerFile}
      findFile={findFile}
      historyFile={historyFile}
      keymapFile={keymapFile}
      selectionFile={selectionFile}
      caretFile={caretFile}
    />
  );
}
