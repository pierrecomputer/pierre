// @ts-expect-error -- no @types/jsdom in benchmark scripts; package already depends on jsdom
import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';

import {
  type BenchmarkEnvironment,
  formatMs,
  getEnvironment,
  parseNonNegativeInteger,
  parsePositiveInteger,
  printTable,
  summarizeSamples,
  type TimingSummary,
} from './lib/benchmarkUtils';
import {
  type FileListToTreeBenchmarkCase,
  filterBenchmarkCases,
  getFileListToTreeBenchmarkCases,
} from './lib/fileListToTreeBenchmarkData';

interface BenchmarkConfig {
  runs: number;
  warmupRuns: number;
  outputJson: boolean;
  caseFilters: string[];
  viewportHeight: number;
}

interface BenchmarkRuntimeInfo {
  codePath: 'dist';
  nodeEnv: 'production';
  renderer: 'preact-dom';
  mountHarness: 'jsdom-fresh-filetree-render';
  buildCommand: 'bun run build';
}

interface LoadedBenchmarkRuntime {
  runtimeInfo: BenchmarkRuntimeInfo;
  FileTree: typeof import('../src/FileTree').FileTree;
}

interface CaseSummary {
  name: string;
  source: FileListToTreeBenchmarkCase['source'];
  fileCount: number;
  uniqueFolderCount: number;
  maxDepth: number;
  expandedFolderCount: number;
  viewportHeight: number;
  renderedItemCount: number;
  shadowHtmlLength: number;
  shadowHtmlChecksum: number;
  clientMount: TimingSummary;
}

interface BenchmarkOutput {
  benchmark: 'virtualizedFileTreeClientMount';
  environment: BenchmarkEnvironment;
  runtime: BenchmarkRuntimeInfo;
  config: BenchmarkConfig;
  checksum: number;
  cases: CaseSummary[];
}

interface ClientMountSnapshot {
  renderedItemCount: number;
  shadowHtmlLength: number;
  shadowHtmlChecksum: number;
}

const DEFAULT_CONFIG: BenchmarkConfig = {
  runs: 10,
  warmupRuns: 2,
  outputJson: false,
  caseFilters: [],
  viewportHeight: 500,
};

const DEFAULT_CASE_FILTERS = ['linux'];
const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const textDecoder = new TextDecoder();

let domReady = false;

function printHelpAndExit(): never {
  console.log('Usage: bun ws trees benchmark:render:client -- [options]');
  console.log('');
  console.log('Options:');
  console.log(
    '  --runs <number>            Measured runs per benchmark case (default: 10)'
  );
  console.log(
    '  --warmup-runs <number>     Warmup runs per benchmark case before measurement (default: 2)'
  );
  console.log(
    '  --viewport-height <number> Fixed viewport height for the mounted virtualized tree (default: 500)'
  );
  console.log(
    '  --case <filter>            Run only cases whose name contains the filter (repeatable). Defaults to linux fixture only.'
  );
  console.log('  --json                     Emit machine-readable JSON output');
  console.log('  -h, --help                 Show this help output');
  process.exit(0);
}

