// What every part shares: the `render` prop, the merge of the app's props with
// the part's own, a subscription to the layout state, and the warning for a
// missing feature.
import {
  cloneElement,
  createElement,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  useSyncExternalStore,
} from 'react';

import type { LayoutState } from '../../types';
import type { ViewStore } from '../contract';

/**
 * Change the element of a part: an element, whose props merge with the
 * part's, or a function of the part's props and state that returns the
 * element.
 */
export type RenderProp<State> =
  | ReactElement<Record<string, unknown>>
  | ((props: Record<string, unknown>, state: State) => ReactElement);

/** The props of a part: HTML attributes, a ref, `render`, and children. */
export interface PartProps<State> extends Omit<
  HTMLAttributes<HTMLElement>,
  'children'
> {
  render?: RenderProp<State>;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

type Props = Record<string, unknown>;

/** Give a ref its element, and return what detaches it. */
function attach(ref: unknown, element: unknown): () => void {
  if (typeof ref === 'function') {
    const cleanup: unknown = ref(element);
    return typeof cleanup === 'function'
      ? (cleanup as () => void)
      : () => {
          ref(null);
        };
  }
  const object = ref as { current: unknown };
  object.current = element;
  return () => {
    object.current = null;
  };
}

/**
 * The app's props, then the part's own. The app's event handler runs first,
 * and the part's handler runs after it unless the app's handler called
 * `preventDefault()`: the app handled the event, and the layout does nothing
 * (with `yieldToApp` false, both always run). The classes join; both refs get
 * the element; the styles join, with the part's values last. For any other
 * prop, the part's value wins.
 */
export function mergeProps(app: Props, own: Props, yieldToApp = true): Props {
  const merged: Props = { ...app, ...own };
  for (const key of Object.keys(app)) {
    const appValue = app[key];
    const ownValue = own[key];
    if (appValue == null || ownValue == null) continue;
    if (key === 'className')
      merged[key] = `${ownValue as string} ${appValue as string}`;
    else if (key === 'style') merged[key] = { ...appValue, ...ownValue };
    else if (key === 'ref')
      merged[key] = (element: unknown) => {
        const detachApp = attach(appValue, element);
        const detachOwn = attach(ownValue, element);
        return () => {
          detachApp();
          detachOwn();
        };
      };
    else if (
      key.startsWith('on') &&
      typeof appValue === 'function' &&
      typeof ownValue === 'function'
    )
      merged[key] = (...args: unknown[]) => {
        (appValue as (...args: unknown[]) => void)(...args);
        if (
          !yieldToApp ||
          (args[0] as { defaultPrevented?: boolean } | null)
            ?.defaultPrevented !== true
        )
          (ownValue as (...args: unknown[]) => void)(...args);
      };
  }
  return merged;
}

/**
 * Render a part: with the app's `render`, or as an element of `tag`. The
 * handlers of a `render` element run before the part's props, and all of them
 * run: the part's own handler in `props` checks `preventDefault()` last.
 */
export function renderPart<State>(
  tag: string,
  render: RenderProp<State> | undefined,
  props: Props,
  state: State
): ReactElement {
  if (typeof render === 'function') return render(props, state);
  if (render !== undefined)
    return cloneElement(render, mergeProps(render.props, props, false));
  return createElement(tag, props);
}

/** A value of the layout state; the part renders when it changes. */
export function useLayoutState<T>(
  store: ViewStore,
  select: (state: LayoutState) => T
): T {
  const get = () => select(store.getSnapshot());
  return useSyncExternalStore(store.subscribe, get, get);
}

const warned = new Set<string>();

/** Warn once in development when the layout lacks the feature of a part. */
export function warnMissing(
  present: boolean,
  part: string,
  feature: string
): void {
  if (
    process.env.NODE_ENV !== 'production' &&
    !present &&
    !warned.has(`${part} ${feature}`)
  ) {
    warned.add(`${part} ${feature}`);
    console.warn(
      `@pierre/layouts: ${part} needs ${feature} in the features of the layout.`
    );
  }
}
