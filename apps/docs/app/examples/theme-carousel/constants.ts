import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

export const THEMES = [
  {
    name: 'pierre-dark',
    label: 'Pierre Dark',
    type: 'dark' as const,
    bg: '#070707',
  },
  {
    name: 'pierre-light',
    label: 'Pierre Light',
    type: 'light' as const,
    bg: '#ffffff',
  },
  {
    name: 'github-dark',
    label: 'GitHub Dark',
    type: 'dark' as const,
    bg: '#0d1117',
  },
  {
    name: 'github-light',
    label: 'GitHub Light',
    type: 'light' as const,
    bg: '#ffffff',
  },
  { name: 'dracula', label: 'Dracula', type: 'dark' as const, bg: '#282a36' },
  { name: 'nord', label: 'Nord', type: 'dark' as const, bg: '#2e3440' },
  {
    name: 'one-dark-pro',
    label: 'One Dark Pro',
    type: 'dark' as const,
    bg: '#282c34',
  },
  {
    name: 'vitesse-dark',
    label: 'Vitesse Dark',
    type: 'dark' as const,
    bg: '#121212',
  },
  {
    name: 'vitesse-light',
    label: 'Vitesse Light',
    type: 'light' as const,
    bg: '#ffffff',
  },
  {
    name: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    type: 'dark' as const,
    bg: '#1e1e2e',
  },
  {
    name: 'catppuccin-latte',
    label: 'Catppuccin Latte',
    type: 'light' as const,
    bg: '#eff1f5',
  },
  {
    name: 'tokyo-night',
    label: 'Tokyo Night',
    type: 'dark' as const,
    bg: '#1a1b26',
  },
] as const;

const OLD_FILE: FileContents = {
  name: 'theme-demo.tsx',
  contents: `import { useState } from 'react';

function Counter() {
  const [count, setCount] = useState(0);

  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(c => c + 1)}>
        Increment
      </button>
    </div>
  );
}
`,
};

const NEW_FILE: FileContents = {
  name: 'theme-demo.tsx',
  contents: `import { useState, useCallback } from 'react';

interface CounterProps {
  initial?: number;
  step?: number;
}

function Counter({ initial = 0, step = 1 }: CounterProps) {
  const [count, setCount] = useState(initial);

  const increment = useCallback(() => {
    setCount(c => c + step);
  }, [step]);

  const decrement = useCallback(() => {
    setCount(c => c - step);
  }, [step]);

  return (
    <div className="counter">
      <p>Count: {count}</p>
      <div className="buttons">
        <button onClick={decrement}>-</button>
        <button onClick={increment}>+</button>
      </div>
    </div>
  );
}
`,
};

export const THEME_CAROUSEL_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(OLD_FILE, NEW_FILE),
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    disableFileHeader: true,
    unsafeCSS: CustomScrollbarCSS,
  },
};
