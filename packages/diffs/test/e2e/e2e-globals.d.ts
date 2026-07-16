// Shared ambient globals for the diffs E2E fixtures.
//
// Each fixture stashes a ready flag (and sometimes an editor handle or an
// interaction log) on `window` so the Playwright specs can await setup and read
// state. TypeScript merges the `Window` interface across the whole program, so
// declaring these per-file with `declare global` produced conflicting `__editor`
// shapes that failed typecheck. Declaring them once here keeps every spec in
// agreement.

interface E2ELineRange {
  start: number;
  end: number;
}

interface E2ESelectionPoint {
  line: number;
  character: number;
}

interface E2ESelection {
  start: E2ESelectionPoint;
  end: E2ESelectionPoint;
  direction?: 'none' | 'backward' | 'forward';
}

interface E2EEditorState {
  selections?: E2ESelection[];
  view?: {
    scrollLeft: number;
    scrollTop: number;
  };
}

interface E2ETextEdit {
  range: { start: E2ESelectionPoint; end: E2ESelectionPoint };
  newText: string;
}

type E2ELineHighlightState = 'none' | 'selected' | 'active' | 'both';

// The subset of the real Editor surface the fixtures expose on `window`.
interface E2EEditor {
  canUndo: boolean;
  canRedo: boolean;
  getText: () => string;
  getFile: () => { contents: string } | undefined;
  getState: () => E2EEditorState;
  setSelections: (selections: E2ESelection[]) => void;
  applyEdits: (edits: E2ETextEdit[], updateHistory?: boolean) => void;
  focus: () => void;
  cleanUp: () => void;
}

interface Window {
  // Fixture ready flags.
  __diffReady?: boolean;
  __editReady?: boolean;
  __editableReady?: boolean;
  __conflictReady?: boolean;
  __fileStatesReady?: boolean;
  __markersReady?: boolean;
  __lineSelectReady?: boolean;
  __annotationsReady?: boolean;
  __themeReady?: boolean;
  __selectionActionReady?: boolean;
  __selectionActionEdgesReady?: boolean;

  // Interaction logs populated by fixture callbacks.
  __editorEvents?: string[];
  __conflictResolutions?: string[];
  __selectionChanges?: (E2ELineRange | null)[];
  __gutterClicks?: E2ELineRange[];
  __actionClicks?: string[];

  // theme.html helper for rendering one row in each line-highlight state.
  __setLineHighlightState?: (state: E2ELineHighlightState) => void;

  // Editor handle exposed by the editable fixtures.
  __editor?: E2EEditor;

  // edit-collapsed.html helpers: rendered new-file line numbers in the
  // editable column, and the primary caret's zero-based line.
  __renderedLines?: () => number[];
  __caretLine?: () => number | undefined;
}
