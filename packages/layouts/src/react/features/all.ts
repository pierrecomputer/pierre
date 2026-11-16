// `allFeatures()`: every feature of the layout, for an app that wants them
// all. A bundler keeps the code of each feature in the list.
import type { EditCommands } from '../../edits';
import type { HiddenPaneCommands } from '../../hidden-panes';
import { naryTree } from '../../models/n-ary';
import type { PersistenceCommands } from '../../persistence';
import type { StackCommands } from '../../stacks';
import type { TreeModel } from '../../types';
import type { ZoomCommands } from '../../zoom';
import type { Feature } from '../contract';
import type { CanDrop } from '../drag';
import { arrange, type ArrangeCommands } from './arrange';
import { corners } from './corners';
import { flip, type FlipOptions } from './flip';
import { focusRing } from './focus-ring';
import { paneDrag } from './pane-drag';
import { stacks } from './stacks';
import { edits, hiddenPanes, persistence } from './store-only';
import { tabDrag } from './tab-drag';
import { zoom } from './zoom';

export interface AllFeaturesOptions {
  /** The tree model of the edits. `naryTree` by default. */
  readonly model?: TreeModel;
  /** The animations: `false` for none, or the options of `flip()`. True by default. */
  readonly animate?: boolean | FlipOptions;
  /** The app's rule for the places of a tab drag and a pane drag. */
  readonly canDrop?: CanDrop;
}

/** The features of `allFeatures()`, with the commands that they add. */
export type AllFeatures = readonly (
  | Feature<EditCommands>
  | Feature<StackCommands>
  | Feature<HiddenPaneCommands>
  | Feature<PersistenceCommands>
  | Feature<ZoomCommands>
  | Feature<ArrangeCommands>
  | Feature
)[];

/**
 * Every feature: `edits(model)`, `stacks()`, `hiddenPanes()`,
 * `persistence()`, `zoom()`, `arrange()`, `paneDrag()`, `tabDrag()`,
 * `corners()`, `focusRing()`, and `flip()` unless `animate` is false.
 */
export function allFeatures({
  model = naryTree,
  animate = true,
  canDrop,
}: AllFeaturesOptions = {}): AllFeatures {
  return [
    edits(model),
    stacks(),
    hiddenPanes(),
    persistence(),
    zoom(),
    arrange(),
    paneDrag({ canDrop }),
    tabDrag({ canDrop }),
    corners(),
    focusRing(),
    ...(animate === false ? [] : [flip(animate === true ? {} : animate)]),
  ];
}
