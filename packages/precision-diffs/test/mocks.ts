import type { FileContents } from '../src/types';

export const mockFiles: Record<string, FileContents> = {
  file1: {
    name: 'file1.ts',
    contents: `import type { PJSThemeNames, ThemesType } from '../types';

export function areThemesEqual(
  themeA: PJSThemeNames | ThemesType | undefined,
  themeB: PJSThemeNames | ThemesType | undefined
): boolean {
  if (
    themeA == null ||
    themeB == null ||
    typeof themeA === 'string' ||
    typeof themeB === 'string'
  ) {
    return themeA === themeB;
  }
  return themeA.dark === themeB.dark && themeA.light === themeB.light;
}`,
  },
};
