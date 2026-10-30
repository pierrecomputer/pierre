import binaryen from 'binaryen';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { type Profiler, Session } from 'node:inspector';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import wabt from 'wabt';

import { optimizeWasm, transformWat } from '../../scripts/build.ts';
import { type Configuration, createCase } from './cases.ts';

type Workload = Awaited<ReturnType<typeof createCase>>;
import { warmup } from './warmup.ts';

const packageDirectory = fileURLToPath(new URL('../../', import.meta.url));
const stageNames = ['blockAnalysis', 'inlineAndRender'];
const pageSize = 65536;
const hash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

function requireNode() {
  if (Boolean(process.versions.bun) || (process.versions.node ?? '') === '') {
    throw new Error('Words diagnostics require Node, not Bun.');
  }
}

function readUleb(bytes: Uint8Array, cursor: { offset: number }) {
  let value = 0;
  let shift = 0;
  while (cursor.offset < bytes.length && shift < 35) {
    const byte = bytes[cursor.offset++];
    value += (byte & 127) * 2 ** shift;
    if ((byte & 128) === 0) return value;
    shift += 7;
  }
  throw new Error('Invalid unsigned LEB128 in Wasm metadata.');
}

// Compare executable sections without re-encoding them. Name sections must not
// change the optimized instructions, function order, data, or memory layout.
function executableBytes(bytes: Uint8Array) {
  const parts = [bytes.subarray(0, 8)];
  const cursor = { offset: 8 };
  while (cursor.offset < bytes.length) {
    const start = cursor.offset;
    const id = bytes[cursor.offset++];
    const length = readUleb(bytes, cursor);
    const end = cursor.offset + length;
    if (end > bytes.length) throw new Error('Truncated Wasm section.');
    if (id !== 0) parts.push(bytes.subarray(start, end));
    cursor.offset = end;
  }
  return Buffer.concat(parts);
}

function functionNames(bytes: Uint8Array) {
  const wasmModule = new WebAssembly.Module(bytes as Uint8Array<ArrayBuffer>);
  const names = [];
  for (const section of WebAssembly.Module.customSections(wasmModule, 'name')) {
    const data = new Uint8Array(section);
    const cursor = { offset: 0 };
    while (cursor.offset < data.length) {
      const id = data[cursor.offset++];
      const length = readUleb(data, cursor);
      const end = cursor.offset + length;
      if (end > data.length) throw new Error('Truncated Wasm name section.');
      if (id === 1) {
        const count = readUleb(data, cursor);
        for (let i = 0; i < count; i++) {
          readUleb(data, cursor);
          const size = readUleb(data, cursor);
          if (cursor.offset + size > end)
            throw new Error('Invalid function name.');
          names.push(
            Buffer.from(
              data.subarray(cursor.offset, cursor.offset + size)
            ).toString()
          );
          cursor.offset += size;
        }
      }
      cursor.offset = end;
    }
  }
  return names;
}

function uniqueIndex(
  children: number[],
  predicate: (node: binaryen.ExpressionInfo) => boolean,
  description: string
) {
  const matches: number[] = [];
  children.forEach((expression: number, index) => {
    if (predicate(binaryen.getExpressionInfo(expression))) matches.push(index);
  });
  if (matches.length !== 1) {
    throw new Error(
      `Diagnostic anchor ${description}: expected one, found ${matches.length}.`
    );
  }
  return matches[0];
}

