// The boxes of the animated elements of a layout before a change, read once
// for each store change and shared by the features that read them before
// React applies the change, such as `flip()` and `zoom()`. The layout's boxes
// are clean there, so the first read costs one layout, and a second read
// would see the writes of the features that ran first.
import { readBoxes } from '../dom/flip';
import type { Rect } from '../types';
import type { ViewContext } from './contract';

const reads = new WeakMap<
  ViewContext,
  { change: number; boxes: Map<string, Rect> }
>();

/** The boxes of the layout before the current change, read once for the change. */
export function boxesBeforeChange(
  context: ViewContext,
  element: HTMLElement
): Map<string, Rect> {
  const read = reads.get(context);
  if (read !== undefined && read.change === context.change()) return read.boxes;
  const boxes = readBoxes(element);
  reads.set(context, { change: context.change(), boxes });
  return boxes;
}
