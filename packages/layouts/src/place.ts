// A pane to a `Place`: the menu items, the keys, and the drops of a layout
// give a place, and these two functions run the command of the feature that
// owns it (`DEC-layouts-pane-commands`). A store feature cannot call the
// commands of another feature, so these are functions over the layout.
import type { EditCommands } from './edits';
import { LayoutOperationError } from './layout-operation';
import type { StackCommands } from './stacks';
import type { CoreLayoutStore } from './store';
import type { PaneNode, Place } from './types';

/** A layout or a store, with the commands that a place may need. */
export type PlaceCommands = CoreLayoutStore &
  Partial<
    Pick<EditCommands, 'move' | 'split'> &
      Pick<StackCommands, 'moveToStack' | 'addTab'>
  >;

// The command that a place needs, or an error that names its feature.
function need<T>(command: T | undefined, feature: string): T {
  if (command === undefined)
    throw new Error(
      `@pierre/layouts: this place needs the feature ${feature}.`
    );
  return command;
}

// Run the command of a place: true when it ran, false when the app's rule
// refuses the place, which changes nothing. Another refusal throws.
function placed(run: () => void): boolean {
  try {
    run();
    return true;
  } catch (error) {
    if (error instanceof LayoutOperationError && error.code === 'place_refused')
      return false;
    throw error;
  }
}

/**
 * Move a pane to a place: beside a node with `move` of `edits()`, or into
 * the tabs of a stack with `moveToStack` of `stacks()`. False when the
 * layout's `canPlace` refuses the place, which changes nothing. It throws an
 * error that names the feature when the layout does not have it.
 */
export function moveTo(
  layout: PlaceCommands,
  source: string,
  place: Place
): boolean {
  return placed(() => {
    if ('beside' in place)
      need(layout.move, 'edits()')(source, place.beside, place.edge);
    else need(layout.moveToStack, 'stacks()')(source, place.into, place.index);
  });
}

/**
 * Open a new pane at a place: beside a node with `split` of `edits()`, or
 * as a tab with `addTab` of `stacks()`. False when the layout's `canPlace`
 * refuses the place, which changes nothing. It throws an error that names
 * the feature when the layout does not have it.
 */
export function openAt(
  layout: PlaceCommands,
  pane: PaneNode,
  place: Place
): boolean {
  return placed(() => {
    if ('beside' in place)
      need(layout.split, 'edits()')(place.beside, pane, place.edge);
    else need(layout.addTab, 'stacks()')(place.into, pane, place.index);
  });
}