function instrumentStages(code: string) {
  const wasmModule = binaryen.parseText(code);
  try {
    const exported = binaryen.getExportInfo(wasmModule.getExport('render'));
    const func = wasmModule.getFunction(exported.value);
    const body = binaryen.getExpressionInfo(
      binaryen.getFunctionInfo(func).body
    ) as binaryen.BlockInfo;
    if (body.id !== binaryen.BlockId)
      throw new Error('Expected a block body for render.');
    const children = body.children;
    const blockStart = uniqueIndex(
      children,
      (node) =>
        node.id === binaryen.BlockId &&
        (node as binaryen.BlockInfo).name === 'blocksDone',
      'blocksDone'
    );
    const blockEnd = uniqueIndex(
      children,
      (node) =>
        node.id === binaryen.CallId &&
        (node as binaryen.CallInfo).target === 'linkIndex',
      'linkIndex'
    );
    const render = uniqueIndex(
      children,
      (node) =>
        node.id === binaryen.CallId &&
        (node as binaryen.CallInfo).target === 'renderBlocks',
      'renderBlocks'
    );
    if (!(blockStart < blockEnd && blockEnd < render)) {
      throw new Error('Unexpected block-analysis/render stage order.');
    }
    wasmModule.addFunctionImport(
      'labStage',
      'lab',
      'stage',
      binaryen.createType([binaryen.i32, binaryen.i32]),
      binaryen.none
    );
    const probe = (stage: number, entering: number) =>
      wasmModule.call(
        'labStage',
        [wasmModule.i32.const(stage), wasmModule.i32.const(entering)],
        binaryen.none
      );
    const instrumented: number[] = [];
    children.forEach((child, index) => {
      if (index === blockStart) instrumented.push(probe(0, 1));
      if (index === render) instrumented.push(probe(1, 1));
      instrumented.push(child);
      if (index === blockEnd) instrumented.push(probe(0, 0));
      if (index === render) instrumented.push(probe(1, 0));
    });
    (
      binaryen as typeof binaryen & {
        Function: { setBody(func: number, body: number): void };
      }
    ).Function.setBody(
      func,
      wasmModule.block(body.name, instrumented, body.type)
    );
    wasmModule.setFeatures(
      binaryen.Features.BulkMemory |
        binaryen.Features.BulkMemoryOpt |
        binaryen.Features.SIMD128
    );
    if (wasmModule.validate() === 0)
      throw new Error('Binaryen rejected diagnostic stage probes.');
    return wasmModule.emitBinary();
  } finally {
    wasmModule.dispose();
  }
}

/** Build only inside a disposable target, never in the package's dist directory. */
export async function buildDiagnostic(targetDirectory: string) {
  requireNode();
  const target = resolve(targetDirectory);
  const dist = join(packageDirectory, 'dist');
  if (target === dist || target.startsWith(dist + sep)) {
    throw new Error(
      'Diagnostic artifacts must not be written to production dist.'
    );
  }
  const production = await readFile(join(target, 'md.wasm'));
  let source = join(target, 'src', 'md.wat');
  try {
    await readFile(source);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    )
      throw error;
    source = join(packageDirectory, 'src', 'md.wat');
  }
  let { code } = transformWat(pathToFileURL(source));
  // The two anonymous exported functions otherwise appear as numeric Wasm frames.
  // Naming them changes only metadata; executable equality below remains mandatory.
  for (const name of ['render', 'complete']) {
    const anchor = `(func (export "${name}")`;
    if (code.split(anchor).length !== 2)
      throw new Error(
        `Expected one anonymous ${name} export for profile naming.`
      );
    code = code.replace(anchor, `(func $lab.${name} (export "${name}")`);
  }
  const { parseWat } = await wabt();
  const parsed = parseWat(source, code, { bulk_memory: true, simd: true });
  let raw;
  try {
    raw = parsed.toBinary({ write_debug_names: true }).buffer;
  } finally {
    parsed.destroy();
  }
  const previousDebugInfo = binaryen.getDebugInfo();
  let named;
  let diagnostic;
  try {
    binaryen.setDebugInfo(true);
    named = optimizeWasm(raw);
    diagnostic = optimizeWasm(instrumentStages(code));
  } finally {
    binaryen.setDebugInfo(previousDebugInfo);
  }
  if (!executableBytes(production).equals(executableBytes(named))) {
    throw new Error(
      'Named Wasm executable sections differ from target md.wasm; rebuild the capture from matching sources and tools.'
    );
  }
  const names = functionNames(named).filter((name) => !/^\d+$/.test(name));
  if (
    !names.includes('renderBlocks') &&
    !names.some((name) => name.includes('inline'))
  ) {
    throw new Error('Optimized Wasm lost meaningful parser function names.');
  }
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'named.wasm'), named);
  await writeFile(join(target, 'diagnostic.wasm'), diagnostic);
  return {
    sourceDirectory: dirname(source),
    productionSha256: hash(production),
    namedSha256: hash(named),
    diagnosticSha256: hash(diagnostic),
    executableSectionsIdentical: true,
    namedFunctions: names.length,
  };
}

