import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export const PACKAGE_MANAGERS = ['npm', 'bun', 'pnpm', 'yarn'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const INSTALL_COMMANDS: Record<PackageManager, string> = {
  npm: 'npm install @pierre/diffs',
  bun: 'bun add @pierre/diffs',
  pnpm: 'pnpm add @pierre/diffs',
  yarn: 'yarn add @pierre/diffs',
};

export const INSTALLATION_EXAMPLES: Record<
  PackageManager,
  PreloadFileOptions<undefined>
> = Object.fromEntries(
  PACKAGE_MANAGERS.map((pm) => [
    pm,
    {
      file: {
        name: `${pm}.sh`,
        contents: INSTALL_COMMANDS[pm],
      },
      options: {
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        disableFileHeader: true,
        unsafeCSS: CustomScrollbarCSS,
      },
    },
  ])
) as Record<PackageManager, PreloadFileOptions<undefined>>;
