import { describe, expect, spyOn, test } from 'bun:test';

import { CodeView } from '../src/components/CodeView';
import {
  createRoot,
  installDom,
  makeFileItem,
  renderItems,
  wait,
} from './domHarness';

describe('CodeView.removeItem', () => {
  test('removes an item while preserving the remaining order', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        makeFileItem('first', 5),
        makeFileItem('middle', 5),
        makeFileItem('last', 5),
      ]);

      expect(viewer.removeItem('middle')).toBe(true);
      viewer.render(true);

      expect(viewer.getItem('middle')).toBeUndefined();
      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'first',
        'last',
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('returns false for an unknown item id', async () => {
    const { cleanup } = installDom();
    const consoleError = spyOn(console, 'error').mockImplementation(() => {});
    const viewer = new CodeView();
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [makeFileItem('existing', 5)]);

      expect(viewer.removeItem('missing')).toBe(false);
      expect(viewer.getItem('existing')).toBeDefined();
      expect(consoleError).toHaveBeenCalledWith(
        'CodeView.removeItem: unknown item id "missing"'
      );
    } finally {
      consoleError.mockRestore();
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
