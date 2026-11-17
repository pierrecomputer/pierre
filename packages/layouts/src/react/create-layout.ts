// `createLayout`: the store of a layout, with the commands of its features,
// and the features for `Root`.
import {
  type CoreLayoutStore,
  createLayoutStore,
  type StoreFeature,
} from '../store';
import type { CanPlace, LayoutNode } from '../types';
import type { Feature, FeatureModule } from './contract';

type UnionToIntersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;

// The commands of one feature. The type distributes over a union, so that a
// feature without commands does not hide the commands of the others.
type CommandsOfFeature<T> =
  T extends Feature<infer Commands> ? Commands : never;

// The names of the features of a union, and the names that they need.
type NamesOf<T> = T extends Feature<object, infer Name, string> ? Name : never;
type NeedsOf<T> =
  T extends Feature<object, string, infer Needs> ? Needs : never;

/**
 * A list of features, with a type error for each feature that a feature of
 * the list needs and the list does not have: for example
 * `createLayout(root, [arrange()])` fails with "Property 'add the feature
 * edits()' is missing". The check is in the types only.
 */
type WithNeededFeatures<F extends readonly Feature[]> = [
  Exclude<NeedsOf<F[number]>, NamesOf<F[number]>>,
] extends [never]
  ? unknown
  : {
      readonly [Name in Exclude<
        NeedsOf<F[number]>,
        NamesOf<F[number]>
      > as `add the feature ${Name}()`]: true;
    };

/** The commands that a list of features adds to a layout. */
export type FeatureCommands<F extends readonly Feature[]> = UnionToIntersection<
  CommandsOfFeature<F[number]>
>;

/** A layout: its state, the core commands, and the commands of its features. */
export type LayoutObject<F extends readonly Feature[] = readonly Feature[]> =
  CoreLayoutStore & FeatureCommands<F> & { readonly features: F };

/** The options of `createLayout`. */
export interface CreateLayoutOptions {
  /**
   * The app's rule for places (`DEC-layouts-one-place-rule`): false refuses
   * a place for a pane. The drags, the pane menu, `moveTo`, `openAt`, and the
   * commands read it; give `applyLayoutOperations` the same rule, so that a
   * server refuses the same places.
   */
  readonly canPlace?: CanPlace;
}

/**
 * Create a layout with features, for example
 * `createLayout(root, [edits(naryTree), zoom(), paneDrag()])`, and render it
 * with `<Layout.Root layout={layout} />`. Each change reaches
 * `layout.subscribe` with its operations, so an app syncs or keeps an undo
 * history without a wrapper of the commands. A feature that needs another
 * feature, such as `arrange()`, which needs `edits()`, gives a type error
 * when the list does not have it, and a development warning.
 */
export function createLayout<const F extends readonly Feature[] = []>(
  root: LayoutNode,
  features?: F & NoInfer<WithNeededFeatures<F>>,
  options: CreateLayoutOptions = {}
): LayoutObject<F> {
  // The features of the library carry their members.
  const modules = (features ??
    []) as readonly Feature[] as readonly FeatureModule[];
  if (process.env.NODE_ENV !== 'production') {
    const names = new Set(modules.map((feature) => feature.name));
    for (const feature of modules)
      for (const name of feature.requires ?? [])
        if (!names.has(name))
          console.warn(
            `@pierre/layouts: the feature ${feature.name} needs the feature ${name} in the same layout.`
          );
  }
  const stores: StoreFeature[] = [];
  for (const feature of modules)
    if (feature.store !== undefined) stores.push(feature.store);
  return Object.assign(createLayoutStore(root, stores, options), {
    features: modules,
  }) as unknown as LayoutObject<F>;
}
