import { describe, expect, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import { installDom } from './domHarness';

type CodeViewOptionPrototypeInternals = {
  fileOptionsPrototype: Record<string, unknown>;
  diffOptionsPrototype: Record<string, unknown>;
};

function readEnumerableValues(options: Record<string, unknown>): void {
  for (const key of Object.keys(options)) {
    void options[key];
  }
}

// This is mostly a test to make sure that the prototypes created don't break
// when attempting to access values.  A small fix for some NextJS logging
// shenanagins
describe('CodeView item option prototypes', () => {
  test('allows enumerating shared accessors without item state', () => {
    const { cleanup } = installDom();
    const viewer = new CodeView({
      enableLineSelection: true,
      onLineClick() {},
      onLineSelectionChange() {},
    });

    try {
      const { fileOptionsPrototype, diffOptionsPrototype } =
        viewer as unknown as CodeViewOptionPrototypeInternals;

      expect(Object.keys(fileOptionsPrototype)).toContain('collapsed');
      expect(Object.keys(diffOptionsPrototype)).toContain('collapsed');
      expect(
        Object.getOwnPropertyDescriptor(diffOptionsPrototype, 'collapsed')
          ?.enumerable
      ).toBe(true);

      expect(() => readEnumerableValues(fileOptionsPrototype)).not.toThrow();
      expect(() => readEnumerableValues(diffOptionsPrototype)).not.toThrow();
      expect(diffOptionsPrototype.collapsed).toBeUndefined();
    } finally {
      viewer.cleanUp();
      cleanup();
    }
  });
});
