import type {
  Theme as ZedTheme,
  ThemeFamily as ZedThemeFamily,
} from '@pierre/highlights';
import {
  createThemeResolver,
  type ThemeLoader,
  type ThemeResolver,
} from '@pierre/theming';
import type { ThemeRegistration } from 'shiki';

import type { HighlighterTypes } from '../../types';
import { isWorkerContext } from '../../utils/isWorkerContext';
import type { DiffsTheme } from './types';

declare const __DIFFS_WORKER__: boolean | undefined;

export type CustomThemeLoader = ThemeLoader<
  ThemeRegistration | DiffsTheme | ZedTheme | ZedThemeFamily
>;
export const customThemes: Map<
  string,
  Partial<Record<'textmate' | 'zed' | 'diffs', CustomThemeLoader>>
> = new Map();
const resolvers = new Map<HighlighterTypes, ThemeResolver<DiffsTheme>>();

// Keep the first loader registered for each name and format.
export function registerCustomThemeLoader(
  themeName: string,
  loader: CustomThemeLoader,
  type: 'textmate' | 'zed' | 'diffs'
): void {
  const themes = customThemes.get(themeName) ?? {};
  if (themes[type] !== undefined) {
    console.error(
      'SharedHighlight.registerCustomTheme: theme name and type already registered',
      themeName,
      type
    );
    return;
  }
  themes[type] = loader;
  customThemes.set(themeName, themes);
}

// Map Zed colors to the VS Code keys used by editor and diff overlays.
const ZED_COLOR_ALIASES: readonly (readonly [
  target: string,
  ...sources: string[],
])[] = [
  ['editor.lineHighlightBackground', 'editor.active_line.background'],
  ['editor.selectionBackground', 'element.selected'],
  ['editor.findMatchBackground', 'search.match_background'],
  ['editor.findMatchHighlightBackground', 'search.match_background'],
  [
    'editorBracketMatch.background',
    'editor.document_highlight.bracket_background',
  ],
  ['editorError.foreground', 'error'],
  ['editorWarning.foreground', 'warning'],
  ['editorInfo.foreground', 'info'],
  ['editorHint.foreground', 'hint'],
  ['gitDecoration.addedResourceForeground', 'created', 'terminal.ansi.green'],
  ['gitDecoration.deletedResourceForeground', 'deleted', 'terminal.ansi.red'],
  [
    'gitDecoration.modifiedResourceForeground',
    'modified',
    'terminal.ansi.blue',
  ],
];

// Build the shared theme shape from a Zed theme: copy its flat colors, then
// fill the VS Code keys the surfaces read from their Zed equivalents.
function createHighlightsTheme(
  name: string,
  raw: ZedTheme | ZedThemeFamily
): DiffsTheme {
  const theme = 'themes' in raw ? raw.themes[0] : raw;
  if (theme === undefined)
    throw new Error(`Theme "${name}" is an empty Zed theme family.`);
  const zed = { ...theme, name };
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(zed.style)) {
    if (typeof value === 'string') colors[key] = value;
  }
  // Zed keeps the local user's caret and selection in the first player slot.
  const player = zed.style.players?.[0];
  if (player?.cursor !== undefined)
    colors['editorCursor.foreground'] ??= player.cursor;
  if (player?.selection !== undefined)
    colors['editor.selectionBackground'] ??= player.selection;
  for (const [target, ...sources] of ZED_COLOR_ALIASES) {
    if (colors[target] !== undefined) continue;
    const source = sources.find((key) => colors[key] !== undefined);
    if (source !== undefined) colors[target] = colors[source];
  }
  if (zed.cssVariables === true) {
    colors['editor.foreground'] = 'var(--hls-foreground)';
    colors['editor.background'] = 'var(--hls-background)';
  } else if (typeof zed.cssVariables === 'object') {
    colors['editor.foreground'] ??=
      colors.text ?? colors.foreground ?? 'foreground';
    colors['editor.background'] ??= colors.background ?? 'background';
    const { prefix = '--hls-', defaults } = zed.cssVariables;
    for (const [key, value] of Object.entries(colors)) {
      const fallback = defaults?.[value];
      colors[key] = `var(${prefix}${value}${fallback ? `, ${fallback}` : ''})`;
    }
  }
  const type = zed.appearance === 'light' ? 'light' : 'dark';
  return {
    name,
    type,
    colors,
    zed,
    fg:
      colors['editor.foreground'] ??
      colors.text ??
      colors.foreground ??
      (type === 'light' ? '#333333' : '#bbbbbb'),
    bg:
      colors['editor.background'] ??
      colors.background ??
      (type === 'light' ? '#ffffff' : '#1e1e1e'),
  };
}

