import { DEFAULT_HIGHLIGHTER } from '../constants';
import type { HighlighterTypes } from '../types';

// The main thread and each worker allow one highlighter type at a time.
// Pending creations and live instances prevent switching types.
let activeType: HighlighterTypes | undefined;
let holds = 0;

export class HighlighterDisposedError extends Error {
  constructor() {
    super('Highlighter is disposed');
    this.name = 'HighlighterDisposedError';
  }
}

export function getHighlighterType(): HighlighterTypes | undefined {
  return activeType;
}

export function resolveHighlighterType(
  type?: HighlighterTypes
): HighlighterTypes {
  return type ?? activeType ?? DEFAULT_HIGHLIGHTER;
}

export function assertHighlighterType(type: HighlighterTypes): void {
  if (activeType != null && activeType !== type) {
    throw new Error(
      `Cannot load the "${type}" highlighter while "${activeType}" is in use. Only one highlighter type can be active at a time; dispose every "${activeType}" instance (disposeHighlighter() disposes the shared one) before switching.`
    );
  }
}

export function acquireHighlighterType(type: HighlighterTypes): void {
  assertHighlighterType(type);
  activeType = type;
  holds++;
}

export function releaseHighlighterType(): void {
  holds--;
  if (holds === 0) {
    activeType = undefined;
  }
}
