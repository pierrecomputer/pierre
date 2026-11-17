// Checks of the public types, which the typecheck runs and no test runner
// executes: an app names and passes a feature, and sees none of its members
// (`DEC-layouts-public-surface`).
import type { LayoutNode } from '../src';
import {
  allFeatures,
  arrange,
  createLayout,
  edits,
  type Feature,
  naryTree,
  stacks,
  tabDrag,
  zoom,
} from '../src/react';

const tree: LayoutNode = { type: 'pane', id: 'a' };

const feature: Feature = zoom();
// @ts-expect-error A feature has no public members.
void feature.name;
// @ts-expect-error An app does not write a feature.
const own: Feature = { name: 'mine' };
void createLayout({ type: 'pane', id: 'a' }, [feature, own]);

// A feature that needs another feature gives a type error when the list does
// not have it, and none when the list has it.
// @ts-expect-error `arrange()` needs `edits()`.
void createLayout(tree, [arrange(), zoom()]);
// @ts-expect-error `tabDrag()` needs `stacks()`.
void createLayout(tree, [edits(naryTree), tabDrag()]);
void createLayout(tree, [edits(naryTree), stacks(), tabDrag(), arrange()]);
void createLayout(tree, allFeatures());
// A list typed as `Feature[]` names no feature, so it gets no check.
const list: readonly Feature[] = [arrange()];
void createLayout(tree, list);
