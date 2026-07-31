import { expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import { createRoot, installDom, makeFile, wait, waitFor } from './domHarness';

// Simple-mode hide swaps rendered rows for a placeholder but must also drop
// the stored render range: re-showing with an unchanged scroll window
// recomputes an identical hunk-quantized range, and if the stale range
// survived, the base render early-returns and the file stays blank at its
// reserved height. Mirrors VirtualizedFileDiff.setVisibility.
test('re-showing a hidden file with an unchanged window re-renders content', async () => {
  const dom = installDom();
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);

    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    // Settle the virtualizer's window specs before the first render so the
    // pre-hide and post-show renders resolve ranges against the same window.
    await wait(10);

    const instance = new VirtualizedFile(
      {},
      virtualizer,
      undefined,
      undefined,
      true
    );
    const file = makeFile('visibility.ts', 40);
    instance.render({ file, fileContainer: container });
    await wait(10);
    const placeholderCount = (): number =>
      container.shadowRoot?.querySelectorAll('[data-placeholder]').length ?? 0;
    expect(placeholderCount()).toBe(0);
    expect(container.shadowRoot?.textContent).toContain('line 1');

    // Virtualizer-driven hide: the placeholder render wipes the content rows.
    instance.setVisibility(false);
    await waitFor(() => placeholderCount() === 1);
    expect(placeholderCount()).toBe(1);

    // Virtualizer-driven re-show: setVisibility(true) followed by the
    // visible-instance render pass, which renders without forceRender.
    instance.setVisibility(true);
    instance.onRender(false);
    await waitFor(() => placeholderCount() === 0);
    expect(placeholderCount()).toBe(0);
    expect(container.shadowRoot?.textContent).toContain('line 1');

    instance.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
  } finally {
    dom.cleanup();
  }
});
