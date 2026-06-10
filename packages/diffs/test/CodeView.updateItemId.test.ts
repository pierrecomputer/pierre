import { describe, expect, test } from 'bun:test';

import {
  CodeView,
  type CodeViewLineSelection,
} from '../src/components/CodeView';
import { DEFAULT_CODE_VIEW_LAYOUT } from '../src/constants';
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

      const renderedBefore = viewer.getRenderedItems();
      expect(renderedBefore.map((item) => item.id)).toEqual(['file:old']);

      expect(viewer.updateItemId('file:old', 'file:new')).toBe(true);

      // The rename rebinds the existing record in place rather than removing
      // and re-adding it, so the same rendered element and item instance must
      // now be reachable only under the new id.
      const renderedAfter = viewer.getRenderedItems();
      expect(renderedAfter.map((item) => item.id)).toEqual(['file:new']);
      expect(renderedAfter[0].element).toBe(renderedBefore[0].element);
      expect(renderedAfter[0].instance).toBe(renderedBefore[0].instance);
      expect(viewer.getItem('file:new')?.id).toBe('file:new');
      expect(viewer.getItem('file:old')).toBeUndefined();

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
      // The pending scroll has not been applied yet (scrollTo defers to the
      // next render frame), so the rename must retarget it to the new id for
      // the forced render below to scroll at all.
      expect(root.scrollTop).toBe(0);
      viewer.render(true);
      // The 120-line item is taller than the viewport, so center alignment
      // falls back to start: the item's top (0) plus the layout padding. A
      // stale 'file:old' target would resolve to no item and leave scrollTop
      // at 0.
      expect(root.scrollTop).toBe(DEFAULT_CODE_VIEW_LAYOUT.paddingTop);
      expect(viewer.getRenderedItems().map((item) => item.id)).toEqual([
        'file:new',
      ]);
    } finally {
      viewer.cleanUp();
      await wait(0);
      cleanup();
    }
  });
});
