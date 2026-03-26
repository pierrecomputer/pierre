import { DEFAULT_THEMES, UNSAFE_CSS_ATTRIBUTE } from '../constants';
import type { MergeConflictActionTarget } from '../managers/InteractionManager';
import { pluckInteractionOptions } from '../managers/InteractionManager';
import type { HunksRenderResult } from '../renderers/DiffHunksRenderer';
import {
  UnresolvedFileHunksRenderer,
  type UnresolvedFileHunksRendererOptions,
} from '../renderers/UnresolvedFileHunksRenderer';
import type {
  FileContents,
  FileDiffMetadata,
  MergeConflictActionPayload,
  MergeConflictMarkerRow,
  MergeConflictRegion,
  MergeConflictResolution,
} from '../types';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areMergeConflictActionsEqual } from '../utils/areMergeConflictActionsEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { getMergeConflictActionSlotName } from '../utils/getMergeConflictActionSlotName';
import {
  buildMergeConflictMarkerRows,
  getMergeConflictActionAnchor,
  type MergeConflictDiffAction,
  parseMergeConflictDiffFromFile,
} from '../utils/parseMergeConflictDiffFromFile';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { resolveConflict as resolveConflictDiff } from '../utils/resolveConflict';
import { splitFileContents } from '../utils/splitFileContents';
import type { WorkerPoolManager } from '../worker';
import {
  FileDiff,
  type FileDiffOptions,
  type FileDiffRenderProps,
} from './FileDiff';

export type RenderMergeConflictActions<LAnnotation> = (
  action: MergeConflictDiffAction,
  instance: UnresolvedFile<LAnnotation>
) => HTMLElement | DocumentFragment | null | undefined;

export type MergeConflictActionsTypeOption<LAnnotation> =
  | 'none'
  | 'default'
  | RenderMergeConflictActions<LAnnotation>;

export interface UnresolvedFileOptions<LAnnotation> extends Omit<
  FileDiffOptions<LAnnotation>,
  'diffStyle'
> {
  onPostRender?(
    node: HTMLElement,
    instance: UnresolvedFile<LAnnotation>
  ): unknown;
  mergeConflictActionsType?: MergeConflictActionsTypeOption<LAnnotation>;
  onMergeConflictAction?(
    payload: MergeConflictActionPayload,
    instance: UnresolvedFile<LAnnotation>
  ): void;
  onMergeConflictResolve?(
    file: FileContents,
    payload: MergeConflictActionPayload
  ): void;
  maxContextLines?: number;
}

export interface UnresolvedFileRenderProps<LAnnotation> extends Omit<
  FileDiffRenderProps<LAnnotation>,
  'oldFile' | 'newFile'
> {
  file?: FileContents;
  actions?: (MergeConflictDiffAction | undefined)[];
  markerRows?: MergeConflictMarkerRow[];
}

export interface UnresolvedFileHydrationProps<LAnnotation> extends Omit<
  UnresolvedFileRenderProps<LAnnotation>,
  'file'