/** Keep caches separate because the same name can have TextMate and Zed palettes. */
export function createDiffsThemeResolver(
  backend: HighlighterTypes
): ThemeResolver<DiffsTheme> {
  let resolver = resolvers.get(backend);
  if (resolver !== undefined) return resolver;
  resolver = createThemeResolver<DiffsTheme>({
    fallbackLoader: async (name) => {
      if (
        typeof __DIFFS_WORKER__ !== 'undefined'
          ? __DIFFS_WORKER__
          : isWorkerContext()
      ) {
        throw new Error(
          `Theme "${name}" cannot be resolved from a worker context. Themes must be pre-resolved on the main thread and passed to the worker via the resolvedThemes parameter.`
        );
      }
      const custom = customThemes.get(name);
      if (backend === 'highlights') {
        // Custom Zed palettes take precedence over the bundled catalog.
        const loader = custom?.zed ?? custom?.diffs;
        if (loader !== undefined) {
          const loaded = await loader();
          const theme = 'default' in loaded ? loaded.default : loaded;
          if ('zed' in theme && theme.zed !== undefined) return theme;
          if ('style' in theme || 'themes' in theme)
            return createHighlightsTheme(name, theme);
          throw new Error(
            `Theme "${name}" is a TextMate theme; register a Zed theme with registerCustomTheme(name, loader, 'zed') for Highlights.`
          );
        }
        const { themes: bundledHighlightsThemes } =
          await import('@pierre/highlights/themes/loader');
        const bundledLoader = bundledHighlightsThemes[name];
        if (bundledLoader !== undefined) {
          const loaded = await bundledLoader();
          return createHighlightsTheme(name, loaded.default);
        }
        if (custom?.textmate !== undefined) {
          throw new Error(
            `Theme "${name}" is only registered for TextMate; use registerCustomTheme(name, loader, 'zed') for Highlights.`
          );
        }
      } else {
        const loader = custom?.textmate ?? custom?.diffs;
        let loaded: ThemeRegistration | DiffsTheme | ZedTheme | ZedThemeFamily;
        if (loader !== undefined) {
          const result = await loader();
          loaded = 'default' in result ? result.default : result;
        } else {
          const { themes } = await import('@pierre/theming/themes');
          const descriptor = themes.getTheme(name);
          if (descriptor === undefined && custom?.zed !== undefined) {
            throw new Error(
              `Theme "${name}" is only registered for Zed; use registerCustomTheme(name, loader, 'textmate') for Shiki.`
            );
          }
          if (descriptor === undefined)
            throw new Error(`No valid theme loader registered for "${name}"`);
          const result = await descriptor.load();
          loaded = 'default' in result ? result.default : result;
        }
        if ('style' in loaded || 'themes' in loaded) {
          throw new Error(
            `Theme "${name}" is a Zed theme; use preferredHighlighter: 'highlights' or register a TextMate theme for Shiki.`
          );
        }
        const { normalizeTheme, createCssVariablesTheme } =
          await import('shiki/core');
        if ('cssVariables' in loaded && loaded.cssVariables !== undefined) {
          return {
            ...loaded,
            textmate: normalizeTheme(
              createCssVariablesTheme(loaded.cssVariables)
            ),
          };
        }
        if ('textmate' in loaded && loaded.textmate !== undefined) {
          return { ...loaded, textmate: normalizeTheme(loaded.textmate) };
        }
        const textmate = normalizeTheme(loaded);
        return {
          name: textmate.name,
          type: textmate.type,
          fg: textmate.fg,
          bg: textmate.bg,
          colors: textmate.colors,
          textmate,
        };
      }
      throw new Error(`No valid theme loader registered for "${name}"`);
    },
    normalizeTheme: (theme, name) => {
      if (theme.name !== name)
        throw new Error(
          `resolvedTheme: themeName: ${name} does not match theme.name: ${theme.name}`
        );
      return theme;
    },
  });
  resolvers.set(backend, resolver);
  return resolver;
}