export function makeProbes({ operation }: { operation: string }) {
  const sessionObservation =
    operation === 'html-renderer'
      ? {
          available: false,
          reason:
            'createHtmlRenderer owns an internal session that bypasses the lab observeSession hook.',
        }
      : {
          available: true,
          reason:
            operation === 'session-full' || operation === 'session-suffix'
              ? 'All core session deliveries are observed by the lab session wrapper.'
              : 'This operation does not use sessions; session counters are zero.',
        };
  const stages = Object.fromEntries(
    stageNames.map((name) => [name, { calls: 0, milliseconds: 0 }])
  );
  const starts = new Map<number, number>();
  const counters = {
    rendererCalls: 0,
    coreRenderCalls: 0,
    completionCalls: 0,
    sourceBytesSubmittedToCore: 0,
    coreInputBytesAfterCompletion: 0,
    completionInputBytes: 0,
    sessionUpdates: sessionObservation.available ? 0 : null,
    cacheHits: sessionObservation.available ? 0 : null,
    resets: sessionObservation.available ? 0 : null,
    definitionBearingCoreCalls: 0,
    memoryGrowthObservations: 0,
    memoryGrowthPages: 0,
    encodeIntoCalls: 0,
    encodedBytes: 0,
    inputCopyCalls: 0,
    copiedBytes: 0,
    decodeCalls: 0,
    decodedBytes: 0,
  };
  const timings = {
    rendererInclusiveMs: 0,
    coreRenderInclusiveMs: 0,
    completionMs: 0,
    encodeIntoMs: 0,
    inputCopyMs: 0,
    decodeMs: 0,
  };
  let active = false;
  return {
    counters,
    timings,
    stages,
    sessionObservation,
    get active() {
      return active;
    },
    begin() {
      active = true;
    },
    end() {
      active = false;
      if (starts.size !== 0)
        throw new Error('Unbalanced diagnostic stage probes.');
    },
    imports: {
      lab: {
        stage(id: number, entering: number) {
          if (!active) return;
          const now = performance.now();
          const name = stageNames[id];
          if ((name ?? '') === '')
            throw new Error(`Unknown diagnostic stage ${id}.`);
          if (entering !== 0) {
            if (starts.has(id))
              throw new Error(`Nested diagnostic stage ${name}.`);
            starts.set(id, now);
          } else {
            if (!starts.has(id))
              throw new Error(`Missing start for diagnostic stage ${name}.`);
            stages[name].calls++;
            stages[name].milliseconds += now - starts.get(id)!;
            starts.delete(id);
          }
        },
      },
    },
    observeSession({
      result,
      cached,
    }: Parameters<NonNullable<Configuration['observeSession']>>[0]) {
      if (!active || !sessionObservation.available) return;
      counters.sessionUpdates!++;
      if (cached) counters.cacheHits!++;
      else if (result.reset) counters.resets!++;
    },
  };
}