> {
  file?: FileContents;
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

interface MergeConflictActionElementCache {
  element: HTMLElement;
  action: MergeConflictDiffAction;
}

interface GetOrComputeDiffProps {
  file: FileContents | undefined;
  fileDiff: FileDiffMetadata | undefined;
  actions: (MergeConflictDiffAction | undefined)[] | undefined;
  markerRows: MergeConflictMarkerRow[] | undefined;
}

interface GetOrComputeDiffResult {
  fileDiff: FileDiffMetadata;
  actions: (MergeConflictDiffAction | undefined)[];
  markerRows: MergeConflictMarkerRow[];
}

interface ResolveConflictReturn {
  file: FileContents;
  fileDiff: FileDiffMetadata;
  actions: (MergeConflictDiffAction | undefined)[];
  markerRows: MergeConflictMarkerRow[];
}

type UnresolvedFileDataCache = GetOrComputeDiffProps;

let instanceId = -1;

export class UnresolvedFile<
  LAnnotation = undefined,
> extends FileDiff<LAnnotation> {
  override readonly __id: string = `unresolved-file:${++instanceId}`;
  protected computedCache: UnresolvedFileDataCache = {
    file: undefined,
    fileDiff: undefined,
    actions: undefined,
    markerRows: undefined,
  };
  private conflictActions: (MergeConflictDiffAction | undefined)[] = [];
  private markerRows: MergeConflictMarkerRow[] = [];
  private conflictActionCache: Map<string, MergeConflictActionElementCache> =
    new Map();

  constructor(
    public override options: UnresolvedFileOptions<LAnnotation> = {
      theme: DEFAULT_THEMES,
    },
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    super(undefined, workerManager, isContainerManaged);
    this.setOptions(options);
  }

  override setOptions(
    options: UnresolvedFileOptions<LAnnotation> | undefined
  ): void {
    if (options == null) {
      return;
    }

    if (
      options.onMergeConflictAction != null &&
      options.onMergeConflictResolve != null
    ) {
      throw new Error(
        'UnresolvedFile: onMergeConflictAction and onMergeConflictResolve are mutually exclusive. Use only one callback.'
      );
    }

    this.options = options;
    this.hunksRenderer.setOptions(this.getHunksRendererOptions(options));

    const hunkSeparators = this.options.hunkSeparators ?? 'line-info';
    this.interactionManager.setOptions(
      pluckInteractionOptions(
        this.options,
        typeof hunkSeparators === 'function' ||
          hunkSeparators === 'line-info' ||
          hunkSeparators === 'line-info-basic'
          ? this.expandHunk
          : undefined,
        this.getLineIndex,
        this.handleMergeConflictActionClick
      )
    );
  }

  protected override createHunksRenderer(
    options: UnresolvedFileOptions<LAnnotation>
  ): UnresolvedFileHunksRenderer<LAnnotation> {
    const renderer = new UnresolvedFileHunksRenderer<LAnnotation>(
      this.getHunksRendererOptions(options),
      this.handleHighlightRender,
      this.workerManager
    );
    return renderer;
  }

  protected override getHunksRendererOptions(
    options: UnresolvedFileOptions<LAnnotation>
  ): UnresolvedFileHunksRendererOptions {
    return getUnresolvedDiffHunksRendererOptions(options, this.options);
  }

  protected override applyPreNodeAttributes(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    super.applyPreNodeAttributes(pre, result, {
      'data-has-merge-conflict': '',
    });
  }

  override cleanUp(): void {
    this.clearMergeConflictActionCache();
    this.computedCache = {
      file: undefined,
      fileDiff: undefined,
      actions: undefined,
      markerRows: undefined,
    };
    this.conflictActions = [];
    super.cleanUp();
  }

  private getOrComputeDiff({
    file,
    fileDiff,
    actions,
    markerRows,
  }: GetOrComputeDiffProps): GetOrComputeDiffResult | undefined {
    const { maxContextLines, onMergeConflictAction } = this.options;
    wrapper: {
      // We are dealing with a controlled component
      if (onMergeConflictAction != null) {
        const hasFileDiff = fileDiff != null;
        const hasActions = actions != null;
        const hasMarkerRows = markerRows != null;
        if (hasFileDiff !== hasActions || hasFileDiff !== hasMarkerRows) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: fileDiff, actions, and markerRows must be passed together'
          );
        }
        // If we were provided a new fileDiff/actions/markerRows, we are a FULLY
        // controlled component, which means we will not do any computation
        if (fileDiff != null && actions != null && markerRows != null) {
          this.computedCache = {
            file: file ?? this.computedCache.file,
            fileDiff,
            actions,
            markerRows,
          };
          break wrapper;
        }
        // If we were provided a new file, we should attempt to parse out a new
        // diff/actions if we haven't computed it before. Once we initialize from
        // a file, later updates must flow through fileDiff/actions instead of
        // reparsing from a new file input.
        else if (file != null || this.computedCache.file != null) {
          if (
            file != null &&
            this.computedCache.file != null &&
            !areFilesEqual(file, this.computedCache.file) &&
            this.computedCache.fileDiff != null &&
            this.computedCache.actions != null
          ) {
            throw new Error(
              'UnresolvedFile.getOrComputeDiff: file can only be used to initialize unresolved state once. Pass fileDiff and actions for subsequent updates.'
            );
          }
          file ??= this.computedCache.file;
          if (file == null) {
            throw new Error(
              'UnresolvedFile.getOrComputeDiff: file is null, should be impossible'
            );
          }
          if (
            !areFilesEqual(file, this.computedCache.file) ||
            this.computedCache.fileDiff == null ||
            this.computedCache.actions == null
          ) {
            const computed = parseMergeConflictDiffFromFile(
              file,
              maxContextLines
            );
            this.computedCache = {
              file,
              fileDiff: computed.fileDiff,
              actions: computed.actions,
              markerRows: computed.markerRows,
            };
          }
          fileDiff = this.computedCache.fileDiff;
          actions = this.computedCache.actions;
          markerRows = this.computedCache.markerRows;
          break wrapper;
        }
        // Otherwise we should fall through and try to use the cache if it exists
        else {
          fileDiff = this.computedCache.fileDiff;
          actions = this.computedCache.actions;
          markerRows = this.computedCache.markerRows;
          break wrapper;
        }
      }
      // If we are uncontrolled we only rely on the file and only use the first
      // version. After that, the cached diff/action pair is the source of
      // truth and we should not accept a new file input.
      else {
        if (fileDiff != null || actions != null || markerRows != null) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: fileDiff, actions, and markerRows are only usable in controlled mode, you must pass in `onMergeConflictAction`'
          );
        }
        if (
          file != null &&
          this.computedCache.file != null &&
          !areFilesEqual(file, this.computedCache.file)
        ) {
          throw new Error(
            'UnresolvedFile.getOrComputeDiff: uncontrolled unresolved files parse the file only once. Later updates must come from the cached diff state.'
          );
        }
        this.computedCache.file ??= file;
        if (
          this.computedCache.fileDiff == null &&
          this.computedCache.file != null
        ) {
          const computed = parseMergeConflictDiffFromFile(
            this.computedCache.file,
            maxContextLines
          );
          this.computedCache.fileDiff = computed.fileDiff;
          this.computedCache.actions = computed.actions;
          this.computedCache.markerRows = computed.markerRows;
        }
        // Because we are uncontrolled, the source of truth is the
        // computedCache
        fileDiff = this.computedCache.fileDiff;
        actions = this.computedCache.actions;
        markerRows = this.computedCache.markerRows;
        break wrapper;
      }
    }
    if (fileDiff == null || actions == null || markerRows == null) {
      return undefined;
    }
    return { fileDiff, actions, markerRows };
  }

  override hydrate(props: UnresolvedFileHydrationProps<LAnnotation>): void {
    const {
      file,
      fileDiff,
      actions,
      markerRows,
      lineAnnotations,
      fileContainer,
      prerenderedHTML,
      preventEmit = false,
    } = props;
    const source = this.getOrComputeDiff({
      file,
      fileDiff,
      actions,
      markerRows,
    });
    const { overflow = 'scroll' } = this.options;
    if (source == null) {
      return;
    }
    prerenderHTMLIfNecessary(fileContainer, prerenderedHTML);
    for (const element of fileContainer.shadowRoot?.children ?? []) {
      if (element instanceof SVGElement) {
        this.spriteSVG = element;
        continue;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element instanceof HTMLPreElement) {
        this.pre = element;
        for (const code of element.children) {
          if (
            !(code instanceof HTMLElement) ||
            code.tagName.toLowerCase() !== 'code'
          ) {
            continue;
          }
          if ('deletions' in code.dataset) {
            this.codeDeletions = code;
          }
          if ('additions' in code.dataset) {
            this.codeAdditions = code;
          }
          if ('unified' in code.dataset) {
            this.codeUnified = code;
          }
        }
        continue;
      }
      if ('diffsHeader' in element.dataset) {
        this.headerElement = element;
        continue;
      }
      if (
        element instanceof HTMLStyleElement &&
        element.hasAttribute(UNSAFE_CSS_ATTRIBUTE)
      ) {
        this.unsafeCSSStyle = element;
        continue;
      }
    }
    if (this.pre != null) {
      this.syncCodeNodesFromPre(this.pre);
    }
    this.setActiveMergeConflictState(source.actions, source.markerRows);
    // If we have no pre tag, then we should render
    if (this.pre == null) {
      this.render({ ...props, preventEmit: true });
    }
    // Otherwise orchestrate our setup
    else {
      this.fileContainer = fileContainer;
      delete this.pre.dataset.dehydrated;

      this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
      this.fileDiff = source.fileDiff;

      this.hunksRenderer.hydrate(this.fileDiff);
      this.renderAnnotations();
      this.renderGutterUtility();
      this.injectUnsafeCSS();
      this.interactionManager.setup(this.pre);
      this.resizeManager.setup(this.pre, overflow === 'wrap');
    }

    this.renderMergeConflictActionSlots();
    if (!preventEmit) {
      this.emitPostRender();
    }
  }

  override rerender(): void {
    if (!this.enabled || this.fileDiff == null) {
      return;
    }
    this.render({ forceRender: true, renderRange: this.renderRange });
  }

  override render(props: UnresolvedFileRenderProps<LAnnotation> = {}): boolean {
    let {
      file,
      fileDiff,
      actions,
      markerRows,
      lineAnnotations,
      preventEmit = false,
      ...rest
    } = props;
    const source = this.getOrComputeDiff({
      file,
      fileDiff,
      actions,
      markerRows,
    });
    if (source == null) {
      return false;
    }
    this.setActiveMergeConflictState(source.actions, source.markerRows);
    const didRender = super.render({
      ...rest,
      fileDiff: source.fileDiff,
      lineAnnotations,
      preventEmit: true,
    });
    if (didRender) {
      this.renderMergeConflictActionSlots();
      if (!preventEmit) {
        this.emitPostRender();
      }
    }
    return didRender;
  }

  public resolveConflict(
    conflictIndex: number,
    resolution: MergeConflictResolution,
    fileDiff: FileDiffMetadata | undefined = this.computedCache.fileDiff
  ): ResolveConflictReturn | undefined {
    const action = this.conflictActions[conflictIndex];
    if (fileDiff == null || action == null) {
      return undefined;
    }

    if (action.conflictIndex !== conflictIndex) {
      console.error({ conflictIndex, action });
      throw new Error(
        "UnresolvedFile.resolveConflict: conflictIndex and conflictAction don't match"
      );
    }

    const newFileDiff = resolveConflictDiff(fileDiff, action, resolution);
    const previousFile = this.computedCache.file;
    const { file, actions, markerRows } = rebuildFileAndActions({
      fileDiff: newFileDiff,
      previousActions: this.conflictActions,
      resolvedConflictIndex: conflictIndex,
      previousFile,
      resolution,
    });

    return {
      file,
      fileDiff: newFileDiff,
      actions,
      markerRows,
    };
  }

  private resolveConflictAndRender(
    conflictIndex: number,
    resolution: MergeConflictResolution
  ): void {
    const action = this.conflictActions[conflictIndex];
    if (action == null) {
      return undefined;
    }
    if (action.conflictIndex !== conflictIndex) {
      console.error({ conflictIndex, action });
      throw new Error(
        "UnresolvedFile.resolveConflictAndRender: conflictIndex and conflictAction don't match"
      );
    }
    const payload: MergeConflictActionPayload = {
      resolution,
      conflict: action.conflict,
    };
    const { file, fileDiff, actions, markerRows } =
      this.resolveConflict(conflictIndex, resolution) ?? {};
    if (
      file == null ||
      fileDiff == null ||
      actions == null ||
      markerRows == null
    ) {
      return undefined;
    }

    this.computedCache = { file, fileDiff, actions, markerRows };
    this.setActiveMergeConflictState(actions, markerRows);
    // NOTE(amadeus): This is a bit jank, but helps to ensure we don't see a
    // bunch of jittery re-renders as things resolve out.  In a more perfect
    // world we would have a more elegant way to kick off a render to the
    // highlighter and then resolve actions in a cleaner way, but time is short
    // right now.  Can't let perfect be the enemy of good
    if (this.workerManager != null) {
      // Because we are using a workerManager, if we fire off the renderDiff
      // call, it will eventually get back to us in a callback which will
      // trigger a re-render
      this.hunksRenderer.renderDiff(fileDiff);
    } else {
      this.render({ forceRender: true });
    }
    this.options.onMergeConflictResolve?.(file, payload);
  }

  private setActiveMergeConflictState(
    actions: (MergeConflictDiffAction | undefined)[] = this.conflictActions,
    markerRows: MergeConflictMarkerRow[] = this.markerRows
  ): void {
    this.conflictActions = actions;
    this.markerRows = markerRows;
    if (
      this.computedCache.fileDiff != null &&
      this.hunksRenderer instanceof UnresolvedFileHunksRenderer
    ) {
      this.hunksRenderer.setConflictState(
        this.options.mergeConflictActionsType === 'none' ? [] : actions,
        markerRows,
        this.computedCache.fileDiff
      );
    }
  }

  private handleMergeConflictActionClick = (
    target: MergeConflictActionTarget
  ): void => {
    const action = this.conflictActions[target.conflictIndex];
    if (action == null) {
      return;
    }
    if (action.conflictIndex !== target.conflictIndex) {
      console.error({ conflictIndex: target.conflictIndex, action });
      throw new Error(
        "UnresolvedFile.handleMergeConflictActionClick: conflictIndex and conflictAction don't match"
      );
    }
    const payload: MergeConflictActionPayload = {
      resolution: target.resolution,
      conflict: action.conflict,
    };
    if (this.options.onMergeConflictAction != null) {
      this.options.onMergeConflictAction(payload, this);
      return;
    }
    this.resolveConflictAndRender(target.conflictIndex, target.resolution);
  };

  private renderMergeConflictActionSlots(): void {
    const { fileDiff } = this.computedCache;
    if (
      this.isContainerManaged ||
      this.fileContainer == null ||
      typeof this.options.mergeConflictActionsType !== 'function' ||
      this.conflictActions.length === 0 ||
      fileDiff == null
    ) {
      this.clearMergeConflictActionCache();
      return;
    }
    const staleActions = new Map(this.conflictActionCache);
    for (
      let actionIndex = 0;
      actionIndex < this.conflictActions.length;
      actionIndex++
    ) {
      const action = this.conflictActions[actionIndex];
      if (action == null) {
        continue;
      }
      if (action.conflictIndex !== actionIndex) {
        console.error({ conflictIndex: actionIndex, action });
        throw new Error(
          "UnresolvedFile.renderMergeConflictActionSlots: conflictIndex and conflictAction don't match"
        );
      }
      const anchor = getMergeConflictActionAnchor(action, fileDiff);
      if (anchor == null) {
        continue;
      }
      const conflictIndex = action.conflictIndex;
      const slotName = getMergeConflictActionSlotName({
        hunkIndex: anchor.hunkIndex,
        lineIndex: anchor.lineIndex,
        conflictIndex,
      });
      const id = `${actionIndex}-${slotName}`;
      let cache = this.conflictActionCache.get(id);
      if (
        cache == null ||
        !areMergeConflictActionsEqual(cache.action, action)
      ) {
        cache?.element.remove();
        const rendered = this.renderMergeConflictAction(action);
        if (rendered == null) {
          continue;
        }
        const element = createAnnotationWrapperNode(slotName);
        element.appendChild(rendered);
        this.fileContainer.appendChild(element);
        cache = { element, action };
        this.conflictActionCache.set(id, cache);
      }
      staleActions.delete(id);
    }
    for (const [id, { element }] of staleActions.entries()) {
      this.conflictActionCache.delete(id);
      element.remove();
    }
  }

  private renderMergeConflictAction(
    action: MergeConflictDiffAction
  ): HTMLElement | undefined {
    if (typeof this.options.mergeConflictActionsType !== 'function') {
      return undefined;
    }
    const rendered = this.options.mergeConflictActionsType(action, this);
    if (rendered == null) {
      return undefined;
    }
    if (rendered instanceof HTMLElement) {
      return rendered;
    }
    if (
      typeof DocumentFragment !== 'undefined' &&
      rendered instanceof DocumentFragment
    ) {
      const wrapper = document.createElement('div');
      wrapper.style.display = 'contents';
      wrapper.appendChild(rendered);
      return wrapper;
    }
    return undefined;
  }

  private clearMergeConflictActionCache(): void {
    for (const { element } of this.conflictActionCache.values()) {
      element.remove();
    }
    this.conflictActionCache.clear();
  }
}

