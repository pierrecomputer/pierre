import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import type { PreloadMultiFileDiffOptions } from '@pierre/diffs/ssr';

export const SHIKI_THEMES: PreloadMultiFileDiffOptions<undefined> = {
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
    unsafeCSS: CustomScrollbarCSS,
  },
};
