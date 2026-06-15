/**
 * Structural validation for the themes: it proves that createTheme produces
 * well-formed VS Code themes and that the palette role tables are valid hex.
 */
import { afterAll, describe, test } from 'bun:test';
import assert from 'node:assert/strict';

import { convertRolesToP3 } from '../src/color';
import { createTheme } from '../src/createTheme';
import {
  type Roles,
  dark as rolesDark,
  darkSoft as rolesDarkSoft,
  light as rolesLight,
  lightSoft as rolesLightSoft,
  protanDeutanDark as rolesProtanDeutanDark,
  protanDeutanLight as rolesProtanDeutanLight,
  tritanopiaDark as rolesTritanopiaDark,
  tritanopiaLight as rolesTritanopiaLight,
} from '../src/roles';

// ── Color-string validators (shared across the theme / token / semantic checks) ──
function isValidHexColor(color: string): boolean {
  // Match #RGB, #RRGGBB, #RRGGBBAA formats
  return /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/.test(color);
}

function isValidColor(color: string): boolean {
  // Hex, or a Display-P3 color() — color(display-p3 r g b) with optional / alpha.
  return (
    isValidHexColor(color) ||
    /^color\(display-p3\s+[\d.]+\s+[\d.]+\s+[\d.]+(\s+\/\s+[\d.]+)?\)$/.test(
      color
    )
  );
}

// Every color string the suite touches — surfaced as a diagnostic at the end so
// the palette's breadth stays visible (the old runner printed this total).
const usedColors = new Set<string>();

// ── Palette roles ─────────────────────────────────────────────────────────────
const REQUIRED_ROLE_CATEGORIES = [
  'bg',
  'fg',
  'border',
  'accent',
  'states',
  'syntax',
  'ansi',
];

const ROLE_SETS: [string, Roles][] = [
  ['dark', rolesDark],
  ['light', rolesLight],
  ['darkSoft', rolesDarkSoft],
  ['lightSoft', rolesLightSoft],
  ['protanDeutanDark', rolesProtanDeutanDark],
  ['protanDeutanLight', rolesProtanDeutanLight],
  ['tritanopiaDark', rolesTritanopiaDark],
  ['tritanopiaLight', rolesTritanopiaLight],
];

describe('palette roles', () => {
  for (const [name, roles] of ROLE_SETS) {
    describe(name, () => {
      test('defines every required role category', () => {
        for (const category of REQUIRED_ROLE_CATEGORIES) {
          assert.ok(
            (roles as Record<string, unknown>)[category] !== undefined,
            `${name}: missing "${category}" category`
          );
        }
      });

      test('uses only valid hex colors', () => {
        // Collect every role-table path whose value is not valid hex. Role tables
        // are authored in hex; P3 conversion happens later, at build time.
        const issues: string[] = [];
        const collectRoleHexIssues = (obj: unknown, path: string) => {
          for (const [key, value] of Object.entries(
            obj as Record<string, unknown>
          )) {
            const fullPath = `${path}.${key}`;
            if (typeof value === 'string') {
              if (!isValidHexColor(value))
                issues.push(`${fullPath}: invalid color "${value}"`);
            } else if (value !== null && typeof value === 'object') {
              collectRoleHexIssues(value, fullPath);
            }
          }
        };
        collectRoleHexIssues(roles, name);
        assert.deepEqual(issues, [], issues.join('\n'));
      });
    });
  }
});

// ── Theme generation ──────────────────────────────────────────────────────────
const CRITICAL_COLORS = [
  'editor.background',
  'editor.foreground',
  'foreground',
  'focusBorder',
  'sideBar.background',
  'activityBar.background',
  'statusBar.background',
];

type ThemeVariant = {
  name: string;
  displayName: string;
  type: 'light' | 'dark';
  roles: Roles;
};

// CVD distinguishability is handled by the gate in cvd.test.ts; here we only
// validate the structure of each generated light/dark variant.
const THEME_VARIANTS: ThemeVariant[] = [
  {
    name: 'pierre-dark',
    displayName: 'Pierre Dark',
    type: 'dark',
    roles: rolesDark,
  },
  {
    name: 'pierre-dark-soft',
    displayName: 'Pierre Dark Soft',
    type: 'dark',
    roles: rolesDarkSoft,
  },
  {
    name: 'pierre-dark-protanopia-deuteranopia',
    displayName: 'Pierre Dark Protanopia & Deuteranopia',
    type: 'dark',
    roles: rolesProtanDeutanDark,
  },
  {
    name: 'pierre-dark-tritanopia',
    displayName: 'Pierre Dark Tritanopia',
    type: 'dark',
    roles: rolesTritanopiaDark,
  },
  {
    name: 'pierre-dark-vibrant',
    displayName: 'Pierre Dark Vibrant',
    type: 'dark',
    roles: convertRolesToP3(rolesDark),
  },
  {
    name: 'pierre-light',
    displayName: 'Pierre Light',
    type: 'light',
    roles: rolesLight,
  },
  {
    name: 'pierre-light-soft',
    displayName: 'Pierre Light Soft',
    type: 'light',
    roles: rolesLightSoft,
  },
  {
    name: 'pierre-light-protanopia-deuteranopia',
    displayName: 'Pierre Light Protanopia & Deuteranopia',
    type: 'light',
    roles: rolesProtanDeutanLight,
  },
  {
    name: 'pierre-light-tritanopia',
    displayName: 'Pierre Light Tritanopia',
    type: 'light',
    roles: rolesTritanopiaLight,
  },
  {
    name: 'pierre-light-vibrant',
    displayName: 'Pierre Light Vibrant',
    type: 'light',
    roles: convertRolesToP3(rolesLight),
  },
];