interface RebuildFileAndActionsProps {
  fileDiff: FileDiffMetadata;
  previousActions: (MergeConflictDiffAction | undefined)[];
  resolvedConflictIndex: number;
  // FIXME: Probably should remove this...
  // additionOffset: number;
  // deletionOffset: number;
  previousFile: FileContents | undefined;
  resolution: MergeConflictResolution;
}

// Rebuild the emitted unresolved file contents and remaining action anchors in
// one pass over the post-resolution diff state.
function rebuildFileAndActions({
  fileDiff,
  previousActions,
  resolvedConflictIndex,
  previousFile,
  resolution,
}: RebuildFileAndActionsProps): Pick<
  ResolveConflictReturn,
  'file' | 'actions' | 'markerRows'
> {
  const resolvedAction = previousActions[resolvedConflictIndex];
  if (resolvedAction == null) {
    throw new Error(
      'rebuildFileAndActions: missing resolved action for unresolved file rebuild'
    );
  }

  const actions = updateConflictActionsAfterResolution(
    previousActions,
    resolvedConflictIndex,
    resolvedAction,
    resolution
  );
  const markerRows = buildMergeConflictMarkerRows(fileDiff, actions);

  const file = rebuildUnresolvedFile({
    fileDiff,
    resolvedAction,
    resolvedConflictIndex,
    previousFile,
    resolution,
  });

  return {
    file,
    actions,
    markerRows,
  };
}

