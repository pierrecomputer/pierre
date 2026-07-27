import type { ResolvedTextEdit, TextDocumentChange } from './textDocument';

// Keeps prediction-only edit metadata off the public TextDocumentChange shape.
export interface TextDocumentChangeTransaction {
  /** Edits applied to the document state before this change. */
  readonly appliedEdits: readonly ResolvedTextEdit[];
  /** Edits that restore the document state before this change. */
  readonly inverseEdits: readonly ResolvedTextEdit[];
}

const transactions = new WeakMap<
  TextDocumentChange,
  TextDocumentChangeTransaction
>();

export function getTextDocumentChangeTransaction(
  change: TextDocumentChange
): TextDocumentChangeTransaction | undefined {
  return transactions.get(change);
}

export function setTextDocumentChangeTransaction(
  change: TextDocumentChange,
  transaction: TextDocumentChangeTransaction
): void {
  transactions.set(change, transaction);
}
