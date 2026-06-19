import type { DiffIndicators } from '@pierre/diffs';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readBrowserStorageKey,
  writeBrowserStorageKey,
} from './browserStorage';

export type DiffsHubCollapseMode = 'expanded' | 'collapsed';
export type DiffsHubCodeFont =
  | {
      kind: 'default';
    }
  | {
      input?: string;
      kind: 'system';
    }
  | {
      family: string;
      input?: string;
      kind: 'custom';
    };
export type DiffsHubDiffStyle = 'split' | 'unified';
export type DiffsHubOverflow = 'wrap' | 'scroll';

export interface DiffsHubCodeFontOption {
  fontFamily: string;
  label: string;
  value: 'default';
}

export interface DiffsHubDisplayPreferences {
  collapseMode: DiffsHubCollapseMode;
  codeFont: DiffsHubCodeFont;
  diffIndicators: DiffIndicators;
  diffStyle: DiffsHubDiffStyle;
  lineNumbers: boolean;
  overflow: DiffsHubOverflow;
  showBackgrounds: boolean;
}

export const DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES = {
  collapseMode: 'expanded',
  codeFont: {
    kind: 'default',
  },
  diffIndicators: 'bars',
  diffStyle: 'split',
  lineNumbers: true,
  overflow: 'scroll',
  showBackgrounds: true,
} satisfies DiffsHubDisplayPreferences;

const DEFAULT_CODE_FONT_FAMILY = 'var(--font-berkeley-mono)';
const SYSTEM_CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const CUSTOM_CODE_FONT_FALLBACK = `${DEFAULT_CODE_FONT_FAMILY}, ${SYSTEM_CODE_FONT_FAMILY}`;
const MAX_CUSTOM_CODE_FONT_LENGTH = 80;
const SYSTEM_MONO_ALIASES = [
  'monospace',
  'system',
  'system mono',
  'system monospace',
  'ui monospace',
] satisfies readonly string[];
const SYSTEM_MONO_ALIAS_KEYS = new Set(
  SYSTEM_MONO_ALIASES.flatMap((alias) => [
    normalizeFontQuery(alias),
    compactFontKey(alias),
  ])
);

interface KnownInstalledCodeFont {
  aliases: readonly string[];
  family: string;
}

const KNOWN_INSTALLED_CODE_FONTS = [
  {
    aliases: [
      'jetbrains',
      'jetbrains mono',
      'jetbrains-mono',
      'jetbrainsmono',
      'jb mono',
      'jbmono',
    ],
    family: 'JetBrains Mono',
  },
  {
    aliases: ['fira', 'fira code', 'fira-code', 'firacode'],
    family: 'Fira Code',
  },
  {
    aliases: ['cascadia', 'cascadia code', 'cascadia-code', 'cascadiacode'],
    family: 'Cascadia Code',
  },
  {
    aliases: [
      'ibm plex',
      'ibm plex mono',
      'ibmplexmono',
      'plex mono',
      'plexmono',
    ],
    family: 'IBM Plex Mono',
  },
  {
    aliases: [
      'adobe source code pro',
      'source code pro',
      'source-code-pro',
      'sourcecodepro',
    ],
    family: 'Source Code Pro',
  },
  {
    aliases: ['roboto mono', 'roboto-mono', 'robotomono'],
    family: 'Roboto Mono',
  },
  {
    aliases: ['sf mono', 'sf-mono', 'sfmono'],
    family: 'SF Mono',
  },
] satisfies readonly KnownInstalledCodeFont[];
const FONT_ALIAS_INDEX = buildFontAliasIndex(KNOWN_INSTALLED_CODE_FONTS);

export const DIFFS_HUB_CODE_FONT_OPTIONS = [
  {
    fontFamily: DEFAULT_CODE_FONT_FAMILY,
    label: 'Default',
    value: 'default',
  },
] satisfies readonly DiffsHubCodeFontOption[];

const COLLAPSE_MODE_VALUES = [
  'expanded',
  'collapsed',
] satisfies readonly DiffsHubCollapseMode[];
const DIFF_INDICATOR_VALUES = [
  'bars',
  'classic',
  'none',
] satisfies readonly DiffIndicators[];
const DIFF_STYLE_VALUES = [
  'split',
  'unified',
] satisfies readonly DiffsHubDiffStyle[];
const OVERFLOW_VALUES = [
  'wrap',
  'scroll',
] satisfies readonly DiffsHubOverflow[];

const DISPLAY_PREFERENCES_STORAGE_KEY = 'diffshub.displayPreferences.v1';
const DISPLAY_PREFERENCES_STORAGE_VERSION = 1;

interface StoredDisplayPreferences {
  preferences: DiffsHubDisplayPreferences;
  version: typeof DISPLAY_PREFERENCES_STORAGE_VERSION;
}