interface RebuildUnresolvedFileProps {
  fileDiff: FileDiffMetadata;
  resolvedAction: MergeConflictDiffAction;
  resolvedConflictIndex: number;
  previousFile: FileContents | undefined;
  resolution: MergeConflictResolution;
}

// Rebuild the unresolved file text from the previous unresolved source so we
// preserve remaining marker blocks exactly while the diff state stays in-place.
function rebuildUnresolvedFile({
  resolvedAction,
  resolvedConflictIndex,
  previousFile,
  fileDiff,
  resolution,
}: RebuildUnresolvedFileProps): FileContents {
  const previousContents = previousFile?.contents ?? '';
  const lines = splitFileContents(previousContents);
  const { conflict } = resolvedAction;
  const replacementLines = getResolvedConflictReplacementLines(
    lines,
    conflict,
    resolution
  );
  const contents = [
    ...lines.slice(0, conflict.startLineIndex),
    ...replacementLines,
    ...lines.slice(conflict.endLineIndex + 1),
  ].join('');

  return {
    name: previousFile?.name ?? fileDiff.name,
    contents,
    cacheKey:
      previousFile?.cacheKey != null
        ? `${previousFile.cacheKey}:mc-${resolvedConflictIndex}-${resolution}`
        : undefined,
  };
}

