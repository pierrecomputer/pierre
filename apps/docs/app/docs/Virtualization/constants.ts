import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

const options = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  disableFileHeader: true,
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const VIRTUALIZATION_REACT_BASIC: PreloadFileOptions<undefined> = {
  file: {
    name: 'react_virtualizer_basic.tsx',
    contents: `import {
  MultiFileDiff,
  Virtualizer,
  WorkerPoolContextProvider,
} from '@pierre/diffs/react';
import { workerFactory } from './utils/workerFactory';

function Example({ oldFile, newFile }) {
  return (
    <WorkerPoolContextProvider
      poolOptions={{ workerFactory }}
      highlighterOptions={{
        theme: { dark: 'pierre-dark', light: 'pierre-light' },
        langs: ['typescript', 'javascript', 'css', 'html'],
      }}
    >
      <Virtualizer
        className="max-h-[70vh] overflow-auto"
        contentClassName="space-y-4"
      >
        <MultiFileDiff
          oldFile={oldFile}
          newFile={newFile}
          options={{
            theme: { dark: 'pierre-dark', light: 'pierre-light' },
            diffStyle: 'split',
          }}
        />
      </Virtualizer>
    </WorkerPoolContextProvider>
  );
}

// Any diff/file component inside <Virtualizer> automatically uses
// virtualized rendering internally:
// - <MultiFileDiff />
// - <PatchDiff />
// - <FileDiff />
// - <File />`,
  },
  options,
};

export const VIRTUALIZATION_REACT_CONFIG: PreloadFileOptions<undefined> = {
  file: {
    name: 'react_virtualizer_config.tsx',
    contents: `import { MultiFileDiff, Virtualizer } from '@pierre/diffs/react';

function Example({ oldFile, newFile }) {
  return (
    <Virtualizer
      className="h-[80vh] overflow-auto"
      contentClassName="space-y-6"
      config={{
        // Extra viewport size in pixels rendered above and below the viewport.
        // (default: 1000)
        overscrollSize: 1000,

        // IntersectionObserver root margin in pixels for visibility tracking.
        // (default: 4000)
        intersectionObserverMargin: 4000,

        // Logs size changes for debugging measurement jitter.
        // Keep disabled in production because it will hurt performance.
        // Useful to confirm that your metrics are accurate.
        resizeDebugging: false,
      }}
    >
      <MultiFileDiff oldFile={oldFile} newFile={newFile} />
    </Virtualizer>
  );
}`,
  },
  options,
};

export const VIRTUALIZATION_VANILLA_DIFF: PreloadFileOptions<undefined> = {
  file: {
    name: 'vanilla_virtualized_file_diff.ts',
    contents: `import {
  Virtualizer,
  VirtualizedFile,
  VirtualizedFileDiff,
  type FileContents,
} from '@pierre/diffs';
import {
  getOrCreateWorkerPoolSingleton,
  terminateWorkerPoolSingleton,
} from '@pierre/diffs/worker';
import { workerFactory } from './utils/workerFactory';

const root = document.getElementById('diff-scroll-root');
const content = document.getElementById('diff-scroll-content');
if (root == null || content == null) {
  throw new Error('Missing container elements');
}

const oldFile: FileContents = {
  name: 'example.ts',
  contents: 'export const value = 1;\\n',
};

const newFile: FileContents = {
  name: 'example.ts',
  contents: 'export const value = 2;\\n',
};

const workerPool = getOrCreateWorkerPoolSingleton({
  poolOptions: { workerFactory },
  highlighterOptions: {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    langs: ['typescript', 'javascript', 'css', 'html'],
  },
});

const virtualizer = new Virtualizer({
  // Extra viewport size in pixels rendered above and below the viewport.
  // (default: 1000)
  overscrollSize: 1000,

  // IntersectionObserver root margin in pixels for visibility tracking.
  // (default: 4000)
  intersectionObserverMargin: 4000,

  // Logs size changes for debugging measurement jitter.
  // Keep disabled in production because it will hurt performance.
  // Useful to confirm that your metrics are accurate.
  resizeDebugging: false,
});
virtualizer.setup(root, content);

// Optional partial metrics override.
// Only include values that differ from defaults.
const metrics = {
  lineHeight: 22,
  fileGap: 10,
};

const diff = new VirtualizedFileDiff(
  {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    diffStyle: 'split',
  },
  virtualizer,
  metrics,
  workerPool
);

diff.render({
  oldFile,
  newFile,
  containerWrapper: content,
});

const file = new VirtualizedFile(
  {
    theme: { dark: 'pierre-dark', light: 'pierre-light' },
    overflow: 'scroll',
  },
  virtualizer,
  metrics,
  workerPool
);

file.render({
  file: {
    name: 'another-example.ts',
    contents: 'export function hello() { return "world"; }\\n',
  },
  containerWrapper: content,
});

// Later cleanup
diff.cleanUp();
file.cleanUp();
virtualizer.cleanUp();
terminateWorkerPoolSingleton();`,
  },
  options,
};
