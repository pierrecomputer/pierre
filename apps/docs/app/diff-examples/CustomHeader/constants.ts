import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type {
  PreloadFileDiffOptions,
  PreloadMultiFileDiffOptions,
} from '@pierre/diffs/ssr';

export const CUSTOM_HEADER_EXAMPLE: PreloadMultiFileDiffOptions<undefined> = {
  oldFile: {
    name: 'config.ts',
    contents: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
`,
  },
  newFile: {
    name: 'config.ts',
    contents: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
    },
  },
  server: {
    port: 3000,
    open: true,
    cors: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'terser',
  },
});
`,
  },
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'dark',
    diffStyle: 'split',
    disableBackground: false,
    unsafeCSS: CustomScrollbarCSS,
  },
};

const FULL_CUSTOM_OLD_FILE: FileContents = {
  name: 'utils.ts',
  contents: `// String utilities
export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, maxLength: number): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength) + '...';
}

// Array utilities
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

export function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

// Object utilities
export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
`,
};

const FULL_CUSTOM_NEW_FILE: FileContents = {
  name: 'utils.ts',
  contents: `// String utilities
export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function truncate(str: string, max: number, ellipsis = '…'): string {
  if (str.length <= max) return str;
  return str.slice(0, max) + ellipsis;
}

// Array utilities
export function unique<T>(array: T[]): T[] {
  return [...new Set(array)];
}

// Object utilities
export function pick<T, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> {
  const result = {} as Pick<T, K>;
  for (const key of keys) {
    result[key] = obj[key];
  }
  return result;
}

export function deepClone<T>(obj: T): T {
  return structuredClone(obj);
}
`,
};

export const FULL_CUSTOM_HEADER_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(FULL_CUSTOM_OLD_FILE, FULL_CUSTOM_NEW_FILE),
  options: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    themeType: 'dark',
    diffStyle: 'unified',
    disableFileHeader: true,
    unsafeCSS: CustomScrollbarCSS,
  },
};
