import { expect, test } from 'bun:test';

import { VirtualizedFile } from '../src/components/VirtualizedFile';
import { Virtualizer } from '../src/components/Virtualizer';
import type { FileContents } from '../src/types';
import { createRoot, installDom, wait, waitFor } from './domHarness';

function makeNamedFile(name: string): FileContents {
  return {
    name,
    contents: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n'),
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
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    await wait(10);

    const instance = new VirtualizedFile(
      {},
      virtualizer,
      undefined,
      undefined,
      true
    );
    instance.render({
      file: makeNamedFile('before.ts'),
      fileContainer: container,
    });
    await wait(10);
    expect(headerText(container)).toContain('before.ts');

    // Host-driven swap with forceRender false — the shape the React wrapper
    // produces when only the `file` prop changes.
    instance.render({
      file: makeNamedFile('after.ts'),
      fileContainer: container,
    });
    await waitFor(() => headerText(container).includes('after.ts'));
    expect(headerText(container)).toContain('after.ts');
    expect(headerText(container)).not.toContain('before.ts');

    instance.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
  } finally {
    dom.cleanup();
  }
});

test('updates the header when the swap lands while the file is hidden', async () => {
  const dom = installDom();
  try {
    const root = createRoot();
    const container = document.createElement('diffs-container');
    root.appendChild(container);
    const virtualizer = new Virtualizer();
    virtualizer.setup(root);
    await wait(10);

    const instance = new VirtualizedFile(
      {},
      virtualizer,
      undefined,
      undefined,
      true
    );
    instance.render({
      file: makeNamedFile('before.ts'),
      fileContainer: container,
    });
    await wait(10);
    expect(headerText(container)).toContain('before.ts');

    // Hide into a placeholder, then swap the file while hidden. The changed
    // file must not be absorbed by the placeholder path.
    instance.setVisibility(false);
    await waitFor(() => placeholderCount(container) === 1);
    instance.render({
      file: makeNamedFile('after.ts'),
      fileContainer: container,
    });

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

    instance.cleanUp();
    virtualizer.cleanUp();
    await wait(10);
  } finally {
    dom.cleanup();
  }
});
