/**
 * Framework-agnostic theme controller. Owns the stateful theming concerns —
 * the selected light/dark theme names, the color mode, and resolving the active
 * theme for the current mode — without any dependency on React.
 *
 * SSR-safe: every browser access (localStorage, matchMedia) is guarded, so the
 * controller constructs and runs on the server (persistence and the
 * prefers-color-scheme listener simply no-op) and hydrates on the client.
 */

import type { ThemeCatalog } from './createThemeCatalog';
import { createThemeResolver, type ThemeResolver } from './createThemeResolver';
import type { ColorMode, ColorScheme, ThemeLike } from './types';

const FALLBACK_LIGHT_THEME = 'pierre-light';
const FALLBACK_DARK_THEME = 'pierre-dark';

export interface ThemeControllerState {
  darkThemeName: string;
  lightThemeName: string;
  mode: ColorMode;
  // Set while an active theme/mode change is waiting for its theme object.
  // During this time, the applied selection and resolvedTheme remain the last
  // successfully resolved pair.
  pendingThemeResolution?: PendingThemeResolution;
  // Populated when resolving an active theme fails. The controller keeps the
  // last successful selection/resolvedTheme instead of publishing a partial
  // update.
  resolutionError?: ThemeResolutionError;
  resolvedTheme?: ThemeLike;
  // The concrete color scheme after resolving 'system' against the OS
  // preference.
  // Always 'light' or 'dark' — never 'system'. Use this to drive light/dark
  // DOM application (e.g. a data-theme attribute) without re-deriving it.
  resolvedColorScheme: ColorScheme;
}

export interface PendingThemeResolution {
  colorScheme: ColorScheme;
  name: string;
}

export interface ThemeResolutionError extends PendingThemeResolution {
  error: unknown;
}

export type ThemeResolutionErrorContext = PendingThemeResolution;

export interface ThemeController {
  // The registry/cache the controller registered its catalog into.
  resolver: ThemeResolver;
  // Detaches the prefers-color-scheme listener (browser only). Safe to call on
  // the server or more than once.
  destroy(): void;
  getState(): ThemeControllerState;
  setColorMode(mode: ColorMode): void;
  // Updates the theme name assigned to one color-scheme slot. It does not switch
  // modes; setColorMode chooses which slot is currently active.
  setThemeNameForScheme(scheme: ColorScheme, name: string): void;
  subscribe(listener: () => void): () => void;
}

export interface ThemeControllerBaseOptions {
  // Initial selection; falls back to catalog/default theme names and 'system'.
  defaultDarkThemeName?: string;
  defaultLightThemeName?: string;
  defaultMode?: ColorMode;
  // Custom persistence adapter. Takes precedence over `storageKey`. Lets a host
  // app store the selection however it likes (e.g. mode and the theme names
  // under separate, pre-existing keys) instead of the default single JSON blob.
  persistence?: ThemePersistence;
  // When true, resolve the inactive theme too (so a mode flip is instant).
  // Default false: only the active theme is resolved.
  preloadInactive?: boolean;
  // Receives active-theme resolution failures. Defaults to console.error.
  onResolutionError?: (
    error: unknown,
    context: ThemeResolutionErrorContext
  ) => void;
  // Built-in localStorage persistence under this key (one JSON entry). Omit to
  // disable persistence, or pass `persistence` for a custom layout.
  storageKey?: string;
}

export interface ThemeControllerCatalogOptions extends ThemeControllerBaseOptions {
  // Registers every catalog loader before resolving the initial active theme.
  catalog: ThemeCatalog;
  // Optional cache/registry owner. Omit to create an isolated resolver for this
  // controller.
  resolver?: ThemeResolver;
}

export interface ThemeControllerResolverOptions extends ThemeControllerBaseOptions {
  // Legacy path for callers that still own resolver registration externally.
  resolver: ThemeResolver;
}

export type ThemeControllerOptions =
  | ThemeControllerCatalogOptions
  | ThemeControllerResolverOptions;

