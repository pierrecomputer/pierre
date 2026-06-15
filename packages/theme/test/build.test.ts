/**
 * Guards the build *output* rather than theme design. After `theme:build` writes
 * themes/*.json, this checks each expected file exists and carries the right
 * metadata — catching build-step regressions (a missing, empty, or misnamed file).
 */
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

type GeneratedFile = {
  path: string;
  expectedType: 'light' | 'dark';
  expectedName: string;
  expectedDisplayName: string;
};

type GeneratedTheme = {
  name?: unknown;
  displayName?: unknown;
  type?: unknown;
  colors?: unknown;
  tokenColors?: unknown;
};

const GENERATED_FILES: GeneratedFile[] = [
  {
    path: 'themes/pierre-light.json',
    expectedType: 'light',
    expectedName: 'pierre-light',
    expectedDisplayName: 'Pierre Light',
  },
  {
    path: 'themes/pierre-light-protanopia-deuteranopia.json',
    expectedType: 'light',
    expectedName: 'pierre-light-protanopia-deuteranopia',
    expectedDisplayName: 'Pierre Light Protanopia & Deuteranopia',
  },
  {
    path: 'themes/pierre-light-soft.json',
    expectedType: 'light',
    expectedName: 'pierre-light-soft',
    expectedDisplayName: 'Pierre Light Soft',
  },
  {
    path: 'themes/pierre-light-tritanopia.json',
    expectedType: 'light',
    expectedName: 'pierre-light-tritanopia',
    expectedDisplayName: 'Pierre Light Tritanopia',
  },
  {
    path: 'themes/pierre-light-vibrant.json',
    expectedType: 'light',
    expectedName: 'pierre-light-vibrant',
    expectedDisplayName: 'Pierre Light Vibrant',
  },
  {
    path: 'themes/pierre-dark.json',
    expectedType: 'dark',
    expectedName: 'pierre-dark',
    expectedDisplayName: 'Pierre Dark',
  },
  {
    path: 'themes/pierre-dark-protanopia-deuteranopia.json',
    expectedType: 'dark',
    expectedName: 'pierre-dark-protanopia-deuteranopia',
    expectedDisplayName: 'Pierre Dark Protanopia & Deuteranopia',
  },
  {
    path: 'themes/pierre-dark-soft.json',
    expectedType: 'dark',
    expectedName: 'pierre-dark-soft',
    expectedDisplayName: 'Pierre Dark Soft',
  },
  {
    path: 'themes/pierre-dark-tritanopia.json',
    expectedType: 'dark',
    expectedName: 'pierre-dark-tritanopia',
    expectedDisplayName: 'Pierre Dark Tritanopia',
  },
  {
    path: 'themes/pierre-dark-vibrant.json',
    expectedType: 'dark',
    expectedName: 'pierre-dark-vibrant',
    expectedDisplayName: 'Pierre Dark Vibrant',
  },
];

describe('generated theme files', () => {
  for (const file of GENERATED_FILES) {
    describe(file.path, () => {
      test('exists', () => {
        assert.ok(existsSync(file.path), `file does not exist: ${file.path}`);
      });

      test('is non-empty, valid JSON with the expected metadata', () => {
        const content = readFileSync(file.path, 'utf8');
        assert.notEqual(content.trim(), '', `file is empty: ${file.path}`);

        const theme = JSON.parse(content) as GeneratedTheme;

        assert.equal(typeof theme.name, 'string', `${file.path}: missing name`);
        assert.equal(
          typeof theme.displayName,
          'string',
          `${file.path}: missing displayName`
        );
        assert.equal(
          theme.name,
          file.expectedName,
          `${file.path}: unexpected name`
        );
        assert.equal(
          theme.displayName,
          file.expectedDisplayName,
          `${file.path}: unexpected displayName`
        );
        assert.equal(typeof theme.type, 'string', `${file.path}: missing type`);
        assert.equal(
          theme.type,
          file.expectedType,
          `${file.path}: unexpected type`
        );
        assert.ok(
          theme.colors !== null &&
            typeof theme.colors === 'object' &&
            Object.keys(theme.colors).length > 0,
          `${file.path}: missing or empty colors object`
        );
        assert.ok(
          Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0,
          `${file.path}: missing or empty tokenColors array`
        );
      });
    });
  }

  test('base themes are large enough to contain full color and token definitions', () => {
    const lightSize = readFileSync('themes/pierre-light.json', 'utf8').length;
    const darkSize = readFileSync('themes/pierre-dark.json', 'utf8').length;

    assert.ok(
      lightSize >= 10_000,
      `pierre-light.json seems too small (${lightSize} bytes)`
    );
    assert.ok(
      darkSize >= 10_000,
      `pierre-dark.json seems too small (${darkSize} bytes)`
    );
  });
});

describe('generated ESM wrapper modules', () => {
  for (const file of GENERATED_FILES) {
    test(`${file.expectedName}.mjs exists`, () => {
      assert.ok(
        existsSync(`dist/${file.expectedName}.mjs`),
        `file does not exist: dist/${file.expectedName}.mjs`
      );
    });
  }

  test('index module exists', () => {
    assert.ok(
      existsSync('dist/index.mjs'),
      'file does not exist: dist/index.mjs'
    );
  });
});

describe('generated Zed theme files', () => {
  test('theme family exists', () => {
    assert.ok(
      existsSync('zed/themes/pierre.json'),
      'file does not exist: zed/themes/pierre.json'
    );
  });
});