export function installProbes(
  workload: Workload,
  probes: ReturnType<typeof makeProbes>
) {
  const renderer = workload.renderer;
  const { counters, timings } = probes;
  const undo: (() => void)[] = [];
  let renderDepth = 0;
  let observedPages = renderer.memory.buffer.byteLength / pageSize;
  const observeMemory = () => {
    const pages = renderer.memory.buffer.byteLength / pageSize;
    if (pages > observedPages) {
      counters.memoryGrowthObservations++;
      counters.memoryGrowthPages += pages - observedPages;
      observedPages = pages;
    }
  };
  const patch = <T, K extends keyof T>(
    object: T,
    key: K,
    wrap: (original: T[K]) => T[K]
  ) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    const original = object[key];
    object[key] = wrap(original);
    undo.push(() => {
      if (descriptor != null) Object.defineProperty(object, key, descriptor);
      else delete object[key];
    });
  };
  patch(
    renderer,
    'render',
    (original) =>
      function (this: typeof renderer, input, ...args) {
        if (!probes.active) return original.call(this, input, ...args);
        counters.rendererCalls++;
        counters.sourceBytesSubmittedToCore +=
          typeof input === 'string'
            ? Buffer.byteLength(input)
            : input.byteLength;
        renderDepth++;
        const start = performance.now();
        try {
          return original.call(this, input, ...args);
        } finally {
          timings.rendererInclusiveMs += performance.now() - start;
          renderDepth--;
          observeMemory();
        }
      }
  );
  patch(
    renderer,
    'wasmRender',
    (original) =>
      function (this: typeof renderer, ...args) {
        if (!probes.active) return original.apply(this, args);
        observeMemory();
        const bytes = new DataView(renderer.memory.buffer).getUint32(2, true);
        counters.coreRenderCalls++;
        counters.coreInputBytesAfterCompletion += bytes;
        if (renderDepth === 0) counters.sourceBytesSubmittedToCore += bytes;
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          timings.coreRenderInclusiveMs += performance.now() - start;
          observeMemory();
          if (new DataView(renderer.memory.buffer).getUint8(30) !== 0)
            counters.definitionBearingCoreCalls++;
        }
      }
  );
  patch(
    renderer,
    'wasmComplete',
    (original) =>
      function (this: typeof renderer, ...args) {
        if (!probes.active) return original.apply(this, args);
        counters.completionCalls++;
        counters.completionInputBytes += new DataView(
          renderer.memory.buffer
        ).getUint32(2, true);
        const start = performance.now();
        try {
          return original.apply(this, args);
        } finally {
          timings.completionMs += performance.now() - start;
          observeMemory();
        }
      }
  );
  // Synchronous diagnostic batches only; always restore the host prototypes.
  patch(
    TextEncoder.prototype,
    'encodeInto',
    (original) =>
      function (this: TextEncoder, ...args) {
        if (!probes.active) return original.apply(this, args);
        const start = performance.now();
        try {
          const result = original.apply(this, args);
          counters.encodeIntoCalls++;
          counters.encodedBytes += result.written;
          return result;
        } finally {
          timings.encodeIntoMs += performance.now() - start;
        }
      }
  );
  patch(
    Uint8Array.prototype,
    'set',
    (original) =>
      function (this: Uint8Array, input, offset?: number) {
        if (
          !probes.active ||
          this.buffer !== renderer.memory.buffer ||
          offset !== pageSize
        ) {
          return original.call(this, input, offset);
        }
        const start = performance.now();
        try {
          counters.inputCopyCalls++;
          counters.copiedBytes += input.length;
          return original.call(this, input, offset);
        } finally {
          timings.inputCopyMs += performance.now() - start;
        }
      }
  );
  patch(
    TextDecoder.prototype,
    'decode',
    (original) =>
      function (this: TextDecoder, input, ...args) {
        if (!probes.active) return original.call(this, input, ...args);
        const start = performance.now();
        try {
          counters.decodeCalls++;
          counters.decodedBytes += input?.byteLength ?? 0;
          return original.call(this, input, ...args);
        } finally {
          timings.decodeMs += performance.now() - start;
        }
      }
  );
  return () => {
    for (const restore of undo.reverse()) restore();
  };
}

