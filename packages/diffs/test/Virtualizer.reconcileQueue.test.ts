import { expect, test } from 'bun:test';

import { Virtualizer } from '../src/components/Virtualizer';
import { createRoot, installDom, wait } from './domHarness';

// The virtualizer only auto-reconciles heights for instances whose onRender
// repainted inside one of its own passes. Content applied from other paths
// (host/React render calls, async highlight completions) must be able to
// queue a reconciliation, or measured line deltas cleared by a layout reset
// (e.g. edit mode flipping expandUnchanged) never get re-captured and the
// instance's placeholder renders at its baseline estimate.
test('requestHeightReconcile reconciles instances the pass did not repaint', async () => {
  const dom = installDom();
  try {
    const root = createRoot();
    const content = document.createElement('div');
    root.appendChild(content);

    let reconciles = 0;
    const instance = {
      // Never repaints inside a virtualizer pass, mirroring an instance whose
      // content landed via a direct render() call.
      onRender: () => false,
      reconcileHeights: () => {
        reconciles += 1;
        return true;
      },
      setVisibility: () => {},
    };

    const container = document.createElement('diffs-container');
    content.appendChild(container);

    const virtualizer = new Virtualizer();
    virtualizer.setup(root, content);
    virtualizer.connect(
      container,
      instance as unknown as Parameters<Virtualizer['connect']>[1]
    );
    await wait(20);

    // onRender returned false in the connect pass, so nothing reconciled.
    const baseline = reconciles;

    virtualizer.requestHeightReconcile(
      instance as unknown as Parameters<Virtualizer['connect']>[1]
    );
    await wait(20);
    expect(reconciles).toBe(baseline + 1);

    // The queue drains once satisfied: further idle passes don't re-measure.
    await wait(20);
    expect(reconciles).toBe(baseline + 1);

    virtualizer.cleanUp();
  } finally {
    dom.cleanup();
  }
});
