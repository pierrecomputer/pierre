'use client';

// Pane chrome parts: each reads its pane from the pane context, subscribes to
// the state that it shows, sets that state as data attributes, and takes a
// `render` prop.
import type { JSX } from 'react';

import contentCss from '../../css/content.css?inline';
import headersCss from '../../css/headers.css?inline';
import { Style } from '../contract';
import { usePaneContext, usePaneState } from '../use-pane';
import { canClose, closePane, closes } from './close';
import {
  mergeProps,
  type PartProps,
  renderPart,
  useLayoutState,
  warnMissing,
} from './part';

export interface HeaderState {
  /** The pane has the focus of the layout. */
  focused: boolean;
  zoomed: boolean;
}

/**
 * The header of a pane: a row for its title, tabs, and buttons. It stays when
 * the pane collapses, as the strip of the collapsed pane.
 */
export function Header({
  render,
  ...props
}: PartProps<HeaderState>): JSX.Element {
  const value = usePaneContext('Layout.Header');
  const focused = usePaneState(value, (pane) => pane.focused);
  const zoomed = usePaneState(value, (pane) => pane.zoomed);
  return (
    <>
      <Style
        name="headers"
        css={headersCss}
        settings={value.context.stylesheets()}
      />
      {renderPart(
        'header',
        render,
        mergeProps(props, {
          className: 'pierre-layout-header',
          'data-focused': focused || undefined,
          'data-zoomed': zoomed || undefined,
        }),
        { focused, zoomed }
      )}
    </>
  );
}

/** The title of a pane, from `getPaneTitle`. */
export function Title({
  render,
  children,
  ...props
}: PartProps<object>): JSX.Element {
  const value = usePaneContext('Layout.Title');
  const pane = usePaneState(value, (state) => state.pane);
  return renderPart(
    'span',
    render,
    mergeProps(props, {
      className: 'pierre-layout-title',
      children: children ?? value.context.title(pane),
    }),
    {}
  );
}

/**
 * The content area of a pane: the element that scrolls. When the pane
 * collapses, the content keeps its DOM, its state, and its scroll position,
 * and becomes inert and skips its style, layout, and paint, while
 * `Layout.Header` stays as the collapsed strip. The view sets
 * `data-collapsed` on it; the content does not render for a collapse.
 */
export function Content({ render, ...props }: PartProps<object>): JSX.Element {
  const { id, context } = usePaneContext('Layout.Content');
  return (
    <>
      <Style name="content" css={contentCss} settings={context.stylesheets()} />
      {renderPart(
        'div',
        render,
        mergeProps(props, {
          className: 'pierre-layout-content',
          ref: context.visibility.contentRef(id),
        }),
        {}
      )}
    </>
  );
}

export interface CollapseButtonState {
  /** The pane, or its stack, is collapsed. */
  collapsed: boolean;
}

/** Collapse the pane (or its stack) to its collapsed size, or expand it. */
export function CollapseButton({
  render,
  children,
  ...props
}: PartProps<CollapseButtonState>): JSX.Element {
  const value = usePaneContext('Layout.CollapseButton');
  const { id, context } = value;
  const pane = usePaneState(value, (state) => state.pane);
  const collapsed = usePaneState(value, (state) => state.collapsed);
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().collapse ?? collapseName)(
        context.title(pane)
      ),
      'aria-pressed': collapsed,
      'data-collapsed': collapsed || undefined,
      onClick: () => context.store.setCollapsed(id, !collapsed),
      children: children ?? (collapsed ? '▸' : '▾'),
    }),
    { collapsed }
  );
}

const collapseName = (title: string): string => `Collapse ${title}`;

const closeName = (title: string): string => `Close ${title}`;

export interface CloseButtonState {
  /** The pane cannot close: it is the last pane that shows. */
  disabled: boolean;
}

/**
 * Close the pane: the app's `onPaneClose`, or `layout.close` from
 * `edits()`. The last pane that shows does not close.
 */
export function CloseButton({
  render,
  children,
  ...props
}: PartProps<CloseButtonState>): JSX.Element {
  const value = usePaneContext('Layout.CloseButton');
  const { id, context } = value;
  warnMissing(
    closes(context),
    'Layout.CloseButton',
    'edits() or the onPaneClose prop'
  );
  const pane = usePaneState(value, (state) => state.pane);
  const disabled = !useLayoutState(context.store, (state) =>
    canClose(context, state, id)
  );
  return renderPart(
    'button',
    render,
    mergeProps(props, {
      type: 'button',
      'aria-label': (context.messages().close ?? closeName)(
        context.title(pane)
      ),
      disabled,
      'data-disabled': disabled || undefined,
      onClick: () => {
        if (!disabled) closePane(context, id);
      },
      children: children ?? '×',
    }),
    { disabled }
  );
}
