import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES,
  type DiffsHubDisplayPreferences,
  getCustomCodeFontFamily,
  getDiffsHubCodeFontFamily,
  readDiffsHubDisplayPreferences,
  writeDiffsHubDisplayPreferences,
} from '../displayPreferences';

const STORAGE_KEY = 'diffshub.displayPreferences.v1';
const SYSTEM_CODE_FONT_FAMILY =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const CUSTOM_CODE_FONT_FALLBACK = `var(--font-berkeley-mono), ${SYSTEM_CODE_FONT_FAMILY}`;

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class ThrowingStorage extends MemoryStorage {
  override getItem(): string | null {
    throw new Error('storage unavailable');
  }

  override setItem(): void {
    throw new Error('storage unavailable');
  }
}

describe('DiffsHub display preferences', () => {
  test('falls back to defaults when storage is empty or unavailable', () => {
    withLocalStorage(new MemoryStorage(), () => {
      expect(readDiffsHubDisplayPreferences()).toEqual(
        DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES
      );
    });
    withLocalStorage(new ThrowingStorage(), () => {
      expect(readDiffsHubDisplayPreferences()).toEqual(
        DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES
      );
    });
  });

  test('round-trips validated display preferences', () => {
    const storage = new MemoryStorage();
    const preferences: DiffsHubDisplayPreferences = {
      collapseMode: 'collapsed',
      codeFont: {
        input: 'jetbrains',
        kind: 'custom',
      },
      diffIndicators: 'classic',
      diffStyle: 'unified',
      lineNumbers: false,
      overflow: 'wrap',
      showBackgrounds: false,
    };

    withLocalStorage(storage, () => {
      writeDiffsHubDisplayPreferences(preferences);

      expect(readDiffsHubDisplayPreferences()).toEqual(preferences);
    });
  });

  test('ignores malformed stored preferences per field', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        preferences: {
          collapseMode: 'closed',
          codeFont: {
            kind: 'legacy',
            value: 'system-mono',
          },
          diffIndicators: 'classic',
          diffStyle: 'side-by-side',
          lineNumbers: false,
          overflow: 'wrap',
          showBackgrounds: 'no',
        },
        version: 1,
      })
    );

    withLocalStorage(storage, () => {
      expect(readDiffsHubDisplayPreferences()).toEqual({
        ...DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES,
        diffIndicators: 'classic',
        lineNumbers: false,
        overflow: 'wrap',
      });
    });
  });

  test('ignores incompatible storage versions', () => {
    const storage = new MemoryStorage();
    storage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        preferences: {
          collapseMode: 'collapsed',
          codeFont: {
            input: 'system',
            kind: 'custom',
          },
          diffIndicators: 'none',
          diffStyle: 'unified',
          lineNumbers: false,
          overflow: 'wrap',
          showBackgrounds: false,
        },
        version: 2,
      })
    );

    withLocalStorage(storage, () => {
      expect(readDiffsHubDisplayPreferences()).toEqual(
        DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES
      );
    });
  });

  test('formats custom installed font names as a quoted font-family fallback stack', () => {
    for (const input of [
      'jetbrains',
      'jetbrainsmono',
      'jetbrains mono',
      'jetbrains-mono',
      'JetBrainsMono',
      'JETBRAINS MONO',
    ]) {
      expect(getCustomCodeFontFamily(input)).toBe(
        `"JetBrains Mono", ${CUSTOM_CODE_FONT_FALLBACK}`
      );
    }

    expect(getCustomCodeFontFamily('Vendor "Mono" \\ Preview\n')).toBe(
      `"Vendor \\"Mono\\" \\\\ Preview", ${CUSTOM_CODE_FONT_FALLBACK}`
    );

    expect(getCustomCodeFontFamily('sourcecodepro')).toBe(
      `"Source Code Pro", ${CUSTOM_CODE_FONT_FALLBACK}`
    );

    for (const input of [
      'system',
      'monospace',
      'system mono',
      'system monospace',
      'ui monospace',
    ]) {
      expect(getCustomCodeFontFamily(input)).toBe(SYSTEM_CODE_FONT_FAMILY);
    }

    expect(
      getDiffsHubCodeFontFamily({
        input: 'Commit Mono',
        kind: 'custom',
      })
    ).toBe(`"Commit Mono", ${CUSTOM_CODE_FONT_FALLBACK}`);

    expect(
      getDiffsHubCodeFontFamily({
        input: 'monospace',
        kind: 'custom',
      })
    ).toBe(SYSTEM_CODE_FONT_FAMILY);

    expect(getCustomCodeFontFamily('JetBrains Mono, serif')).toBeNull();
    expect(getCustomCodeFontFamily('x'.repeat(81))).toBeNull();

    expect(
      getDiffsHubCodeFontFamily({
        input: 'JetBrains Mono, serif',
        kind: 'custom',
      })
    ).toBe(
      getDiffsHubCodeFontFamily(DEFAULT_DIFFS_HUB_DISPLAY_PREFERENCES.codeFont)
    );

    expect(getCustomCodeFontFamily('   ')).toBeNull();
  });
});

function withLocalStorage(storage: Storage, callback: () => void): void {
  const descriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    'localStorage'
  );
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });

  try {
    callback();
  } finally {
    if (descriptor == null) {
      Reflect.deleteProperty(globalThis, 'localStorage');
    } else {
      Object.defineProperty(globalThis, 'localStorage', descriptor);
    }
  }
}
