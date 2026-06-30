import { describe, expect, test } from 'bun:test';

import {
  type ControllerSnapshotSeenHolder,
  shouldBumpControllerRevision,
} from '../src/render/controllerSnapshotSubscription';

// FileTreeView's controller-subscription effect re-subscribes whenever its
// layout/viewport deps change. Each emit runs the imperative viewport `update()`
// and, for every emit *except* the genuine initial snapshot, must bump the
// render revision so the rendered rows repaint. The bug (issue #883) was that
// the "seen the initial snapshot yet?" flag lived in an effect-local `let`, so
// it reset to `false` on every re-subscribe and swallowed the revision bump on
// the first real emit after each re-subscribe — model correct, DOM stale.
//
// These tests pin the contract that the flag must persist across re-subscribes:
// only the very first emit observed by a given holder is suppressed.
describe('shouldBumpControllerRevision', () => {
  test('suppresses only the genuine initial snapshot, then bumps every later emit', () => {
    const seen: ControllerSnapshotSeenHolder = { current: false };

    // Initial snapshot: no bump (first render already reflects the controller).
    expect(shouldBumpControllerRevision(seen)).toBe(false);
    // Every subsequent emit bumps.
    expect(shouldBumpControllerRevision(seen)).toBe(true);
    expect(shouldBumpControllerRevision(seen)).toBe(true);
  });

  test('first emit after a re-subscribe still bumps when the holder persists', () => {
    // A single persistent holder models the component-instance `useRef` that
    // survives across effect re-runs (re-subscribes).
    const seen: ControllerSnapshotSeenHolder = { current: false };

    // --- initial subscribe ---
    expect(shouldBumpControllerRevision(seen)).toBe(false); // initial snapshot
    expect(shouldBumpControllerRevision(seen)).toBe(true); // a real emit

    // --- effect re-runs: re-subscribe with the SAME persistent holder ---
    // This is the regression: the very next emit is a *real* mutation, not a
    // fresh initial snapshot, so it must bump. With the old effect-local `let`
    // (a brand-new holder per re-subscribe, see below) this would be swallowed.
    expect(shouldBumpControllerRevision(seen)).toBe(true);

    // --- another re-subscribe, same holder ---
    expect(shouldBumpControllerRevision(seen)).toBe(true);
  });

  test('regression guard: a fresh holder per re-subscribe reproduces the swallowed first emit', () => {
    // Documents exactly why the effect-local `let` was wrong: a new holder on
    // each re-subscribe makes every first-emit-after-re-subscribe look like the
    // initial snapshot and get swallowed. The fix is to share one holder across
    // re-subscribes (a `useRef`), exercised by the test above.
    const firstSubscribe: ControllerSnapshotSeenHolder = { current: false };
    expect(shouldBumpControllerRevision(firstSubscribe)).toBe(false); // initial
    expect(shouldBumpControllerRevision(firstSubscribe)).toBe(true); // real emit

    // Re-subscribe creates a brand-new (reset) holder — the buggy shape.
    const reSubscribe: ControllerSnapshotSeenHolder = { current: false };
    // The first real emit after the re-subscribe is wrongly suppressed.
    expect(shouldBumpControllerRevision(reSubscribe)).toBe(false);
  });
});
