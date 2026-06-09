// Realistic ThemeLike fixtures modeled on real VS Code / Shiki themes, each
// chosen to exercise one of normalizeThemeColors' fallback chains or repair
// heuristics (and the color transforms). Color values are kept faithful to the
// source themes so the parity behavior under test mirrors what ships.

import type { ThemeLike } from '../../src/modules/types';

// slack-ochin: tagged `light` for its (white) editor surface, but ships a
// DARK navy sidebar with light-gray text. Its list.hoverBackground is tuned
// for the light editor, so on the dark sidebar the near-white hover lands on
// top of the light text — hoverWouldEraseText must reject it.
export const slackOchin: ThemeLike = {
  name: 'Slack Ochin',
  type: 'light',
  fg: '#2D3E4C',
  bg: '#F9F9F9',
  colors: {
    'editor.background': '#F9F9F9',
    'editor.foreground': '#2D3E4C',
    'sideBar.background': '#2D3E4C',
    'sideBar.foreground': '#DCDEDF',
    'list.hoverBackground': '#d5e1ea',
    'list.activeSelectionForeground': '#FFFFFF',
    'list.activeSelectionBackground': '#3B556E',
  },
};

// Material Theme Ocean: a dim sideBar.foreground (#4B526D) that sits below the
// AA normal-text floor against the deep-blue sidebar bg — used by the later
// chrome token task to validate muted-foreground promotion. hoverBg and
// selectionBg are not fully asserted here because those paths are reserved for
// the chrome-tokens tests; surface resolution is the primary concern covered.
export const materialThemeOcean: ThemeLike = {
  name: 'Material Theme Ocean',
  type: 'dark',
  fg: '#A6ACCD',
  bg: '#0F111A',
  colors: {
    'editor.background': '#0F111A',
    'editor.foreground': '#A6ACCD',
    'sideBar.background': '#0F111A',
    'sideBar.foreground': '#4B526D',
    'list.hoverBackground': '#000000',
    'list.activeSelectionBackground': '#000000',
    descriptionForeground: '#4B526D',
  },
};

// Aurora X (synthetic, "X" = stripped): a deliberately sparse theme with only
// fg/bg and a couple of palette colors. No sideBar.*, no editor.*, no list.*,
// no git keys — exercises every fallback to the base surface and leaves the
// optional tokens undefined.
export const auroraX: ThemeLike = {
  name: 'Aurora X',
  type: 'dark',
  fg: '#E0E0E0',
  bg: '#15161B',
  colors: {
    'terminal.ansiGreen': '#7FD962',
    focusBorder: '#4C7EFF',
  },
};

// Ayu Dark: a muted descriptionForeground (#5c6773) whose contrast against the
// editor bg lands around ~3.3:1 — a real-world muted value near the AA floor.
export const ayuDark: ThemeLike = {
  name: 'Ayu Dark',
  type: 'dark',
  fg: '#BFBDB6',
  bg: '#0B0E14',
  colors: {
    'editor.background': '#0B0E14',
    'editor.foreground': '#BFBDB6',
    'sideBar.background': '#0B0E14',
    'sideBar.foreground': '#BFBDB6',
    descriptionForeground: '#5c6773',
    'list.hoverBackground': '#1A1F29',
    'list.activeSelectionBackground': '#1A1F29',
    'gitDecoration.addedResourceForeground': '#7FD962',
    'gitDecoration.modifiedResourceForeground': '#73B8FF',
    'gitDecoration.deletedResourceForeground': '#F26D78',
  },
};

// Catppuccin: ships list.focusOutline=#00000000 (fully transparent) but a good
// opaque focusBorder — exercises the transparent-outline rejection, which must
// fall through to focusBorder.
export const catppuccin: ThemeLike = {
  name: 'Catppuccin Mocha',
  type: 'dark',
  fg: '#CDD6F4',
  bg: '#1E1E2E',
  colors: {
    'editor.background': '#1E1E2E',
    'editor.foreground': '#CDD6F4',
    'sideBar.background': '#181825',
    'sideBar.foreground': '#CDD6F4',
    'list.focusOutline': '#00000000',
    focusBorder: '#B4BEFE',
    'list.hoverBackground': '#313244',
  },
};

// Vesper: a gutter-only git theme. It defines NO gitDecoration.* and NO
// terminal.ansi* keys — only editorGutter.*Background — so the git chain must
// fall all the way through to the gutter tail.
export const vesper: ThemeLike = {
  name: 'Vesper',
  type: 'dark',
  fg: '#FFFFFF',
  bg: '#101010',
  colors: {
    'editor.background': '#101010',
    'editor.foreground': '#FFFFFF',
    'sideBar.background': '#101010',
    'sideBar.foreground': '#A0A0A0',
    'editorGutter.addedBackground': '#15ABA0',
    'editorGutter.modifiedBackground': '#A0A0A0',
    'editorGutter.deletedBackground': '#FF8080',
  },
};

export const ALL_FIXTURES: Record<string, ThemeLike> = {
  slackOchin,
  materialThemeOcean,
  auroraX,
  ayuDark,
  catppuccin,
  vesper,
};
