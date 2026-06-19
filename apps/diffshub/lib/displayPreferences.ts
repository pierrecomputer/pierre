import type { DiffIndicators } from '@pierre/diffs';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  readBrowserStorageKey,
  writeBrowserStorageKey,
} from './browserStorage';

export type DiffsHubCollapseMode = 'expanded' | 'collapsed';
export type DiffsHubDiffStyle = 'split' | 'unified';
export type DiffsHubOverflow = 'wrap' | 'scroll';

export interface DiffsHubDisplayPreferences {
  collapseMode: DiffsHubCollapseMode;
  diffIndicators: DiffIndicators;
  diffStyle: DiffsHubDiffStyle;
  lineNumbers: boolean;
  overflow: DiffsHubOverflow;
  showBackgrounds: boolean;
}

export const DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES = {
  collapseMode: 'expanded',
  diffIndicators: 'bars',
  diffStyle: 'split',
  lineNumbers: true,
  overflow: 'scroll',
  showBackgrounds: true,
} satisfies DiffsHubDisplayPreferences;

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

function parseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function getObjectProperty(value: unknown, property: string): unknown {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return Object.getOwnPropertyDescriptor(value, property)?.value;
}