interface UseDiffsHubDisplayPreferencesResult {
  displayPreferences: DiffsHubDisplayPreferences;
  displayPreferencesHydrated: boolean;
  updateDisplayPreferences(
    update: (previous: DiffsHubDisplayPreferences) => DiffsHubDisplayPreferences
  ): void;
}

export function useDiffsHubDisplayPreferences(): UseDiffsHubDisplayPreferencesResult {
  const [displayPreferences, setDisplayPreferences] =
    useState<DiffsHubDisplayPreferences>(DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES);
  const displayPreferencesRef = useRef<DiffsHubDisplayPreferences>(
    DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES
  );
  const [displayPreferencesHydrated, setDisplayPreferencesHydrated] =
    useState(false);

  useEffect(() => {
    const storedPreferences = readDiffsHubDisplayPreferences();
    displayPreferencesRef.current = storedPreferences;
    setDisplayPreferences(storedPreferences);
    setDisplayPreferencesHydrated(true);
  }, []);

  const updateDisplayPreferences = useCallback(
    (
      update: (
        previous: DiffsHubDisplayPreferences
      ) => DiffsHubDisplayPreferences
    ) => {
      const next = update(displayPreferencesRef.current);
      displayPreferencesRef.current = next;
      setDisplayPreferences(next);
      writeDiffsHubDisplayPreferences(next);
    },
    []
  );

  return {
    displayPreferences,
    displayPreferencesHydrated,
    updateDisplayPreferences,
  };
}

export function readDiffsHubDisplayPreferences(): DiffsHubDisplayPreferences {
  const rawValue = readBrowserStorageKey(DISPLAY_PREFERENCES_STORAGE_KEY);
  if (rawValue == null) {
    return DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES;
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(rawValue);
  } catch {
    return DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES;
  }

  return parseStoredDisplayPreferences(parsedValue);
}

export function writeDiffsHubDisplayPreferences(
  preferences: DiffsHubDisplayPreferences
): void {
  const storedPreferences = {
    preferences,
    version: DISPLAY_PREFERENCES_STORAGE_VERSION,
  } satisfies StoredDisplayPreferences;

  writeBrowserStorageKey(
    DISPLAY_PREFERENCES_STORAGE_KEY,
    JSON.stringify(storedPreferences)
  );
}

export function getDiffsHubCodeFontFamily(font: DiffsHubCodeFont): string {
  switch (font.kind) {
    case 'default':
      return DEFAULT_CODE_FONT_FAMILY;
    case 'system':
      return SYSTEM_CODE_FONT_FAMILY;
    case 'custom':
      return (
        getCustomCodeFontFamilyName(font.family) ??
        getDiffsHubCodeFontFamily(
          DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.codeFont
        )
      );
  }
}

export function getCustomCodeFontFamily(family: string): string | null {
  const resolvedFont = resolveCodeFontInput(family);
  if (resolvedFont == null) {
    return null;
  }

  return resolvedFont.kind === 'custom'
    ? getCustomCodeFontFamilyName(resolvedFont.family)
    : getDiffsHubCodeFontFamily(resolvedFont);
}

export function resolveCustomCodeFontFamilyName(input: string): string | null {
  const resolvedFont = resolveCodeFontInput(input);
  return resolvedFont?.kind === 'custom' ? resolvedFont.family : null;
}

export function resolveCodeFontInput(input: string): DiffsHubCodeFont | null {
  const cleanedInput = cleanCustomCodeFontFamilyInput(input);
  if (cleanedInput == null) {
    return null;
  }

  const normalizedInput = normalizeFontQuery(cleanedInput);
  const compactInput = compactFontKey(cleanedInput);
  if (
    SYSTEM_MONO_ALIAS_KEYS.has(normalizedInput) ||
    SYSTEM_MONO_ALIAS_KEYS.has(compactInput)
  ) {
    return {
      input,
      kind: 'system',
    };
  }

  const knownFont =
    FONT_ALIAS_INDEX.get(normalizedInput) ?? FONT_ALIAS_INDEX.get(compactInput);
  return {
    family: knownFont?.family ?? cleanedInput,
    input,
    kind: 'custom',
  };
}

export function isDiffsHubDefaultCodeFont(value: string): value is 'default' {
  return value === 'default';
}

function parseStoredDisplayPreferences(
  value: unknown
): DiffsHubDisplayPreferences {
  if (
    getObjectProperty(value, 'version') !== DISPLAY_PREFERENCES_STORAGE_VERSION
  ) {
    return DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES;
  }

  return parseDisplayPreferences(getObjectProperty(value, 'preferences'));
}

