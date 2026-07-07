import { expect, test } from 'bun:test';

import { VirtualizedFileDiff } from '../src/components/VirtualizedFileDiff';
import { Virtualizer } from '../src/components/Virtualizer';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { createRoot, installDom, wait } from './domHarness';

function makeDiff(index: number) {
  const name = `file-${index}.ts`;
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\n');
  return parseDiffFromFile(
    { name, contents: lines },
    { name, contents: `${lines}\nextra` }
  );
}

// Mirrors React StrictMode's dev-only double mount, which drives the exact
// call order the React wrapper produces: children hydrate before the
// virtualizer's own ref runs setup (refs commit bottom-up), then everything
// is cleaned up and mounted again against the SAME DOM nodes. The remount's
// instances hydrate over the previous instances' leftover DOM — if cleanUp
// leaves a placeholder behind, hydration adopts it, skips the render path,
// and the remounted instances never connect to the virtualizer.
test('StrictMode-style remount reconnects instances to the virtualizer', async () => {
  const dom = installDom();
  try {
    const root = createRoot();
    const content = document.createElement('div');
    root.appendChild(content);

    const diffs = [0, 1, 2].map(makeDiff);
    const containers = diffs.map((_, index) => {
      const element = document.createElement('diffs-container');
      // jsdom performs no layout; stack the containers manually so items far
      // below the 800px root render as placeholders rather than content.
      Object.defineProperty(element, 'getBoundingClientRect', {
        value: () => ({
          top: index * 20_000,
          bottom: index * 20_000 + 850,
          height: 850,
          left: 0,
          right: 1000,
          width: 1000,
          x: 0,
          y: index * 20_000,
          toJSON() {
            return {};
          },
        }),
      });
      content.appendChild(element);
      return element;
    });

    const virtualizer = new Virtualizer();
    // Mimics the React wrapper's per-instance sequence: the ref callback
    // hydrates, and the post-mount isometric effect follows with a render
    // (useFileDiffInstance.ts). The render is what connects an instance whose
    // hydrate adopted existing DOM.
    const mount = () =>
      diffs.map((fileDiff, index) => {
        const instance = new VirtualizedFileDiff(
          {},
          virtualizer,
          undefined,
          undefined,
          true
        );
        instance.hydrate({ fileDiff, fileContainer: containers[index] });
        instance.render({ fileDiff });
        return instance;
      });
    const observers = () =>
      (virtualizer as unknown as { observers: Map<HTMLElement, unknown> })
        .observers;

    // StrictMode pass 1: children hydrate, then the wrapper ref runs setup.
    const first = mount();
    virtualizer.setup(root);
    await wait(10);
    expect(observers().size).toBe(3);
    // Sanity check the geometry: the far-offscreen item must actually have
    // rendered a placeholder, or the leftover-placeholder regression below
    // would be vacuously untested.
    expect(
      containers[2].shadowRoot?.querySelectorAll('[data-placeholder]').length
    ).toBe(1);

    // StrictMode simulated unmount: children clean up, then the wrapper.
    for (const instance of first) {
      instance.cleanUp();
    }
    virtualizer.cleanUp();
    expect(observers().size).toBe(0);

    // StrictMode pass 2: fresh instances over the same DOM, then setup again.
    const second = mount();
    virtualizer.setup(root);
    await wait(10);

    // Every remounted instance must be tracked by the virtualizer again...
    expect(observers().size).toBe(3);
    expect([...observers().values()]).toEqual(second);
    // ...and no container may have accumulated leftover placeholders.
    for (const container of containers) {
      expect(
        container.shadowRoot?.querySelectorAll('[data-placeholder]').length
      ).toBeLessThanOrEqual(1);
    }

    for (const instance of second) {
      instance.cleanUp();
    }
    virtualizer.cleanUp();
    await wait(50);
  } finally {
    dom.cleanup();
  }
});
