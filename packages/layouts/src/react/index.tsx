'use client';

// `@pierre/layouts/react`. An app imports the components as a namespace and
// the functions by name, from this one entry:
//
//   import * as Layout from '@pierre/layouts/react';
//   import { createLayout, edits, naryTree } from '@pierre/layouts/react';
//   const layout = createLayout(root, [edits(naryTree)]);
//   <Layout.Root layout={layout} renderPane={renderPane} />;
//
// Each feature carries its store part, its view part, and its sheets. A
// bundler keeps only the parts and features that an app uses.
export { PANE_VISIBILITY_EVENT, type PaneVisibilityEvent } from '../dom/panes';
export type { ResizeStrategy } from '../dom/resize-work';
export type { PaneEdges } from '../css-layout';
export type { DropPlace } from '../drop';
export { binaryTree } from '../models/binary';
export { naryTree } from '../models/n-ary';
export type {
  Feature,
  FeatureHooks,
  Gesture,
  HostPatch,
  LayoutMessages,
  LayoutResizeContext,
  LayoutResizeSession,
  PaneContextValue,
  StylesheetsSetting,
  ViewContext,
  ViewRender,
  ViewState,
  ViewStore,
} from './contract';
export {
  createLayout,
  type FeatureCommands,
  type LayoutObject,
} from './create-layout';
export { edits, hiddenPanes, persistence } from './features/store-only';
export {
  Layout,
  type LayoutProps,
  type LayoutTablistProps,
  type LayoutTabProps,
  type PaneAction,
  type PaneHeaderProps,
} from './layout';
export {
  CloseButton,
  type CloseButtonState,
  CollapseButton,
  type CollapseButtonState,
  Content,
  Header,
  type HeaderState,
  Title,
} from './parts/chrome';
export type { PartProps, RenderProp } from './parts/part';
export {
  type LayoutSeparator,
  Root,
  type RootCommonProps,
  type RootControlledProps,
  type RootLayoutProps,
  type RootProps,
} from './root';
export { type PaneState, usePane } from './use-pane';
