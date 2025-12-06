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
  file2: {
    name: 'file2.js',
    contents: `function calculateTotal(items) {
  const total = items.reduce((sum, item) => {
    return sum + item.price;
  }, 0);
  return total;
}

export default calculateTotal;`,
  },
};

export const mockDiffs = {
  diffRowBufferTest: {
    oldFile: {
      name: 'file.tsx',
      contents: `import * as 'react';
import IconSprite from './IconSprite';
import Header from './Header';

export default function Home() {
  return (
    <div>
      <Header />
      <IconSprite />
    </div>
  );
}
`,
    },
    newFile: {
      name: 'file.tsx',
      contents: `import IconSprite from './IconSprite';
import HeaderSimple from '../components/HeaderSimple';
import Hero from '../components/Hero';

export default function Home() {
  return (
    <div>
      <HeaderSimple />
      <IconSprite />
      <h1>Hello!</h1>
    </div>
  );
}
`,
    },
    options: {
      diffStyle: 'split',
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
    },
  },
} as const;
