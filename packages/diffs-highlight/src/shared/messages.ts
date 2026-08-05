/**
 * The message contract between the two Figma realms. The sandbox
 * (`src/sandbox/code.ts`) owns the document and the variables; the UI iframe
 * (`src/ui/main.ts`) owns Shiki and the controls. Neither can call into the
 * other directly, so every exchange goes through `postMessage` with one of the
 * shapes below.
 */

/** One character range of a text layer, to be bound to one Figma variable. */
export interface TokenBinding {
  /** Character index of the first character, 0-indexed. */
  start: number;
  /** Character index one past the last character. */
  end: number;
  /** Figma variable name inside the chosen collection, e.g. `syntax/keyword`. */
  variableName: string;
}

/**
 * Where a collection's variables live, which decides how they are reached: a
 * local collection's variables can be bound as they are, while a library's have
 * to be imported into the file by key first.
 */
export type CollectionSource = 'local' | 'library';

/** A variable collection the user can target, as offered in the picker. */
export interface CollectionSummary {
  /** Local collection id, or the library collection key. */
  id: string;
  source: CollectionSource;
  name: string;
  /** The library publishing it, when `source` is `library`. */
  libraryName?: string;
  /**
   * Mode names, so the UI can tell a multi-mode collection from a single one.
   * Always empty for a library collection: Figma's library API does not report
   * a published collection's modes.
   */
  modeNames: string[];
  /** How many of the collection's variables are named `syntax/*`. */
  syntaxVariableCount: number;
}

/** One selected text layer and the text to tokenize for it. */
export interface SelectionLayer {
  nodeId: string;
  nodeName: string;
  characters: string;
}

/** The ranges to bind on one layer, the result of tokenizing it. */
export interface LayerBindings {
  nodeId: string;
  /** Carried along so the sandbox can name the layer if it has to skip it. */
  nodeName: string;
  bindings: TokenBinding[];
}

export type SandboxMessage =
  /**
   * Sent on startup and again whenever the selection changes, so the UI never
   * has to ask. `layers` is empty when nothing usable is selected, and `issue`
   * explains why.
   */
  | {
      type: 'state';
      collections: CollectionSummary[];
      layers: SelectionLayer[];
      issue: string | null;
      /**
       * Why no library collections are listed, when reading them failed rather
       * than there being none to list.
       */
      libraryIssue: string | null;
    }
  | {
      type: 'applied';
      /** Character ranges that received a bound variable. */
      boundRanges: number;
      /** How many layers those ranges are spread across. */
      boundLayers: number;
      /**
       * Variable names the mapping asked for that the chosen collection does
       * not contain — the sign of a wrong collection or a partial import.
       */
      missingVariableNames: string[];
      /** Layers left untouched, each as `name: reason`. */
      skippedLayers: string[];
    }
  | { type: 'error'; message: string };

export type UiMessage =
  | {
      type: 'apply';
      collectionId: string;
      collectionSource: CollectionSource;
      layers: LayerBindings[];
    }
  | { type: 'cancel' };
