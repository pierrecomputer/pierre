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

/** A local variable collection the user can target, as offered in the picker. */
export interface CollectionSummary {
  id: string;
  name: string;
  /** Mode names, so the UI can tell a multi-mode collection from a single one. */
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
  | { type: 'apply'; collectionId: string; layers: LayerBindings[] }
  | { type: 'cancel' };