function parseDisplayPreferences(value: unknown): DiffsHubDisplayPreferences {
  return {
    collapseMode: parseStringChoice(
      getObjectProperty(value, 'collapseMode'),
      COLLAPSE_MODE_VALUES,
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.collapseMode
    ),
    codeFont: parseCodeFont(
      getObjectProperty(value, 'codeFont'),
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.codeFont
    ),
    diffIndicators: parseStringChoice(
      getObjectProperty(value, 'diffIndicators'),
      DIFF_INDICATOR_VALUES,
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.diffIndicators
    ),
    diffStyle: parseStringChoice(
      getObjectProperty(value, 'diffStyle'),
      DIFF_STYLE_VALUES,
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.diffStyle
    ),
    lineNumbers: parseBoolean(
      getObjectProperty(value, 'lineNumbers'),
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.lineNumbers
    ),
    overflow: parseStringChoice(
      getObjectProperty(value, 'overflow'),
      OVERFLOW_VALUES,
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.overflow
    ),
    showBackgrounds: parseBoolean(
      getObjectProperty(value, 'showBackgrounds'),
      DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.showBackgrounds
    ),
  };
}

function parseStringChoice<Value extends string>(
  value: unknown,
  choices: readonly Value[],
  fallback: Value
): Value {
  if (typeof value !== 'string') {
    return fallback;
  }

  for (const choice of choices) {
    if (choice === value) {
      return choice;
    }
  }

  return fallback;
}

function parseCodeFont(
  value: unknown,
  fallback: DiffsHubCodeFont
): DiffsHubCodeFont {
  const kind = getObjectProperty(value, 'kind');
  if (kind === 'default') {
    return {
      kind: 'default',
    };
  }

  if (kind === 'system') {
    const input = cleanCustomCodeFontFamilyInput(
      getObjectProperty(value, 'input')
    );
    return input == null
      ? {
          kind: 'system',
        }
      : {
          input,
          kind: 'system',
        };
  }

  if (kind === 'preset') {
    const presetValue = getObjectProperty(value, 'value');
    return presetValue === 'default' ? { kind: 'default' } : fallback;
  }

  if (kind === 'custom') {
    const customInput =
      cleanCustomCodeFontFamilyInput(getObjectProperty(value, 'input')) ??
      cleanCustomCodeFontFamilyInput(getObjectProperty(value, 'family'));
    if (customInput != null) {
      return resolveCodeFontInput(customInput) ?? fallback;
    }
  }

  return fallback;
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function getObjectProperty(value: unknown, property: string): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return Object.getOwnPropertyDescriptor(value, property)?.value;
}

function cleanCustomCodeFontFamilyInput(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const unquotedValue = removeWrappingQuotes(
    removeControlCharacters(value.normalize('NFKC')).trim()
  );
  const cleanedValue = unquotedValue.replaceAll(/\s+/g, ' ').trim();

  if (
    cleanedValue.length === 0 ||
    cleanedValue.length > MAX_CUSTOM_CODE_FONT_LENGTH ||
    cleanedValue.includes(',')
  ) {
    return null;
  }

  return cleanedValue;
}

function getCustomCodeFontFamilyName(family: string): string | null {
  const fontFamilyName = cleanCustomCodeFontFamilyInput(family);
  if (fontFamilyName == null) {
    return null;
  }

  return `${quoteCSSString(fontFamilyName)}, ${CUSTOM_CODE_FONT_FALLBACK}`;
}

function buildFontAliasIndex(
  fonts: readonly KnownInstalledCodeFont[]
): ReadonlyMap<string, KnownInstalledCodeFont> {
  const index = new Map<string, KnownInstalledCodeFont>();
  for (const font of fonts) {
    indexFontAlias(index, font, font.family);
    for (const alias of font.aliases) {
      indexFontAlias(index, font, alias);
    }
  }
  return index;
}

function indexFontAlias(
  index: Map<string, KnownInstalledCodeFont>,
  font: KnownInstalledCodeFont,
  alias: string
): void {
  for (const key of [normalizeFontQuery(alias), compactFontKey(alias)]) {
    if (key.length === 0) {
      continue;
    }

    const existing = index.get(key);
    if (existing != null && existing.family !== font.family) {
      throw new Error(
        `Font alias collision for "${key}": "${existing.family}" and "${font.family}"`
      );
    }
    index.set(key, font);
  }
}

function normalizeFontQuery(value: string): string {
  return value
    .normalize('NFKC')
    .replaceAll(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replaceAll(/['’]/g, '')
    .replaceAll(/[^a-z0-9]+/g, ' ')
    .trim()
    .replaceAll(/\s+/g, ' ');
}

function compactFontKey(value: string): string {
  return normalizeFontQuery(value).replaceAll(/\s+/g, '');
}

function removeWrappingQuotes(value: string): string {
  if (value.length < 2) {
    return value;
  }

  const firstCharacter = value[0];
  const lastCharacter = value.at(-1);
  if (
    (firstCharacter === '"' && lastCharacter === '"') ||
    (firstCharacter === "'" && lastCharacter === "'")
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function quoteCSSString(value: string): string {
  return `"${value.replaceAll(/["\\]/g, '\\$&')}"`;
}

function removeControlCharacters(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code > 0x1f && code !== 0x7f) {
      result += character;
    }
  }
  return result;
}