function getResolvedConflictReplacementLines(
  lines: string[],
  conflict: MergeConflictDiffAction['conflict'],
  resolution: MergeConflictResolution
): string[] {
  const currentLines = lines.slice(
    conflict.startLineIndex + 1,
    conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex
  );
  const incomingLines = lines.slice(
    conflict.separatorLineIndex + 1,
    conflict.endLineIndex
  );

  if (resolution === 'current') {
    return currentLines;
  }
  if (resolution === 'incoming') {
    return incomingLines;
  }
  return [...currentLines, ...incomingLines];
}

// The diff resolver keeps hunk/content group indexes stable, so the only
// follow-up update we need here is shifting unresolved source-region line
// numbers for later conflicts in the rebuilt file text.
function updateConflictActionsAfterResolution(
  previousActions: (MergeConflictDiffAction | undefined)[],
  resolvedConflictIndex: number,
  resolvedAction: MergeConflictDiffAction,
  resolution: MergeConflictResolution
): (MergeConflictDiffAction | undefined)[] {
  const lineDelta = getResolvedConflictLineDelta(
    resolvedAction.conflict,
    resolution
  );

  return previousActions.map((action, index) => {
    if (index === resolvedConflictIndex) {
      return undefined;
    }
    if (action == null) {
      return undefined;
    }
    if (action.conflict.startLineIndex > resolvedAction.conflict.endLineIndex) {
      return {
        ...action,
        conflict: shiftMergeConflictRegion(action.conflict, lineDelta),
      };
    }
    return action;
  });
}