function assertParity(
  production: ReturnType<Workload['verify']>,
  candidate: ReturnType<Workload['verify']>,
  variant: string
) {
  if (production.outputSha256 !== candidate.outputSha256) {
    throw new Error(
      `${variant} output differs from production: ${candidate.outputSha256} != ${production.outputSha256}`
    );
  }
}

function post<T extends object = object>(
  session: Session,
  method: string,
  parameters = {}
) {
  return new Promise<T>((resolve, reject) => {
    session.post(method, parameters, (error, result) =>
      error != null ? reject(error) : resolve(result as T)
    );
  });
}

function summarizeProfile(profile: Profiler.Profile, names: string[]) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const samples = new Map<
    string,
    { function: string; url: string; line: number; samples: number }
  >();
  for (const id of profile.samples ?? []) {
    const frame = nodes.get(id)!.callFrame;
    const key = `${frame.url}:${frame.lineNumber}:${frame.columnNumber}:${frame.functionName}`;
    let entry = samples.get(key);
    if (entry == null) {
      entry = {
        function:
          (frame.functionName ?? '') !== ''
            ? frame.functionName
            : '(anonymous)',
        url: frame.url,
        line: frame.lineNumber + 1,
        samples: 0,
      };
      samples.set(key, entry);
    }
    entry.samples++;
  }
  const hotspots = [...samples.values()].sort((a, b) => b.samples - a.samples);
  return {
    totalSamples: profile.samples?.length ?? 0,
    sampledNamedWasmFunctions: new Set(
      hotspots
        .filter(
          (item) =>
            item.url?.startsWith('wasm:') && names.includes(item.function)
        )
        .map((item) => item.function)
    ).size,
    hotspots: hotspots.slice(0, 30),
  };
}

/** Private modules preserve source positions; remap to their actual captured entry. */
export function remapProfileSources(
  profile: Profiler.Profile,
  targetDirectory: string,
  entry: string
) {
  const url = pathToFileURL(join(targetDirectory, entry)).href;
  for (const node of profile.nodes) {
    if (node.callFrame.url.startsWith('data:text/javascript'))
      node.callFrame.url = url;
  }
}

