// `createLayout`: the store of a layout, with the commands of its features,
// and the features for `Root`.
import {
  type CoreLayoutStore,
  createLayoutStore,
  type StoreFeature,
} from '../store';
import type { LayoutNode } from '../types';
import type { Feature } from './contract';

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

// The commands of one feature. The type distributes over a union, so that a
// feature without commands does not hide the commands of the others.
type CommandsOfFeature<T> =
  T extends Feature<infer Commands> ? Commands : never;

/** The commands that a list of features adds to a layout. */
export type FeatureCommands<F extends readonly Feature[]> = UnionToIntersection<
  CommandsOfFeature<F[number]>
>;

/** A layout: its state, the core commands, and the commands of its features. */
export type LayoutObject<F extends readonly Feature[] = readonly Feature[]> =
  CoreLayoutStore & FeatureCommands<F> & { readonly features: F };

/**
 * Create a layout with features, for example
 * `createLayout(root, [edits(naryTree), zoom(), moveDrag()])`, and render it
 * with `<Layout.Root layout={layout} />`. `Root` calls each command through the
 * layout object, so an app wraps a command with an object of its own:
 * `{ ...layout, activate(id) { record(id); layout.activate(id); } }`.
 */
export function createLayout<const F extends readonly Feature[] = []>(
  root: LayoutNode,
  features?: F
): LayoutObject<F> {
  const list = features ?? ([] as unknown as F);
  if (process.env.NODE_ENV !== 'production') {
    const names = new Set(list.map((feature) => feature.name));
    for (const feature of list)
      for (const name of feature.requires ?? [])
        if (!names.has(name))
          console.warn(
            `@pierre/layouts: the feature ${feature.name} needs the feature ${name} in the same layout.`
          );
  }
  const stores: StoreFeature[] = [];
  for (const feature of list)
    if (feature.store !== undefined) stores.push(feature.store);
  return Object.assign(createLayoutStore(root, stores), {
    features: list,
  }) as unknown as LayoutObject<F>;
}