// The user's persisted selection. Only this is stored — never the resolved
// theme object, which is re-derived from the resolver on load.
export interface ThemeSelection {
  darkThemeName: string;
  lightThemeName: string;
  mode: ColorMode;
}

// Pluggable persistence. `load` returns the stored selection (or null when
// absent/unreadable); `save` writes it. Implementations must guard their own
// browser access so the controller stays SSR-safe.
export interface ThemePersistence {
  load(): ThemeSelection | null;
  save(selection: ThemeSelection): void;
}

type ActiveSelectionPatch = Partial<
  Pick<
    ThemeControllerState,
    'darkThemeName' | 'lightThemeName' | 'mode' | 'resolvedColorScheme'
  >
>;

// Reads window.localStorage defensively. Returns undefined on the server or if
// storage access throws (e.g. disabled cookies / private mode).
function getStorage(): Storage | undefined {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage != null) {
      return globalThis.localStorage;
    }
  } catch {
    // Accessing localStorage can throw in sandboxed iframes — treat as absent.
  }
  return undefined;
}

// The default persistence adapter: the whole selection as one JSON entry under
// `storageKey`. SSR-safe (no-ops when localStorage is unavailable). Apps that
// need a different layout pass their own `persistence` adapter instead.
function createLocalStorageAdapter(
  storageKey: string,
  defaults: { darkThemeName: string; lightThemeName: string }
): ThemePersistence {
  return {
    load() {
      const storage = getStorage();
      const raw = storage?.getItem(storageKey);
      if (raw == null) return null;
      try {
        const parsed = JSON.parse(raw) as Partial<ThemeSelection>;
        if (parsed.mode == null) return null;
        return {
          darkThemeName: parsed.darkThemeName ?? defaults.darkThemeName,
          lightThemeName: parsed.lightThemeName ?? defaults.lightThemeName,
          mode: parsed.mode,
        };
      } catch {
        return null; // Corrupt value — treat as absent.
      }
    },
    save(selection) {
      const storage = getStorage();
      try {
        storage?.setItem(storageKey, JSON.stringify(selection));
      } catch {
        // Quota or access errors are non-fatal for theming.
      }
    },
  };
}

// True when the OS/browser currently prefers a dark color scheme. Returns false
// on the server or when matchMedia is unavailable, so 'system' defaults to the
// light theme until the client can report otherwise.
function systemPrefersDark(): boolean {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.matchMedia != null) {
      return globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch {
    // Ignore — fall through to the light default.
  }
  return false;
}

