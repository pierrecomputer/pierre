import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';
import { type FileContents, parseDiffFromFile } from '@pierre/diffs';
import type { PreloadFileDiffOptions } from '@pierre/diffs/ssr';

const OLD_FILE: FileContents = {
  name: 'config.json',
  contents: `{
  "name": "my-app",
  "version": "1.0.0",
  "description": "A simple application",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "test": "jest"
  },
  "dependencies": {
    "express": "^4.18.0"
  }
}
`,
};

const NEW_FILE: FileContents = {
  name: 'config.json',
  contents: `{
  "name": "my-app",
  "version": "2.0.0",
  "description": "A modern web application",
  "type": "module",
  "main": "src/index.ts",
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": {
    "express": "^4.21.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0"
  }
}
`,
};

export const GIT_BLAME_EXAMPLE: PreloadFileDiffOptions<undefined> = {
  fileDiff: parseDiffFromFile(OLD_FILE, NEW_FILE),
  options: {
    theme: 'pierre-dark',
    diffStyle: 'unified',
    unsafeCSS: CustomScrollbarCSS,
    enableHoverUtility: true,
  },
};
