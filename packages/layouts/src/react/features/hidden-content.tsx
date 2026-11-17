'use client';

// `hiddenContent()`: what the content of a pane does while its pane does not
// show (`explore-hidden-content-modes`). It reads the reasons of the
// visibility module, which stays the one owner of the visibility of the
// hosts (`DEC-layouts-pane-visibility-owner`): the mode changes only what
// React renders inside a host.
import { Activity, type ReactNode, useSyncExternalStore } from 'react';

import type { PaneNode } from '../../types';
import type {
  ContentBoundaryProps,
  Feature,
  FeatureModule,
  HiddenContent,
} from '../contract';

/**
 * The content of a pane in the `activity` or `unmount` mode: it shows while
 * no reason of `mask` hides it, and waits in a hidden `<Activity>` or
 * unmounts while one does. A hide renders only this boundary, and the
 * content renders only when it shows again. `first` gives a pane that does
 * not show at its first render no mount, or a hidden one, before the view
 * sets its reasons.
 */
function ContentBoundary({
  value,
  mode,
  first,
  mask,
  children,
}: ContentBoundaryProps): ReactNode {
  const { visibility } = value.context;
  const hidden = (): boolean =>
    (visibility.reasons(value.id, first) & mask) !== 0;
  const hides = useSyncExternalStore(visibility.subscribe, hidden, hidden);
  if (mode === 'unmount') return hides ? null : children;
  // `<Activity>` came with React 19.2: with an earlier React, the content
  // stays mounted.
  if (mode === 'mounted' || (Activity as unknown) === undefined)
    return children;
  return <Activity mode={hides ? 'hidden' : 'visible'}>{children}</Activity>;
}

/**
 * Choose what the content of a pane does while its pane does not show: a
 * hidden pane, an inactive tab of a stack, a pane under a zoom or an
 * overlay, or a pane that collapses, to 0 pixels or to its header (then the
 * content of `Layout.Content` only). One mode for every pane, or a function
 * that chooses for each pane from its node, for example by the kind of its
 * content. See `HiddenContent`. Without this feature, the content stays
 * mounted.
 */
export function hiddenContent(
  option: HiddenContent | ((pane: PaneNode) => HiddenContent)
): Feature<object, 'hidden-content', never> {
  const feature: FeatureModule = {
    name: 'hidden-content',
    contentMode: (pane) =>
      typeof option === 'function' ? option(pane) : option,
    ContentBoundary,
  };
  return feature;
}
