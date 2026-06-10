import { describe, expect, test } from 'bun:test';

import {
  CodeView,
  type CodeViewLineSelection,
} from '../src/components/CodeView';
import type { CodeViewScrollTarget } from '../src/types';
import {
  createRoot,
  installDom,
  makeFileItem,
  renderItems,
  wait,
} from './domHarness';

describe('CodeView item id updates', () => {
  test('emits a selected line change when renaming the selected item', async () => {
    const { cleanup } = installDom();
    const changes: (CodeViewLineSelection | null)[] = [];
    const viewer = new CodeView({
      onSelectedLinesChange(selection) {
        changes.push(selection);
      },
    });
    const root = createRoot();
    const selection: CodeViewLineSelection = {
      id: 'file:old',
      range: { start: 2, end: 3 },
    };

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:old', 20)]);
      viewer.setSelectedLines(selection, { notify: false });

      expect(viewer.updateItemId('file:old', 'file:new')).toBe(true);

      const renamedSelection = { ...selection, id: 'file:new' };
      expect(viewer.getSelectedLines()).toEqual(renamedSelection);
      expect(changes).toEqual([renamedSelection]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });

  test('does not mutate a pending scroll target passed by the caller', async () => {
    const { cleanup } = installDom();
    const viewer = new CodeView();
    const root = createRoot();
    const target: CodeViewScrollTarget = {
      type: 'item',
      id: 'file:old',
      align: 'center',
      behavior: 'instant',
    };

    try {
      viewer.setup(root);
      await renderItems(viewer, [makeFileItem('file:old', 120)]);
      viewer.scrollTo(target);

      expect(viewer.updateItemId('file:old', 'file:new')).toBe(true);

      expect(target).toEqual({
        type: 'item',
        id: 'file:old',
        align: 'center',
        behavior: 'instant',
      });
      viewer.render(true);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
