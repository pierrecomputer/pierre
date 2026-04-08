import inspector from 'node:inspector';
import { performance } from 'node:perf_hooks';

import {
  createVisibleTreeProjectionScenarios,
  createVisibleTreeProjectionWorkload,
} from './visibleTreeProjectionShared';

interface ProfileConfig {
  iterations: number;
  json: boolean;
  scenarioName: string;
  workload: string;
}

interface CpuProfileNodeCallFrame {
  columnNumber: number;
  functionName: string;
  lineNumber: number;
  scriptId: string;
  url: string;
}

interface CpuProfileNode {
  callFrame: CpuProfileNodeCallFrame;
  children?: number[];
  id: number;
}

interface CpuProfile {
  nodes: CpuProfileNode[];
  samples?: number[];
  timeDeltas?: number[];
}

interface ProfileFunctionSummary {
  name: string;
  selfMs: number;
  totalMs: number;
}

function parseArgs(argv: readonly string[]): ProfileConfig {
  const config: ProfileConfig = {
    iterations: 50,
    json: false,
    scenarioName: 'projection-only',
    workload: 'linux-1x',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--iterations':
        config.iterations = Number(argv[index + 1] ?? config.iterations);
        index += 1;
        break;
      case '--json':
        config.json = true;
        break;
      case '--scenario':
        config.scenarioName = argv[index + 1] ?? config.scenarioName;
        index += 1;
        break;
      case '--workload':
        config.workload = argv[index + 1] ?? config.workload;
        index += 1;
        break;
      default:
        break;
    }
  }

  return config;
}

async function main(): Promise<void> {
  const config = parseArgs(process.argv.slice(2));
  const workload = createVisibleTreeProjectionWorkload(config.workload);
  const scenario = createVisibleTreeProjectionScenarios(workload).find(
    ({ name }) => name === config.scenarioName
  );
  if (scenario == null) {
    throw new Error(
      `Unknown visible tree projection scenario: "${config.scenarioName}"`
    );
  }

  const session = new inspector.Session();
  session.connect();

  await postInspector(session, 'Profiler.enable');
  await postInspector(session, 'Profiler.setSamplingInterval', {
    interval: 1_000,
  });
  await postInspector(session, 'Profiler.start');

  const startedAt = performance.now();
  let rowCount = 0;
  for (let iteration = 0; iteration < config.iterations; iteration += 1) {
    rowCount = scenario.measure().rowCount;
  }
  const wallTimeMs = performance.now() - startedAt;

  const profile = (
    await postInspector<{ profile?: CpuProfile }>(session, 'Profiler.stop')
  ).profile;
  await postInspector(session, 'Profiler.disable').catch(() => {});
  session.disconnect();

  const functionSummaries = summarizeCpuProfile(profile ?? null).slice(0, 15);
  const output = {
    profile: 'visible-tree-projection',
    scenario: scenario.name,
    summary: {
      iterations: config.iterations,
      rowCount,
      wallTimeMs,
      workload: workload.name,
    },
    topFunctions: functionSummaries,
  };

  if (config.json) {
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(
    `${workload.name}:${scenario.name}  iterations=${String(config.iterations)}  rows=${String(rowCount)}  wall=${wallTimeMs.toFixed(3)}ms`
  );
  for (const summary of functionSummaries) {
    console.log(
      `  ${summary.name}  self=${summary.selfMs.toFixed(3)}ms  total=${summary.totalMs.toFixed(3)}ms`
    );
  }
}

function createFunctionLabel(callFrame: CpuProfileNodeCallFrame): string {
  const functionName =
    callFrame.functionName.length > 0 ? callFrame.functionName : '(anonymous)';
  if (callFrame.url.length === 0) {
    return functionName;
  }

  const parts = callFrame.url.split('/');
  const fileName = parts[parts.length - 1] ?? callFrame.url;
  return `${functionName} (${fileName}:${String(callFrame.lineNumber + 1)})`;
}

function summarizeCpuProfile(
  profile: CpuProfile | null
): ProfileFunctionSummary[] {
  if (
    profile == null ||
    profile.samples == null ||
    profile.timeDeltas == null ||
    profile.samples.length === 0
  ) {
    return [];
  }

  const nodeById = new Map<number, CpuProfileNode>();
  const parentById = new Map<number, number | null>();
  for (const node of profile.nodes) {
    nodeById.set(node.id, node);
    parentById.set(node.id, null);
  }
  for (const node of profile.nodes) {
    for (const childId of node.children ?? []) {
      parentById.set(childId, node.id);
    }
  }

  const selfMsByLabel = new Map<string, number>();
  const totalMsByLabel = new Map<string, number>();
  for (let index = 0; index < profile.samples.length; index += 1) {
    const nodeId = profile.samples[index];
    const durationMs = (profile.timeDeltas[index] ?? 0) / 1_000;
    const leafNode = nodeId == null ? null : (nodeById.get(nodeId) ?? null);
    if (leafNode == null) {
      continue;
    }

    const leafLabel = createFunctionLabel(leafNode.callFrame);
    selfMsByLabel.set(
      leafLabel,
      (selfMsByLabel.get(leafLabel) ?? 0) + durationMs
    );

    let currentNodeId: number | null = nodeId;
    while (currentNodeId != null) {
      const currentNode = nodeById.get(currentNodeId);
      if (currentNode == null) {
        break;
      }

      const label = createFunctionLabel(currentNode.callFrame);
      totalMsByLabel.set(label, (totalMsByLabel.get(label) ?? 0) + durationMs);
      currentNodeId = parentById.get(currentNodeId) ?? null;
    }
  }

  return [...totalMsByLabel.entries()]
    .map(([name, totalMs]) => ({
      name,
      selfMs: selfMsByLabel.get(name) ?? 0,
      totalMs,
    }))
    .sort((left, right) => right.totalMs - left.totalMs);
}

function postInspector<TResult = void>(
  session: inspector.Session,
  method: string,
  params?: object
): Promise<TResult> {
  return new Promise((resolve, reject) => {
    session.post(method, params ?? {}, (error, result) => {
      if (error != null) {
        reject(error);
        return;
      }

      resolve((result ?? {}) as TResult);
    });
  });
}

await main();
