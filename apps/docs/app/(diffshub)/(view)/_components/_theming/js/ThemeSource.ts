// → future @pierre/theme-kit. The vanilla-JS contract for reading the active
// resolved theme, plus the two adapters that produce one. React context simply
// carries the current ThemeSource; the override precedence (prop > provider)
// falls out because a `theme` prop constructs a local fixedSource.
import type {
  ColorScheme,
  ThemeController,
  ThemeLike,
  ThemeResolver,
} from '@pierre/theme-kit';

export interface ActiveThemeSnapshot {
  // The resolved active theme object (full: colors + tokenColors). Undefined
  // until the first resolve settles.
  theme?: ThemeLike;
  colorScheme: ColorScheme;
}

// The reusable part: a subscribable source for the currently-active resolved
// theme. It deliberately does not know about theme-name pairs. Trees and chrome
// only need this shape.
export interface ThemeSource {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ActiveThemeSnapshot;
}

// The diffs-specific extension: selected light/dark theme names plus the active
// scheme. Diffs still consumes names, so adapters can expose this optional
// capability without making it part of the generic ThemeSource contract.
export interface ThemeNameSelection {
  darkThemeName: string;
  lightThemeName: string;
  colorScheme: ColorScheme;
}

export interface ThemeNameSelectionSource {
  getThemeNameSelection(): ThemeNameSelection | undefined;
}

export type ThemeSourceWithNameSelection = ThemeSource &
  ThemeNameSelectionSource;

export function hasThemeNameSelection(
  source: ThemeSource | undefined
): source is ThemeSourceWithNameSelection {
  return (
    source != null &&
    typeof (source as Partial<ThemeNameSelectionSource>)
      .getThemeNameSelection === 'function'
  );
}

export type ThemeValue = string | ThemeLike;
export type ThemePair<T = ThemeValue> = { light: T; dark: T };
export type ThemeInput = ThemeValue | ThemePair;

export interface FixedSourceOptions {
  resolver: ThemeResolver;
  // The provider color scheme used to pick a slot from a { light, dark } pair.
  // A single value pins mode-independently and ignores this. React feeds the
  // current mode here; a vanilla caller supplies it. Defaults to 'light'.
  colorScheme?: ColorScheme;
}

// Reads the color scheme from a resolved theme object's own `type`, defaulting
// to 'light' when the theme declares nothing.
function schemeOf(theme: ThemeLike | undefined): ColorScheme {
  return theme?.type === 'dark' ? 'dark' : 'light';
}

export function isThemePair(input: ThemeInput): input is ThemePair {
  return typeof input === 'object' && 'light' in input && 'dark' in input;
}

export function nameOf(slot: ThemeValue | undefined): string | undefined {
  return typeof slot === 'string' ? slot : slot?.name;
}

export function requireThemeValueName(value: ThemeValue): string {
  const name = nameOf(value);
  if (name == null || name === '') {
    throw new Error(
      'ThemeInput ThemeLike values used by diff wrappers must include a `name`'
    );
  }
  return name;
}

// Wraps the theme-kit controller — the stateful, "follows the selector" source.
// Maps controller state to a singular ActiveThemeSnapshot. Reproduces the
// no-flash "keep previous resolved theme until the cold one settles" semantics:
// when the controller's resolvedTheme is momentarily undefined (a cold swap in
// flight), we return the last non-undefined theme we saw, so chrome/tree never
// flash the default palette. The scheme always follows the controller
// immediately so a mode flip is visible at once even while the new theme object
// loads.
export function controllerSource(
  controller: ThemeController
): ThemeSourceWithNameSelection {
  let lastResolved: ThemeLike | undefined = controller.getState().resolvedTheme;
  return {
    subscribe(listener) {
      return controller.subscribe(listener);
    },
    getSnapshot() {
      const state = controller.getState();
      if (state.resolvedTheme != null) {
        lastResolved = state.resolvedTheme;
      }
      return {
        theme: state.resolvedTheme ?? lastResolved,
        colorScheme: state.resolvedColorScheme,
      };
    },
    getThemeNameSelection() {
      const state = controller.getState();
      return {
        darkThemeName: state.darkThemeName,
        lightThemeName: state.lightThemeName,
        colorScheme: state.resolvedColorScheme,
      };
    },
  };
}

// Wraps an override. A single value (name or object) pins the theme
// mode-independently; a { light, dark } pair resolves the slot matching the
// provider mode. Names are lazy-resolved through the resolver ("load on demand")
// and the source notifies its subscribers once the resolve settles. The
// last-resolved value is kept so a cold name never reports undefined after it
// has loaded once.
export function fixedSource(
  input: ThemeInput,
  options: FixedSourceOptions
): ThemeSourceWithNameSelection {
  const { resolver, colorScheme = 'light' } = options;
  const listeners = new Set<() => void>();
  let resolved: ThemeLike | undefined;
  let selection: ThemeNameSelection | undefined;
  // The scheme this source reports. For an object it is the object's own type;
  // for a name it follows the provider mode until the object resolves, then the
  // resolved object's type wins (matching the controller's resolved-object
  // behavior). For a pair it is the provider mode.
  let reportedScheme: ColorScheme = colorScheme;

  function notify(): void {
    for (const listener of listeners) listener();
  }

  // Pull the name (if any) for the slot we should show, plus an already-resolved
  // object when the input carried one directly.
  function selectSlot(): { name?: string; object?: ThemeLike } {
    if (typeof input === 'string') return { name: input };
    if (isThemePair(input)) {
      const slot = colorScheme === 'dark' ? input.dark : input.light;
      return typeof slot === 'string' ? { name: slot } : { object: slot };
    }
    return { object: input };
  }

  if (typeof input === 'string') {
    selection = {
      lightThemeName: input,
      darkThemeName: input,
      colorScheme: reportedScheme,
    };
  } else if (isThemePair(input)) {
    const light = nameOf(input.light);
    const dark = nameOf(input.dark);
    if (light != null && dark != null) {
      selection = {
        lightThemeName: light,
        darkThemeName: dark,
        colorScheme: reportedScheme,
      };
    }
  } else {
    const name = nameOf(input);
    if (name != null) {
      selection = {
        lightThemeName: name,
        darkThemeName: name,
        colorScheme: reportedScheme,
      };
    }
  }

  const slot = selectSlot();
  if (slot.object != null) {
    resolved = slot.object;
    reportedScheme = schemeOf(slot.object);
    const name = nameOf(slot.object);
    if (name != null) {
      resolver.seedResolvedTheme(name, slot.object);
    }
  } else if (slot.name != null) {
    const cached = resolver.getResolvedTheme(slot.name);
    if (cached != null) {
      resolved = cached;
      reportedScheme = schemeOf(cached);
    } else {
      // Load on demand; notify when it settles so subscribers re-read.
      void resolver
        .resolveTheme(slot.name)
        .then((theme) => {
          resolved = theme;
          reportedScheme = schemeOf(theme);
          if (
            selection != null &&
            selection.lightThemeName === selection.darkThemeName &&
            selection.lightThemeName === slot.name
          ) {
            selection = { ...selection, colorScheme: reportedScheme };
          }
          notify();
        })
        .catch(() => {
          // Resolution failures leave the previous value in place.
        });
    }
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return { theme: resolved, colorScheme: reportedScheme };
    },
    getThemeNameSelection() {
      return selection != null
        ? { ...selection, colorScheme: reportedScheme }
        : undefined;
    },
  };
}
