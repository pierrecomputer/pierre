import { parseDiffFromFile, resolveTheme } from '@pierre/diffs';
import { themeToTreeStyles } from '@pierre/trees';
import { notFound } from 'next/navigation';
import { Suspense } from 'react';

import { ThemesGridClient } from './ThemesGridClient';

const SAMPLE_OLD_FILE = {
  name: 'config.ts',
  contents: [
    "import { readFile } from 'fs/promises';",
    '',
    'interface Config {',
    '  port: number;',
    '  host: string;',
    '}',
    '',
    'export async function loadConfig(path: string) {',
    "  const raw = await readFile(path, 'utf-8');",
    '  return JSON.parse(raw) as Config;',
    '}',
    '',
    'export function getDefaultConfig(): Config {',
    "  return { port: 3000, host: 'localhost' };",
    '}',
    '',
  ].join('\n'),
};

const SAMPLE_NEW_FILE = {
  name: 'config.ts',
  contents: [
    "import { readFile, stat } from 'fs/promises';",
    '',
    'interface Config {',
    '  port: number;',
    '  host: string;',
    '  debug?: boolean;',
    "  logLevel: 'info' | 'warn' | 'error';",
    '}',
    '',
    'export async function loadConfig(path: string): Promise<Config> {',
    '  await stat(path);',
    "  const raw = await readFile(path, 'utf-8');",
    '  const config = JSON.parse(raw) as Partial<Config>;',
    '  return { ...getDefaultConfig(), ...config };',
    '}',
    '',
    'export function getDefaultConfig(): Config {',
    '  return {',
    '    port: 3000,',
    "    host: 'localhost',",
    '    debug: false,',
    "    logLevel: 'info',",
    '  };',
    '}',
    '',
    'export function validateConfig(config: Config): boolean {',
    '  return config.port > 0 && config.port < 65536;',
    '}',
    '',
  ].join('\n'),
};

const THEMES = [
  // Pierre
  'pierre-light',
  'pierre-dark',

  // GitHub
  'github-light',
  'github-dark',
  'github-dark-dimmed',

  // Atom / One
  'one-light',
  'one-dark-pro',

  // Dracula
  'dracula',
  'dracula-soft',

  // Material
  'material-theme-lighter',
  'material-theme',
  'material-theme-darker',
  'material-theme-ocean',
  'material-theme-palenight',

  // Monokai
  'monokai',

  // Night Owl
  'night-owl',

  // Tokyo Night
  'tokyo-night',

  // Synthwave
  'synthwave-84',

  // Catppuccin
  'catppuccin-latte',
  'catppuccin-frappe',
  'catppuccin-macchiato',
  'catppuccin-mocha',

  // Gruvbox
  'gruvbox-light-medium',
  'gruvbox-dark-medium',

  // Houston
  'houston',

  // Rosé Pine
  'rose-pine-dawn',
  'rose-pine',
  'rose-pine-moon',

  // Solarized
  'solarized-light',
  'solarized-dark',

  // Vesper
  'vesper',

  // --- Additional picks ---

  // Everforest
  'everforest-light',
  'everforest-dark',

  // Poimandres
  'poimandres',

  // Kanagawa
  'kanagawa-lotus',
  'kanagawa-wave',
  'kanagawa-dragon',

  // Vitesse
  'vitesse-light',
  'vitesse-dark',
  'vitesse-black',

  // Nord
  'nord',

  // Laserwave
  'laserwave',

  // Aurora
  'aurora-x',

  // Ayu
  'ayu-dark',

  // Snazzy / Slack
  'snazzy-light',
  'slack-dark',

  // Min
  'min-light',
  'min-dark',
] as const;

export default async function TreesThemesPage() {
  if (process.env.NODE_ENV !== 'development') {
    return notFound();
  }

  const resolvedThemes = await Promise.all(
    THEMES.map(async (themeName) => {
      try {
        const theme = await resolveTheme(
          themeName as Parameters<typeof resolveTheme>[0]
        );
        return {
          name: themeName,
          type: theme.type,
          styles: themeToTreeStyles(theme),
        };
      } catch {
        return null;
      }
    })
  );

  const themes = resolvedThemes.filter(
    (t): t is NonNullable<typeof t> => t != null
  );

  const fileDiff = parseDiffFromFile(SAMPLE_OLD_FILE, SAMPLE_NEW_FILE);

  return (
    <Suspense>
      <ThemesGridClient themes={themes} fileDiff={fileDiff} />
    </Suspense>
  );
}
