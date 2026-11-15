'use client';

import {
  type CSSProperties,
  type JSX,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from 'react';

import type { OverlayCover } from '../../src';
import {
  createDrawer,
  createModal,
  modalStrategy,
  type OverlayEdge,
  type OverlayHandle,
} from './overlays';
import overlaysCss from './overlays.css?inline';

/**
 * The sheet of the overlays, rendered with the sheets of the layout: a React
 * `<style>` with `href` and `precedence`, which React puts in the head once
 * for each document. In the bench, the same rules in the app's linked
 * stylesheet made an open over 16 panes of real content about 5 ms slower.
 */
function OverlaySheet(): JSX.Element {
  return (
    <style href="pierre-layouts-reference-overlays" precedence="pierre-layouts">
      {overlaysCss}
    </style>
  );
}

interface OverlayProps {
  /** Whether the overlay shows. Escape and `onClose` ask the app to set it to false. */
  open: boolean;
  /** Called when the overlay starts to close by itself, for example on Escape. */
  onClose: () => void;
  /** The layout root, or an element that contains it: the workspace that the overlay covers. */
  layout: RefObject<HTMLElement | null>;
  /** Called with each change of the panes under the overlay. */
  onCoverChange?: (cover: OverlayCover) => void;
  /** The accessible name, when no element of the content names the overlay. */
  label?: string;
  /** The ID of the element that names the overlay. */
  labelledBy?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export interface ModalProps extends OverlayProps {
  /**
   * `translucent` (the default) dims the page around the modal. `opaque`
   * hides the page, so no pane renders while the modal is open.
   */
  backdrop?: 'translucent' | 'opaque';
}

export interface DrawerProps extends OverlayProps {
  /** The edge of the workspace that the drawer slides in from. */
  edge: OverlayEdge;
  /**
   * The button that opens the drawer: it gets `aria-expanded` and the focus
   * when the drawer closes. Render the drawer right after it.
   */
  trigger?: RefObject<HTMLElement | null>;
}

/**
 * Create the overlay's handle after the element mounts, keep the latest
 * callbacks without a new handle, and open or close it with `open`. `key`
 * holds the options that need a new handle. The handle starts in a passive
 * effect: React attaches the ref of a layout that renders after the overlay
 * only after the overlay's layout effects run.
 */
function useOverlay(
  props: OverlayProps,
  create: (
    element: HTMLElement,
    layout: HTMLElement,
    callbacks: {
      onClose: () => void;
      onCover: (cover: OverlayCover) => void;
    }
  ) => OverlayHandle,
  key: string
): RefObject<HTMLElement | null> {
  const { open, layout, onClose, onCoverChange } = props;
  const element = useRef<HTMLElement | null>(null);
  const handle = useRef<OverlayHandle | null>(null);
  // The latest props, so that a change of a callback needs no new handle.
  const latest = useRef({ onClose, onCoverChange, create });

  useLayoutEffect(() => {
    latest.current = { onClose, onCoverChange, create };
  });

  useEffect(() => {
    const overlay = element.current;
    const root = layout.current;
    if (overlay === null || root === null) return;
    const created = latest.current.create(overlay, root, {
      onClose: () => latest.current.onClose(),
      onCover: (cover) => latest.current.onCoverChange?.(cover),
    });
    handle.current = created;
    return () => {
      created.destroy();
      handle.current = null;
    };
  }, [key, layout]);

  useEffect(() => {
    const current = handle.current;
    if (current === null) return;
    if (open) current.open();
    else current.close();
  }, [open, key]);

  return element;
}

/**
 * A modal over the workspace: a `manual` popover with `role="dialog"` and
 * `aria-modal`, which keeps the focus and hides the rest of the page from
 * assistive technology. It covers the panes in its box with `coverLayout`.
 */
export function Modal(props: ModalProps): JSX.Element {
  const {
    backdrop = 'translucent',
    label,
    labelledBy,
    className,
    style,
    children,
  } = props;
  // The bench compares other strategies; an app gets the popover.
  const strategy = modalStrategy();
  const ref = useOverlay(
    props,
    (element, layout, callbacks) =>
      createModal(element, { layout, backdrop, ...callbacks }),
    `${strategy}:${backdrop}`
  );
  const common = {
    className: `pierre-overlay pierre-modal ${className ?? ''}`,
    style,
    'aria-label': label,
    'aria-labelledby': labelledBy,
    'data-backdrop': backdrop,
  };
  // The strategy decides the element, so a change of strategy mounts a new one.
  return strategy === 'popover' ? (
    <>
      <OverlaySheet />
      <div
        key="popover"
        ref={ref as RefObject<HTMLDivElement | null>}
        role="dialog"
        aria-modal="true"
        popover="manual"
        {...common}
      >
        {children}
      </div>
    </>
  ) : (
    <>
      <OverlaySheet />
      <dialog
        key="dialog"
        ref={ref as RefObject<HTMLDialogElement | null>}
        {...common}
      >
        {children}
      </dialog>
    </>
  );
}

/**
 * A non-modal drawer that slides in from an edge of the workspace, as a
 * `manual` popover. The panes that it covers completely stop rendering.
 */
export function Drawer(props: DrawerProps): JSX.Element {
  const { edge, trigger, label, labelledBy, className, style, children } =
    props;
  const ref = useOverlay(
    props,
    (element, layout, callbacks) =>
      createDrawer(element, {
        layout,
        edge,
        trigger: trigger?.current,
        ...callbacks,
      }),
    edge
  );
  return (
    <>
      <OverlaySheet />
      <div
        ref={ref as RefObject<HTMLDivElement | null>}
        role="dialog"
        popover="manual"
        aria-label={label}
        aria-labelledby={labelledBy}
        className={`pierre-overlay pierre-drawer ${className ?? ''}`}
        data-edge={edge}
        style={style}
      >
        {children}
      </div>
    </>
  );
}