function parseArgs(argv: string[]): BenchmarkConfig {
  const config: BenchmarkConfig = { ...DEFAULT_CONFIG };

  for (let index = 0; index < argv.length; index++) {
    const rawArg = argv[index];
    if (rawArg === '--help' || rawArg === '-h') {
      printHelpAndExit();
    }

    if (rawArg === '--json') {
      config.outputJson = true;
      continue;
    }

    const [flag, inlineValue] = rawArg.split('=', 2);
    if (
      flag === '--runs' ||
      flag === '--warmup-runs' ||
      flag === '--viewport-height' ||
      flag === '--case'
    ) {
      const value = inlineValue ?? argv[index + 1];
      if (value == null) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (inlineValue == null) {
        index += 1;
      }

      if (flag === '--runs') {
        config.runs = parsePositiveInteger(value, '--runs');
      } else if (flag === '--warmup-runs') {
        config.warmupRuns = parseNonNegativeInteger(value, '--warmup-runs');
      } else if (flag === '--viewport-height') {
        config.viewportHeight = parsePositiveInteger(
          value,
          '--viewport-height'
        );
      } else {
        config.caseFilters.push(value);
      }
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return config;
}

function decodeOutput(output: Uint8Array): string {
  return textDecoder.decode(output).trim();
}

function ensureProductionDistBuild(): BenchmarkRuntimeInfo {
  process.env.NODE_ENV = 'production';

  const buildResult = Bun.spawnSync({
    cmd: ['bun', 'run', 'build'],
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENT: '1',
      NODE_ENV: 'production',
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });

  if (buildResult.exitCode !== 0) {
    const stdout = decodeOutput(buildResult.stdout);
    const stderr = decodeOutput(buildResult.stderr);
    throw new Error(
      [
        'Failed to build @pierre/trees before running the client render benchmark.',
        stdout !== '' ? `stdout:\n${stdout}` : null,
        stderr !== '' ? `stderr:\n${stderr}` : null,
      ]
        .filter((line): line is string => line != null)
        .join('\n\n')
    );
  }

  return {
    codePath: 'dist',
    nodeEnv: 'production',
    renderer: 'preact-dom',
    mountHarness: 'jsdom-fresh-filetree-render',
    buildCommand: 'bun run build',
  };
}

function parsePx(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function installBenchmarkDom(viewportHeight: number): void {
  if (domReady) {
    return;
  }

  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    pretendToBeVisual: true,
  });

  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    HTMLTemplateElement: dom.window.HTMLTemplateElement,
    HTMLDivElement: dom.window.HTMLDivElement,
    HTMLStyleElement: dom.window.HTMLStyleElement,
    HTMLSlotElement: dom.window.HTMLSlotElement,
    HTMLInputElement: dom.window.HTMLInputElement,
    SVGElement: dom.window.SVGElement,
    ShadowRoot: dom.window.ShadowRoot,
    navigator: dom.window.navigator,
    Node: dom.window.Node,
    Event: dom.window.Event,
    MutationObserver: dom.window.MutationObserver,
    customElements: dom.window.customElements,
    getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  });

  class MockCSSStyleSheet {
    cssRules: unknown[] = [];
    replaceSync(_text: string) {}
  }
  Object.assign(globalThis, { CSSStyleSheet: MockCSSStyleSheet });

  class MockResizeObserver {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  Object.assign(globalThis, { ResizeObserver: MockResizeObserver });

  const proto = dom.window.HTMLElement.prototype as HTMLElement & {
    __clientHeightPatched?: boolean;
    __boundingClientRectPatched?: boolean;
  };

  if (
    (proto as { __clientHeightPatched?: boolean }).__clientHeightPatched !==
    true
  ) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        const explicit = parsePx(this.style.height);
        if (explicit > 0) {
          return explicit;
        }
        if (
          this.dataset.fileTreeVirtualizedScroll === 'true' ||
          this.dataset.fileTreeVirtualizedRoot === 'true' ||
          this.dataset.fileTreeVirtualizedWrapper === 'true'
        ) {
          return viewportHeight;
        }
        return 0;
      },
    });
    (proto as { __clientHeightPatched?: boolean }).__clientHeightPatched = true;
  }

  if (
    (proto as { __boundingClientRectPatched?: boolean })
      .__boundingClientRectPatched !== true
  ) {
    dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
      const height = (this as HTMLElement).clientHeight;
      const explicitWidth = parsePx((this as HTMLElement).style.width);
      const width = explicitWidth > 0 ? explicitWidth : 300;
      return {
        x: 0,
        y: 0,
        top: 0,
        right: width,
        bottom: height,
        left: 0,
        width,
        height,
        toJSON() {
          return this;
        },
      } as DOMRect;
    };
    (
      proto as { __boundingClientRectPatched?: boolean }
    ).__boundingClientRectPatched = true;
  }

  domReady = true;
}

async function loadBenchmarkRuntime(
  viewportHeight: number
): Promise<LoadedBenchmarkRuntime> {
  const runtimeInfo = ensureProductionDistBuild();
  installBenchmarkDom(viewportHeight);

  const fileTreeModule = await import(
    new URL('../dist/FileTree.js', import.meta.url).href
  );
  return {
    runtimeInfo,
    FileTree: fileTreeModule.FileTree as LoadedBenchmarkRuntime['FileTree'],
  };
}

