import { getVirtualizationWorkload } from '@pierre/tree-test-data';
import { bench, boxplot, do_not_optimize, run, summary } from 'mitata';

import { PathStore } from '../src/index';

const VISIBLE_WINDOW_SIZE = 200;

interface BenchmarkCliOptions {
  filter?: RegExp;
  json: boolean;
}

interface BenchmarkWorkload {
  expandedFolders: readonly string[];
  files: readonly string[];
  name: string;
  sortedFiles: readonly string[];
}

interface VisibleSliceBenchmarkCase {
  end: number;
  name: string;
  start: number;
  store: PathStore;
}

interface MoveBenchmarkCase {
  from: string;
  name: string;
  to: string;
  workload: BenchmarkWorkload;
}

function parseArgs(argv: readonly string[]): BenchmarkCliOptions {
  let filter: RegExp | undefined;
  let json = false;

  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--json') {
      json = true;
      continue;
    }

    if (argument === '--filter') {
      const value = argv[index + 1];
      if (value == null || value.length === 0) {
        throw new Error('Expected a value after --filter');
      }

      filter = new RegExp(value);
      index++;
      continue;
    }

    if (argument === '--help') {
      console.log('Usage: bun ws path-store benchmark -- [options]');
      console.log('');
      console.log('Options:');
      console.log(
        '  --filter <regex>   Run only benchmarks whose names match the regex'
      );
      console.log('  --json             Emit mitata JSON output');
      process.exit(0);
    }

    throw new Error(`Unknown benchmark argument: ${argument}`);
  }

  return { filter, json };
}

// Builds the fully expanded store shape that the virtualized tree reads from in
// production without charging that setup time to the measured read benchmark.
function createExpandedStore(workload: BenchmarkWorkload): PathStore {
  return new PathStore({
    flattenEmptyDirectories: false,
    initialExpandedPaths: workload.expandedFolders,
    paths: workload.sortedFiles,
    presorted: true,
  });
}

// Benchmarks should jump into a cold visible region, not just the first window.
function getMiddleWindowStart(store: PathStore): number {
  const middleIndex = Math.floor(store.getVisibleCount() / 2);
  return Math.max(0, middleIndex - Math.floor(VISIBLE_WINDOW_SIZE / 2));
}

const benchmarkWorkloads: BenchmarkWorkload[] = [
  getVirtualizationWorkload('pierre-snapshot'),
  getVirtualizationWorkload('linux'),
  getVirtualizationWorkload('linux-5x'),
].map((workload) => ({
  expandedFolders: workload.expandedFolders,
  files: workload.files,
  name: workload.name,
  sortedFiles: PathStore.preparePaths(workload.files),
}));

const visibleSliceCases: VisibleSliceBenchmarkCase[] = benchmarkWorkloads.map(
  (workload) => {
    const store = createExpandedStore(workload);
    const start = getMiddleWindowStart(store);

    return {
      end: Math.min(
        store.getVisibleCount() - 1,
        start + VISIBLE_WINDOW_SIZE - 1
      ),
      name: workload.name,
      start,
      store,
    };
  }
);

const moveCases: MoveBenchmarkCase[] = [
  {
    from: 'apps/',
    name: 'pierre-snapshot',
    to: 'apps-moved/',
    workload: benchmarkWorkloads[0],
  },
  {
    from: 'arch/',
    name: 'linux',
    to: 'arch-moved/',
    workload: benchmarkWorkloads[1],
  },
  {
    from: 'linux-1/arch/',
    name: 'linux-5x',
    to: 'linux-1/arch-moved/',
    workload: benchmarkWorkloads[2],
  },
];

boxplot(() => {
  summary(() => {
    for (const workload of benchmarkWorkloads) {
      bench(`prepare/${workload.name} canonical-sort`, () => {
        return do_not_optimize(PathStore.preparePaths(workload.files));
      }).gc('inner');

      bench(`build/${workload.name} sorted-constructor`, () => {
        const store = new PathStore({
          flattenEmptyDirectories: false,
          paths: workload.sortedFiles,
          presorted: true,
        });

        return do_not_optimize(store.getNodeCount());
      }).gc('inner');
    }
  });

  summary(() => {
    for (const visibleCase of visibleSliceCases) {
      bench(`visible/${visibleCase.name} middle-window`, () => {
        return do_not_optimize(
          visibleCase.store.getVisibleSlice(visibleCase.start, visibleCase.end)
        );
      });
    }
  });

  summary(() => {
    for (const moveCase of moveCases) {
      bench(`move/${moveCase.name} expanded-root-subtree`, function* () {
        yield {
          [0]() {
            const store = createExpandedStore(moveCase.workload);
            return {
              end: Math.min(
                store.getVisibleCount() - 1,
                VISIBLE_WINDOW_SIZE - 1
              ),
              store,
            };
          },

          bench(state: { store: PathStore; end: number }) {
            state.store.move(moveCase.from, moveCase.to);
            return do_not_optimize(state.store.getVisibleSlice(0, state.end));
          },
        };
      }).gc('inner');
    }
  });
});

const options = parseArgs(process.argv.slice(2));

await run({
  ...(options.filter != null && { filter: options.filter }),
  ...(options.json && { format: 'json' as const }),
  throw: true,
});
