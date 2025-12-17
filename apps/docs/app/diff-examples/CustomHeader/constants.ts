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
  name: 'Button.tsx',
  contents: `import { forwardRef } from 'react';

interface ButtonProps {
  variant?: 'primary' | 'secondary';
  children: React.ReactNode;
  onClick?: () => void;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', children, onClick }, ref) => {
    return (
      <button
        ref={ref}
        className={\`btn btn-\${variant}\`}
        onClick={onClick}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
`,
};

const FULL_CUSTOM_NEW_FILE: FileContents = {
  name: 'Button.tsx',
  contents: `import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface ButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  children: React.ReactNode;
  onClick?: () => void;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', disabled, children, onClick }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'btn',
          \`btn-\${variant}\`,
          \`btn-\${size}\`,
          disabled && 'btn-disabled'
        )}
        onClick={onClick}
        disabled={disabled}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
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
