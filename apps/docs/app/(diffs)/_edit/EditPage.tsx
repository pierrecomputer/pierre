import type {
  PreloadedFileResult,
  PreloadFileDiffResult,
} from '@pierre/diffs/ssr';

import { WorkerPoolContext } from '../_components/WorkerPoolContext';
import { LiveEditing } from '../_examples/LiveEditing/LiveEditing';
import { EditHero } from './EditHero';
import { EditReference } from './EditReference';
import { EditShortcuts } from './EditShortcuts';
import { FindDemo } from './FindDemo';
import { HistoryDemo } from './HistoryDemo';
import { MarkerDemo } from './MarkerDemo';
import { SelectionDemo } from './SelectionDemo';
import { HeadingAnchors } from '@/components/docs/HeadingAnchors';
import { FeatureHeader } from '@/components/FeatureHeader';
import Footer from '@/components/Footer';
import { Header } from '@/components/Header';
import { PierreCompanySection } from '@/components/PierreCompanySection';

interface EditPageProps {
  liveEditorFile: PreloadedFileResult<undefined>;
  liveDiffEditorDiff: PreloadFileDiffResult<undefined>;
  markerFile: PreloadedFileResult<undefined>;
  findFile: PreloadedFileResult<undefined>;
  historyFile: PreloadedFileResult<undefined>;
  shortcutsFile: PreloadedFileResult<undefined>;
  selectionFile: PreloadedFileResult<undefined>;
}

export function EditPage({
  liveEditorFile,
  liveDiffEditorDiff,
  markerFile,
  findFile,
  historyFile,
  shortcutsFile,
  selectionFile,
}: EditPageProps) {
  return (
    <WorkerPoolContext>
      <div className="mx-auto min-h-screen max-w-5xl px-5 xl:max-w-[80rem]">
        <Header className="-mb-[1px]" />
        <EditHero />
        <HeadingAnchors />

        <section className="space-y-16 pb-8">
          <LiveEditing
            prerenderedFile={liveEditorFile}
            prerenderedDiff={liveDiffEditorDiff}
          />

          <div className="space-y-5">
            <FeatureHeader
              id="selection-action"
              title="Selection actions"
              description={
                <>
                  Select any text to reveal a floating popover, anchored to the
                  selection and rendered with{' '}
                  <code>renderSelectionAction()</code>. Place any number of
                  actions inside—here, an editor-style <em>Add to chat</em>{' '}
                  sends the selected snippet to the panel on the right, while a
                  secondary action copies it.
                </>
              }
            />
            <SelectionDemo prerenderedFile={selectionFile} />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="markers"
              title="Annotate code with markers"
              description={
                <>
                  Use <code>editor.setMarkers()</code> to inject inline context
                  into your code for linter, formatting, and more. Includes
                  support for severity-aware underlines and hover popups. Hover
                  over markers (shown with wavy, colored underlines) in the
                  example below.
                </>
              }
            />
            <MarkerDemo prerenderedFile={markerFile} />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="find"
              title="Find and replace"
              description={
                <>
                  Find strings across files with <code>Cmd/Ctrl-F</code> on any{' '}
                  <code>File</code> or <code>FileDiff</code>. Find and replace
                  with <code>Cmd-Opt-F</code>(Mac) or <code>Ctrl-Alt-F</code>
                  (Linux/Windows). The search panel below is open—type a query
                  to highlight matches, jump between them with{' '}
                  <code>Enter</code> or its arrows, and toggle case, whole-word,
                  or regex as you go.
                </>
              }
            />
            <FindDemo prerenderedFile={findFile} />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="history"
              title="Undo history"
              description={
                <>
                  Edits land on a structure-aware undo stack out of the box.
                  Walk it with keyboard shortcuts and the toolbar below, or
                  drive it in code with <code>editor.undo()</code>,{' '}
                  <code>editor.redo()</code>, and{' '}
                  <code>editor.applyEdits()</code>. The example loads with a
                  short refactor already applied across several commits.
                </>
              }
            />
            <HistoryDemo prerenderedFile={historyFile} />
          </div>

          <div className="space-y-5">
            <FeatureHeader
              id="shortcuts"
              title="Keyboard shortcuts"
              description={
                <>
                  Edit mode ships with all the additional shortcuts your users
                  will need out of the box. Use the example <code>File</code>{' '}
                  below to try the shortcuts you see in the table, including
                  moving selected lines with <code>Alt-↑</code> /{' '}
                  <code>Alt-↓</code> or <code>Alt-Ctrl-P</code> /{' '}
                  <code>Alt-Ctrl-N</code> on macOS and Linux. Editing the
                  example <code>File</code> will not update the table.
                </>
              }
            />
            <EditShortcuts prerenderedFile={shortcutsFile} />
          </div>

          <EditReference />
        </section>

        <PierreCompanySection />
        <Footer />
      </div>
    </WorkerPoolContext>
  );
}