/** CPU sampling and perturbed diagnostics are separate from headline timing. */
export async function profileCase({
  caseId,
  targetDirectory,
  outputDirectory,
  durationMs = 2000,
}: {
  caseId: string;
  targetDirectory: string;
  outputDirectory: string;
  durationMs?: number;
}) {
  requireNode();
  if (!Number.isFinite(durationMs) || durationMs <= 0)
    throw new Error('durationMs must be positive.');
  const target = resolve(targetDirectory);
  const output = resolve(outputDirectory);
  const production = await createCase(caseId, target);
  const productionVerification = production.verify();
  const namedBytes = await readFile(join(target, 'named.wasm'));
  const productionBytes = await readFile(join(target, 'md.wasm'));
  if (!executableBytes(productionBytes).equals(executableBytes(namedBytes))) {
    throw new Error(
      'Named Wasm does not match the production executable sections.'
    );
  }
  const names = functionNames(namedBytes);
  if (names.length === 0) throw new Error('Named Wasm has no function names.');
  const named = await createCase(caseId, target, { wasmFile: 'named.wasm' });
  const probes = makeProbes(production.descriptor);
  const diagnostic = await createCase(caseId, target, {
    wasmFile: 'diagnostic.wasm',
    imports: probes.imports,
    observeSession: probes.observeSession,
  });
  const namedVerification = named.verify();
  const diagnosticVerification = diagnostic.verify();
  assertParity(productionVerification, namedVerification, 'Named');
  assertParity(productionVerification, diagnosticVerification, 'Diagnostic');

  const session = new Session();
  let profile;
  let profileOperations = 0;
  let checksum = 0;
  // Diagnostics warm by both elapsed time and delivery/operation count, just
  // like timing workers, but remain a separate perturbed measurement.
  const warmupMs = 250;
  const warmupDeliveries = 20000;
  const warmupMaxMs = 5000;
  const updates =
    production.descriptor.unit === 'replay' ? production.descriptor.updates : 1;
  const warmupFloor =
    production.descriptor.unit === 'replay' ? warmupDeliveries : 400;
  const warmups: Record<
    string,
    Omit<ReturnType<typeof warmup>, 'sink'> & { warmupReachedCap: boolean }
  > = {};
  const warnings = [];
  for (const [name, workload] of Object.entries({ named, diagnostic })) {
    const { sink, ...achieved } = warmup(workload.run, {
      warmupMs,
      warmupMaxMs,
      warmupFloor,
      updates,
    });
    checksum = (checksum ^ sink) >>> 0;
    warmups[name] = {
      ...achieved,
      warmupReachedCap: achieved.warmupElapsedMs >= warmupMaxMs,
    };
    if (!achieved.warmupReachedFloor) {
      const warning =
        `${name} warmup did not reach both floors: ` +
        `${achieved.warmupElapsedMs.toFixed(1)}ms / ${warmupMs}ms, ` +
        `${achieved.warmupDeliveries} deliveries / ${warmupFloor}; ` +
        `cap ${warmupMaxMs}ms. Diagnostic results are not fully warmed.`;
      warnings.push(warning);
      console.warn(warning);
    }
  }
  session.connect();
  try {
    await post(session, 'Profiler.enable');
    await post(session, 'Profiler.setSamplingInterval', { interval: 100 });
    await post(session, 'Profiler.start');
    const deadline = performance.now() + durationMs;
    do {
      checksum = (checksum ^ named.run()) >>> 0;
      profileOperations++;
    } while (performance.now() < deadline);
    ({ profile } = await post<Profiler.StopReturnType>(
      session,
      'Profiler.stop'
    ));
  } finally {
    session.disconnect();
  }
  remapProfileSources(profile, target, named.entry);

  // This small matched batch estimates probe cost, not renderer performance.
  // No stage probes, clock wrappers, or prototype patches are active above.
  const operations = 3;
  const referenceStart = performance.now();
  for (let i = 0; i < operations; i++)
    checksum = (checksum ^ named.run()) >>> 0;
  const referenceMs = performance.now() - referenceStart;
  const memoryBefore = diagnostic.renderer.memory.buffer.byteLength;
  const restore = installProbes(diagnostic, probes);
  let diagnosticMs;
  try {
    probes.begin();
    const start = performance.now();
    for (let i = 0; i < operations; i++)
      checksum = (checksum ^ diagnostic.run()) >>> 0;
    diagnosticMs = performance.now() - start;
  } finally {
    try {
      probes.end();
    } finally {
      restore();
    }
  }
  assertParity(productionVerification, named.verify(), 'Profiled named');
  assertParity(
    productionVerification,
    diagnostic.verify(),
    'Probed diagnostic'
  );
  const uniqueFinalBytes = Buffer.byteLength(diagnostic.source);
  const safeId = caseId.replace(/[^a-zA-Z0-9_.-]/g, '_');
  const profilePath = join(output, `${safeId}.cpuprofile`);
  const summaryPath = join(output, `${safeId}.profile.json`);
  const report = {
    schemaVersion: 1,
    case: production.descriptor,
    warnings,
    runtime: {
      node: process.versions.node,
      v8: process.versions.v8,
      execArgv: process.execArgv,
    },
    artifacts: {
      profilePath,
      summaryPath,
      productionSha256: hash(productionBytes),
      namedSha256: hash(namedBytes),
      diagnosticSha256: hash(await readFile(join(target, 'diagnostic.wasm'))),
    },
    parity: {
      executableSectionsIdentical: true,
      production: productionVerification,
      named: namedVerification,
      diagnostic: diagnosticVerification,
    },
    cpu: {
      requestedDurationMs: durationMs,
      warmupMs,
      warmupDeliveries,
      warmupMaxMs,
      warmup: warmups,
      operations: profileOperations,
      samplingIntervalMicroseconds: 100,
      ...summarizeProfile(profile, names),
    },
    diagnostic: {
      perturbed: true,
      operations,
      milliseconds: diagnosticMs,
      sessionObservation: probes.sessionObservation,
      counters: probes.counters,
      timings: probes.timings,
      stages: probes.stages,
      uniqueFinalSourceBytesPerOperation: uniqueFinalBytes,
      sourceReprocessingRatio:
        uniqueFinalBytes !== 0
          ? probes.counters.sourceBytesSubmittedToCore /
            (operations * uniqueFinalBytes)
          : null,
      memory: {
        beforeBytes: memoryBefore,
        afterBytes: diagnostic.renderer.memory.buffer.byteLength,
      },
      probeOverhead: {
        operations,
        referenceMs,
        diagnosticMs,
        observedRatio: referenceMs !== 0 ? diagnosticMs / referenceMs : null,
        interpretation:
          'Three warmed operations, named versus instrumented. Includes compiler effects, wrappers and probes; not a speedup estimate or a stable overhead correction.',
      },
    },
    checksum,
    limitations: [
      'All diagnostic times are perturbed. CPU sampling uses optimized named Wasm without stage probes; neither run is headline performance evidence.',
      'Block analysis spans the block loop, EOF/container closure and link indexing. Inline/render spans renderBlocks including inline analysis and HTML emission. Initialization/frontmatter/output publication remain outside these stages.',
      'Renderer/core/stage/encoding times are inclusive and overlap. Remaining batch time includes session bookkeeping, string operations, checksums and probe work; it is not an exact glue-only time.',
      'Encoding measures encodeInto; copying measures Uint8Array.set into the Wasm input region; decoding includes all TextDecoder.decode calls in the synchronous diagnostic batch. Other copies and native string concatenation are not separately timed.',
      'Submitted source bytes count actual renderer arguments, including stable-prefix rerenders and definition fallback. Core input bytes additionally include completion repairs. Raw kernels bypassing Renderer use the control-block length.',
      'Cache hits use observed core-session result identity. Resets count noncached results with reset=true, including initial option-state resets; they do not infer causes. HTML internal sessions are not observable: their session counters are null, not zero.',
      'Memory growth reports observed page deltas at JS/core boundaries, not the exact number of memory.grow instructions. Parity verification warms memory before measurement.',
      'A workload dominated by JS or too short for sampling can have no named Wasm samples despite a valid name section. Inlined WAT functions need not appear as separate CPU frames.',
    ],
  };
  await mkdir(output, { recursive: true });
  await writeFile(profilePath, JSON.stringify(profile));
  await writeFile(summaryPath, JSON.stringify(report, null, 2) + '\n');
  console.log(
    `Profile ${caseId}: ${report.cpu.totalSamples} samples; ${report.cpu.sampledNamedWasmFunctions} sampled named Wasm functions.`
  );
  console.log(
    `Diagnostic only: ${probes.counters.coreRenderCalls} core renders, ${probes.counters.sourceBytesSubmittedToCore} source bytes submitted, ${probes.counters.cacheHits ?? 'unavailable'} cache hits, ${probes.counters.resets ?? 'unavailable'} resets.`
  );
  if (!probes.sessionObservation.available)
    console.log(
      `Session observation unavailable: ${probes.sessionObservation.reason}`
    );
  console.log(
    `Stages (perturbed): block ${probes.stages.blockAnalysis.milliseconds.toFixed(3)}ms; inline/render ${probes.stages.inlineAndRender.milliseconds.toFixed(3)}ms; completion ${probes.timings.completionMs.toFixed(3)}ms. No speedup claim.`
  );
  console.log(`CPU profile: ${profilePath}\nDiagnostic JSON: ${summaryPath}`);
  return report;
}
