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

// The subset of the real Editor surface the fixtures expose on `window`.
interface E2EEditor {
  canUndo: boolean;
  canRedo: boolean;
  getText: () => string;
  getFile: () => { contents: string } | undefined;
  getState: () => E2EEditorState;
  setSelections: (selections: E2ESelection[]) => void;
  focus: () => void;
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

  // Interaction logs populated by fixture callbacks.
  __editorEvents?: string[];
  __conflictResolutions?: string[];
  __selectionChanges?: (E2ELineRange | null)[];
  __gutterClicks?: E2ELineRange[];
  __actionClicks?: string[];

  // Editor handle exposed by the editable fixtures.
  __editor?: E2EEditor;
}
