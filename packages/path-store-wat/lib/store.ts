// PathStore over the wasm engine. Same public API as @pierre/path-store's
// PathStore: every tree-wide loop runs inside the module, and this class only
// turns node ids into strings, rows, and events.

import {
  compareSegmentSortKeys,
  createSegmentSortKey,
  getPreparedInputEntries,
  getPreparedInputPresortedPaths,
  prepareInput,
  preparePathEntries,
  preparePaths,
  preparePresortedInput,
} from '@pierre/path-store';
import type {
  PathStoreAddEvent,
  PathStoreChildPatch,
  PathStoreCleanupOptions,
  PathStoreCleanupResult,
  PathStoreCollapseEvent,
  PathStoreCollisionStrategy,
  PathStoreCompareEntry,
  PathStoreConstructorOptions,
  PathStoreDirectoryLoadState,
  PathStoreEventForType,
  PathStoreEventType,
  PathStoreExpandEvent,
  PathStoreFlattenedRowSegment,
  PathStoreInitialExpansion,
  PathStoreLoadAttempt,
  PathStoreMoveEvent,
  PathStoreMoveOptions,
  PathStoreOperation,
  PathStoreOptions,
  PathStorePathComparator,
  PathStorePathInfo,
  PathStorePreparedInput,
  PathStoreRemoveEvent,
  PathStoreRemoveOptions,
  PathStoreSemanticEvent,
  PathStoreVisibleAncestorRow,
  PathStoreVisibleRow,
  PathStoreVisibleRowContext,
  PathStoreVisibleTreeProjection,
  PathStoreVisibleTreeProjectionData,
  PathStoreVisibleTreeProjectionRow,
  SegmentSortKey,
} from '@pierre/path-store';

import {
  ArrayId,
  DEPTH_SHIFT,
  Engine,
  ERROR_DUPLICATE,
  ERROR_UNSORTED,
  FLAG_DIR,
  FLAG_EXPLICIT,
  FLAG_REMOVED,
  FLAG_ROOT,
} from './engine';
import {
  batchEvents,
  createEventState,
  finalizeEvent,
  recordEvent,
  subscribe,
} from './events';
import type { EventState } from './events';

const ROOT_ID = 0;
const ROW_STRIDE = 6;

/** Prepared input carrying raw newline-delimited UTF-8 paths in store order. */
const PRESORTED_BYTES = Symbol('pathStorePresortedBytes');

type PresortedBytesInput = PathStorePreparedInput & {
  [PRESORTED_BYTES]: Uint8Array;
};

interface DirectoryLoadInfo {
  activeAttemptId: number | null;
  errorMessage: string | null;
  nextAttemptId: number;
  state: PathStoreDirectoryLoadState;
}

interface MoveTarget {
  basename: string;
  existingNodeId: number | null;
  parentId: number;
}

/** What `signature` reports for a directory; see src/mutate.wat. */
type ProjectionSignature = [number, number, number] | null;

export interface WasmPathStoreConstructorOptions extends PathStoreConstructorOptions {
  /** Compiled module; defaults to the one registered with `init`. */
  module?: WebAssembly.Module;
}

let sharedModule: WebAssembly.Module | null = null;

/** Register the compiled engine every store constructed without `module` uses. */
export function init(module: WebAssembly.Module): void {
  sharedModule = module;
}

function requireModule(
  module: WebAssembly.Module | undefined
): WebAssembly.Module {
  const resolved = module ?? sharedModule;
  if (resolved == null) {
    throw new Error(
      'No WebAssembly path store module registered: import the package entry or call init() first'
    );
  }
  return resolved;
}

function resolveInitialExpansion(
  initialExpansion: PathStoreInitialExpansion
): number {
  if (initialExpansion === 'open') {
    return 1;
  }
  if (initialExpansion === 'closed') {
    return 0;
  }
  if (!Number.isInteger(initialExpansion) || initialExpansion < 0) {
    throw new Error(
      `initialExpansion must be "open", "closed", or a non-negative integer depth. Received: ${String(
        initialExpansion
      )}`
    );
  }
  return initialExpansion + 2;
}

function splitLookupSegments(path: string): {
  requiresDirectory: boolean;
  segments: string[];
} {
  if (path.length === 0) {
    return { requiresDirectory: false, segments: [] };
  }
  const hasTrailingSlash = path.charCodeAt(path.length - 1) === 47;
  const content = hasTrailingSlash ? path.slice(0, -1) : path;
  return { requiresDirectory: hasTrailingSlash, segments: content.split('/') };
}

