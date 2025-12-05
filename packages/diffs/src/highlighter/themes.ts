import { bundledThemes } from 'shiki';
import { normalizeTheme } from 'shiki/core';

import type {
  PJSHighlighter,
  PJSThemeNames,
  ThemeRegistrationResolved,
  ThemesType,
} from '../types';
import { getThemes } from '../utils/getThemes';
import { isWorkerContext } from '../utils/isWorkerContext';

const ResolvedThemes: Map<PJSThemeNames, ThemeRegistrationResolved> = new Map();

const ResolvingThemes: Map<
  PJSThemeNames,
  Promise<ThemeRegistrationResolved>
> = new Map();

const RegisteredCustomThemes: Map<
  string,
  () => Promise<ThemeRegistrationResolved>
> = new Map();

const attachedThemes = new Set<string>();

// This method should only be called if you know all themes are resolved,
// otherwise it will fail. The main intention is a helper to avoid an async
// tick if we don't actually need it
export function getResolvedThemes(
  themeNames: PJSThemeNames[]
): ThemeRegistrationResolved[] {
  const resolvedThemes: ThemeRegistrationResolved[] = [];
  for (const themeName of themeNames) {
    const theme = ResolvedThemes.get(themeName);
    if (theme == null) {
      throw new Error(
        `getAllResolvedThemes: ${themeName} is unresolved, you must resolve all necessary themes before calling this function`
      );
    }
    resolvedThemes.push(theme);
  }
  return resolvedThemes;
}

export function getResolvedOrResolveTheme(
  themeName: PJSThemeNames
): ThemeRegistrationResolved | Promise<ThemeRegistrationResolved> {
  return ResolvedThemes.get(themeName) ?? resolveTheme(themeName);
}

export function hasResolvedThemes(themeNames: PJSThemeNames[]): boolean {
  for (const themeName of themeNames) {
    if (!ResolvedThemes.has(themeName)) {
      return false;
    }
  }
  return true;
}

export async function resolveTheme(
  themeName: PJSThemeNames
): Promise<ThemeRegistrationResolved> {
  if (isWorkerContext()) {
    throw new Error(
      `resolveTheme("${themeName}") cannot be called from a worker context. ` +
        'Themes must be pre-resolved on the main thread and passed to the worker via the resolvedLanguages parameter.'
    );
  }

  const resolver = ResolvingThemes.get(themeName);
  if (resolver != null) {
    return resolver;
  }

  try {
    const loader =
      RegisteredCustomThemes.get(themeName) ??
      bundledThemes[themeName as keyof typeof bundledThemes];

    if (loader == null) {
      throw new Error(`resolveTheme: No valid loader for ${themeName}`);
    }

    const resolver = loader().then((result) => {
      return normalizeAndCacheResolvedTheme(
        themeName,
        ('default' in result
          ? result.default
          : result) as ThemeRegistrationResolved
      );
    });

    ResolvingThemes.set(themeName, resolver);
    const theme = await resolver;
    if (theme.name !== themeName) {
      throw new Error(
        `resolvedTheme: themeName: ${themeName} does not match theme.name: ${theme.name}`
      );
    }
    ResolvedThemes.set(theme.name, theme);
    return theme;
  } finally {
    ResolvingThemes.delete(themeName);
  }
}

export async function resolveThemes(
  themes: PJSThemeNames[]
): Promise<ThemeRegistrationResolved[]> {
  const resolvedThemes: ThemeRegistrationResolved[] = [];
  const themesToResolve: Promise<ThemeRegistrationResolved | undefined>[] = [];
  for (const themeName of themes) {
    const themeData =
      getResolvedOrResolveTheme(themeName) ?? resolveTheme(themeName);
    if ('then' in themeData) {
      themesToResolve.push(themeData);
    } else {
      resolvedThemes.push(themeData);
    }
  }

  if (themesToResolve.length > 0) {
    await Promise.all(themesToResolve).then((resolved) => {
      for (const theme of resolved) {
        if (theme != null) {
          resolvedThemes.push(theme);
        }
      }
    });
  }

  return resolvedThemes;
}

export function attachResolvedThemes(
  themes:
    | PJSThemeNames
    | ThemeRegistrationResolved
    | (PJSThemeNames | ThemeRegistrationResolved)[],
  highlighter: PJSHighlighter
): void {
  themes = Array.isArray(themes) ? themes : [themes];
  for (let themeRef of themes) {
    let resolvedTheme: ThemeRegistrationResolved | undefined;
    if (typeof themeRef === 'string') {
      resolvedTheme = ResolvedThemes.get(themeRef);
      if (resolvedTheme == null) {
        throw new Error(
          `loadResolvedThemes: ${themeRef} is not resolved, you must resolve it before calling loadResolvedThemes`
        );
      }
    } else {
      resolvedTheme = themeRef;
      themeRef = themeRef.name;
      if (!ResolvedThemes.has(themeRef)) {
        ResolvedThemes.set(themeRef, resolvedTheme);
      }
    }
    if (attachedThemes.has(themeRef)) continue;
    attachedThemes.add(themeRef);
    highlighter.loadThemeSync(resolvedTheme);
  }
}

export function areThemesAttached(themes: PJSThemeNames | ThemesType): boolean {
  for (const theme of getThemes(themes)) {
    if (!attachedThemes.has(theme)) {
      return false;
    }
  }
  return true;
}

export function cleanUpResolvedThemes(): void {
  ResolvedThemes.clear();
  attachedThemes.clear();
}

export function registerCustomTheme(
  themeName: string,
  loader: () => Promise<ThemeRegistrationResolved>
): void {
  if (RegisteredCustomThemes.has(themeName)) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name already registered',
      themeName
    );
    return;
  }
  RegisteredCustomThemes.set(themeName, loader);
}

function normalizeAndCacheResolvedTheme(
  themeName: string,
  themeData: ThemeRegistrationResolved
): ThemeRegistrationResolved {
  const resolvedTheme = ResolvedThemes.get(themeName);
  if (resolvedTheme != null) {
    return resolvedTheme;
  }
  themeData = normalizeTheme(themeData);
  ResolvedThemes.set(themeName, themeData);
  return themeData;
}

registerCustomTheme('pierre-dark', () => {
  return import(
    '../themes/pierre-dark.json'
  ) as unknown as Promise<ThemeRegistrationResolved>;
});

registerCustomTheme('pierre-light', () => {
  return import(
    '../themes/pierre-light.json'
  ) as unknown as Promise<ThemeRegistrationResolved>;
});