function getResolvedConflictLineDelta(
  conflict: MergeConflictRegion,
  resolution: MergeConflictResolution
): number {
  const currentLineCount =
    (conflict.baseMarkerLineIndex ?? conflict.separatorLineIndex) -
    conflict.startLineIndex -
    1;
  const incomingLineCount =
    conflict.endLineIndex - conflict.separatorLineIndex - 1;
  const replacementLineCount =
    resolution === 'current'
      ? currentLineCount
      : resolution === 'incoming'
        ? incomingLineCount
        : currentLineCount + incomingLineCount;
  const conflictLineCount = conflict.endLineIndex - conflict.startLineIndex + 1;
  return replacementLineCount - conflictLineCount;
}

function shiftMergeConflictRegion(
  conflict: MergeConflictRegion,
  lineDelta: number
): MergeConflictRegion {
  return {
    ...conflict,
    startLineIndex: conflict.startLineIndex + lineDelta,
    startLineNumber: conflict.startLineNumber + lineDelta,
    separatorLineIndex: conflict.separatorLineIndex + lineDelta,
    separatorLineNumber: conflict.separatorLineNumber + lineDelta,
    endLineIndex: conflict.endLineIndex + lineDelta,
    endLineNumber: conflict.endLineNumber + lineDelta,
    baseMarkerLineIndex:
      conflict.baseMarkerLineIndex != null
        ? conflict.baseMarkerLineIndex + lineDelta
        : undefined,
    baseMarkerLineNumber:
      conflict.baseMarkerLineNumber != null
        ? conflict.baseMarkerLineNumber + lineDelta
        : undefined,
  };
}

// NOTE(amadeus): Should probably pull this out into a util, and make variants
// for all component types
export function getUnresolvedDiffHunksRendererOptions<LAnnotation>(
  options?: UnresolvedFileOptions<LAnnotation>,
  baseOptions?: UnresolvedFileOptions<LAnnotation>
): UnresolvedFileHunksRendererOptions {
  return {
    ...baseOptions,
    ...options,
    hunkSeparators:
      typeof options?.hunkSeparators === 'function'
        ? 'custom'
        : options?.hunkSeparators,
    mergeConflictActionsType:
      typeof options?.mergeConflictActionsType === 'function'
        ? 'custom'
        : options?.mergeConflictActionsType,
  };
}
