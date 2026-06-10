/**
 * React bindings for @pierre/theming. A thin useSyncExternalStore wrapper over
 * the framework-agnostic controller with no logic of its own — all state,
 * persistence, and resolution live in the controller, so a non-React app can use
 * it directly. React is an optional peer dependency; importing this entry is the
 * only place React is required.
 */

import { useSyncExternalStore } from 'react';

import type { ThemeController, ThemeControllerState } from './index';

// Binds a ThemeController to React via useSyncExternalStore and returns its
// current state — mode, the selected theme names, the resolved theme, and
// resolvedColorScheme. The controller emits a new state object only when
// something changes, so the snapshot reference is stable between renders (no
// tearing, no render loop). getState doubles as the server snapshot — it returns
// the initial selection on the server and hydrates on the client.
export function useThemeController(
  controller: ThemeController
): ThemeControllerState {
  return useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState
  );
}
