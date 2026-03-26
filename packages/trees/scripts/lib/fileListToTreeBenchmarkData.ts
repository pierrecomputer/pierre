import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  forEachFolderInNormalizedPath,
  normalizeInputPath,
} from '../../src/utils/normalizeInputPath';

export interface FileListShapeSummary {
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
}

export interface FileListToTreeBenchmarkCase extends FileListShapeSummary {
  name: string;
  source: 'synthetic' | 'fixture';
  files: string[];
}

const BENCHMARK_FIXTURE_PATH = resolve(
  import.meta.dir,
  '../fixtures/fileListToTree-monorepo-snapshot.txt'
);
// Cross-package dependency: this fixture lives in apps/docs because the dev
// page also renders it. If that file moves, this path must be updated.
const LINUX_KERNEL_FIXTURE_PATH = resolve(
  import.meta.dir,
  '../../../../apps/docs/app/trees-dev/linux-files.json'
);

interface LinuxKernelFixture {
  files: string[];
  folders: string[];
}

function readFixtureLines(path: string): string[] {
  return readFileSync(path, 'utf-8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

// The docs app already ships this Linux kernel file list, so reusing it keeps
// the benchmark tied to a real workload we exercise elsewhere in the repo.
function readLinuxKernelFixture(path: string): LinuxKernelFixture {
  return JSON.parse(readFileSync(path, 'utf-8')) as LinuxKernelFixture;
}

function pushRepeatedFiles(
  files: string[],
  count: number,
  buildPath: (index: number) => string
): void {
  for (let index = 0; index < count; index++) {
    files.push(buildPath(index));
  }
}

function buildTinyFlatFiles(): string[] {
  const files: string[] = [];
  pushRepeatedFiles(
    files,
    16,
    (index) => `.config-${index.toString().padStart(2, '0')}.json`
  );
  pushRepeatedFiles(
    files,
    112,
    (index) => `file-${index.toString().padStart(3, '0')}.ts`
  );
  return files;
}

function buildSmallMixedFiles(): string[] {
  const files: string[] = [
    'README.md',
    'package.json',
    'tsconfig.json',
    '.gitignore',
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
  ];

  for (let packageIndex = 0; packageIndex < 12; packageIndex++) {
    const packageName = `pkg-${packageIndex.toString().padStart(2, '0')}`;
    files.push(`packages/${packageName}/package.json`);
    files.push(`packages/${packageName}/README.md`);

    for (let featureIndex = 0; featureIndex < 6; featureIndex++) {
      const featureName = `feature-${featureIndex.toString().padStart(2, '0')}`;
      for (let fileIndex = 0; fileIndex < 12; fileIndex++) {
        files.push(
          `packages/${packageName}/src/${featureName}/module-${fileIndex
            .toString()
            .padStart(2, '0')}.ts`
        );
      }
    }
  }

  for (let appIndex = 0; appIndex < 4; appIndex++) {
    const appName = `app-${appIndex.toString().padStart(2, '0')}`;
    for (let routeIndex = 0; routeIndex < 16; routeIndex++) {
      files.push(
        `apps/${appName}/src/routes/route-${routeIndex
          .toString()
          .padStart(2, '0')}.tsx`
      );
    }
  }

  return files;
}

function buildMediumBalancedFiles(): string[] {
  const files: string[] = [];

  for (let workspaceIndex = 0; workspaceIndex < 20; workspaceIndex++) {
    const workspaceName = `workspace-${workspaceIndex
      .toString()
      .padStart(2, '0')}`;

    for (let packageIndex = 0; packageIndex < 10; packageIndex++) {
      const packageName = `package-${packageIndex.toString().padStart(2, '0')}`;

      for (let featureIndex = 0; featureIndex < 5; featureIndex++) {
        const featureName = `feature-${featureIndex.toString().padStart(2, '0')}`;

        for (let fileIndex = 0; fileIndex < 4; fileIndex++) {
          files.push(
            `generated/${workspaceName}/${packageName}/${featureName}/file-${fileIndex
              .toString()
              .padStart(2, '0')}.ts`
          );
        }
      }
    }
  }

  return files;
}

function buildLargeWideFiles(): string[] {
  const files: string[] = [];

  for (let folderIndex = 0; folderIndex < 80; folderIndex++) {
    const folderName = `bucket-${folderIndex.toString().padStart(2, '0')}`;
    for (let fileIndex = 0; fileIndex < 100; fileIndex++) {
      files.push(
        `wide/${folderName}/item-${fileIndex.toString().padStart(3, '0')}.ts`
      );
    }
  }

  return files;
}

function buildLargeDeepChainFiles(): string[] {
  const files: string[] = [];

  for (let chainIndex = 0; chainIndex < 128; chainIndex++) {
    const chainName = `chain-${chainIndex.toString().padStart(3, '0')}`;
    const chainPrefix = Array.from(
      { length: 10 },
      (_, depthIndex) => `level-${depthIndex.toString().padStart(2, '0')}`
    ).join('/');

    for (let fileIndex = 0; fileIndex < 16; fileIndex++) {
      files.push(
        `deep/${chainName}/${chainPrefix}/file-${fileIndex
          .toString()
          .padStart(2, '0')}.ts`
      );
    }
  }

  return files;
}

function buildLargeMonorepoShapedFiles(): string[] {
  const files: string[] = [
    '.github/workflows/ci.yml',
    '.github/workflows/release.yml',
    '.changeset/config.json',
    'README.md',
    'package.json',
    'tsconfig.json',
  ];

  for (let packageIndex = 0; packageIndex < 24; packageIndex++) {
    const packageName = `pkg-${packageIndex.toString().padStart(2, '0')}`;
    files.push(`packages/${packageName}/package.json`);
    files.push(`packages/${packageName}/README.md`);

    for (let layerIndex = 0; layerIndex < 4; layerIndex++) {
      const layerName = `layer-${layerIndex.toString().padStart(2, '0')}`;
      for (let featureIndex = 0; featureIndex < 3; featureIndex++) {
        const featureName = `feature-${featureIndex.toString().padStart(2, '0')}`;
        for (let fileIndex = 0; fileIndex < 4; fileIndex++) {
          files.push(
            `packages/${packageName}/src/${layerName}/${featureName}/file-${fileIndex
              .toString()
              .padStart(2, '0')}.ts`
          );
        }
      }
    }
  }

  for (let appIndex = 0; appIndex < 12; appIndex++) {
    const appName = `app-${appIndex.toString().padStart(2, '0')}`;
    files.push(`apps/${appName}/package.json`);

    for (let routeIndex = 0; routeIndex < 12; routeIndex++) {
      const routeName = `route-${routeIndex.toString().padStart(2, '0')}`;
      for (let fileIndex = 0; fileIndex < 6; fileIndex++) {
        files.push(
          `apps/${appName}/src/routes/${routeName}/view-${fileIndex
            .toString()
            .padStart(2, '0')}.tsx`
        );
      }
    }
  }

  for (let docsIndex = 0; docsIndex < 8; docsIndex++) {
    for (let pageIndex = 0; pageIndex < 40; pageIndex++) {
      files.push(
        `apps/docs/content/section-${docsIndex
          .toString()
          .padStart(2, '0')}/page-${pageIndex.toString().padStart(3, '0')}.mdx`
      );
    }
  }

  return files;
}

function buildExplicitDirectoriesFiles(): string[] {
  const files: string[] = [];

  for (let packageIndex = 0; packageIndex < 32; packageIndex++) {
    const packageName = `pkg-${packageIndex.toString().padStart(2, '0')}`;
    files.push(`packages/${packageName}/src/components/`);
    files.push(`packages/${packageName}/src/utils/`);
    files.push(`packages/${packageName}/src/components/Button.tsx`);
    files.push(`packages/${packageName}/src/utils/helpers.ts`);
  }

  return files;
}

export function describeFileListShape(files: string[]): FileListShapeSummary {
  const uniqueFolders = new Set<string>();
  let fileCount = 0;
  let maxDepth = 0;

  for (const filePath of files) {
    const normalizedPath = normalizeInputPath(filePath);
    if (normalizedPath == null) {
      continue;
    }

    fileCount += 1;
    const depth = normalizedPath.path.split('/').length;
    if (depth > maxDepth) {
      maxDepth = depth;
    }

    forEachFolderInNormalizedPath(
      normalizedPath.path,
      normalizedPath.isDirectory,
      (folderPath) => {
        uniqueFolders.add(folderPath);
      }
    );
  }

  return {
    fileCount,
    uniqueFolderCount: uniqueFolders.size,
    maxDepth,
  };
}

function createCase(
  name: string,
  source: 'synthetic' | 'fixture',
  files: string[]
): FileListToTreeBenchmarkCase {
  return {
    name,
    source,
    files,
    ...describeFileListShape(files),
  };
}

let cachedCases: FileListToTreeBenchmarkCase[] | null = null;

export function getFileListToTreeBenchmarkCases(): FileListToTreeBenchmarkCase[] {
  if (cachedCases != null) {
    return cachedCases;
  }

  cachedCases = [
    createCase('tiny-flat', 'synthetic', buildTinyFlatFiles()),
    createCase('small-mixed', 'synthetic', buildSmallMixedFiles()),
    createCase('medium-balanced', 'synthetic', buildMediumBalancedFiles()),
    createCase('large-wide', 'synthetic', buildLargeWideFiles()),
    createCase('large-deep-chain', 'synthetic', buildLargeDeepChainFiles()),
    createCase(
      'large-monorepo-shaped',
      'synthetic',
      buildLargeMonorepoShapedFiles()
    ),
    createCase(
      'explicit-directories',
      'synthetic',
      buildExplicitDirectoriesFiles()
    ),
    createCase(
      'fixture-linux-kernel-files',
      'fixture',
      readLinuxKernelFixture(LINUX_KERNEL_FIXTURE_PATH).files
    ),
    createCase(
      'fixture-pierrejs-repo-snapshot',
      'fixture',
      readFixtureLines(BENCHMARK_FIXTURE_PATH)
    ),
  ];

  return cachedCases;
}

export function filterBenchmarkCases(
  cases: FileListToTreeBenchmarkCase[],
  filters: string[]
): FileListToTreeBenchmarkCase[] {
  if (filters.length === 0) {
    return cases;
  }

  const normalizedFilters = filters.map((filter) => filter.toLowerCase());
  return cases.filter((caseConfig) =>
    normalizedFilters.some((filter) =>
      caseConfig.name.toLowerCase().includes(filter)
    )
  );
}
