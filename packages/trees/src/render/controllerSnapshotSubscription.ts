// The controller-subscription effect in FileTreeView re-subscribes whenever its
// layout/viewport deps change. On the genuine initial snapshot we skip the
// Preact re-render (the first render already reflects the controller), but every
// *real* emit after that must bump the render revision so the rows repaint.
//
// The subtlety this helper exists to make testable: the "have we seen the
// initial snapshot yet?" flag must live for the lifetime of the component
// instance, not for the lifetime of a single effect run. When it was an
// effect-local `let`, it reset to `false` on every re-subscribe, so the first
// emit after each re-subscribe was wrongly treated as the initial snapshot and
// its revision bump was swallowed — the model updated but the DOM went stale
// until the next emit. Threading a persistent holder (a `useRef`) through this
// helper keeps the initial-render optimization while ensuring re-subscribes
// still repaint on their first real emit.

export interface ControllerSnapshotSeenHolder {
  current: boolean;
}

// Returns whether this controller emit should bump the render revision, and
// records that the initial snapshot has now been observed. Only the very first
// emit observed by a given holder is suppressed; every later emit — including
// the first emit after a re-subscribe that reuses the same holder — bumps.
export function shouldBumpControllerRevision(
  hasSeenInitialSnapshot: ControllerSnapshotSeenHolder
): boolean {
  if (hasSeenInitialSnapshot.current) {
    return true;
  }

  hasSeenInitialSnapshot.current = true;
  return false;
}