// Collapses a ColorMode to the concrete 'light'/'dark' color scheme that should
// apply now, resolving 'system' against the OS preference.
function resolveColorScheme(mode: ColorMode): ColorScheme {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

export function createThemeController(
  options: ThemeControllerOptions
): ThemeController {
  const { storageKey, preloadInactive = false } = options;
  const catalog =
    'catalog' in options && options.catalog != null
      ? options.catalog
      : undefined;
  const selectedResolver =
    options.resolver ?? (catalog != null ? createThemeResolver() : undefined);
  if (selectedResolver == null) {
    throw new Error('createThemeController requires a catalog or resolver');
  }
  const resolver: ThemeResolver = selectedResolver;

  catalog?.registerInto(resolver);

  const defaultDarkThemeName =
    options.defaultDarkThemeName ??
    catalog?.defaultDarkThemeName ??
    FALLBACK_DARK_THEME;
  const defaultLightThemeName =
    options.defaultLightThemeName ??
    catalog?.defaultLightThemeName ??
    FALLBACK_LIGHT_THEME;

  // Custom adapter wins; otherwise fall back to the single-JSON-key localStorage
  // adapter when a storageKey is given; otherwise persistence is disabled.
  const persistence: ThemePersistence | undefined =
    options.persistence ??
    (storageKey != null
      ? createLocalStorageAdapter(storageKey, {
          darkThemeName: defaultDarkThemeName,
          lightThemeName: defaultLightThemeName,
        })
      : undefined);

  const initialMode = options.defaultMode ?? 'system';
  let state: ThemeControllerState = {
    darkThemeName: defaultDarkThemeName,
    lightThemeName: defaultLightThemeName,
    mode: initialMode,
    resolvedTheme: undefined,
    resolvedColorScheme: resolveColorScheme(initialMode),
  };

  const listeners = new Set<() => void>();
  let activeResolutionId = 0;
  let pendingSelectionPatch: ActiveSelectionPatch | undefined;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  // Loads any persisted selection over the defaults (client only).
  function hydrateFromStorage(): void {
    const loaded = persistence?.load();
    if (loaded == null) return;
    state = {
      ...state,
      darkThemeName: loaded.darkThemeName,
      lightThemeName: loaded.lightThemeName,
      mode: loaded.mode,
      resolvedColorScheme: resolveColorScheme(loaded.mode),
    };
  }

  function persist(): void {
    persistence?.save({
      darkThemeName: state.darkThemeName,
      lightThemeName: state.lightThemeName,
      mode: state.mode,
    });
  }

  // The theme name that should be active for the current mode, keyed off the
  // already-resolved 'light'/'dark' so 'system' maps consistently.
  function activeThemeNameFor(selection: {
    darkThemeName: string;
    lightThemeName: string;
    resolvedColorScheme: ColorScheme;
  }): string {
    return selection.resolvedColorScheme === 'dark'
      ? selection.darkThemeName
      : selection.lightThemeName;
  }

  function intendedState(
    patch: ActiveSelectionPatch = {}
  ): ThemeControllerState {
    return { ...state, ...pendingSelectionPatch, ...patch };
  }

  function reportResolutionError(
    error: unknown,
    context: ThemeResolutionErrorContext
  ): void {
    if (options.onResolutionError != null) {
      options.onResolutionError(error, context);
      return;
    }
    console.error(
      `[theming] Failed to resolve theme "${context.name}" for ${context.colorScheme} color scheme`,
      error
    );
  }

  function preloadInactiveFor(selection: {
    darkThemeName: string;
    lightThemeName: string;
    resolvedColorScheme: ColorScheme;
  }): void {
    if (!preloadInactive) return;

    const activeName = activeThemeNameFor(selection);
    const inactive =
      selection.resolvedColorScheme === 'dark'
        ? selection.lightThemeName
        : selection.darkThemeName;
    if (
      inactive !== activeName &&
      resolver.getResolvedTheme(inactive) === undefined
    ) {
      void resolver.resolveTheme(inactive).catch(() => {});
    }
  }

  // Resolves the active theme (and, when preloadInactive is set, the other one)
  // and publishes the result. Active selection changes are committed only after
  // the theme object resolves, so subscribers never see a new name/mode paired
  // with the previous theme's derived tokens.
  function resolveActive(
    patch: ActiveSelectionPatch = {},
    { notifyPending = false, persistOnSuccess = false } = {}
  ): void {
    const selectionPatch = { ...pendingSelectionPatch, ...patch };
    const next = intendedState(patch);
    const name = activeThemeNameFor(next);
    const colorScheme = next.resolvedColorScheme;

    const cached = resolver.getResolvedTheme(name);
    if (cached !== undefined) {
      activeResolutionId++;
      pendingSelectionPatch = undefined;
      state = {
        ...state,
        ...selectionPatch,
        pendingThemeResolution: undefined,
        resolutionError: undefined,
        resolvedTheme: cached,
      };
      if (persistOnSuccess) persist();
      notify();
      preloadInactiveFor(state);
      return;
    }

    const resolutionId = ++activeResolutionId;
    pendingSelectionPatch = selectionPatch;
    state = {
      ...state,
      pendingThemeResolution: { colorScheme, name },
      resolutionError: undefined,
    };
    if (notifyPending) notify();

    void resolver
      .resolveTheme(name)
      .then((theme) => {
        if (resolutionId !== activeResolutionId) return;
        const latestIntended = intendedState();
        if (
          latestIntended.resolvedColorScheme !== colorScheme ||
          activeThemeNameFor(latestIntended) !== name
        ) {
          return;
        }
        const patchToCommit = pendingSelectionPatch ?? {};
        pendingSelectionPatch = undefined;
        state = {
          ...state,
          ...patchToCommit,
          pendingThemeResolution: undefined,
          resolutionError: undefined,
          resolvedTheme: theme,
        };
        if (persistOnSuccess) persist();
        notify();
        preloadInactiveFor(state);
      })
      .catch((error: unknown) => {
        if (resolutionId !== activeResolutionId) return;
        pendingSelectionPatch = undefined;
        state = {
          ...state,
          pendingThemeResolution: undefined,
          resolutionError: { colorScheme, error, name },
        };
        reportResolutionError(error, { colorScheme, name });
        notify();
      });
  }

  function updateInactiveThemeName(
    key: 'darkThemeName' | 'lightThemeName',
    name: string
  ): void {
    state = { ...state, [key]: name, resolutionError: undefined };
    persist();
    notify();
    preloadInactiveFor(state);
  }

  function isSchemeActiveInIntendedState(
    scheme: ColorScheme,
    patch: ActiveSelectionPatch = {}
  ): boolean {
    return intendedState(patch).resolvedColorScheme === scheme;
  }

  function setActiveSelection(patch: ActiveSelectionPatch): void {
    resolveActive(patch, { notifyPending: true, persistOnSuccess: true });
  }

  function setInactiveThemeName(
    scheme: ColorScheme,
    key: 'darkThemeName' | 'lightThemeName',
    name: string
  ): void {
    if (isSchemeActiveInIntendedState(scheme, { [key]: name })) {
      setActiveSelection({ [key]: name });
    } else {
      updateInactiveThemeName(key, name);
    }
  }

  function setMode(mode: ColorMode): void {
    const nextScheme = resolveColorScheme(mode);
    setActiveSelection({ mode, resolvedColorScheme: nextScheme });
  }

  function maybeUpdateSystemColorScheme(): void {
    if (intendedState().mode !== 'system') return;
    const next = resolveColorScheme('system');
    if (next !== intendedState().resolvedColorScheme) {
      resolveActive({ resolvedColorScheme: next }, { notifyPending: true });
    }
  }

  function isSelectedValue(
    key: 'darkThemeName' | 'lightThemeName' | 'mode',
    value: string
  ): boolean {
    return intendedState()[key] === value;
  }

  // Re-resolves whenever the OS theme flips while in 'system' mode, updating the
  // concrete resolvedColorScheme so DOM application (data-theme etc.) follows
  // the OS.
  let mediaQuery: MediaQueryList | undefined;
  const handleMediaChange = (): void => {
    maybeUpdateSystemColorScheme();
  };
  function attachMediaListener(): void {
    try {
      if (typeof globalThis !== 'undefined' && globalThis.matchMedia != null) {
        mediaQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
        mediaQuery.addEventListener('change', handleMediaChange);
      }
    } catch {
      // No matchMedia (server / unsupported) — system mode falls back to light.
    }
  }

  hydrateFromStorage();
  attachMediaListener();
  resolveActive();

  return {
    resolver,
    destroy() {
      if (mediaQuery != null) {
        mediaQuery.removeEventListener('change', handleMediaChange);
        mediaQuery = undefined;
      }
      listeners.clear();
    },
    getState() {
      return state;
    },
    setColorMode(mode) {
      if (isSelectedValue('mode', mode)) return;
      setMode(mode);
    },
    setThemeNameForScheme(scheme, name) {
      const key = scheme === 'light' ? 'lightThemeName' : 'darkThemeName';
      if (isSelectedValue(key, name)) return;
      setInactiveThemeName(scheme, key, name);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
