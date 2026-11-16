import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import * as root from '../src';

// The public surface of each entry (`DEC-layouts-public-surface`): a new export
// is a deliberate change of this list. The names come from the export
// statements of the entry file, as the React entry imports CSS that the test
// runner does not load.
function exportsOf(path: string): { values: string[]; types: string[] } {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').replace(
    /\/\/[^\n]*/g,
    ''
  );
  const values: string[] = [];
  const types: string[] = [];
  for (const match of source.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) {
    for (const specifier of match[2].split(',')) {
      const text = specifier.trim();
      if (text === '') continue;
      const name = text
        .replace(/^type\s+/, '')
        .split(' as ')
        .at(-1)
        ?.trim();
      if (name === undefined) continue;
      if (match[1] !== undefined || text.startsWith('type ')) types.push(name);
      else values.push(name);
    }
  }
  const sort = (names: string[]) => names.sort((a, b) => a.localeCompare(b));
  return { values: sort(values), types: sort(types) };
}

const sorted = (names: readonly string[]) =>
  [...names].sort((a, b) => a.localeCompare(b));

const ROOT_VALUES = sorted([
  'applyLayoutOperations',
  'applyOperations',
  'canClose',
  'computeCSSLayout',
  'computeLayout',
  'coverLayout',
  'createLayoutStore',
  'cssCorners',
  'edits',
  'getPanes',
  'hiddenPanes',
  'InvalidLayoutTreeError',
  'isTreeOperation',
  'LayoutOperationError',
  'moveTo',
  'naryTree',
  'neighbor',
  'neighbors',
  'openAt',
  'OVERLAY_COVER_EVENT',
  'parseLayoutOperations',
  'parseStoredLayoutTree',
  'persistence',
  'pixelCorners',
  'stackOf',
  'stacks',
  'visualOrder',
  'zoom',
]);

const ROOT_TYPES = sorted([
  'ApplyLayoutOperationsOptions',
  'ChildExtent',
  'ChildSize',
  'CommandsOf',
  'CoreLayoutStore',
  'CornerGeometry',
  'CoverOptions',
  'CreateLayoutStoreOptions',
  'CSSCorner',
  'CSSLayout',
  'CSSPane',
  'CSSRect',
  'CSSSeparator',
  'Direction',
  'Edge',
  'EditCommands',
  'HiddenPaneCommands',
  'LayoutChange',
  'LayoutGeometry',
  'LayoutNode',
  'LayoutOperation',
  'LayoutOperationErrorCode',
  'LayoutState',
  'LayoutTreeOperation',
  'LayoutWindowOperation',
  'OverlayCover',
  'OverlayCoverEvent',
  'PaneEdges',
  'PaneGeometry',
  'PaneNode',
  'PersistenceCommands',
  'Place',
  'PlaceCommands',
  'Rect',
  'SeparatorGeometry',
  'SplitNode',
  'StackCommands',
  'StackNode',
  'StoredLayoutTree',
  'StoreFeature',
  'StoreWith',
  'TabOptions',
  'TreeModel',
  'ZoomCommands',
]);

const REACT_VALUES = sorted([
  'allFeatures',
  'CloseButton',
  'CollapseButton',
  'Content',
  'corners',
  'createLayout',
  'defaultKeys',
  'edits',
  'flip',
  'FOCUS_EDGE_EVENT',
  'focusRing',
  'Header',
  'hiddenPanes',
  'MoveHandle',
  'moveTo',
  'naryTree',
  'neighbor',
  'neighbors',
  'openAt',
  'OVERLAY_COVER_EVENT',
  'PANE_VISIBILITY_EVENT',
  'paneDrag',
  'persistence',
  'Root',
  'stacks',
  'Tab',
  'tabDrag',
  'TabList',
  'Title',
  'useCover',
  'usePane',
  'visualOrder',
  'zoom',
  'ZoomButton',
]);

const REACT_TYPES = sorted([
  'AllFeatures',
  'AllFeaturesOptions',
  'CanDrop',
  'CloseButtonState',
  'CollapseButtonState',
  'CoverOptions',
  'DragSource',
  'DropPlace',
  'DropTarget',
  'EdgeMessageValues',
  'Feature',
  'FeatureCommands',
  'FlipOptions',
  'FocusEdgeEvent',
  'HeaderState',
  'LayoutMessages',
  'LayoutObject',
  'LayoutSeparator',
  'MoveHandleState',
  'OverlayCover',
  'OverlayCoverEvent',
  'PaneDragOptions',
  'PaneEdges',
  'PaneMessageValues',
  'PaneState',
  'PaneVisibilityEvent',
  'PartProps',
  'Place',
  'PlaceCommands',
  'RenderProp',
  'RootProps',
  'SeparatorMessageValues',
  'StylesheetsSetting',
  'TabDragOptions',
  'TabListItemState',
  'TabListProps',
  'TabState',
  'TargetMessageValues',
  'ZoomButtonState',
  'ZoomCommands',
]);

describe('the public surface', () => {
  test('@pierre/layouts exports the documented API only', () => {
    expect(exportsOf('../src/index.ts')).toEqual({
      values: ROOT_VALUES,
      types: ROOT_TYPES,
    });
    // The values that the entry gives at run time.
    expect(sorted(Object.keys(root))).toEqual(ROOT_VALUES);
  });

  test('@pierre/layouts/react exports the documented API only, and no feature contract', () => {
    expect(exportsOf('../src/react/index.tsx')).toEqual({
      values: REACT_VALUES,
      types: REACT_TYPES,
    });
  });
});
