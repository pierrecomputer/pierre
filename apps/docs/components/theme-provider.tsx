'use client';

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

type ResolvedTheme = 'light' | 'dark';
type Theme = ResolvedTheme | 'system';

interface ThemeProviderProps {
  attribute?: 'class' | `data-${string}` | Array<'class' | `data-${string}`>;
  children: ReactNode;
  defaultTheme?: Theme;
  enableColorScheme?: boolean;
  enableSystem?: boolean;
  forcedTheme?: Theme;
  storageKey?: string;
  themes?: ResolvedTheme[];
  value?: Partial<Record<Theme, string>>;
}

interface ThemeContextValue {
  forcedTheme?: Theme;
  resolvedTheme?: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  systemTheme?: ResolvedTheme;
  theme?: Theme;
  themes: Theme[];
}

const DEFAULT_THEMES: ResolvedTheme[] = ['light', 'dark'];
const DEFAULT_STORAGE_KEY = 'theme';
const DEFAULT_ATTRIBUTE = 'data-theme';
const THEME_QUERY = '(prefers-color-scheme: dark)';

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function getSystemTheme(): ResolvedTheme {
  return window.matchMedia(THEME_QUERY).matches ? 'dark' : 'light';
}

function resolveTheme(
  theme: Theme,
  enableSystem: boolean,
  systemTheme: ResolvedTheme | undefined
): ResolvedTheme {
  if (theme === 'system' && enableSystem) {
    return systemTheme ?? getSystemTheme();
  }

  return theme === 'dark' ? 'dark' : 'light';
}

function getAttributeThemeValues(
  themes: ResolvedTheme[],
  value: Partial<Record<Theme, string>> | undefined
): string[] {
  return themes.map((theme) => value?.[theme] ?? theme);
}

// Mirrors the small class/data-attribute contract the docs need, without
// rendering an inline script from a Client Component.
function applyTheme({
  attribute,
  enableColorScheme,
  enableSystem,
  systemTheme,
  theme,
  themes,
  value,
}: {
  attribute: ThemeProviderProps['attribute'];
  enableColorScheme: boolean;
  enableSystem: boolean;
  systemTheme: ResolvedTheme | undefined;
  theme: Theme;
  themes: ResolvedTheme[];
  value: Partial<Record<Theme, string>> | undefined;
}) {
  const root = document.documentElement;
  const resolvedTheme = resolveTheme(theme, enableSystem, systemTheme);
  const resolvedValue = value?.[resolvedTheme] ?? resolvedTheme;
  const attributes = Array.isArray(attribute) ? attribute : [attribute];
  const classValues = getAttributeThemeValues(themes, value);

  for (const currentAttribute of attributes) {
    if (currentAttribute === 'class') {
      root.classList.remove(...classValues);
      root.classList.add(resolvedValue);
      continue;
    }

    if (currentAttribute != null) {
      root.setAttribute(currentAttribute, resolvedValue);
    }
  }

  if (enableColorScheme) {
    root.style.colorScheme = resolvedTheme;
  }
}

function isTheme(value: string | null, themes: Theme[]): value is Theme {
  return value != null && themes.includes(value as Theme);
}

function readStoredTheme(storageKey: string): string | null {
  try {
    return window.localStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

function writeStoredTheme(storageKey: string, theme: Theme) {
  try {
    window.localStorage.setItem(storageKey, theme);
  } catch {
    // The in-memory state still updates when storage is unavailable.
  }
}

export function ThemeProvider({
  attribute = DEFAULT_ATTRIBUTE,
  children,
  defaultTheme,
  enableColorScheme = true,
  enableSystem = true,
  forcedTheme,
  storageKey = DEFAULT_STORAGE_KEY,
  themes = DEFAULT_THEMES,
  value,
}: ThemeProviderProps) {
  const defaultResolvedTheme =
    defaultTheme ?? (enableSystem ? 'system' : 'light');
  const availableThemes = useMemo(
    () => (enableSystem ? [...themes, 'system' as const] : themes),
    [enableSystem, themes]
  );
  const [theme, setThemeState] = useState<Theme | undefined>(undefined);
  const [systemTheme, setSystemTheme] = useState<ResolvedTheme | undefined>(
    undefined
  );

  useEffect(() => {
    const storedTheme = readStoredTheme(storageKey);
    setThemeState(
      isTheme(storedTheme, availableThemes) ? storedTheme : defaultResolvedTheme
    );
  }, [availableThemes, defaultResolvedTheme, storageKey]);

  useEffect(() => {
    if (!enableSystem) {
      return;
    }

    const media = window.matchMedia(THEME_QUERY);
    const updateSystemTheme = () => {
      setSystemTheme(media.matches ? 'dark' : 'light');
    };

    updateSystemTheme();
    media.addEventListener('change', updateSystemTheme);
    return () => media.removeEventListener('change', updateSystemTheme);
  }, [enableSystem]);

  useEffect(() => {
    const activeTheme = forcedTheme ?? theme ?? defaultResolvedTheme;

    applyTheme({
      attribute,
      enableColorScheme,
      enableSystem,
      systemTheme,
      theme: activeTheme,
      themes,
      value,
    });
  }, [
    attribute,
    defaultResolvedTheme,
    enableColorScheme,
    enableSystem,
    forcedTheme,
    systemTheme,
    theme,
    themes,
    value,
  ]);

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      setThemeState(nextTheme);
      writeStoredTheme(storageKey, nextTheme);
    },
    [storageKey]
  );

  const resolvedTheme =
    theme == null ? undefined : resolveTheme(theme, enableSystem, systemTheme);
  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      forcedTheme,
      resolvedTheme,
      setTheme,
      systemTheme,
      theme,
      themes: availableThemes,
    }),
    [availableThemes, forcedTheme, resolvedTheme, setTheme, systemTheme, theme]
  );

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  return (
    useContext(ThemeContext) ?? {
      setTheme: () => {},
      themes: [],
    }
  );
}
