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
export type { PaneEdges } from '../css-layout';
export type { DropPlace } from '../drop';
export { naryTree } from '../models/n-ary';
export { type Presentation, presentation } from '../presentation';
export type { ZoomCommands } from '../zoom';
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
export {
  type AllFeatures,
  allFeatures,
  type AllFeaturesOptions,
} from './features/all';
export { corners } from './features/corners';
export { flip, type FlipOptions } from './features/flip';
export { focusRing } from './features/focus-ring';
export { paneDrag } from './features/pane-drag';
export { stacks } from './features/stacks';
export { tabDrag } from './features/tab-drag';
export { edits, hiddenPanes, persistence } from './features/store-only';
export { zoom } from './features/zoom';
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
  MoveHandle,
  type MoveHandleState,
  Title,
  ZoomButton,
  type ZoomButtonState,
} from './parts/chrome';
export type { PartProps, RenderProp } from './parts/part';
export {
  Tab,
  TabList,
  type TabListItemState,
  type TabListProps,
  type TabState,
} from './parts/tabs';
export { type LayoutSeparator, Root, type RootProps } from './root';
export { useControlledLayout } from './use-controlled-layout';
export { Drawer, type DrawerProps, Modal, type ModalProps } from './overlays';
export { useCover } from './use-cover';
export {
  type CoverOptions,
  OVERLAY_COVER_EVENT,
  type OverlayCover,
  type OverlayCoverEvent,
  type OverlayEdge,
} from '../overlays';
export { type PaneState, usePane } from './use-pane';