export class PathStore {
  readonly #engine: Engine;
  readonly #events: EventState;
  readonly #options: {
    flattenEmptyDirectories: boolean;
    sort: 'default' | PathStorePathComparator;
  };
  readonly #segmentStrings: (string | undefined)[] = [];
  readonly #segmentSortKeys: (SegmentSortKey | undefined)[] = [];
  #pathCache = new Map<number, { path: string; version: number }>();
  #pathCacheVersion = 0;
  readonly #loadInfoById = new Map<number, DirectoryLoadInfo>();

  public constructor(options: WasmPathStoreConstructorOptions = {}) {
    this.#options = {
      flattenEmptyDirectories: options.flattenEmptyDirectories !== false,
      sort: options.sort ?? 'default',
    };
    this.#engine = new Engine(requireModule(options.module), {
      compareNodes: (a, b) => this.#compareNodes(a, b),
      compareSegmentBytes: (aPtr, aLen, bPtr, bLen) =>
        this.#compareSegmentBytes(aPtr, aLen, bPtr, bLen),
      compareSegments: (a, b) => this.#compareSegments(a, b),
    });
    this.#events = createEventState(() => this.#engine.exports.visibleCount());
    this.#pathCache.set(ROOT_ID, { path: '', version: 0 });
    this.#build(options);
  }

  public static preparePaths(
    paths: readonly string[],
    options: PathStoreOptions = {}
  ): string[] {
    return preparePaths(paths, options);
  }

  public static prepareInput(
    paths: readonly string[],
    options: PathStoreOptions = {}
  ): PathStorePreparedInput {
    return prepareInput(paths, options);
  }

  public static preparePresortedInput(
    paths: readonly string[]
  ): PathStorePreparedInput {
    return preparePresortedInput(paths);
  }

  /**
   * Prepared input straight from newline-delimited UTF-8 bytes already in
   * store order (a trailing '/' marks an explicit directory). This engine
   * ingests the bytes without creating a JS string per path; `paths` (and
   * the JS engine, through `presortedPaths`) decode them only on demand.
   */
  public static preparePresortedBytes(
    bytes: Uint8Array
  ): PathStorePreparedInput {
    let decoded: string[] | null = null;
    const decode = (): readonly string[] => {
      if (decoded == null) {
        const text = new TextDecoder().decode(bytes);
        decoded = text.length === 0 ? [] : text.replace(/\n$/, '').split('\n');
      }
      return decoded;
    };
    const input = {
      [PRESORTED_BYTES]: bytes,
      get paths(): readonly string[] {
        return decode();
      },
      get presortedPaths(): readonly string[] {
        return decode();
      },
    };
    return input satisfies PresortedBytesInput;
  }

  // --- construction -------------------------------------------------------

  #build(options: WasmPathStoreConstructorOptions): void {
    const exports = this.#engine.exports;
    exports.reset();
    this.#engine.sync();

    const input = this.#writeInput(options);
    exports.storeInit(input.lines);
    const error = exports.ingest(
      input.ptr,
      input.len,
      input.validate === true ? 1 : 0
    );
    this.#engine.sync();
    if (error !== 0) {
      this.#throwIngestError(error, input.ptr);
    }
    exports.finishIngest();

    const initialExpansion = options.initialExpansion ?? 'closed';
    exports.configure(
      this.#options.flattenEmptyDirectories ? 1 : 0,
      resolveInitialExpansion(initialExpansion),
      this.#options.sort === 'default' ? 0 : 1
    );

    const expandedPaths = options.initialExpandedPaths;
    if (expandedPaths != null && expandedPaths.length > 0) {
      const written = this.#engine.writeInputPaths(expandedPaths);
      const expandedCount = exports.resolveExpandedPaths(
        written.ptr,
        written.len
      );
      exports.inputDrop();
      // Every directory open under a closed default: switch to the open
      // default and let later directories start collapsed, the same shape
      // PathStore's explicit-open fast path produces.
      if (
        initialExpansion === 'closed' &&
        expandedCount === exports.liveDirCount()
      ) {
        exports.openAll();
      }
    }

    exports.initCounts();
    exports.compact();
    this.#engine.sync();
  }

  #writeInput(options: WasmPathStoreConstructorOptions): {
    len: number;
    lines: number;
    ptr: number;
    validate?: boolean;
  } {
    const prepared = options.preparedInput;
    if (prepared != null) {
      const bytes = (prepared as Partial<PresortedBytesInput>)[PRESORTED_BYTES];
      if (bytes != null) {
        const written = this.#engine.writeInputBytes(bytes);
        return {
          ...written,
          lines: this.#engine.exports.countLines(written.ptr, written.len) + 1,
        };
      }
      const presorted = getPreparedInputPresortedPaths(prepared);
      if (presorted != null) {
        return {
          ...this.#engine.writeInputPaths(presorted),
          lines: presorted.length,
        };
      }
      const entries = getPreparedInputEntries(prepared);
      const paths = entries.map((entry) => entry.path);
      return { ...this.#engine.writeInputPaths(paths), lines: paths.length };
    }

    const inputPaths = options.paths ?? [];
    if (options.presorted === true) {
      return {
        ...this.#engine.writeInputPaths(inputPaths),
        lines: inputPaths.length,
        validate: true,
      };
    }
    const entries = preparePathEntries(inputPaths, options);
    const paths = entries.map((entry) => entry.path);
    return { ...this.#engine.writeInputPaths(paths), lines: paths.length };
  }

  #throwIngestError(code: number, inputPtr: number): never {
    const at = this.#engine.result[1];
    const bytes = this.#engine.bytes;
    let end = inputPtr + at;
    while (end < bytes.length && bytes[end] !== 10 && bytes[end] !== 0) {
      end += 1;
    }
    const line = new TextDecoder().decode(bytes.subarray(inputPtr + at, end));
    if (code === ERROR_DUPLICATE) {
      throw new Error(`Duplicate path: "${line}"`);
    }
    if (code === ERROR_UNSORTED) {
      throw new Error(
        `Builder input must be sorted before appendPaths(): "${line}"`
      );
    }
    throw new Error(`Invalid path input near "${line}"`);
  }

  // --- host comparators -------------------------------------------------------

  #segmentText(segmentId: number): string {
    const cached = this.#segmentStrings[segmentId];
    if (cached !== undefined) {
      return cached;
    }
    const text = this.#engine.segmentText(segmentId);
    this.#segmentStrings[segmentId] = text;
    return text;
  }

  #segmentSortKey(segmentId: number): SegmentSortKey {
    const cached = this.#segmentSortKeys[segmentId];
    if (cached !== undefined) {
      return cached;
    }
    const key = createSegmentSortKey(this.#segmentText(segmentId));
    this.#segmentSortKeys[segmentId] = key;
    return key;
  }

  #compareSegmentBytes(
    aPtr: number,
    aLen: number,
    bPtr: number,
    bLen: number
  ): number {
    const bytes = this.#engine.bytes;
    const decoder = new TextDecoder();
    return compareSegmentSortKeys(
      createSegmentSortKey(decoder.decode(bytes.subarray(aPtr, aPtr + aLen))),
      createSegmentSortKey(decoder.decode(bytes.subarray(bPtr, bPtr + bLen)))
    );
  }

  #compareSegments(a: number, b: number): number {
    return compareSegmentSortKeys(
      this.#segmentSortKey(a),
      this.#segmentSortKey(b)
    );
  }

  #compareNodes(a: number, b: number): number {
    const sort = this.#options.sort;
    if (sort === 'default') {
      return 0;
    }
    return sort(this.#compareEntry(a), this.#compareEntry(b));
  }

  #compareEntry(nodeId: number): PathStoreCompareEntry {
    const path = this.#materializePath(nodeId);
    const isDirectory = this.#isDir(nodeId);
    const normalized = isDirectory ? path.slice(0, -1) : path;
    return {
      basename: this.#segmentText(this.#engine.i32(ArrayId.name)[nodeId]),
      depth: this.#depth(nodeId),
      isDirectory,
      path,
      segments: normalized.length === 0 ? [] : normalized.split('/'),
    };
  }

  // --- node reads ---------------------------------------------------------------

  #meta(nodeId: number): number {
    const meta = this.#engine.i32(ArrayId.meta);
    if (nodeId < 0 || nodeId >= meta.length) {
      return FLAG_REMOVED;
    }
    return meta[nodeId];
  }

  #isDir(nodeId: number): boolean {
    return (this.#meta(nodeId) & FLAG_DIR) !== 0;
  }

  #depth(nodeId: number): number {
    return this.#meta(nodeId) >>> DEPTH_SHIFT;
  }

  #requireLive(nodeId: number): void {
    if ((this.#meta(nodeId) & FLAG_REMOVED) !== 0) {
      throw new Error(`Unknown node ID: ${String(nodeId)}`);
    }
  }

  #parentOf(nodeId: number): number {
    return this.#engine.i32(ArrayId.parent)[nodeId];
  }

  #childCount(nodeId: number): number {
    const dir = this.#engine.i32(ArrayId.dir)[nodeId];
    return this.#engine.i32(ArrayId.dChildCount)[dir];
  }

  #ancestorIds(nodeId: number): number[] {
    const ids: number[] = [];
    let current = nodeId;
    while (true) {
      this.#requireLive(current);
      ids.push(current);
      if (current === ROOT_ID) {
        return ids;
      }
      current = this.#parentOf(current);
    }
  }

  #lookup(path: string, requireDirectory = false): number {
    if (path.length === 0) {
      return ROOT_ID;
    }
    const encoded = this.#engine.encodeScratch(path);
    const id = this.#engine.exports.lookup(
      encoded.ptr,
      encoded.len,
      requireDirectory ? 1 : 0
    );
    this.#engine.sync();
    return id;
  }

  #materializePath(nodeId: number): string {
    this.#requireLive(nodeId);
    const cached = this.#pathCache.get(nodeId);
    if (cached != null && cached.version === this.#pathCacheVersion) {
      return cached.path;
    }
    this.#engine.exports.nodePath(nodeId);
    this.#engine.sync();
    const path = this.#engine.outText();
    this.#pathCache.set(nodeId, { path, version: this.#pathCacheVersion });
    return path;
  }

  #signature(nodeId: number): ProjectionSignature {
    this.#engine.exports.signature(nodeId);
    const result = this.#engine.result;
    if (result[2] === -1) {
      return null;
    }
    return [result[2], result[3], result[4]];
  }

  #didProjectionChange(
    before: ProjectionSignature,
    after: ProjectionSignature
  ): boolean {
    if (before == null || after == null) {
      return true;
    }
    return (
      before[0] !== after[0] || before[1] !== after[1] || before[2] !== after[2]
    );
  }

  #forgetRemovedNodes(): void {
    const removed = this.#engine.outI32();
    for (let index = 0; index < removed.length; index += 1) {
      const id = removed[index];
      this.#pathCache.delete(id);
      this.#loadInfoById.delete(id);
    }
  }

  #isDirectoryProjectionVisible(directoryNodeId: number): boolean {
    const exports = this.#engine.exports;
    let current = directoryNodeId;
    while (current !== ROOT_ID) {
      this.#requireLive(current);
      const parent = this.#parentOf(current);
      if (parent !== ROOT_ID) {
        if (
          exports.isExpanded(parent) === 0 &&
          exports.flattenedChild(parent) !== current
        ) {
          return false;
        }
      }
      current = parent;
    }
    return true;
  }

  #requireDirectoryNodeId(path: string): number {
    const id = this.#lookup(path);
    if (id === -1) {
      throw new Error(`Path does not exist: "${path}"`);
    }
    if (!this.#isDir(id)) {
      throw new Error(`Path is not a directory: "${path}"`);
    }
    return id;
  }

  // --- reads -------------------------------------------------------------------------

  public list(path?: string): string[] {
    const id = path == null ? ROOT_ID : this.#lookup(path);
    if (id === -1) {
      return [];
    }
    this.#engine.exports.listPaths(id);
    this.#engine.sync();
    return this.#engine.lines(ArrayId.out);
  }

  public getNodeCount(): number {
    return this.#engine.exports.activeNodeCount();
  }

  public getVisibleCount(): number {
    return this.#engine.exports.visibleCount();
  }

  public getPathInfo(path: string): PathStorePathInfo | null {
    const id = this.#lookup(path);
    if (id === -1) {
      return null;
    }
    return {
      depth: this.#depth(id),
      kind: this.#isDir(id) ? 'directory' : 'file',
      path: this.#materializePath(id),
    };
  }

  public isExpanded(path: string): boolean {
    const id = this.#requireDirectoryNodeId(path);
    return this.#engine.exports.isExpanded(id) !== 0;
  }

  public getVisibleIndex(path: string): number | null {
    const id = this.#lookup(path);
    if (id === -1 || id === ROOT_ID) {
      return null;
    }
    const index = this.#engine.exports.visibleIndexOf(id);
    return index === -1 ? null : index;
  }

  public getVisibleSlice(
    start: number,
    end: number
  ): readonly PathStoreVisibleRow[] {
    const total = this.getVisibleCount();
    if (total <= 0 || end < start) {
      return [];
    }
    const normalizedStart = Math.max(0, Math.min(start, total - 1));
    const normalizedEnd = Math.max(normalizedStart, Math.min(end, total - 1));
    const exports = this.#engine.exports;
    exports.collectRows(normalizedStart, normalizedEnd - normalizedStart + 1);
    this.#engine.sync();
    const records = this.#engine.outI32().slice();
    const rowCount = records.length / ROW_STRIDE;
    const paths = this.#rowPaths(records, rowCount, true);
    const rows: PathStoreVisibleRow[] = new Array(rowCount);
    for (let index = 0; index < rowCount; index += 1) {
      const at = index * ROW_STRIDE;
      rows[index] = this.#materializeRow(
        records[at],
        records[at + 1],
        records[at + 2],
        paths[index]
      );
    }
    return rows;
  }

  /**
   * Paths for the rows `collectRows` wrote: a row under another row of the
   * window extends that row's path by its own name (one string concat, the
   * same shape the JS engine builds); rows whose parent is above the window
   * and flattened rows take the engine's path for their terminal node.
   * Window reads remember their paths like materializeNodePath would; the
   * full projection does not, as a million Map entries cost more than they
   * save.
   */
  #rowPaths(records: Int32Array, rowCount: number, cache: boolean): string[] {
    const names = this.#engine.i32(ArrayId.name);
    const meta = this.#engine.i32(ArrayId.meta);
    const version = this.#pathCacheVersion;
    const paths: string[] = new Array(rowCount);
    for (let index = 0; index < rowCount; index += 1) {
      const at = index * ROW_STRIDE;
      const headId = records[at];
      const terminalId = records[at + 1];
      const parentRow = records[at + 5];
      let path: string;
      if (parentRow < 0 || headId !== terminalId) {
        path = this.#materializePath(terminalId);
      } else {
        const name = this.#segmentText(names[terminalId]);
        path =
          (meta[terminalId] & FLAG_DIR) !== 0
            ? `${paths[parentRow]}${name}/`
            : `${paths[parentRow]}${name}`;
        if (cache) {
          this.#pathCache.set(terminalId, { path, version });
        }
      }
      paths[index] = path;
    }
    return paths;
  }

  #materializeRow(
    headId: number,
    terminalId: number,
    visibleDepth: number,
    path: string
  ): PathStoreVisibleRow {
    const exports = this.#engine.exports;
    const isDirectory = this.#isDir(terminalId);
    const isFlattened = headId !== terminalId;
    const loadState = isDirectory
      ? this.#rowLoadState(headId, terminalId)
      : null;
    return {
      depth: visibleDepth,
      flattenedSegments: isFlattened
        ? this.#flattenedSegments(headId, terminalId)
        : undefined,
      hasChildren: isDirectory && this.#childCount(terminalId) > 0,
      id: terminalId,
      isExpanded: isDirectory && exports.isExpanded(terminalId) !== 0,
      isFlattened,
      isLoading: loadState === 'loading',
      kind: isDirectory ? 'directory' : 'file',
      loadState:
        loadState == null || loadState === 'loaded' ? undefined : loadState,
      name: this.#segmentText(this.#engine.i32(ArrayId.name)[terminalId]),
      path,
    };
  }

  #flattenChainIds(headId: number): number[] {
    this.#engine.exports.flattenChain(headId);
    this.#engine.sync();
    return Array.from(this.#engine.outI32());
  }

  #flattenedSegments(
    headId: number,
    terminalId: number
  ): PathStoreFlattenedRowSegment[] {
    const names = this.#engine.i32(ArrayId.name);
    return this.#flattenChainIds(headId).map((nodeId) => ({
      isTerminal: nodeId === terminalId,
      name: this.#segmentText(names[nodeId]),
      nodeId,
      path: this.#materializePath(nodeId),
    }));
  }

  #rowLoadState(
    headId: number,
    terminalId: number
  ): PathStoreDirectoryLoadState {
    if (headId === terminalId) {
      return this.#loadInfoById.get(terminalId)?.state ?? 'loaded';
    }
    let hasUnloaded = false;
    let hasError = false;
    for (const nodeId of this.#flattenChainIds(headId)) {
      const state = this.#loadInfoById.get(nodeId)?.state ?? 'loaded';
      if (state === 'loading') {
        return 'loading';
      }
      if (state === 'error') {
        hasError = true;
      } else if (state === 'unloaded') {
        hasUnloaded = true;
      }
    }
    return hasError ? 'error' : hasUnloaded ? 'unloaded' : 'loaded';
  }

  public getVisibleRowContext(
    index: number
  ): PathStoreVisibleRowContext | null {
    const total = this.getVisibleCount();
    if (index < 0 || index >= total) {
      return null;
    }
    this.#engine.exports.rowContext(index);
    this.#engine.sync();
    const records = this.#engine.outI32().slice();
    const count = records.length / ROW_STRIDE;
    const visible = this.#engine.i32(ArrayId.visible);
    const subtreeEnd = (terminalId: number, rowIndex: number): number =>
      Math.min(total - 1, rowIndex + Math.max(1, visible[terminalId]) - 1);
    const rowAt = count - 1;
    const row = this.#materializeRow(
      records[rowAt * ROW_STRIDE],
      records[rowAt * ROW_STRIDE + 1],
      records[rowAt * ROW_STRIDE + 2],
      this.#materializePath(records[rowAt * ROW_STRIDE + 1])
    );
    const ancestorPaths: string[] = [];
    for (let ancestor = 0; ancestor < rowAt; ancestor += 1) {
      ancestorPaths.push(
        this.#materializePath(records[ancestor * ROW_STRIDE + 1])
      );
    }
    let cachedAncestorRows: readonly PathStoreVisibleAncestorRow[] | null =
      null;
    const materializeAncestorRows =
      (): readonly PathStoreVisibleAncestorRow[] => {
        if (cachedAncestorRows != null) {
          return cachedAncestorRows;
        }
        const rows: PathStoreVisibleAncestorRow[] = [];
        const rowAncestorPaths: string[] = [];
        for (let ancestor = 0; ancestor < rowAt; ancestor += 1) {
          const at = ancestor * ROW_STRIDE;
          const ancestorRow = this.#materializeRow(
            records[at],
            records[at + 1],
            records[at + 2],
            this.#materializePath(records[at + 1])
          );
          rows.push({
            ancestorPaths: [...rowAncestorPaths],
            index: records[at + 5],
            posInSet: records[at + 3],
            row: ancestorRow,
            setSize: records[at + 4],
            subtreeEndIndex: subtreeEnd(records[at + 1], records[at + 5]),
          });
          rowAncestorPaths.push(ancestorRow.path);
        }
        cachedAncestorRows = rows;
        return rows;
      };
    return {
      ancestorPaths,
      get ancestorRows() {
        return materializeAncestorRows();
      },
      index: records[rowAt * ROW_STRIDE + 5],
      posInSet: records[rowAt * ROW_STRIDE + 3],
      row,
      setSize: records[rowAt * ROW_STRIDE + 4],
      subtreeEndIndex: subtreeEnd(
        records[rowAt * ROW_STRIDE + 1],
        records[rowAt * ROW_STRIDE + 5]
      ),
    };
  }

  public getVisibleTreeProjectionData(
    maxRows: number = this.getVisibleCount()
  ): PathStoreVisibleTreeProjectionData {
    const exports = this.#engine.exports;
    exports.collectRows(0, maxRows);
    this.#engine.sync();
    const records = this.#engine.outI32();
    const rowCount = records.length / ROW_STRIDE;
    const parentRowIndex = new Int32Array(rowCount);
    const posInSetByIndex = new Int32Array(rowCount);
    const setSizeByIndex = new Int32Array(rowCount);
    for (let index = 0; index < rowCount; index += 1) {
      const at = index * ROW_STRIDE;
      posInSetByIndex[index] = records[at + 3];
      setSizeByIndex[index] = records[at + 4];
      parentRowIndex[index] = records[at + 5];
    }
    const paths = this.#rowPaths(records, rowCount, false);
    let cachedVisibleIndexByPath: Map<string, number> | null = null;
    return {
      getParentIndex(index: number): number {
        return index < 0 || index >= rowCount ? -1 : parentRowIndex[index];
      },
      paths,
      posInSetByIndex,
      setSizeByIndex,
      get visibleIndexByPath(): Map<string, number> {
        if (cachedVisibleIndexByPath == null) {
          cachedVisibleIndexByPath = new Map();
          for (let index = 0; index < rowCount; index += 1) {
            cachedVisibleIndexByPath.set(paths[index], index);
          }
        }
        return cachedVisibleIndexByPath;
      },
    };
  }

  public getVisibleTreeProjection(): PathStoreVisibleTreeProjection {
    const data = this.getVisibleTreeProjectionData();
    const rows: PathStoreVisibleTreeProjectionRow[] = new Array(
      data.paths.length
    );
    for (let index = 0; index < data.paths.length; index += 1) {
      const parentIndex = data.getParentIndex(index);
      rows[index] = {
        index,
        parentPath: parentIndex >= 0 ? data.paths[parentIndex] : null,
        path: data.paths[index],
        posInSet: data.posInSetByIndex[index],
        setSize: data.setSizeByIndex[index],
      };
    }
    return {
      getParentIndex: data.getParentIndex,
      rows,
      get visibleIndexByPath(): Map<string, number> {
        return data.visibleIndexByPath;
      },
    };
  }

  // --- expansion -------------------------------------------------------------------

  public expand(path: string): void {
    const previousVisibleCount = this.getVisibleCount();
    const event = this.#setExpansion(path, true);
    if (event != null) {
      recordEvent(
        this.#events,
        finalizeEvent(this.#events, previousVisibleCount, event)
      );
    }
  }

  public collapse(path: string): void {
    const previousVisibleCount = this.getVisibleCount();
    const event = this.#setExpansion(path, false);
    if (event != null) {
      recordEvent(
        this.#events,
        finalizeEvent(this.#events, previousVisibleCount, event)
      );
    }
  }

  #setExpansion(
    path: string,
    expanded: boolean
  ): PathStoreExpandEvent | PathStoreCollapseEvent | null {
    const id = this.#requireDirectoryNodeId(path);
    const exports = this.#engine.exports;
    if ((exports.isExpanded(id) !== 0) === expanded) {
      return null;
    }
    exports.setExpanded(id, expanded ? 1 : 0);
    exports.recomputeUpward(id);
    this.#engine.sync();
    return {
      affectedAncestorIds: this.#ancestorIds(id),
      affectedNodeIds: [id],
      canonicalChanged: false,
      operation: expanded ? 'expand' : 'collapse',
      path,
      projectionChanged: true,
      visibleCountDelta: null,
    };
  }

  // --- mutations ---------------------------------------------------------------------

  public add(path: string): void {
    const previousVisibleCount = this.getVisibleCount();
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, this.#addPath(path))
    );
  }

  public remove(path: string, options: PathStoreRemoveOptions = {}): void {
    const previousVisibleCount = this.getVisibleCount();
    recordEvent(
      this.#events,
      finalizeEvent(
        this.#events,
        previousVisibleCount,
        this.#removePath(path, options)
      )
    );
  }

  public move(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions = {}
  ): void {
    const previousVisibleCount = this.getVisibleCount();
    const event = this.#movePath(fromPath, toPath, options);
    if (event != null) {
      recordEvent(
        this.#events,
        finalizeEvent(this.#events, previousVisibleCount, event)
      );
    }
  }

  public batch(
    operations: readonly PathStoreOperation[] | ((store: PathStore) => void)
  ): void {
    batchEvents(this.#events, () => {
      if (typeof operations === 'function') {
        operations(this);
        return;
      }
      for (const operation of operations) {
        this.#applyOperation(operation);
      }
    });
  }

  #applyOperation(operation: PathStoreOperation): void {
    switch (operation.type) {
      case 'add':
        this.add(operation.path);
        break;
      case 'remove':
        this.remove(operation.path, { recursive: operation.recursive });
        break;
      case 'move':
        this.move(operation.from, operation.to, {
          collision: operation.collision,
        });
        break;
    }
  }

  #addPath(path: string): PathStoreAddEvent {
    const exports = this.#engine.exports;
    const isDirectory =
      path.length > 0 && path.charCodeAt(path.length - 1) === 47;
    const content = isDirectory ? path.slice(0, -1) : path;
    const lastSlash = content.lastIndexOf('/');
    const directoryPart = isDirectory
      ? content
      : lastSlash === -1
        ? ''
        : content.slice(0, lastSlash);
    const basename = isDirectory ? '' : content.slice(lastSlash + 1);

    const directoryBytes = this.#engine.encodeScratch(directoryPart);
    const previousSignature = this.#signature(
      exports.deepestExistingDir(directoryBytes.ptr, directoryBytes.len)
    );
    const directoryId = exports.ensureDirChain(
      directoryBytes.ptr,
      directoryBytes.len
    );
    this.#engine.sync();
    if (directoryId === -1) {
      const fileId = this.#engine.result[1];
      throw new Error(
        `Cannot create a directory that collides with an existing file: "${this.#segmentText(
          this.#engine.i32(ArrayId.name)[fileId]
        )}"`
      );
    }
    const affectedNodeIds = new Set<number>(this.#engine.outI32());
    let addedNodeId = directoryId;

    if (isDirectory) {
      if ((this.#meta(directoryId) & FLAG_EXPLICIT) !== 0) {
        throw new Error(`Path already exists: "${path}"`);
      }
      exports.addFlag(directoryId, FLAG_EXPLICIT);
      this.#pathCache.set(directoryId, {
        path,
        version: this.#pathCacheVersion,
      });
      affectedNodeIds.add(directoryId);
    } else {
      const nameBytes = this.#engine.encodeScratch(basename);
      addedNodeId = exports.createFile(
        directoryId,
        nameBytes.ptr,
        nameBytes.len
      );
      this.#engine.sync();
      if (addedNodeId === -1) {
        const parentPath = this.#materializePath(directoryId);
        throw new Error(
          `Path already exists: "${parentPath.length === 0 ? basename : `${parentPath}${basename}`}"`
        );
      }
      affectedNodeIds.add(addedNodeId);
    }

    exports.recomputeUpward(directoryId);
    const nextSignature = this.#signature(directoryId);
    return {
      affectedAncestorIds: this.#ancestorIds(addedNodeId),
      affectedNodeIds: [...affectedNodeIds],
      canonicalChanged: true,
      operation: 'add',
      path,
      projectionChanged: this.#didProjectionChange(
        previousSignature,
        nextSignature
      ),
      visibleCountDelta: null,
    };
  }

  #removePath(
    path: string,
    options: PathStoreRemoveOptions
  ): PathStoreRemoveEvent {
    const id = this.#lookup(path);
    if (id === -1) {
      throw new Error(`Path does not exist: "${path}"`);
    }
    if ((this.#meta(id) & FLAG_ROOT) !== 0) {
      throw new Error('The root node cannot be removed');
    }
    if (
      this.#isDir(id) &&
      this.#childCount(id) > 0 &&
      options.recursive !== true
    ) {
      throw new Error(
        `Cannot remove a non-empty directory without recursive: "${path}"`
      );
    }

    const parentId = this.#parentOf(id);
    const previousSignature = this.#signature(parentId);
    this.#engine.exports.removeNode(id);
    this.#engine.sync();
    const removedNodeIds = Array.from(this.#engine.outI32());
    this.#forgetRemovedNodes();
    const nextSignature = this.#signature(parentId);
    return {
      affectedAncestorIds: this.#ancestorIds(parentId),
      affectedNodeIds: removedNodeIds,
      canonicalChanged: true,
      operation: 'remove',
      path,
      projectionChanged: this.#didProjectionChange(
        previousSignature,
        nextSignature
      ),
      recursive: options.recursive === true,
      visibleCountDelta: null,
    };
  }

  #resolveMoveTarget(sourceNodeId: number, toPath: string): MoveTarget {
    const existing = this.#lookup(toPath);
    if (existing !== -1) {
      if (this.#isDir(existing)) {
        return {
          basename: this.#segmentText(
            this.#engine.i32(ArrayId.name)[sourceNodeId]
          ),
          existingNodeId: null,
          parentId: existing,
        };
      }
      const segments = splitLookupSegments(toPath).segments;
      return {
        basename: segments[segments.length - 1] ?? '',
        existingNodeId: existing,
        parentId: this.#parentOf(existing),
      };
    }

    const segments = splitLookupSegments(toPath).segments;
    const basename = segments[segments.length - 1] ?? '';
    const parentSegments = segments.slice(0, -1);
    const parentId =
      parentSegments.length === 0
        ? ROOT_ID
        : this.#lookup(`${parentSegments.join('/')}/`, true);
    if (parentId === -1) {
      throw new Error(`Destination parent does not exist: "${toPath}"`);
    }
    return { basename, existingNodeId: null, parentId };
  }

  #handleMoveCollision(
    collisionNodeId: number,
    strategy: PathStoreCollisionStrategy,
    sourceIsDirectory: boolean
  ): 'handled' | 'skip' {
    if (strategy === 'skip') {
      return 'skip';
    }
    if (strategy === 'error') {
      throw new Error(
        `Destination already exists: "${this.#materializePath(collisionNodeId)}"`
      );
    }
    const collisionIsDirectory = this.#isDir(collisionNodeId);
    if (collisionIsDirectory !== sourceIsDirectory) {
      throw new Error(
        'replace collision requires the same source and destination kinds'
      );
    }
    if (collisionIsDirectory && this.#childCount(collisionNodeId) > 0) {
      throw new Error(
        'replace collision does not support non-empty directories'
      );
    }
    this.#engine.exports.removeNode(collisionNodeId);
    this.#engine.sync();
    this.#forgetRemovedNodes();
    return 'handled';
  }

  #movePath(
    fromPath: string,
    toPath: string,
    options: PathStoreMoveOptions
  ): PathStoreMoveEvent | null {
    const exports = this.#engine.exports;
    const sourceNodeId = this.#lookup(fromPath);
    if (sourceNodeId === -1) {
      throw new Error(`Source path does not exist: "${fromPath}"`);
    }
    if ((this.#meta(sourceNodeId) & FLAG_ROOT) !== 0) {
      throw new Error('The root node cannot be moved');
    }

    const collision = options.collision ?? 'error';
    const target = this.#resolveMoveTarget(sourceNodeId, toPath);
    const sourceParentId = this.#parentOf(sourceNodeId);
    const previousSourceSignature = this.#signature(sourceParentId);
    const previousTargetSignature = this.#signature(target.parentId);
    const sourceName = this.#segmentText(
      this.#engine.i32(ArrayId.name)[sourceNodeId]
    );
    const nameBytes = this.#engine.encodeScratch(target.basename);
    const targetNameId = exports.internSegment(nameBytes.ptr, nameBytes.len);
    this.#engine.sync();

    if (target.parentId === sourceParentId && sourceName === target.basename) {
      return null;
    }
    const sourceIsDirectory = this.#isDir(sourceNodeId);
    if (
      sourceIsDirectory &&
      exports.isAncestor(sourceNodeId, target.parentId) !== 0
    ) {
      throw new Error('Cannot move a directory into one of its descendants');
    }

    const siblingCollisionId = exports.findChild(target.parentId, targetNameId);
    this.#engine.sync();
    const collisionNodeId =
      target.existingNodeId ??
      (siblingCollisionId === -1 ? null : siblingCollisionId);
    if (collisionNodeId != null && collisionNodeId !== sourceNodeId) {
      if (
        this.#handleMoveCollision(
          collisionNodeId,
          collision,
          sourceIsDirectory
        ) === 'skip'
      ) {
        return null;
      }
    }

    const previousParentId = exports.moveNode(
      sourceNodeId,
      target.parentId,
      targetNameId
    );
    this.#engine.sync();
    this.#pathCache.delete(sourceNodeId);
    this.#pathCacheVersion += 1;
    const nextSourceSignature = this.#signature(previousParentId);
    const nextTargetSignature = this.#signature(target.parentId);
    return {
      affectedAncestorIds: [
        ...new Set([
          ...this.#ancestorIds(previousParentId),
          ...this.#ancestorIds(target.parentId),
        ]),
      ],
      affectedNodeIds: [sourceNodeId],
      canonicalChanged: true,
      from: fromPath,
      operation: 'move',
      projectionChanged:
        this.#didProjectionChange(
          previousSourceSignature,
          nextSourceSignature
        ) ||
        this.#didProjectionChange(previousTargetSignature, nextTargetSignature),
      to: this.#materializePath(sourceNodeId),
      visibleCountDelta: null,
    };
  }

  // --- events ----------------------------------------------------------------------------

  public on<TType extends PathStoreEventType | '*'>(
    type: TType,
    handler: (event: PathStoreEventForType<TType>) => void
  ): () => void {
    return subscribe(this.#events, type, handler);
  }

  // --- async child loading ----------------------------------------------------------------

  #loadInfo(nodeId: number): DirectoryLoadInfo {
    const existing = this.#loadInfoById.get(nodeId);
    if (existing != null) {
      return existing;
    }
    const info: DirectoryLoadInfo = {
      activeAttemptId: null,
      errorMessage: null,
      nextAttemptId: 1,
      state: 'loaded',
    };
    this.#loadInfoById.set(nodeId, info);
    return info;
  }

  public getDirectoryLoadState(path: string): PathStoreDirectoryLoadState {
    const id = this.#requireDirectoryNodeId(path);
    return this.#loadInfoById.get(id)?.state ?? 'loaded';
  }

  public markDirectoryUnloaded(path: string): void {
    const id = this.#requireDirectoryNodeId(path);
    if (this.#childCount(id) > 0) {
      throw new Error(
        `Cannot mark a directory with known children as unloaded: "${path}"`
      );
    }
    const previousVisibleCount = this.getVisibleCount();
    const info = this.#loadInfo(id);
    info.activeAttemptId = null;
    info.errorMessage = null;
    info.state = 'unloaded';
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, {
        affectedAncestorIds: this.#ancestorIds(id),
        affectedNodeIds: [id],
        canonicalChanged: false,
        operation: 'mark-directory-unloaded',
        path,
        projectionChanged: this.#isDirectoryProjectionVisible(id),
        visibleCountDelta: null,
      })
    );
  }

  public beginChildLoad(path: string): PathStoreLoadAttempt {
    const id = this.#requireDirectoryNodeId(path);
    const previousVisibleCount = this.getVisibleCount();
    const info = this.#loadInfo(id);
    let attempt: PathStoreLoadAttempt;
    if (info.state === 'loading' && info.activeAttemptId != null) {
      attempt = { attemptId: info.activeAttemptId, nodeId: id, reused: true };
    } else {
      const attemptId = info.nextAttemptId;
      info.activeAttemptId = attemptId;
      info.errorMessage = null;
      info.nextAttemptId += 1;
      info.state = 'loading';
      attempt = { attemptId, nodeId: id, reused: false };
    }
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, {
        affectedAncestorIds: this.#ancestorIds(id),
        affectedNodeIds: [id],
        attemptId: attempt.attemptId,
        canonicalChanged: false,
        operation: 'begin-child-load',
        path,
        projectionChanged: this.#isDirectoryProjectionVisible(id),
        reused: attempt.reused,
        visibleCountDelta: null,
      })
    );
    return attempt;
  }

  #resolveActiveDirectoryNodeId(nodeId: number): number | null {
    if ((this.#meta(nodeId) & FLAG_REMOVED) !== 0 || !this.#isDir(nodeId)) {
      return null;
    }
    return nodeId;
  }

  public applyChildPatch(
    attempt: PathStoreLoadAttempt,
    patch: PathStoreChildPatch
  ): boolean {
    const id = this.#resolveActiveDirectoryNodeId(attempt.nodeId);
    if (id == null) {
      return false;
    }
    const info = this.#loadInfoById.get(id);
    if (
      info == null ||
      info.state !== 'loading' ||
      info.activeAttemptId !== attempt.attemptId
    ) {
      return false;
    }

    const directoryPath = this.#materializePath(id);
    // Validate against a throwaway subtree store first so the live store
    // stays atomic when a later operation would fail.
    const validationStore = new PathStore({
      module: requireModule(undefined),
      paths: this.list(directoryPath),
      presorted: true,
      sort: this.#options.sort,
    });
    validationStore.batch(patch.operations);

    const previousVisibleCount = this.getVisibleCount();
    const childEvents: PathStoreSemanticEvent[] = [];
    for (const operation of patch.operations) {
      assertOperationTargetsDirectory(directoryPath, operation);
      const operationVisibleCount = this.getVisibleCount();
      switch (operation.type) {
        case 'add':
          childEvents.push(
            finalizeEvent(
              this.#events,
              operationVisibleCount,
              this.#addPath(operation.path)
            )
          );
          break;
        case 'remove':
          childEvents.push(
            finalizeEvent(
              this.#events,
              operationVisibleCount,
              this.#removePath(operation.path, {
                recursive: operation.recursive,
              })
            )
          );
          break;
        case 'move': {
          const event = this.#movePath(operation.from, operation.to, {
            collision: operation.collision,
          });
          if (event != null) {
            childEvents.push(
              finalizeEvent(this.#events, operationVisibleCount, event)
            );
          }
          break;
        }
      }
    }

    const projectionChanged =
      childEvents.some((event) => event.projectionChanged) ||
      this.#isDirectoryProjectionVisible(id);
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, {
        affectedAncestorIds: this.#ancestorIds(id),
        affectedNodeIds: [id],
        attemptId: attempt.attemptId,
        canonicalChanged: childEvents.some((event) => event.canonicalChanged),
        childEvents,
        operation: 'apply-child-patch',
        path: this.#materializePath(id),
        projectionChanged,
        visibleCountDelta: null,
      })
    );
    return true;
  }

  public completeChildLoad(attempt: PathStoreLoadAttempt): boolean {
    const id = this.#resolveActiveDirectoryNodeId(attempt.nodeId);
    if (id == null) {
      return false;
    }
    const previousVisibleCount = this.getVisibleCount();
    const info = this.#loadInfoById.get(id);
    const applied = info != null && info.activeAttemptId === attempt.attemptId;
    if (applied) {
      info.activeAttemptId = null;
      info.errorMessage = null;
      info.state = 'loaded';
    }
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, {
        affectedAncestorIds: this.#ancestorIds(id),
        affectedNodeIds: [id],
        attemptId: attempt.attemptId,
        canonicalChanged: false,
        operation: 'complete-child-load',
        path: this.#materializePath(id),
        projectionChanged: this.#isDirectoryProjectionVisible(id),
        stale: !applied,
        visibleCountDelta: null,
      })
    );
    return applied;
  }

  public failChildLoad(
    attempt: PathStoreLoadAttempt,
    errorMessage?: string
  ): boolean {
    const id = this.#resolveActiveDirectoryNodeId(attempt.nodeId);
    if (id == null) {
      return false;
    }
    const previousVisibleCount = this.getVisibleCount();
    const info = this.#loadInfoById.get(id);
    const applied = info != null && info.activeAttemptId === attempt.attemptId;
    if (applied) {
      info.activeAttemptId = null;
      info.errorMessage = errorMessage ?? null;
      info.state = 'error';
    }
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, {
        affectedAncestorIds: this.#ancestorIds(id),
        affectedNodeIds: [id],
        attemptId: attempt.attemptId,
        canonicalChanged: false,
        errorMessage,
        operation: 'fail-child-load',
        path: this.#materializePath(id),
        projectionChanged: this.#isDirectoryProjectionVisible(id),
        stale: !applied,
        visibleCountDelta: null,
      })
    );
    return applied;
  }

  // --- cleanup -------------------------------------------------------------------------------

  #cleanupMetrics(): {
    activeNodeCount: number;
    cachedPathEntryCount: number;
    loadInfoEntryCount: number;
    segmentCount: number;
    totalNodeSlotCount: number;
  } {
    const exports = this.#engine.exports;
    let cachedPathEntryCount = 0;
    for (const [nodeId, entry] of this.#pathCache) {
      if (
        entry.version === this.#pathCacheVersion &&
        (this.#meta(nodeId) & FLAG_REMOVED) === 0
      ) {
        cachedPathEntryCount += 1;
      }
    }
    return {
      activeNodeCount: exports.activeNodeCount(),
      cachedPathEntryCount,
      loadInfoEntryCount: this.#loadInfoById.size,
      segmentCount: Math.max(0, exports.segmentCount() - 1),
      totalNodeSlotCount: Math.max(0, exports.nodeCount() - 1),
    };
  }

  public cleanup(
    options: PathStoreCleanupOptions = {}
  ): PathStoreCleanupResult {
    if (this.#events.transactionStack.length > 0) {
      throw new Error(
        'Cleanup cannot run during an open batch or transaction.'
      );
    }
    for (const info of this.#loadInfoById.values()) {
      if (info.state === 'loading' && info.activeAttemptId != null) {
        throw new Error('Cleanup cannot run while directory loads are active.');
      }
    }

    const mode = options.mode ?? 'stable';
    const previousVisibleCount = this.getVisibleCount();
    const before = this.#cleanupMetrics();
    if (mode === 'stable') {
      this.#stableCleanup();
    } else {
      this.#aggressiveCleanup();
    }
    const after = this.#cleanupMetrics();
    const result: PathStoreCleanupResult = {
      activeNodeCountAfter: after.activeNodeCount,
      activeNodeCountBefore: before.activeNodeCount,
      cachedPathEntryCountAfter: after.cachedPathEntryCount,
      cachedPathEntryCountBefore: before.cachedPathEntryCount,
      idsPreserved: mode === 'stable',
      loadInfoEntryCountAfter: after.loadInfoEntryCount,
      loadInfoEntryCountBefore: before.loadInfoEntryCount,
      mode,
      reclaimedCachedPathEntryCount:
        before.cachedPathEntryCount - after.cachedPathEntryCount,
      reclaimedLoadInfoEntryCount:
        before.loadInfoEntryCount - after.loadInfoEntryCount,
      reclaimedNodeSlotCount:
        before.totalNodeSlotCount - after.totalNodeSlotCount,
      reclaimedSegmentCount: before.segmentCount - after.segmentCount,
      segmentCountAfter: after.segmentCount,
      segmentCountBefore: before.segmentCount,
      totalNodeSlotCountAfter: after.totalNodeSlotCount,
      totalNodeSlotCountBefore: before.totalNodeSlotCount,
    };
    recordEvent(
      this.#events,
      finalizeEvent(this.#events, previousVisibleCount, {
        ...result,
        affectedAncestorIds: [],
        affectedNodeIds: [],
        canonicalChanged: false,
        operation: 'cleanup',
        projectionChanged: mode !== 'stable',
        visibleCountDelta: null,
      })
    );
    return result;
  }

  #collectLoadInfosByPath(): Array<{ info: DirectoryLoadInfo; path: string }> {
    const retained: Array<{ info: DirectoryLoadInfo; path: string }> = [];
    for (const [nodeId, info] of this.#loadInfoById) {
      if (
        (this.#meta(nodeId) & FLAG_REMOVED) !== 0 ||
        !this.#isDir(nodeId) ||
        info.state === 'loaded'
      ) {
        continue;
      }
      retained.push({
        info: { ...info, activeAttemptId: null },
        path: this.#materializePath(nodeId),
      });
    }
    return retained;
  }

  #restoreLoadInfosByPath(
    retained: ReadonlyArray<{ info: DirectoryLoadInfo; path: string }>
  ): void {
    this.#loadInfoById.clear();
    for (const entry of retained) {
      const id = this.#lookup(entry.path);
      if (id === -1 || !this.#isDir(id)) {
        continue;
      }
      this.#loadInfoById.set(id, { ...entry.info });
    }
  }

  // Keeps node ids; drops cached strings, dead segments, and trailing tombstones.
  #stableCleanup(): void {
    const exports = this.#engine.exports;
    const loadInfos = this.#collectLoadInfosByPath();
    this.#pathCacheVersion += 1;
    this.#pathCache.clear();
    this.#pathCache.set(ROOT_ID, { path: '', version: this.#pathCacheVersion });
    this.#segmentStrings.length = 0;
    this.#segmentSortKeys.length = 0;
    this.#engine.invalidateSegments();
    exports.compactSegments();
    exports.trimTrailingRemoved();
    exports.recomputeAllCounts();
    exports.compact();
    this.#engine.sync();
    this.#restoreLoadInfosByPath(loadInfos);
  }

  // Rebuilds a dense store from the canonical list, then restores
  // path-keyed expansion overrides and load states.
  #aggressiveCleanup(): void {
    const exports = this.#engine.exports;
    const loadInfos = this.#collectLoadInfosByPath();
    const overrides = this.#collectExpansionOverridePaths();
    const defaultExpansion = exports.defaultExpansion();
    const collapseNewDirs = exports.collapseNewDirs();
    const canonical = this.list();

    exports.reset();
    this.#engine.sync();
    const written = this.#engine.writeInputPaths(canonical);
    exports.storeInit(canonical.length);
    const error = exports.ingest(written.ptr, written.len, 0);
    this.#engine.sync();
    if (error !== 0) {
      this.#throwIngestError(error, written.ptr);
    }
    exports.finishIngest();
    exports.configure(
      this.#options.flattenEmptyDirectories ? 1 : 0,
      defaultExpansion,
      this.#options.sort === 'default' ? 0 : 1
    );
    exports.setCollapseNewDirs(collapseNewDirs);
    this.#pathCacheVersion = 0;
    this.#pathCache = new Map([[ROOT_ID, { path: '', version: 0 }]]);
    this.#segmentStrings.length = 0;
    this.#segmentSortKeys.length = 0;
    this.#engine.invalidateSegments();
    for (const path of overrides.expandedPaths) {
      const id = this.#lookup(path);
      if (id !== -1) {
        exports.setExpanded(id, 1);
      }
    }
    for (const path of overrides.collapsedPaths) {
      const id = this.#lookup(path);
      if (id !== -1) {
        exports.setExpanded(id, 0);
      }
    }
    exports.initCounts();
    exports.compact();
    this.#engine.sync();
    this.#restoreLoadInfosByPath(loadInfos);
  }

  #collectExpansionOverridePaths(): {
    collapsedPaths: string[];
    expandedPaths: string[];
  } {
    const meta = this.#engine.i32(ArrayId.meta);
    const collapsedPaths: string[] = [];
    const expandedPaths: string[] = [];
    for (let nodeId = 1; nodeId < meta.length; nodeId += 1) {
      const flags = meta[nodeId];
      if ((flags & (FLAG_REMOVED | FLAG_DIR | 16)) !== (FLAG_DIR | 16)) {
        continue;
      }
      if ((flags & 32) !== 0) {
        expandedPaths.push(this.#materializePath(nodeId));
      } else {
        collapsedPaths.push(this.#materializePath(nodeId));
      }
    }
    return { collapsedPaths, expandedPaths };
  }
}

function assertOperationTargetsDirectory(
  directoryPath: string,
  operation: PathStoreOperation
): void {
  switch (operation.type) {
    case 'add':
    case 'remove':
      if (
        !operation.path.startsWith(directoryPath) ||
        operation.path === directoryPath
      ) {
        throw new Error(
          `Child patch operation must stay within ${directoryPath}: "${operation.path}"`
        );
      }
      break;
    case 'move':
      if (
        !operation.from.startsWith(directoryPath) ||
        !operation.to.startsWith(directoryPath) ||
        operation.from === directoryPath ||
        operation.to === directoryPath
      ) {
        throw new Error(
          `Child patch move must stay within ${directoryPath}: "${operation.from}" -> "${operation.to}"`
        );
      }
      break;
  }
}
