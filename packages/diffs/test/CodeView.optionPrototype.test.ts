import { describe, expect, test } from 'bun:test';

import {
  CODE_VIEW_DIFF_OPTION_KEYS,
  CODE_VIEW_FILE_OPTION_KEYS,
  CodeView,
} from '../src/components/CodeView';
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

      // Every declared pass-through key must resolve to an enumerable
      // accessor on its prototype — whether the plain loops define it or a
      // hand-written getter does (e.g. the edit-forced options). A key that
      // is skipped from the loops without a replacement getter fails here.
      const fileKeys = Object.keys(fileOptionsPrototype);
      for (const key of CODE_VIEW_FILE_OPTION_KEYS) {
        expect(fileKeys).toContain(key);
      }
      const diffKeys = Object.keys(diffOptionsPrototype);
      for (const key of CODE_VIEW_DIFF_OPTION_KEYS) {
        expect(diffKeys).toContain(key);
      }

      expect(() => readEnumerableValues(fileOptionsPrototype)).not.toThrow();
      expect(() => readEnumerableValues(diffOptionsPrototype)).not.toThrow();
      expect(diffOptionsPrototype.collapsed).toBeUndefined();
    } finally {
      viewer.cleanUp();
      cleanup();
    }
  });
});
