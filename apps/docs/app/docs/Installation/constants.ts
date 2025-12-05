import type { PreloadFileOptions } from '@pierre/precision-diffs/ssr';

export const PACKAGE_MANAGERS = ['npm', 'bun', 'pnpm', 'yarn'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const INSTALL_COMMANDS: Record<PackageManager, string> = {
  npm: 'npm install @pierre/precision-diffs',
  bun: 'bun add @pierre/precision-diffs',
  pnpm: 'pnpm add @pierre/precision-diffs',
  yarn: 'yarn add @pierre/precision-diffs',
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
      },
    },
  ])
) as Record<PackageManager, PreloadFileOptions<undefined>>;
