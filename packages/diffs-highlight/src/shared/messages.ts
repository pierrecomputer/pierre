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
  /** Mode names, shown so the user can tell the semantic collection apart. */
  modeNames: string[];
  /** How many of the collection's variables are named `syntax/*`. */
  syntaxVariableCount: number;
}

/** The selected text layer, if the current selection is usable. */
export interface SelectionSummary {
  nodeId: string;
  nodeName: string;
  characters: string;
}

export type SandboxMessage =
  /**
   * Sent on startup and again whenever the selection changes, so the UI never
   * has to ask. `issue` explains why `selection` is null when it is.
   */
  | {
      type: 'state';
      collections: CollectionSummary[];
      selection: SelectionSummary | null;
      issue: string | null;
    }
  | {
      type: 'applied';
      /** Character ranges that received a bound variable. */
      boundRanges: number;
      /**
       * Variable names the mapping asked for that the chosen collection does
       * not contain — the sign of a wrong collection or a partial import.
       */
      missingVariableNames: string[];
    }
  | { type: 'error'; message: string };

export type UiMessage =
  | {
      type: 'apply';
      nodeId: string;
      collectionId: string;
      bindings: TokenBinding[];
    }
  | { type: 'cancel' };
