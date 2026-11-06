import { expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import type { FileContents } from '../src/types';
import { createRoot, installDom, wait, waitFor } from './domHarness';

function makeNamedFile(name: string, label = 'line'): FileContents {
  return {
    name,
    contents: Array.from({ length: 20 }, (_, i) => `${label} ${i + 1}`).join(
      '\n'
    ),
  };
}

function headerText(container: HTMLElement): string {
  return (
    container.shadowRoot?.querySelector('[data-diffs-header]')?.textContent ??
    ''
  );
}

function placeholderCount(container: HTMLElement): number {
  return (
    container.shadowRoot?.querySelectorAll('[data-placeholder]').length ?? 0
  );
}

// The file-twin of #881: VirtualizedFile bound `this.file` before the base
// render's change detection could compare old and new, so the base compared
// the swapped file with itself and never invalidated `cachedHeaderHTML` — a
// renamed file kept rendering the old header indefinitely.
test('updates the rendered header when a live instance swaps to a renamed file', async () => {
  const dom = installDom();
  const virtualizer = new Virtualizer();
  let instance: VirtualizedFile | undefined;
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);
    virtualizer.setup(root);
    await wait(10);

    let file = makeNamedFile('before.ts');
    // A late highlight asks the owner to render the current file again.
    instance = new VirtualizedFile(
      {},
      virtualizer,
      undefined,
      undefined,
      () => {
        instance?.render({ file });
      }
    );
    instance.render({ file, fileContainer: container });
    await waitFor(() => headerText(container).includes('before.ts'));
    expect(headerText(container)).toContain('before.ts');

    // Host-driven swap with forceRender false — the shape the React wrapper
    // produces when only the `file` prop changes.
    file = makeNamedFile('after.ts');
    instance.render({ file, fileContainer: container });
    await waitFor(() => headerText(container).includes('after.ts'));
    expect(headerText(container)).toContain('after.ts');
    expect(headerText(container)).not.toContain('before.ts');
  } finally {
    instance?.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
    dom.cleanup();
  }
});

// Measured wrapped-line heights are keyed by line index for the current file.
// prepareCodeViewItem must reset them when the file is replaced (CodeView
// updateItem with a version bump) — the file-twin of the diff side's
// targetChanged reset from #689. Stale measurements otherwise feed
// computeApproximateSize and getLinePosition indefinitely.
test('prepareCodeViewItem drops measured heights when the file is replaced', async () => {
  const dom = installDom();
  const virtualizer = new Virtualizer();
  let instance: VirtualizedFile | undefined;
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);
    virtualizer.setup(root);
    await wait(10);

    const wrappedFile = makeNamedFile('wrapped.ts');
    instance = new VirtualizedFile(
      { overflow: 'wrap', disableFileHeader: true },
      virtualizer,
      undefined,
      undefined,
      () => {
        instance?.render({ file: wrappedFile });
      }
    );
    instance.render({ file: wrappedFile, fileContainer: container });
    // Prime the prepare hook the way CodeView does on every layout pass —
    // the first call latches internal state (currentCollapsed) whose initial
    // transition forces a reset that would mask the swap below. Its return
    // value is the estimate-based height for a fresh layout cache.
    const estimatedHeight = instance.updateCodeViewLayout(wrappedFile, 0);
    expect(estimatedHeight).toBeGreaterThan(0);
    await waitFor(
      () => container.shadowRoot?.textContent?.includes('line 1') === true
    );
    expect(container.shadowRoot?.textContent).toContain('line 1');

    // jsdom rows measure 0px, so reconciling seeds every rendered line with a
    // measured height that differs from the estimate.
    instance.reconcileHeights();
    expect(instance.getLineHeight(0)).toBe(0);
    expect(instance.height).not.toBe(estimatedHeight);

    // Replace the file wholesale; same line count, so a correctly reset cache
    // reproduces the original estimate-based height.
    const height = instance.updateCodeViewLayout(
      makeNamedFile('replaced.ts', 'other'),
      0
    );
    expect(instance.getLineHeight(0)).toBe(20);
    expect(height).toBe(estimatedHeight);
  } finally {
    instance?.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
    dom.cleanup();
  }
});

test('updates the header when the swap lands while the file is hidden', async () => {
  const dom = installDom();
  const virtualizer = new Virtualizer();
  let instance: VirtualizedFile | undefined;
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);
    virtualizer.setup(root);
    await wait(10);

    let file = makeNamedFile('before.ts');
    instance = new VirtualizedFile(
      {},
      virtualizer,
      undefined,
      undefined,
      () => {
        instance?.render({ file });
      }
    );
    instance.render({ file, fileContainer: container });
    await waitFor(() => headerText(container).includes('before.ts'));
    expect(headerText(container)).toContain('before.ts');

    // Hide into a placeholder, then swap the file while hidden. The changed
    // file must not be absorbed by the placeholder path.
    instance.setVisibility(false);
    await waitFor(() => placeholderCount(container) === 1);
    expect(placeholderCount(container)).toBe(1);
    file = makeNamedFile('after.ts');
    instance.render({ file, fileContainer: container });

    // Re-show through the virtualizer's sequence: visibility flip, then the
    // visible-instance render pass without forceRender.
    instance.setVisibility(true);
    instance.onRender(false);
    await waitFor(
      () =>
        placeholderCount(container) === 0 &&
        headerText(container).includes('after.ts')
    );
    expect(placeholderCount(container)).toBe(0);
    expect(headerText(container)).toContain('after.ts');
    expect(headerText(container)).not.toContain('before.ts');
  } finally {
    instance?.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
    dom.cleanup();
  }
});
