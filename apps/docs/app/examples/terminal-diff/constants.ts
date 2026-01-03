import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

const OLD_FILE: FileContents = {
  name: 'package.json',
  contents: `{
  "name": "my-app",
  "version": "1.2.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start"
  },
  "dependencies": {
    "next": "14.0.0",
    "react": "18.2.0"
  }
}
`,
};

const NEW_FILE: FileContents = {
  name: 'package.json',
  contents: `{
  "name": "my-app",
  "version": "1.3.0",
  "scripts": {
    "dev": "next dev --turbo",
    "build": "next build",
    "start": "next start",
    "lint": "next lint"
  },
  "dependencies": {
    "next": "15.0.0",
    "react": "19.0.0"
  }
}
`,
};

export const TERMINAL_DIFF_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(OLD_FILE, NEW_FILE),
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    disableFileHeader: true,
    disableLineNumbers: true,
    diffIndicators: 'classic',
    unsafeCSS: CustomScrollbarCSS,
  },
};