describe('theme generation', () => {
  for (const variant of THEME_VARIANTS) {
    describe(variant.displayName, () => {
      const theme = createTheme({
        name: variant.name,
        displayName: variant.displayName,
        type: variant.type,
        roles: variant.roles,
      });

      test('has the required top-level properties', () => {
        assert.notEqual(theme.name, '', 'missing theme name');
        assert.notEqual(theme.displayName, '', 'missing theme displayName');
        assert.notEqual(theme.type, '', 'missing theme type');
        assert.ok(
          Object.keys(theme.colors).length > 0,
          'missing colors object'
        );
        assert.ok(theme.tokenColors.length > 0, 'missing tokenColors array');
        assert.ok(
          Object.keys(theme.semanticTokenColors).length > 0,
          'missing semanticTokenColors object'
        );
      });

      test('uses the expected package-safe name and display label', () => {
        assert.equal(theme.name, variant.name);
        assert.equal(theme.displayName, variant.displayName);
      });

      test(`has type "${variant.type}"`, () => {
        assert.equal(theme.type, variant.type);
      });

      test('defines the critical editor colors', () => {
        for (const key of CRITICAL_COLORS) {
          assert.notEqual(
            theme.colors[key],
            undefined,
            `missing critical color: ${key}`
          );
        }
      });

      test('has only valid color values', () => {
        // Walk the colors tree: record every color string (for the unique-color
        // tally) and flag any malformed #hex / color() value.
        const issues: string[] = [];
        const collectColorIssues = (obj: unknown, path: string) => {
          for (const [key, value] of Object.entries(
            obj as Record<string, unknown>
          )) {
            const currentPath = path !== '' ? `${path}.${key}` : key;
            if (typeof value === 'string') {
              usedColors.add(value);
              if (
                (value.startsWith('#') || value.startsWith('color(')) &&
                !isValidColor(value)
              ) {
                issues.push(`Invalid color at ${currentPath}: ${value}`);
              }
            } else if (value !== null && typeof value === 'object') {
              collectColorIssues(value, currentPath);
            }
          }
        };
        collectColorIssues(theme.colors, '');
        assert.deepEqual(issues, [], issues.join('\n'));
      });

      test('has no undefined or null colors', () => {
        for (const [key, value] of Object.entries(theme.colors)) {
          assert.ok(
            value !== undefined && value !== null,
            `color "${key}" is ${value}`
          );
        }
      });

      test('tokenColors is a non-empty array', () => {
        assert.ok(
          Array.isArray(theme.tokenColors),
          'tokenColors is not an array'
        );
        assert.ok(theme.tokenColors.length > 0, 'tokenColors array is empty');
      });

      test('every tokenColors entry is well-formed', () => {
        theme.tokenColors.forEach((token, idx) => {
          assert.notEqual(
            token.scope,
            undefined,
            `tokenColors[${idx}] missing scope`
          );
          assert.notEqual(
            token.settings,
            undefined,
            `tokenColors[${idx}] missing settings`
          );
          if (token.settings.foreground !== undefined) {
            usedColors.add(token.settings.foreground);
            assert.ok(
              isValidColor(token.settings.foreground),
              `tokenColors[${idx}] has invalid foreground color: ${token.settings.foreground}`
            );
          }
        });
      });

      test('every semanticTokenColors entry is valid', () => {
        for (const [key, value] of Object.entries(theme.semanticTokenColors)) {
          if (typeof value === 'string') {
            usedColors.add(value);
            assert.ok(
              isValidColor(value),
              `semanticTokenColors["${key}"] has invalid color: ${value}`
            );
          } else if (typeof value === 'object' && value !== null) {
            const foreground = (value as { foreground?: string }).foreground;
            if (foreground) {
              usedColors.add(foreground);
              assert.ok(
                isValidColor(foreground),
                `semanticTokenColors["${key}"].foreground has invalid color: ${foreground}`
              );
            }
          }
        }
      });
    });
  }
});

afterAll(() => {
  console.log(`Total unique colors used: ${usedColors.size}`);
});