function checksumHtml(html: string): number {
  let hash = 2166136261;
  for (let index = 0; index < html.length; index++) {
    hash ^= html.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createFileTreeOptions(
  caseConfig: FileListToTreeBenchmarkCase
): import('../src/FileTree').FileTreeOptions {
  return {
    id: `benchmark-client-render-${caseConfig.name.replace(/[^A-Za-z0-9_-]/g, '-')}`,
    initialFiles: caseConfig.files,
    flattenEmptyDirectories: true,
    sort: false,
    virtualize: { threshold: 0 },
  };
}

function createStateConfig(
  caseConfig: FileListToTreeBenchmarkCase
): import('../src/FileTree').FileTreeStateConfig {
  return {
    initialExpandedItems: caseConfig.expandedFolders ?? [],
  };
}

async function mountClientRenderCase(
  runtime: LoadedBenchmarkRuntime,
  caseConfig: FileListToTreeBenchmarkCase,
  config: BenchmarkConfig
): Promise<ClientMountSnapshot> {
  const host = document.createElement('div');
  host.style.height = `${config.viewportHeight}px`;
  host.style.width = '320px';
  document.body.appendChild(host);

  const fileTree = new runtime.FileTree(
    createFileTreeOptions(caseConfig),
    createStateConfig(caseConfig)
  );

  try {
    fileTree.render({ containerWrapper: host });
    await flushMicrotasks();

    const container = fileTree.getFileTreeContainer();
    const shadowRoot = container?.shadowRoot;
    const html = shadowRoot?.innerHTML ?? '';

    return {
      renderedItemCount:
        shadowRoot?.querySelectorAll('[data-type="item"]').length ?? 0,
      shadowHtmlLength: html.length,
      shadowHtmlChecksum: checksumHtml(html),
    };
  } finally {
    fileTree.cleanUp();
    host.remove();
  }
}

export async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const runtime = await loadBenchmarkRuntime(config.viewportHeight);
  const selectedCaseConfigs = filterBenchmarkCases(
    getFileListToTreeBenchmarkCases(),
    config.caseFilters.length > 0 ? config.caseFilters : DEFAULT_CASE_FILTERS
  );

  if (selectedCaseConfigs.length === 0) {
    throw new Error('No benchmark cases matched the provided --case filters.');
  }

  const samplesByCase = selectedCaseConfigs.map(() => [] as number[]);
  const summaries: ClientMountSnapshot[] = [];

  for (let warmupIndex = 0; warmupIndex < config.warmupRuns; warmupIndex++) {
    for (const caseConfig of selectedCaseConfigs) {
      await mountClientRenderCase(runtime, caseConfig, config);
    }
  }

  for (let runIndex = 0; runIndex < config.runs; runIndex++) {
    for (
      let caseIndex = 0;
      caseIndex < selectedCaseConfigs.length;
      caseIndex++
    ) {
      const caseConfig = selectedCaseConfigs[caseIndex];
      const startTime = performance.now();
      const snapshot = await mountClientRenderCase(runtime, caseConfig, config);
      samplesByCase[caseIndex].push(performance.now() - startTime);
      if (runIndex === 0) {
        summaries[caseIndex] = snapshot;
      }
    }
  }

  const caseSummaries: CaseSummary[] = selectedCaseConfigs.map(
    (caseConfig, index) => ({
      name: caseConfig.name,
      source: caseConfig.source,
      fileCount: caseConfig.fileCount,
      uniqueFolderCount: caseConfig.uniqueFolderCount,
      maxDepth: caseConfig.maxDepth,
      expandedFolderCount: caseConfig.expandedFolders?.length ?? 0,
      viewportHeight: config.viewportHeight,
      renderedItemCount: summaries[index]?.renderedItemCount ?? 0,
      shadowHtmlLength: summaries[index]?.shadowHtmlLength ?? 0,
      shadowHtmlChecksum: summaries[index]?.shadowHtmlChecksum ?? 0,
      clientMount: summarizeSamples(samplesByCase[index]),
    })
  );

  const checksum = caseSummaries.reduce(
    (sum, summary) =>
      sum +
      summary.shadowHtmlChecksum +
      summary.shadowHtmlLength +
      summary.renderedItemCount,
    0
  );
  const environment = getEnvironment();

  const output: BenchmarkOutput = {
    benchmark: 'virtualizedFileTreeClientMount',
    environment,
    runtime: runtime.runtimeInfo,
    config,
    checksum,
    cases: caseSummaries,
  };

  if (config.outputJson) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log('virtualized file tree client-mount benchmark');
  console.log(
    `bun=${environment.bunVersion} platform=${environment.platform} arch=${environment.arch}`
  );
  console.log(
    `runtime=${runtime.runtimeInfo.codePath} nodeEnv=${runtime.runtimeInfo.nodeEnv} renderer=${runtime.runtimeInfo.renderer} harness=${runtime.runtimeInfo.mountHarness}`
  );
  console.log(`buildCommand=${runtime.runtimeInfo.buildCommand}`);
  console.log(
    `cases=${selectedCaseConfigs.length} runsPerCase=${config.runs} warmupRunsPerCase=${config.warmupRuns}`
  );
  console.log(`viewportHeight=${config.viewportHeight}`);
  if (config.caseFilters.length > 0) {
    console.log(`filters=${config.caseFilters.join(', ')}`);
  } else {
    console.log(`filters=${DEFAULT_CASE_FILTERS.join(', ')} (default)`);
  }
  console.log(`checksum=${checksum}`);
  console.log('');

  printTable(
    caseSummaries.map((summary) => ({
      case: summary.name,
      source: summary.source,
      files: String(summary.fileCount),
      folders: String(summary.uniqueFolderCount),
      depth: String(summary.maxDepth),
      expanded: String(summary.expandedFolderCount),
      htmlItems: String(summary.renderedItemCount),
      shadowBytes: String(summary.shadowHtmlLength),
      clientMountMedianMs: formatMs(summary.clientMount.medianMs),
      clientMountP95Ms: formatMs(summary.clientMount.p95Ms),
    })),
    [
      'case',
      'source',
      'files',
      'folders',
      'depth',
      'expanded',
      'htmlItems',
      'shadowBytes',
      'clientMountMedianMs',
      'clientMountP95Ms',
    ]
  );
}

if (import.meta.main) {
  await main();
}
