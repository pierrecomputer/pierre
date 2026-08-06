import { describe, expect, spyOn, test } from 'bun:test';

import {
  CodeView,
  type CodeViewLineSelection,
} from '../src/components/CodeView';
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

  test('emits a null selection change when removing the selected item', async () => {
    const { cleanup } = installDom();
    const changes: (CodeViewLineSelection | null)[] = [];
    const viewer = new CodeView({
      onSelectedLinesChange(selection) {
        changes.push(selection);
      },
    });
    try {
      viewer.setup(createRoot());
      await renderItems(viewer, [
        makeFileItem('kept', 5),
        makeFileItem('selected', 5),
      ]);
      viewer.setSelectedLines(
        { id: 'selected', range: { start: 2, end: 3 } },
        { notify: false }
      );

      // Removing an unrelated item leaves the selection alone and stays
      // silent.
      expect(viewer.removeItem('kept')).toBe(true);
      expect(changes).toEqual([]);
      expect(viewer.getSelectedLines()?.id).toBe('selected');

      // Removing the selected item clears it and tells the consumer, so
      // controlled selection state can't write the dead selection back.
      expect(viewer.removeItem('selected')).toBe(true);
      expect(changes).toEqual([null]);
      expect(viewer.getSelectedLines()).toBeNull();
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
