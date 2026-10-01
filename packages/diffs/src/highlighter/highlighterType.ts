import { DEFAULT_HIGHLIGHTER } from '../constants';
import type { HighlighterTypes } from '../types';

// Only one highlighter type may be loaded per JavaScript realm (the main
// thread and each worker have their own). In-flight creations and live
// instances each hold the type; it unlocks once every hold is released.
let activeType: HighlighterTypes | undefined;
let holds = 0;

/** The highlighter type in use in this realm, or undefined when none is. */
export function getHighlighterType(): HighlighterTypes | undefined {
  return activeType;
}

/**
 * The type a request should load: the requested type, else the type already
 * in use, else the default. Callers that omit a type follow the active one.
 */
export function resolveHighlighterType(
  type?: HighlighterTypes
): HighlighterTypes {
  return type ?? activeType ?? DEFAULT_HIGHLIGHTER;
}

/** Throw when a different highlighter type is already in use in this realm. */
export function assertHighlighterType(type: HighlighterTypes): void {
  if (activeType != null && activeType !== type) {
    throw new Error(
      `Cannot load the "${type}" highlighter while "${activeType}" is in use. Only one highlighter type can be active at a time; dispose every "${activeType}" instance (disposeHighlighter() disposes the shared one) before switching.`
    );
  }
}

/** Hold the realm's highlighter type until a matching release. */
export function acquireHighlighterType(type: HighlighterTypes): void {
  assertHighlighterType(type);
  activeType = type;
  holds++;
}

/** Drop one hold, unlocking the type when nothing else holds it. */
export function releaseHighlighterType(): void {
  holds--;
  if (holds === 0) {
    activeType = undefined;
  }
}
