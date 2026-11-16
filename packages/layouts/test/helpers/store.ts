// A store with each store feature, as the tests of the commands use it.
import {
  createLayoutStore,
  type EditCommands,
  edits,
  type HiddenPaneCommands,
  hiddenPanes,
  type LayoutNode,
  naryTree,
  parseStoredLayoutTree,
  persistence,
  type PersistenceCommands,
  type StackCommands,
  stacks,
  type StoreFeature,
  type StoreWith,
  type TreeModel,
  zoom,
  type ZoomCommands,
} from '../../src';

export type TestStore = StoreWith<
  [
    StoreFeature<EditCommands>,
    StoreFeature<StackCommands>,
    StoreFeature<ZoomCommands>,
    StoreFeature<HiddenPaneCommands>,
    StoreFeature<PersistenceCommands>,
  ]
>;

export function testStore(
  root: LayoutNode,
  model: TreeModel = naryTree
): TestStore {
  return createLayoutStore(root, [
    edits(model),
    stacks(),
    zoom(),
    hiddenPanes(),
    persistence(),
  ]);
}

/** Save the tree of one store through JSON and the parser, and set it in another. */
export function saveAndLoad(from: TestStore, to: TestStore): void {
  to.setStoredTree(
    parseStoredLayoutTree(JSON.parse(JSON.stringify(from.toStoredTree())))
  );
}
