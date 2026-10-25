import type { Element as HASTElement } from 'hast';

import {
  CUSTOM_HEADER_SLOT_ID,
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
  DIFFS_TAG_NAME,
  EMPTY_LINE_ANNOTATIONS,
  EMPTY_RENDER_RANGE,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import { ColumnReconciler } from '../dom/ColumnReconciler';
import type { Editor } from '../editor/editor';
import type { TextDocument, TextDocumentChange } from '../editor/textDocument';
import type {
  ApplyChangeOptions,
  ApplyChangeResult,
  CapturedDiffSessionState,
  EditCompletionDecision,
  EditorActiveLineOptions,
  EditorChangeEvent,
  FileDiffEditCompleteEvent,
  RetainedDiffSessionSnapshot,
} from '../editor/types';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
  HighlighterDisposedError,
} from '../highlighter/shared_highlighter';
import type { RowKey, RowSpec } from '../layout/RowSpec';
import {
  type GetHoveredLineResult,
  type GetLineIndexUtility,
  InteractionManager,
  type InteractionManagerBaseOptions,
  pluckInteractionOptions,
  type SelectionWriteOptions,
} from '../managers/InteractionManager';
import { ResizeManager } from '../managers/ResizeManager';
import { ScrollSyncManager } from '../managers/ScrollSyncManager';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import {
  DiffHunksRenderer,
  type DiffHunksRendererOptions,
  type HunksRenderResult,
} from '../renderers/DiffHunksRenderer';
import { SVGSpriteSheet } from '../sprite';
export type { FileDiffEditCompleteEvent } from '../editor/types';
import type {
  AppliedThemeStyleCache,
  BaseCodeOptions,
  BaseDiffOptions,
  CustomPreProperties,
  DiffLineAnnotation,
  ExpansionDirections,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  HighlightedToken,
  HunkData,
  HunkSeparators,
  LineAnnotation,
  MaybeDiffFileInput,
  PostRenderPhase,
  PrePropertiesConfig,
  RenderHeaderFilenameSuffixCallback,
  RenderHeaderMetadataCallback,
  RenderHeaderPrefixCallback,
  RenderRange,
  SelectedLineRange,
  SelectionSide,
  ThemeTypes,
} from '../types';
import { areDiffLineAnnotationsEqual } from '../utils/areDiffLineAnnotationsEqual';
import { areDiffTargetsEqual } from '../utils/areDiffTargetsEqual';
import { areFilesEqual } from '../utils/areFilesEqual';
import { areHunkDataEqual } from '../utils/areHunkDataEqual';
import { arePrePropertiesEqual } from '../utils/arePrePropertiesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { awaitWithTimeout } from '../utils/awaitWithTimeout';
import {
  cloneFileDiffMetadata,
  cloneHunks,
} from '../utils/cloneFileDiffMetadata';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
import { createContentColumn } from '../utils/createContentColumn';
import { createGutterUtilityContentNode } from '../utils/createGutterUtilityContentNode';
import { createUnsafeCSSStyleNode } from '../utils/createUnsafeCSSStyleNode';
import {
  patchScrollbarGutterSize,
  wrapThemeCSS,
  wrapUnsafeCSS,
} from '../utils/cssWrappers';
import {
  adoptEditSessionAnnotations,
  type EditSessionAnnotations,
  resolveEditSessionSlotName,
  writeEditSessionAnnotations,
} from '../utils/editSessionAnnotations';
import { finishEditSessionForDiff } from '../utils/editSessionHunks';
import { getDiffFileInput } from '../utils/getDiffFileInput';
import { getDiffHunksRendererOptions } from '../utils/getDiffHunksRendererOptions';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getHunkSideStartBoundary } from '../utils/getHunkSideBoundaries';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
import { getThemes } from '../utils/getThemes';
import { guardWebKitScrollDuringRebuild } from '../utils/guardWebKitScrollDuringRebuild';
import { createGutterWrapper } from '../utils/hast_utils';
import { hastToHtml } from '../utils/hastToHtml';
import { upsertHostThemeStyle } from '../utils/hostTheme';
import { hydratePartialDiff } from '../utils/hydratePartialDiff';
import { isDefaultRenderRange } from '../utils/isDefaultRenderRange';
import { isDiffPlainText } from '../utils/isDiffPlainText';
import { isStyleNode } from '../utils/isStyleNode';
import { iterateOverDiff } from '../utils/iterateOverDiff';
import { parseDiffFromFile } from '../utils/parseDiffFromFile';
import { isSafari } from '../utils/platform';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { resolvePreferredHighlighter } from '../utils/resolvePreferredHighlighter';
import { getMeasuredScrollbarGutter } from '../utils/scrollbarGutter';
import { setPreNodeProperties } from '../utils/setWrapperNodeProps';
import {
  getExpandedRegion,
  getHunkAdditionLineRange,
  getNearestRenderableAdditionLine,
  getTrailingExpandedRegion,
  isAdditionLineRenderable,
} from '../utils/virtualDiffLayout';
import type { WorkerPoolManager } from '../worker';
import { isHandledWorkerPoolError } from '../worker/errors';
import { DiffsContainerLoaded } from './web-components';

type LoadedPartialDiffContents = Awaited<
  ReturnType<NonNullable<BaseDiffOptions['loadDiffFiles']>>
>;

type DeferredSelectedLinesWrite = [
  range: SelectedLineRange | null,
  options: SelectionWriteOptions | undefined,
];

type DeferredEditorActiveLineWrite = [
  lineNumber: number | null,
  options: EditorActiveLineOptions | undefined,
];

function canHydrateDiff(fileDiff: FileDiffMetadata): boolean {
  return (
    fileDiff.isPartial &&
    (fileDiff.type === 'change' ||
      fileDiff.type === 'rename-changed' ||
      fileDiff.type === 'rename-pure')
  );
}

function shouldResetUndoState(
  prevDiff: FileDiffMetadata,
  nextDiff: FileDiffMetadata
): boolean {
  if (prevDiff.isPartial || nextDiff.isPartial) {
    throw new Error(
      'FileDiff.shouldResetEditorForExternalDiff: diffs must be fully hydrated'
    );
  }
  const prevLanguage = prevDiff.lang ?? getFiletypeFromFileName(prevDiff.name);
  const nextLanguage = nextDiff.lang ?? getFiletypeFromFileName(nextDiff.name);
  const prevHasOldFile = prevDiff.type !== 'new';
  const nextHasOldFile = nextDiff.type !== 'new';
  if (
    prevDiff.name !== nextDiff.name ||
    prevLanguage !== nextLanguage ||
    prevHasOldFile !== nextHasOldFile ||
    prevDiff.deletionLines.length !== nextDiff.deletionLines.length
  ) {
    return true;
  }
  return prevDiff.deletionLines.some(
    (line, index) => line !== nextDiff.deletionLines[index]
  );
}

export interface FileDiffRenderBaseProps<LAnnotation> {
  fileDiff?: FileDiffMetadata;
  deferManagers?: boolean;
  forceRender?: boolean;
  preventEmit?: boolean;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}

export type FileDiffRenderProps<LAnnotation> =
  FileDiffRenderBaseProps<LAnnotation> & MaybeDiffFileInput;

export type FileDiffHydrationProps<LAnnotation> = Omit<
  FileDiffRenderBaseProps<LAnnotation>,
  'fileContainer'
> &
  MaybeDiffFileInput & {
    fileContainer: HTMLElement;
    prerenderedHTML?: string;
  };

export type FileDiffType = 'file-diff' | 'unresolved-file';

export type FileDiffEditChangeHandler<LAnnotation, Caret> = (
  event: EditorChangeEvent<'file-diff', LAnnotation, Caret>
) => void;

/**
 * Decides a completed edit synchronously: return `'accept'` to install the
 * event's `fileDiff` and annotations, or `'reject'` to restore the original
 * values. The event is frozen, so re-key the accepted diff in place
 * (`event.fileDiff.cacheKey = '…'`) before accepting. The event's editor is
 * detached and returns its final state from `getViewState()`. A missing handler
 * rejects.
 */
export type FileDiffEditCompleteHandler<LAnnotation, Caret> = (
  event: FileDiffEditCompleteEvent<LAnnotation, Caret>
) => EditCompletionDecision;

export interface FileDiffOptions<LAnnotation, Caret>
  extends
    Omit<BaseDiffOptions, 'hunkSeparators'>,
    InteractionManagerBaseOptions<'diff'> {
  hunkSeparators?:
    | Exclude<HunkSeparators, 'custom'> /**
       * @deprecated Custom hunk separator functions are deprecated and will be
       * removed in a future version.
       */
    | ((
        hunk: HunkData,
        instance: FileDiff<LAnnotation, Caret>
      ) => HTMLElement | DocumentFragment | null | undefined);
  disableFileHeader?: boolean;
  renderHeaderPrefix?: RenderHeaderPrefixCallback;
  renderHeaderFilenameSuffix?: RenderHeaderFilenameSuffixCallback;
  renderHeaderMetadata?: RenderHeaderMetadataCallback;
  renderCustomHeader?: RenderHeaderMetadataCallback;
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  /** Receives the matching diff, including any editor changes. */
  renderAnnotation?(
    annotation: DiffLineAnnotation<LAnnotation>,
    fileDiff: FileDiffMetadata
  ): HTMLElement | undefined;
  renderGutterUtility?(
    getHoveredRow: () => GetHoveredLineResult<'diff'> | undefined
  ): HTMLElement | null | undefined;

  onPostRender?(
    node: HTMLElement,
    instance: FileDiff<LAnnotation, Caret>,
    phase: PostRenderPhase
  ): unknown;

  /**
   * Fired synchronously for every document change of an active edit session
   * on this component, with the same `EditorChangeEvent` the editor reports
   * through its own `onChange`. It reports the document, not the screen; the
   * rows may not show the change yet. Do not feed the event's file back into
   * the component while the session is active, and do not call `render` with
   * a new file or diff, `cleanUp`, or the editor's `applyEdits`, `undo`,
   * `redo`, `edit` or `cleanUp` from inside the callback: that throws. An
   * error thrown by the callback is logged and the update finishes.
   */
  onEditChange?: FileDiffEditChangeHandler<LAnnotation, Caret>;

  /**
   * Fired when `edit` toggles false or a component unmounts, including when the
   * final contents are unchanged. If no callback is provided, the component
   * reverts to the last `fileDiff` or `oldFile`/`newFiles` and annotations
   * passed into it. The callback receives the detached editor with its final
   * pre-detach state.
   */
  onEditComplete?: FileDiffEditCompleteHandler<LAnnotation, Caret>;
}

interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: DiffLineAnnotation<LAnnotation>;
  fileDiff: FileDiffMetadata;
}

interface CustomHunkElementCache {
  element: HTMLElement;
  hunkData: HunkData;
}

interface ColumnElements {
  gutter: HTMLElement;
  content: HTMLElement;
}

interface PendingFileLoad {
  fileDiff: FileDiffMetadata;
  promise: Promise<void>;
}

type HydrationSetup<LAnnotation> = {
  fileDiff: FileDiffMetadata | undefined;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
} & MaybeDiffFileInput;

interface HeaderCache {
  lastRenderedHTML: string | undefined;
  html: string | undefined;
  fileDiff: FileDiffMetadata | undefined;
}

export interface FileDiffRenderData<LAnnotation> {
  fileDiff: FileDiffMetadata;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[];
}

export interface FileDiffRenderInput<LAnnotation> {
  fileDiff: FileDiffMetadata;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
}

interface EditSession<LAnnotation> {
  // Editable copy of the diff. Changes in the editor are written here.
  diff: FileDiffMetadata;
  // Latest input, kept separately so rejecting edits can restore it.
  inputDiff: FileDiffMetadata;
  annotations:
    | EditSessionAnnotations<DiffLineAnnotation<LAnnotation>>
    | undefined;
}

let instanceId = -1;

export class FileDiff<LAnnotation = undefined, Caret = undefined> {
  // NOTE(amadeus): We sorta need this to ensure the web-component file is
  // properly loaded
  static LoadedCustomComponent: boolean = DiffsContainerLoaded;

  readonly __id: string = `file-diff:${++instanceId}`;
  readonly type: FileDiffType = 'file-diff';

  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  protected codeUnified: HTMLElement | undefined;
  protected codeDeletions: HTMLElement | undefined;
  protected codeAdditions: HTMLElement | undefined;
  protected bufferBefore: HTMLElement | undefined;
  protected bufferAfter: HTMLElement | undefined;
  protected themeCSSStyle: HTMLStyleElement | undefined;
  protected appliedThemeCSS: AppliedThemeStyleCache | undefined;
  protected hasAdoptedThemeCSS = false;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected appliedUnsafeCSS: string | undefined;
  protected gutterUtilityContent: HTMLElement | undefined;

  protected headerElement: HTMLElement | undefined;
  protected headerPrefix: HTMLElement | undefined;
  protected headerFilenameSuffix: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;
  protected headerCustom: HTMLElement | undefined;
  protected separatorCache: Map<string, CustomHunkElementCache> = new Map();
  protected errorWrapper: HTMLElement | undefined;
  protected placeHolder: HTMLElement | undefined;

  protected hunksRenderer: DiffHunksRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected scrollSyncManager: ScrollSyncManager;
  protected interactionManager: InteractionManager<'diff'>;

  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>> =
    new Map();
  // Annotations for the displayed diff, stored with that diff in renderedData.
  protected get lineAnnotations(): DiffLineAnnotation<LAnnotation>[] {
    return this.renderedData?.lineAnnotations ?? EMPTY_LINE_ANNOTATIONS;
  }
  protected managersDirty = false;

  protected deletionFile?: FileContents | null;
  protected additionFile?: FileContents | null;
  // Latest input. Editor changes are kept in the private edit session.
  public fileDiff: FileDiffMetadata | undefined;
  private editSession: EditSession<LAnnotation> | undefined;
  // Diff and annotations currently displayed. Absent until a diff is rendered.
  private renderedData: FileDiffRenderData<LAnnotation> | undefined;
  // Keep the next diff and its annotations together until that diff renders.
  private pendingData: FileDiffRenderData<LAnnotation> | undefined;
  // Forces the next render() call, such as the one the owner makes after
  // requestOwnerRender.
  protected forceRenderOverride: true | undefined;
  protected renderRange: RenderRange | undefined;
  protected pendingFiles: PendingFileLoad | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected headerCache: HeaderCache = {
    lastRenderedHTML: undefined,
    html: undefined,
    fileDiff: undefined,
  };
  protected lastRowCount: number | undefined;
  // The keyed row writer of each code element on screen.
  private readonly columnReconcilers = new WeakMap<
    HTMLElement,
    ColumnReconciler
  >();
  // Keys of the rows the last column write inserted or rewrote.
  private changedRowKeys: RowKey[] = [];
  private mounted = false;

  protected enabled = true;

  protected editor: Editor<'file-diff', LAnnotation, Caret> | undefined;
  // Holds back selected-line and editor active-line writes until a queued
  // render has rebuilt the diff rows.
  protected lineStateRefreshPending = false;
  protected deferredSelectedLines: DeferredSelectedLinesWrite | undefined;
  protected deferredEditorActiveLine: DeferredEditorActiveLineWrite | undefined;

  constructor(
    public options: FileDiffOptions<LAnnotation, Caret> = {
      theme: DEFAULT_THEMES,
    },
    protected workerManager?: WorkerPoolManager | undefined,
    // Set when an owner such as React manages the container. Internal renders
    // call it, and the owner must call render().
    protected requestOwnerRender?: () => void
  ) {
    this.hunksRenderer = this.createHunksRenderer(options);
    this.resizeManager = new ResizeManager();
    this.scrollSyncManager = new ScrollSyncManager();
    this.interactionManager = new InteractionManager(
      'diff',
      pluckInteractionOptions(
        options,
        typeof options.hunkSeparators === 'function' ||
          (options.hunkSeparators ?? 'line-info') === 'line-info' ||
          options.hunkSeparators === 'line-info-basic'
          ? this.handleExpandHunk
          : undefined,
        this.getLineIndex
      )
    );
    this.workerManager?.subscribeToThemeChanges(this);
    this.enabled = true;
  }

  protected handleHighlightRender = (): void => {
    this.rerender();
  };

  private getTheme() {
    return (
      this.workerManager?.getDiffRenderOptions().theme ??
      this.options.theme ??
      DEFAULT_THEMES
    );
  }

  protected getHunksRendererOptions(
    options: FileDiffOptions<LAnnotation, Caret>
  ): DiffHunksRendererOptions {
    return getDiffHunksRendererOptions(options);
  }

  protected createHunksRenderer(
    options: FileDiffOptions<LAnnotation, Caret>
  ): DiffHunksRenderer<LAnnotation> {
    return new DiffHunksRenderer<LAnnotation>(
      this.getHunksRendererOptions(options),
      this.getAnnotationSlotName,
      this.handleHighlightRender,
      this.workerManager
    );
  }

  public getLineIndex: GetLineIndexUtility = (
    lineNumber: number,
    side: SelectionSide = 'additions'
  ) => {
    return this.getLineIndexForDiff(
      this.getDiffForLineIndex(),
      lineNumber,
      side
    );
  };

  protected getDiffForLineIndex(): FileDiffMetadata | undefined {
    return this.getRenderedDiff();
  }

  // Resolve source lines against the same diff that produced the rendered
  // rows. During an asynchronous replacement, that can be the previous diff.
  protected getLineIndexForDiff(
    fileDiff: FileDiffMetadata | undefined,
    lineNumber: number,
    side: SelectionSide
  ): [number, number] | undefined {
    if (fileDiff == null) {
      return undefined;
    }
    const lastHunk = fileDiff.hunks.at(-1);
    let targetUnifiedIndex: number | undefined;
    let targetSplitIndex: number | undefined;
    hunkIterator: for (const hunk of fileDiff.hunks) {
      const hunkStart =
        side === 'deletions' ? hunk.deletionStart : hunk.additionStart;
      const hunkCount =
        side === 'deletions' ? hunk.deletionCount : hunk.additionCount;
      let currentLineNumber =
        getHunkSideStartBoundary(hunkStart, hunkCount) + 1;
      let splitIndex = hunk.splitLineStart;
      let unifiedIndex = hunk.unifiedLineStart;

      // If we've selected a line between or before a hunk,
      // we should grab its index here
      if (lineNumber < currentLineNumber) {
        const difference = currentLineNumber - lineNumber;
        targetUnifiedIndex = Math.max(unifiedIndex - difference, 0);
        targetSplitIndex = Math.max(splitIndex - difference, 0);
        break hunkIterator;
      }

      if (lineNumber >= currentLineNumber + hunkCount) {
        if (hunk === lastHunk) {
          const difference = lineNumber - (currentLineNumber + hunkCount);
          targetUnifiedIndex =
            unifiedIndex + hunk.unifiedLineCount + difference;
          targetSplitIndex = splitIndex + hunk.splitLineCount + difference;
          break hunkIterator;
        }
        continue;
      }

      for (const content of hunk.hunkContent) {
        if (content.type === 'context') {
          if (lineNumber < currentLineNumber + content.lines) {
            const difference = lineNumber - currentLineNumber;
            targetSplitIndex = splitIndex + difference;
            targetUnifiedIndex = unifiedIndex + difference;
            break hunkIterator;
          } else {
            currentLineNumber += content.lines;
            splitIndex += content.lines;
            unifiedIndex += content.lines;
          }
        } else {
          const sideCount =
            side === 'deletions' ? content.deletions : content.additions;
          if (lineNumber < currentLineNumber + sideCount) {
            const indexDifference = lineNumber - currentLineNumber;
            targetUnifiedIndex =
              unifiedIndex +
              (side === 'additions' ? content.deletions : 0) +
              indexDifference;
            targetSplitIndex = splitIndex + indexDifference;

            break hunkIterator;
          } else {
            currentLineNumber += sideCount;
            splitIndex += Math.max(content.deletions, content.additions);
            unifiedIndex += content.deletions + content.additions;
          }
        }
      }

      break hunkIterator;
    }

    if (targetUnifiedIndex == null || targetSplitIndex == null) {
      return undefined;
    }
    return [targetUnifiedIndex, targetSplitIndex];
  }

  // FIXME(amadeus): This is a bit of a looming issue that I'll need to resolve:
  // * Do we publicly allow merging of options or do we have individualized setters?
  // * When setting new options, we need to figure out what settings require a
  //   re-render and which can just be applied more elegantly
  // * There's also an issue of options that live here on the File class and
  //   those that live on the Hunk class, and it's a bit of an issue with passing
  //   settings down and mirroring them (not great...)
  public setOptions(
    options: FileDiffOptions<LAnnotation, Caret> | undefined
  ): void {
    if (options == null) return;
    this.options = options;
    this.clearReusableHeader();
    this.hunksRenderer.setOptions(this.getHunksRendererOptions(options));
    this.syncInteractionOptions();
  }

  protected syncInteractionOptions(): void {
    this.interactionManager.setOptions(
      pluckInteractionOptions(
        this.options,
        typeof this.options.hunkSeparators === 'function' ||
          (this.options.hunkSeparators ?? 'line-info') === 'line-info' ||
          this.options.hunkSeparators === 'line-info-basic'
          ? this.handleExpandHunk
          : undefined,
        this.getLineIndex
      )
    );
  }

  private mergeOptions(
    options: Partial<FileDiffOptions<LAnnotation, Caret>>
  ): void {
    this.options = { ...this.options, ...options };
  }

  public setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    this.applyCachedThemeState(themeType);
  }

  private applyCachedThemeState(themeType: ThemeTypes): boolean {
    if (
      typeof this.options.theme === 'string' ||
      this.fileContainer == null ||
      this.appliedThemeCSS == null
    ) {
      return false;
    }
    const effectiveThemeType = this.appliedThemeCSS.baseThemeType ?? themeType;
    if (this.appliedThemeCSS.themeType === effectiveThemeType) {
      return false;
    }
    this.applyThemeState(
      this.fileContainer,
      this.appliedThemeCSS.themeStyles,
      themeType,
      this.appliedThemeCSS.baseThemeType
    );
    return true;
  }

  private hasThemeChanged(): boolean {
    return (
      this.appliedThemeCSS != null &&
      !areThemesEqual(this.appliedThemeCSS.theme, this.getTheme())
    );
  }

  public getHoveredLine = (): GetHoveredLineResult<'diff'> | undefined => {
    return this.interactionManager.getHoveredLine();
  };

  public getAnnotationSlotName = (
    annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>
  ): string => {
    return resolveEditSessionSlotName(
      this.editSession?.annotations,
      annotation,
      getLineAnnotationName
    );
  };

  // Return annotations for the working diff, including updates that haven't
  // been rendered yet.
  protected getLatestAnnotations(): DiffLineAnnotation<LAnnotation>[] {
    return (
      this.pendingData?.lineAnnotations ??
      this.editSession?.annotations?.current ??
      this.lineAnnotations
    );
  }

  // Use pending annotations only when their diff is selected for rendering.
  protected getAnnotationsForDiff(
    fileDiff: FileDiffMetadata
  ): DiffLineAnnotation<LAnnotation>[] {
    const { pendingData } = this;
    return pendingData != null &&
      areDiffTargetsEqual(fileDiff, pendingData.fileDiff)
      ? pendingData.lineAnnotations
      : this.lineAnnotations;
  }

  // Check whether the annotation array is new. Reusing a tracked array must
  // not reset positions moved by editing.
  protected isNewAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): boolean {
    const session = this.editSession?.annotations;
    const latestAnnotations = this.getLatestAnnotations();
    if (lineAnnotations === latestAnnotations) {
      return false;
    }
    return (
      session == null ||
      (lineAnnotations !== session.provided &&
        lineAnnotations !== session.current)
    );
  }

  public setLineAnnotations(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): void {
    const sessionAnnotations = this.editSession?.annotations;
    if (sessionAnnotations != null) {
      if (!this.isNewAnnotations(lineAnnotations)) {
        return;
      }
      // Use the new annotations for editing, and keep their original positions
      // so rejecting the edit can restore them.
      writeEditSessionAnnotations(
        sessionAnnotations,
        lineAnnotations,
        getLineAnnotationName
      );
    }
    const fileDiff = this.getWorkingDiff();
    if (fileDiff != null) {
      this.pendingData = { fileDiff, lineAnnotations };
    }
  }

  // Takes annotations the editor remapped and makes them what the session
  // renders: updates the session, feeds the renderer, and re-renders
  // annotation rows. Returns true when new annotations were adopted —
  // virtualized subclasses override this and refresh their layout on true.
  //
  // The editor sends moved annotations with the edit, through
  // applyDocumentChange or updateRenderCache, and again with the change event
  // (__acceptEditorChange). The identity check makes the second call a no-op.
  //
  // The annotations the caller passed in are never touched — stale
  // re-renders keep deduping against them.
  protected syncEditSessionAnnotationsFromEditor(
    lineAnnotations: DiffLineAnnotation<LAnnotation>[]
  ): boolean {
    const session = this.editSession?.annotations;
    if (session == null || lineAnnotations === session.current) {
      return false;
    }
    session.current = lineAnnotations;
    if (this.renderedData != null) {
      this.renderedData.lineAnnotations = lineAnnotations;
    }
    this.pendingData = undefined;
    this.hunksRenderer.setLineAnnotations(lineAnnotations);
    this.renderAnnotations();
    return true;
  }

  public setSelectedLines(
    range: SelectedLineRange | null,
    options?: SelectionWriteOptions
  ): void {
    if (this.lineStateRefreshPending) {
      this.deferredSelectedLines = [range, options];
    } else {
      this.interactionManager.setSelection(range, options);
    }
  }

  public setEditorActiveLine(
    lineNumber: number | null,
    options?: EditorActiveLineOptions
  ): void {
    if (this.lineStateRefreshPending) {
      this.deferredEditorActiveLine = [lineNumber, options];
    } else {
      this.interactionManager.setEditorActiveLine(lineNumber, {
        lineNumberOnly: options?.lineNumberOnly,
        side: options?.side ?? 'additions',
      });
    }
  }

  // A refresh can receive selected-lines and editor active-line writes in either
  // order. Apply the latest value from each after the rows are stable.
  protected flushDeferredLineState(): void {
    const {
      deferredEditorActiveLine: editorActiveLine,
      deferredSelectedLines: selectedLines,
    } = this;
    this.lineStateRefreshPending = false;
    this.deferredEditorActiveLine = undefined;
    this.deferredSelectedLines = undefined;

    if (editorActiveLine != null) {
      this.setEditorActiveLine(...editorActiveLine);
    }
    if (selectedLines != null) {
      this.interactionManager.setSelection(...selectedLines);
    }
  }

  public flushManagers(): void {
    if (!this.managersDirty || this.pre == null) {
      this.managersDirty = false;
      return;
    }

    const { diffStyle = 'split', overflow = 'scroll' } = this.options;
    this.interactionManager.setup(this.pre);
    this.resizeManager.setup(this.pre, {
      disableAnnotations: overflow === 'wrap',
      columnVariables: this.shouldApplyColumnVariables(overflow)
        ? 'apply'
        : 'measure',
    });
    if (overflow === 'scroll' && diffStyle === 'split') {
      this.scrollSyncManager.setup(
        this.pre,
        this.codeDeletions,
        this.codeAdditions
      );
    } else {
      this.scrollSyncManager.cleanUp();
    }
    this.managersDirty = false;
  }

  protected shouldApplyColumnVariables(overflow: 'scroll' | 'wrap'): boolean {
    if (typeof this.options.hunkSeparators === 'function') {
      return true;
    }
    return (
      overflow === 'scroll' &&
      (this.lineAnnotations.length > 0 ||
        this.pre?.hasAttribute('data-has-merge-conflict') === true)
    );
  }

  public getCodeScrollLeft(): number {
    return Math.max(
      this.codeUnified?.scrollLeft ?? 0,
      this.codeDeletions?.scrollLeft ?? 0,
      this.codeAdditions?.scrollLeft ?? 0
    );
  }

  public setCodeScrollLeft(position: number): void {
    if (this.codeUnified != null) {
      this.codeUnified.scrollLeft = position;
    }
    if (this.codeAdditions != null) {
      this.codeAdditions.scrollLeft = position;
    }
    if (this.codeDeletions != null) {
      this.codeDeletions.scrollLeft = position;
    }
  }

  public __getEffectiveCodeOptions(): BaseCodeOptions {
    return { ...this.options, ...this.hunksRenderer.getEffectiveCodeOptions() };
  }

  public cleanUp(recycle: boolean = false): void {
    const { editor } = this;
    editor?.__assertOutsideChangeCallback('FileDiff.cleanUp');
    dequeueRender(this.handleEditSessionRender);
    this.emitPostRender(true);
    // Tear the editor down while the code scrollers still exist. A recycle
    // keeps its document and undo history; a full teardown drops them as the
    // session ends.
    editor?.cleanUp(recycle ? 'recycle' : 'discard');
    if (!recycle) {
      this.editor = undefined;
    }
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.managersDirty = false;
    this.workerManager?.unsubscribeToThemeChanges(this);
    this.renderRange = undefined;
    if (!recycle) {
      this.pendingFiles = undefined;
    }

    // Clean up the elements
    if (!this.isComponentManaged) {
      this.fileContainer?.remove();
    }
    this.fileContainer = undefined;
    this.mounted = false;
    if (!recycle) {
      this.renderedData = undefined;
      this.pendingData = undefined;
    }
    this.clearAuxiliaryNodes();
    this.annotationCache.clear();
    this.pre?.remove();
    this.pre = undefined;
    this.codeUnified = undefined;
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;
    this.appliedPreAttributes = undefined;
    this.headerElement?.remove();
    this.headerElement = undefined;
    this.clearHeaderSlots();
    this.placeHolder?.remove();
    this.placeHolder = undefined;
    this.headerCache.lastRenderedHTML = undefined;
    if (!recycle) {
      this.clearReusableHeader();
    }
    this.errorWrapper?.remove();
    this.errorWrapper = undefined;
    this.spriteSVG = undefined;
    this.lastRowCount = undefined;
    this.themeCSSStyle = undefined;
    this.appliedThemeCSS = undefined;
    this.hasAdoptedThemeCSS = false;
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;

    if (recycle) {
      this.hunksRenderer.recycle();
    } else {
      this.hunksRenderer.cleanUp();
      this.workerManager = undefined;
      // Clean up the data
      this.fileDiff = undefined;
      this.editSession = undefined;
      this.deletionFile = undefined;
      this.additionFile = undefined;
    }
    this.lineStateRefreshPending = false;
    this.deferredEditorActiveLine = undefined;
    this.deferredSelectedLines = undefined;
    this.enabled = false;
  }

  public virtualizedSetup(): void {
    this.enabled = true;
    this.workerManager?.subscribeToThemeChanges(this);
  }

  public hydrate({
    fileContainer,
    prerenderedHTML,
    preventEmit = false,
    lineAnnotations,
    fileDiff,
    ...fileInputProps
  }: FileDiffHydrationProps<LAnnotation>): void {
    if (!this.enabled) {
      throw new Error(
        'FileDiff.hydrate: attempting to call hydrate after cleaned up'
      );
    }
    if (this.fileContainer != null) {
      throw new Error(
        'FileDiff.hydrate: hydrate can only be called before the instance has rendered or hydrated'
      );
    }
    const fileInput = getDiffFileInput(fileInputProps, 'FileDiff.hydrate');
    const oldFile = fileInput?.oldFile;
    const newFile = fileInput?.newFile;
    this.hydrateElements(fileContainer, prerenderedHTML);
    // An editor attached before hydration may carry a retained keyed document
    // and its session-shaped hunks. Render through that private session instead
    // of adopting external markup, so hydration cannot recompute or flash it.
    const forceEditorRender = this.editor != null;
    if (
      forceEditorRender ||
      shouldRenderCode(
        this.pre,
        hasDiffContent({ fileDiff, oldFile, newFile }),
        this.options.collapsed
      ) ||
      shouldRenderHeader(
        this.headerElement,
        hasDiffHeaderContent({ fileDiff, oldFile, newFile }),
        this.options.disableFileHeader
      )
    ) {
      this.render({
        ...fileInputProps,
        fileContainer,
        lineAnnotations,
        fileDiff,
        forceRender: forceEditorRender || fileInputProps.forceRender,
        preventEmit: true,
      });
    }
    // Otherwise orchestrate our setup
    else {
      this.hydrationSetup({
        fileDiff,
        lineAnnotations,
        ...fileInput,
      });
    }
    if (!preventEmit) {
      this.emitPostRender();
    }
  }

  protected hydrateElements(
    fileContainer: HTMLElement,
    prerenderedHTML: string | undefined
  ): void {
    if (this.fileContainer !== fileContainer) {
      this.emitPostRender(true);
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
        element.hasAttribute(THEME_CSS_ATTRIBUTE)
      ) {
        this.themeCSSStyle = element;
        continue;
      }
      if (
        element instanceof HTMLStyleElement &&
        element.hasAttribute(UNSAFE_CSS_ATTRIBUTE)
      ) {
        this.unsafeCSSStyle = element;
        this.appliedUnsafeCSS = element.textContent;
        continue;
      }
    }
    if (this.pre != null) {
      this.syncCodeNodesFromPre(this.pre);
      this.pre.removeAttribute('data-dehydrated');
    }
    this.fileContainer = fileContainer;
    this.hydrateMeasuredScrollbar();
  }

  protected hydrationSetup({
    fileDiff,
    oldFile,
    newFile,
    lineAnnotations,
  }: HydrationSetup<LAnnotation>): void {
    // It's possible we are hydrating a pure-rename and therefore there will be
    // no pre element
    const hydratedAnnotations = lineAnnotations ?? this.getLatestAnnotations();
    this.pendingData = undefined;
    this.additionFile = newFile;
    this.deletionFile = oldFile;
    this.fileDiff =
      fileDiff ??
      (oldFile !== undefined && newFile !== undefined
        ? parseDiffFromFile(oldFile, newFile, this.options.parseDiffOptions)
        : undefined);
    this.renderedData =
      this.fileDiff != null
        ? { fileDiff: this.fileDiff, lineAnnotations: hydratedAnnotations }
        : undefined;
    if (this.fileDiff != null) {
      this.adoptRenderData(this.fileDiff);
    }

    if (this.pre == null) {
      return;
    }

    this.syncInteractionOptions();
    this.hunksRenderer.hydrate(this.fileDiff);
    // FIXME(amadeus): not sure how to handle this yet...
    // this.renderSeparators();
    this.renderAnnotations();
    this.renderGutterUtility();
    this.injectUnsafeCSS();
    this.managersDirty = true;
    this.flushManagers();
  }

  public rerender(): void {
    if (
      !this.enabled ||
      (this.getInputDiff() == null &&
        this.additionFile == null &&
        this.deletionFile == null)
    ) {
      return;
    }
    if (this.requestRender()) return;
    this.render({ forceRender: true, renderRange: this.renderRange });
  }

  // Editors update their rows directly. Other internal renders can be driven
  // by the owner, so React updates its children before calling render().
  protected requestRender(): boolean {
    const { requestOwnerRender } = this;
    if (this.editSession != null || requestOwnerRender == null) {
      return false;
    }
    this.forceRenderOverride = true;
    requestOwnerRender();
    return true;
  }

  protected get isComponentManaged(): boolean {
    return this.requestOwnerRender != null;
  }

  public onThemeChange(): void {
    this.hunksRenderer.clearRenderCache();
    this.rerender();
  }

  // This wrapper must stay separate from `expandHunk` because subclasses like
  // `VirtualizedFileDiff` replace `expandHunk` with their own instance field
  // after `super()` returns. `InteractionManager` is created in this base
  // constructor, so it needs a stable callback that resolves `this.expandHunk`
  // at click time instead of capturing the base implementation too early.
  public handleExpandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    this.expandHunk(hunkIndex, direction, expansionLineCountOverride);
  };

  public expandHunk = (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): void => {
    this.loadFilesIfNecessary();
    this.hunksRenderer.expandHunk(
      hunkIndex,
      direction,
      expansionLineCountOverride
    );
    this.rerender();
  };

  protected loadFilesIfNecessary(): void {
    const fileDiff = this.getInputDiff();
    const { loadDiffFiles } = this.options;
    if (
      fileDiff == null ||
      !canHydrateDiff(fileDiff) ||
      this.pendingFiles?.fileDiff === fileDiff
    ) {
      return;
    }
    if (loadDiffFiles == null) {
      throw new Error(
        'FileDiff: loadDiffFiles is required to load full files for a partial diff'
      );
    }

    const promise = this.loadFilesForDiff(fileDiff, loadDiffFiles);
    const pendingFiles: PendingFileLoad = (this.pendingFiles = {
      fileDiff,
      promise,
    });
    // Track the exact request object so an older completion for the same diff
    // cannot clear a newer request.
    const clearPendingFiles = (): void => {
      if (this.pendingFiles === pendingFiles) {
        this.pendingFiles = undefined;
      }
    };
    pendingFiles.promise = promise.finally(clearPendingFiles);
  }

  /**
   * In order to start an edit session, you must be using a `fileDiff` that
   * includes the full contents for both files. In other words, `isPartial`
   * must be false You can use `prepareForEditing` to hydrate if
   * `loadDiffFiles` was passed in to `options`
   */
  public __canAttachEditor(): boolean {
    const fileDiff = this.getInputDiff();
    return fileDiff != null && !fileDiff.isPartial;
  }

  /**
   * Load a partial diff before starting a new edit session. Call this before
   * Editor.edit when the diff may still be partial; it resolves only when this
   * instance has a complete diff to edit.
   */
  public async prepareForEditing(): Promise<void> {
    if (this.__canAttachEditor()) {
      return;
    }
    const pending = this.__prepareForEditing();
    if (pending == null) {
      const fileDiff = this.getInputDiff();
      if (fileDiff?.isPartial === true && !canHydrateDiff(fileDiff)) {
        throw new Error(
          'FileDiff.prepareForEditing: this partial diff cannot be hydrated; provide a complete diff'
        );
      }
      throw new Error(
        'FileDiff.prepareForEditing: a partial diff requires loadDiffFiles'
      );
    }
    await pending;
    if (!this.__canAttachEditor()) {
      throw new Error(
        'FileDiff.prepareForEditing: the diff did not finish loading'
      );
    }
  }

  /** Hydrate a diff if necessary  */
  public __prepareForEditing(): Promise<void> | undefined {
    if (this.__canAttachEditor()) {
      return undefined;
    }
    const fileDiff = this.getInputDiff();
    if (fileDiff?.isPartial === true && !canHydrateDiff(fileDiff)) {
      throw new Error(
        'FileDiff: this partial diff cannot be hydrated; provide a complete diff to edit'
      );
    }
    this.loadFilesIfNecessary();
    return this.pendingFiles?.promise;
  }

  private async loadFilesForDiff(
    fileDiff: FileDiffMetadata,
    loadDiffFiles: NonNullable<BaseDiffOptions['loadDiffFiles']>
  ): Promise<void> {
    try {
      const files = await loadDiffFiles(fileDiff);
      if (this.getInputDiff() !== fileDiff) {
        return;
      }

      await this.handleFilesLoaded(fileDiff, files);
    } catch (error: unknown) {
      if (this.options.disableErrorHandling === true) {
        throw error;
      }
      console.error(error);
    }
  }

  protected async handleFilesLoaded(
    expectedDiff: FileDiffMetadata,
    files: LoadedPartialDiffContents
  ): Promise<void> {
    if (this.getInputDiff() !== expectedDiff || !expectedDiff.isPartial) {
      return;
    }
    hydratePartialDiff('merge', expectedDiff, files);
    this.setHydratedState(files);
    if (!this.installHydratedDiff(expectedDiff)) {
      await awaitWithTimeout(() => this.primeHighlightCache(expectedDiff));
      if (!this.enabled || this.getInputDiff() !== expectedDiff) {
        return;
      }
    }
    this.rerender();
  }

  // Called when a partial diff finishes loading. If an edit session exists,
  // it is restarted from the loaded diff and the editor's document is
  // updated. Returns false when there is no session to update.
  protected installHydratedDiff(expectedDiff: FileDiffMetadata): boolean {
    if (this.editSession == null || this.getInputDiff() !== expectedDiff) {
      return false;
    }
    this.replaceEditSession(expectedDiff, this.getLatestAnnotations());
    return true;
  }

  // Restarts the session from a new diff and gives the editor's document the
  // new contents. Undo history is kept unless the old side, name or language
  // changed.
  private replaceEditSession(
    incomingDiff: FileDiffMetadata,
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined
  ): void {
    const { editor, editSession } = this;
    const previousDiff = editSession?.diff;
    this.installEditSession(incomingDiff);
    if (editor != null && previousDiff != null) {
      editor.__replaceDocument(
        getAdditionFile(incomingDiff),
        shouldResetUndoState(previousDiff, incomingDiff),
        lineAnnotations
      );
    }
  }

  // Stores a new input and says whether it differs from the current one. A
  // session takes a complete input at once; a partial one is loaded first and
  // taken by handleFilesLoaded.
  protected updateInputDiff(
    incomingDiff: FileDiffMetadata,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ): boolean {
    if (areDiffTargetsEqual(this.getInputDiff(), incomingDiff)) {
      return false;
    }
    this.editor?.__assertOutsideChangeCallback('FileDiff.render');
    const previousAnnotations = this.getLatestAnnotations();
    this.fileDiff = incomingDiff;
    const { editSession } = this;
    if (editSession?.annotations != null && lineAnnotations != null) {
      editSession.annotations = adoptEditSessionAnnotations(
        lineAnnotations,
        getLineAnnotationName,
        editSession.annotations
      );
    }
    if (editSession != null) {
      if (incomingDiff.isPartial) {
        editSession.inputDiff = incomingDiff;
        this.loadFilesIfNecessary();
      } else {
        this.replaceEditSession(
          incomingDiff,
          editSession.annotations?.current ??
            lineAnnotations ??
            previousAnnotations
        );
      }
    }
    this.pendingData = {
      fileDiff: this.editSession?.diff ?? incomingDiff,
      lineAnnotations:
        this.editSession?.annotations?.current ??
        lineAnnotations ??
        previousAnnotations,
    };
    return true;
  }

  // When an editor opens a document saved under a document key,
  // `retainedDocument` restores its text and undo history. It is omitted when
  // replacing the diff in an open editor so the replacement is handled as a
  // new external update instead of overwriting the document being edited.
  private installEditSession(
    inputDiff: FileDiffMetadata,
    retainedDocument?: FileContents,
    retainedSession?: RetainedDiffSessionSnapshot
  ): void {
    const sessionDiff = this.hunksRenderer.startEditSession(inputDiff, {
      document: retainedDocument,
      snapshot: retainedSession,
    });
    // Initialize annotations when the session starts so updateInputDiff can
    // reset their positions when a replacement arrives. An existing session
    // keeps its tracked annotations.
    const annotations =
      this.editSession?.annotations ??
      adoptEditSessionAnnotations(
        this.getLatestAnnotations(),
        getLineAnnotationName
      );
    this.editSession = {
      diff: sessionDiff,
      inputDiff,
      annotations,
    };
    this.pendingData = {
      fileDiff: sessionDiff,
      lineAnnotations: annotations.current,
    };
  }

  protected setHydratedState(files: LoadedPartialDiffContents): void {
    this.deletionFile = files.oldFile;
    this.additionFile = files.newFile;
    this.workerManager?.cleanUpTasks(this.hunksRenderer);
    this.hunksRenderer.clearRenderCache();
  }

  public render({
    fileDiff,
    deferManagers = false,
    forceRender = false,
    preventEmit = false,
    lineAnnotations,
    fileContainer,
    containerWrapper,
    renderRange,
    ...fileInputProps
  }: FileDiffRenderProps<LAnnotation>): boolean {
    if (!this.enabled) {
      // NOTE(amadeus): May need to be a silent failure? Making it loud for now
      // to better understand it
      throw new Error(
        'FileDiff.render: attempting to call render after cleaned up'
      );
    }
    forceRender = this.forceRenderOverride ?? forceRender;
    this.forceRenderOverride = undefined;

    const fileInput = getDiffFileInput(fileInputProps, 'FileDiff.render');
    const oldFile = fileInput?.oldFile;
    const newFile = fileInput?.newFile;

    // postpone background tokenizing to next frame for avoiding UI freeze
    // during render
    this.editor?.__postponeBgTokenizeToNextFrame();

    const {
      collapsed = false,
      themeType = 'system',
      expandUnchanged = false,
    } = this.options;
    const nextRenderRange = collapsed ? undefined : renderRange;
    const themeChanged = this.hasThemeChanged();
    const hasFileInput = fileInput != null;
    const filesDidChange =
      hasFileInput &&
      (!areOptionalFilesEqual(oldFile, this.deletionFile) ||
        !areOptionalFilesEqual(newFile, this.additionFile));
    let diffDidChange =
      fileDiff != null && !areDiffTargetsEqual(fileDiff, this.getInputDiff());
    const annotationsChanged =
      lineAnnotations != null &&
      (lineAnnotations.length > 0 || this.getLatestAnnotations().length > 0)
        ? this.isNewAnnotations(lineAnnotations)
        : false;

    if (
      !collapsed &&
      areRenderRangesEqual(nextRenderRange, this.renderRange) &&
      !forceRender &&
      !annotationsChanged &&
      !themeChanged &&
      // If using the fileDiff API, lets check to see if they are equal to
      // avoid doing work
      ((fileDiff != null && !diffDidChange) ||
        // If using the oldFile/newFile API then lets check to see if they are
        // equal
        (fileDiff == null && !filesDidChange))
    ) {
      const rendered = this.applyCachedThemeState(themeType);
      if (rendered) {
        this.finalizeRender();
      }
      return rendered;
    }

    let nextParsedFileDiff: FileDiffMetadata | undefined;
    if (
      fileDiff == null &&
      hasFileInput &&
      (filesDidChange || this.getInputDiff() == null)
    ) {
      nextParsedFileDiff = parseDiffFromFile(
        fileInput.oldFile,
        fileInput.newFile,
        this.options.parseDiffOptions
      );
    }

    // A new diff is not allowed from inside onChange. Refuse it here, before
    // the file pair and render range below are stored, so a retry after the
    // callback still sees it as new.
    if ((fileDiff != null && diffDidChange) || nextParsedFileDiff != null) {
      this.editor?.__assertOutsideChangeCallback('FileDiff.render');
    }
    this.renderRange = nextRenderRange;
    // Store files only when this render actually carried a file input:
    // internal rerenders pass none, and wiping the pair here would defeat the
    // oldFile/newFile early-return on every later host render. An explicit
    // fileDiff input supersedes a previously parsed pair, so clear it then.
    if (hasFileInput) {
      this.deletionFile = oldFile;
      this.additionFile = newFile;
    } else if (fileDiff != null) {
      this.deletionFile = undefined;
      this.additionFile = undefined;
    }

    if (fileDiff != null && diffDidChange) {
      this.updateInputDiff(fileDiff, lineAnnotations);
    } else if (nextParsedFileDiff != null) {
      diffDidChange = true;
      this.updateInputDiff(nextParsedFileDiff, lineAnnotations);
    }
    if (diffDidChange) {
      this.clearReusableHeader();
    }

    if (lineAnnotations != null) {
      this.setLineAnnotations(lineAnnotations);
    }

    const workingDiff = this.getWorkingDiff();
    if (workingDiff == null) {
      return false;
    }
    // Backstop for sessions that ended without their exit hook running (e.g.
    // session-shaped metadata reused after a host teardown): restore
    // recompute-shaped hunks before rendering.
    if (
      workingDiff.editSessionDirty === true &&
      this.shouldSelfHealEditSession()
    ) {
      finishEditSessionForDiff(workingDiff, this.options.parseDiffOptions);
      void this.hunksRenderer.refreshHighlightedResult();
    }
    if (expandUnchanged) {
      this.loadFilesIfNecessary();
    }
    this.hunksRenderer.setOptions(this.getHunksRendererOptions(this.options));
    this.syncInteractionOptions();

    this.prepareRenderData(
      this.hunksRenderer.getDiffForNextRender(workingDiff)
    );

    const { disableErrorHandling = false, disableFileHeader = false } =
      this.options;

    if (disableFileHeader) {
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.remove();
        this.headerElement = undefined;
        this.headerCache.lastRenderedHTML = undefined;
      }
      this.clearHeaderSlots();
    }
    fileContainer = this.getOrCreateFileContainer(
      fileContainer,
      containerWrapper
    );
    this.applyCachedThemeState(themeType);

    if (collapsed) {
      this.removeRenderedCode();
      this.clearAuxiliaryNodes();

      try {
        const hunksResult = this.hunksRenderer.renderDiff(
          workingDiff,
          EMPTY_RENDER_RANGE
        );
        if (hunksResult != null) {
          this.applyThemeState(
            fileContainer,
            hunksResult.themeStyles,
            themeType,
            hunksResult.baseThemeType
          );
        }
        if (hunksResult?.headerElement != null) {
          this.applyHeaderToDOM(
            hunksResult.headerElement,
            fileContainer,
            hunksResult.fileDiff
          );
        }
        this.renderSeparators([]);
        this.adoptRenderData(hunksResult?.fileDiff ?? workingDiff);
        this.injectUnsafeCSS();
      } catch (error: unknown) {
        if (disableErrorHandling) {
          throw error;
        }
        console.error(error);
        if (error instanceof Error) {
          this.applyErrorToDOM(error, fileContainer);
        }
      }
      this.finalizeRender();
      if (!preventEmit) {
        this.emitPostRender();
      }
      return true;
    }

    // The new-file lines this render shows, which the editor works with.
    const editorRenderRange =
      this.editor != null
        ? this.computeEditorRenderRange(nextRenderRange)
        : undefined;
    const finishedTokens = this.editor?.__prepareRender(editorRenderRange);
    if (finishedTokens != null) {
      this.hunksRenderer.setTokens(finishedTokens);
    }
    try {
      const pre = this.getOrCreatePreNode(fileContainer);

      const hunksResult = this.hunksRenderer.renderDiff(
        workingDiff,
        nextRenderRange
      );
      if (hunksResult == null) {
        if (
          this.workerManager?.isInitialized() === false &&
          this.workerManager.isWorkingPool()
        ) {
          void this.workerManager
            .initialize()
            .catch(() => {})
            .then(() => this.rerender());
        }
        return false;
      }

      this.applyThemeState(
        fileContainer,
        hunksResult.themeStyles,
        themeType,
        hunksResult.baseThemeType
      );

      if (hunksResult.headerElement != null) {
        this.applyHeaderToDOM(
          hunksResult.headerElement,
          fileContainer,
          hunksResult.fileDiff
        );
      }
      const { unified, deletions, additions } = hunksResult.columns;
      if (unified != null || deletions != null || additions != null) {
        this.applyHunksToDOM(pre, hunksResult);
      } else if (this.pre != null) {
        this.pre.remove();
        this.pre = undefined;
      }
      this.renderSeparators(hunksResult.hunkData);
      this.adoptRenderData(hunksResult.fileDiff);
      this.applyBuffers(pre, nextRenderRange);
      this.injectUnsafeCSS();
      this.renderAnnotations();
      this.renderGutterUtility();

      this.managersDirty = true;
      if (!deferManagers) {
        this.flushManagers();
      }

      this.finalizeRender();
      if (this.editor != null) {
        this.syncRenderViewToEditor(editorRenderRange);
      }
    } catch (error: unknown) {
      if (disableErrorHandling) {
        throw error;
      }
      console.error(error);
      if (error instanceof Error) {
        this.applyErrorToDOM(error, fileContainer);
      }
    }
    if (!preventEmit) {
      this.emitPostRender();
    }
    return true;
  }

  protected finalizeRender(): void {}

  protected emitPostRender(unmount = false): void {
    const {
      fileContainer,
      options: { onPostRender },
    } = this;

    if (unmount) {
      if (!this.mounted) {
        return;
      }
      this.mounted = false;
      if (fileContainer == null) {
        return;
      }
      this.options.onPostRender?.(fileContainer, this, 'unmount');
      return;
    }

    if (fileContainer == null) {
      return;
    }

    const phase: PostRenderPhase = this.mounted ? 'update' : 'mount';
    this.mounted = true;
    onPostRender?.(fileContainer, this, phase);
  }

  // Return the latest input without editor changes. It may be newer than the
  // displayed diff while a replacement is loading or being highlighted.
  protected getInputDiff(): FileDiffMetadata | undefined {
    return this.fileDiff;
  }

  // Return the editor's copy, including its changes, or the input when there
  // is no edit session. The editor keeps its copy while a partial input loads.
  // Use fallbackDiff if the new input is not stored yet.
  protected getWorkingDiff(
    fallbackDiff: FileDiffMetadata | undefined = this.fileDiff
  ): FileDiffMetadata | undefined {
    return this.editSession?.diff ?? fallbackDiff;
  }

  // Return the displayed diff. While a replacement is being highlighted,
  // this still returns the previous diff.
  protected getRenderedDiff(): FileDiffMetadata | undefined {
    return this.renderedData?.fileDiff;
  }

  /**
   * @internal Data the next render() with this input will display. While a
   * replacement diff is being highlighted, this is still the displayed data.
   */
  public __getNextRenderData({
    fileDiff,
    lineAnnotations,
  }: FileDiffRenderInput<LAnnotation>): FileDiffRenderData<LAnnotation> {
    const sessionAnnotations = this.editSession?.annotations;
    // Keep the supplied content during editing. The editor moves annotation
    // rows through stable slots without rerendering their React children.
    if (sessionAnnotations != null) {
      return {
        fileDiff,
        lineAnnotations:
          lineAnnotations != null && this.isNewAnnotations(lineAnnotations)
            ? lineAnnotations
            : sessionAnnotations.provided,
      };
    }
    const workingDiff = this.getWorkingDiff(fileDiff) ?? fileDiff;
    const nextDiff = this.hunksRenderer.getDiffForNextRender(workingDiff);
    return {
      fileDiff: nextDiff,
      lineAnnotations:
        lineAnnotations != null && areDiffTargetsEqual(nextDiff, workingDiff)
          ? lineAnnotations
          : this.getAnnotationsForDiff(nextDiff),
    };
  }

  // Build rows using annotations for the diff the renderer selected.
  // Subclasses also prepare their additional rows here.
  protected prepareRenderData(fileDiff: FileDiffMetadata): void {
    this.hunksRenderer.setLineAnnotations(this.getAnnotationsForDiff(fileDiff));
  }

  // Record the diff now on screen. If it matches pendingData, apply those
  // annotations and clear pendingData; otherwise keep the pending update.
  protected adoptRenderData(fileDiff: FileDiffMetadata): void {
    const { pendingData } = this;
    const matchesPending =
      pendingData != null &&
      areDiffTargetsEqual(fileDiff, pendingData.fileDiff);
    this.renderedData = {
      fileDiff,
      lineAnnotations: matchesPending
        ? pendingData.lineAnnotations
        : this.lineAnnotations,
    };
    if (matchesPending) {
      this.pendingData = undefined;
    }
  }

  private syncRenderViewToEditor(
    renderRange = this.computeEditorRenderRange(this.renderRange)
  ): void {
    const { editor, fileContainer } = this;
    const lineAnnotations = this.getLatestAnnotations();
    const fileDiff = this.getWorkingDiff();
    if (
      editor == null ||
      fileContainer == null ||
      fileDiff == null ||
      fileDiff.isPartial
    ) {
      return;
    }
    const sync = (highlighter: DiffsHighlighter): void => {
      if (
        !this.enabled ||
        this.editor !== editor ||
        this.fileContainer !== fileContainer ||
        this.getWorkingDiff() !== fileDiff
      ) {
        return;
      }
      editor.__syncRenderView({
        highlighter,
        fileContainer,
        fileDiff,
        lineAnnotations,
        renderRange,
      });
    };
    const theme = this.getTheme();
    const lang = fileDiff.lang ?? getFiletypeFromFileName(fileDiff.name);
    // Sync synchronously whenever the shared highlighter is ready; otherwise
    // load it and sync once it resolves.
    const highlighter = getHighlighterIfLoaded({
      theme,
      lang,
    });
    if (highlighter != null) {
      sync(highlighter);
    } else {
      void getSharedHighlighter({
        themes: getThemes(theme),
        langs: ['text', lang],
        preferredHighlighter: resolvePreferredHighlighter(
          this.workerManager,
          this.options
        ),
      })
        .then(sync)
        .catch((error: unknown) => {
          if (!(error instanceof HighlighterDisposedError)) {
            console.error(error);
          }
        });
    }
  }

  // The stored render range is in rendered-row units for the windowed AST
  // pipeline, but the editor consumes render ranges in document-line units.
  // Derive the addition-side document window covered by the rendered rows:
  // startingLine = first addition line with a row in the window, totalLines =
  // last such line - first + 1, and 0 when the window holds no addition rows
  // (e.g. a pure-deletion run taller than the viewport).
  private computeEditorRenderRange(
    renderRange: RenderRange | undefined
  ): RenderRange | undefined {
    const fileDiff = this.getWorkingDiff();
    if (
      renderRange == null ||
      fileDiff == null ||
      isDefaultRenderRange(renderRange)
    ) {
      return renderRange;
    }
    const {
      diffStyle = 'split',
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    let firstLineNumber: number | undefined;
    let lastLineNumber: number | undefined;
    iterateOverDiff({
      diff: fileDiff,
      diffStyle,
      startingLine: renderRange.startingLine,
      totalLines: renderRange.totalLines,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
      callback: ({ additionLine }) => {
        if (additionLine != null) {
          firstLineNumber ??= additionLine.lineNumber;
          lastLineNumber = additionLine.lineNumber;
        }
      },
    });
    if (firstLineNumber == null || lastLineNumber == null) {
      return { ...renderRange, startingLine: 0, totalLines: 0 };
    }
    return {
      ...renderRange,
      startingLine: firstLineNumber - 1,
      totalLines: lastLineNumber - firstLineNumber + 1,
    };
  }

  /** @internal Settle annotations locally. */
  public __acceptEditorChange(
    event: EditorChangeEvent<'file-diff', LAnnotation, Caret>
  ): void {
    const { lineAnnotations } = event;
    if (lineAnnotations != null) {
      this.syncEditSessionAnnotationsFromEditor(lineAnnotations);
    }
  }

  public emitEditChange(
    event: EditorChangeEvent<'file-diff', LAnnotation, Caret>
  ): void {
    const { onEditChange } = this.options;
    onEditChange?.(event);
  }

  /**
   * @internal Capture the current diff session, or return `undefined` when no
   * complete compatible session exists.
   *
   * When `clone` is true, the returned lines and hunks are copied.
   */
  public __captureDocumentSessionState(
    clone = true
  ): CapturedDiffSessionState | undefined {
    const sessionDiff = this.editSession?.diff;
    if (sessionDiff == null || sessionDiff.isPartial) {
      return undefined;
    }
    return {
      diffSession: {
        oldFile:
          sessionDiff.type !== 'new'
            ? {
                name: sessionDiff.prevName ?? sessionDiff.name,
                lines: clone
                  ? [...sessionDiff.deletionLines]
                  : sessionDiff.deletionLines,
              }
            : null,
        type: sessionDiff.type,
        hunks: clone ? cloneHunks(sessionDiff.hunks) : sessionDiff.hunks,
      },
      hasChanges: sessionDiff.editSessionDirty === true,
    };
  }

  /** @internal Associate this component with its editor for a render lifecycle. */
  public __attachEditor(
    editor: Editor<'file-diff', LAnnotation, Caret>
  ): () => void {
    // Editing is a plain file-diff concern only. Subclasses with their own
    // hunk semantics (UnresolvedFile) are not editable, so an editor must
    // never attach to them.
    if (this.type !== 'file-diff') {
      throw new Error(
        `FileDiff.__attachEditor: cannot attach an editor to a "${this.type}" diff`
      );
    }
    if (this.editor != null) {
      throw new Error('FileDiff.__attachEditor: an editor is already attached');
    }
    if (!this.__canAttachEditor()) {
      throw new Error(
        'FileDiff.__attachEditor: a complete diff is required before editing'
      );
    }
    const detach = () => {
      this.editor = undefined;
      this.endEditSession();
    };
    try {
      this.resumeEditorRendering(editor);
      return detach;
    } catch (error) {
      detach();
      throw error;
    }
  }

  /** @internal Resume rendering for the editor already associated with this component. */
  public __resumeEditor(editor: Editor<'file-diff', LAnnotation, Caret>): void {
    if (this.editor !== editor) {
      throw new Error('FileDiff.__resumeEditor: editor association changed');
    }
    this.resumeEditorRendering(editor);
  }

  private resumeEditorRendering(
    editor: Editor<'file-diff', LAnnotation, Caret>
  ): void {
    const inputDiff = this.getInputDiff();
    const initialInputDiff =
      this.editSession == null && inputDiff != null && !inputDiff.isPartial
        ? inputDiff
        : undefined;
    if (initialInputDiff != null) {
      this.installEditSession(
        initialInputDiff,
        editor.__getDocumentContents(getAdditionFile(initialInputDiff)),
        editor.__getDocumentSessionState()
      );
    }
    this.editor = editor;
    // The editor sync below refuses partial diffs (it needs the full file
    // contents); kick off hydration so the loaded re-render re-runs it.
    if (this.getInputDiff()?.isPartial === true) {
      this.loadFilesIfNecessary();
    }
    const editSessionDiff = this.editSession?.diff;
    if (this.hunksRenderer.editorRenderReady()) {
      // Compatible markup can be reused without repainting. Once the renderer
      // transfers that cache to the private session, the existing DOM belongs
      // to the session as well.
      if (
        editSessionDiff != null &&
        this.hunksRenderer.diffCache === editSessionDiff
      ) {
        this.adoptRenderData(editSessionDiff);
      }
      if (this.columnsWritten()) {
        this.syncRenderViewToEditor();
      } else {
        this.rerender();
      }
    } else {
      // The current markup is missing the editor's token metadata, or its
      // highlight is still pending: render through the session, which also
      // syncs the render view once it paints.
      this.rerender();
    }
  }

  /**
   * @internal
   *
   * Ends the edit session and settles which diff this component renders.
   * Requires the editor to be detached first. Does nothing when no session
   * exists, so callers can invoke it again safely after it has settled.
   *
   * `onEditComplete` receives the completed diff, current input diff,
   * complete file pair, and both annotation collections even when the final
   * text is unchanged. In `install` mode, accepting installs the completed diff
   * and its annotations; rejecting or having no handler restores the external
   * values. `discard` mode always restores the external values. An accepted
   * diff cannot reuse the replaced diff's `cacheKey`.
   */
  public __completeEditSession(
    editor: Editor<'file-diff', LAnnotation, Caret>,
    mode: 'install' | 'discard'
  ): void {
    this.settleEditSession(mode === 'install', editor);
  }

  private settleEditSession(
    installResult: boolean,
    editor: Editor<'file-diff', LAnnotation, Caret> | undefined
  ): void {
    const { editSession } = this;
    if (editSession == null) {
      return;
    }
    const {
      diff: editSessionDiff,
      inputDiff,
      annotations: editSessionAnnotations,
    } = editSession;
    const inputAnnotations =
      editSessionAnnotations?.provided ?? this.lineAnnotations;
    if (this.editor != null) {
      throw new Error(
        'FileDiff.__completeEditSession: detach the editor before completing the session'
      );
    }
    this.endEditSession();

    const sessionAnnotationsCurrent = editSessionAnnotations?.current;
    let acceptedDiff: FileDiffMetadata | undefined;
    let acceptedOldFile: FileContents | null = null;
    let acceptedNewFile: FileContents | null = null;
    let failed = false;
    let failure: unknown;
    if (editor == null) {
      throw new Error(
        'FileDiff.__completeEditSession: editor is required for completion'
      );
    }
    const completedDiff = cloneFileDiffMetadata(editSessionDiff);
    const newFile: FileContents = {
      name: completedDiff.name,
      contents: completedDiff.additionLines.join(''),
    };
    if (completedDiff.lang != null) {
      newFile.lang = completedDiff.lang;
    }
    const event: FileDiffEditCompleteEvent<LAnnotation, Caret> = {
      fileDiff: completedDiff,
      editor,
      originalFileDiff: inputDiff,
      oldFile:
        completedDiff.type === 'new'
          ? null
          : {
              name: completedDiff.prevName ?? completedDiff.name,
              contents: completedDiff.deletionLines.join(''),
            },
      newFile,
      lineAnnotations: sessionAnnotationsCurrent,
      originalLineAnnotations: inputAnnotations,
    };
    // Frozen so a handler cannot swap the event's fileDiff/originalFileDiff
    // references; nested mutation (i.e. a fresh cacheKey on event.fileDiff)
    // still works.
    Object.freeze(event);
    try {
      editor.__emitEditComplete(event);
      const decision = this.options.onEditComplete?.(event);
      if (decision === 'accept') {
        if (
          completedDiff.cacheKey != null &&
          completedDiff.cacheKey === inputDiff.cacheKey
        ) {
          throw new Error(
            'FileDiff.__completeEditSession: an accepted diff must not reuse the replaced diff cacheKey'
          );
        }
        acceptedDiff = completedDiff;
        acceptedOldFile = event.oldFile;
        acceptedNewFile = event.newFile;
      }
    } catch (error) {
      failed = true;
      failure = error;
    }

    if (installResult && acceptedDiff != null) {
      // Callers using the oldFile/newFile API get the stored pair
      // refreshed so their next render with the event's files does not
      // reparse over the accepted diff. Every editable pair has a new
      // side (deleted files cannot be edited), so that is the check.
      if (this.additionFile != null) {
        this.deletionFile = acceptedOldFile;
        this.additionFile = acceptedNewFile;
      }
    }
    this.editSession = undefined;
    this.fileDiff =
      installResult && acceptedDiff != null ? acceptedDiff : inputDiff;
    this.pendingData = {
      fileDiff: this.fileDiff,
      lineAnnotations:
        installResult && acceptedDiff != null
          ? (sessionAnnotationsCurrent ?? inputAnnotations)
          : inputAnnotations,
    };
    if (installResult && this.fileContainer != null) {
      this.rerender();
    }
    if (failed) {
      throw failure;
    }
  }

  // Ends the edit session. If the hunks changed when editing ended, the diff
  // is highlighted again and re-rendered.
  private endEditSession(): void {
    if (!this.hunksRenderer.endEditSession()) {
      return;
    }
    void this.hunksRenderer.refreshHighlightedResult();
    this.escalateEditSessionRender();
  }

  /**
   * @internal Applies one change of the editor's document to the diff and the
   * rows on screen.
   */
  public applyChange(
    document: TextDocument<'file-diff', LAnnotation>,
    change: TextDocumentChange,
    options: ApplyChangeOptions<'file-diff', LAnnotation> = {}
  ): ApplyChangeResult {
    if (this.editSession == null) {
      throw new Error('FileDiff.applyChange: requires an active edit session');
    }
    const { tokens, lineAnnotations } = options;
    const { lineDelta, regionsChanged } = this.hunksRenderer.applyChange(
      change,
      document,
      tokens
    );
    if (lineAnnotations != null) {
      this.syncEditSessionAnnotationsFromEditor(lineAnnotations);
    }
    // Nothing is on screen (not mounted, or recycled), so the next render
    // picks the change up.
    if (this.fileContainer == null) {
      return { rebuiltLines: [] };
    }
    // A change in line count or in the collapsed regions also moves what
    // surrounds the rows (buffers, separators, headers), so render it all.
    // Otherwise only the rows need patching.
    if (lineDelta !== 0 || regionsChanged) {
      this.rerender();
    } else {
      this.patchRows();
    }
    // A render callback may have ended the session.
    if (this.editSession == null) {
      return { rebuiltLines: [] };
    }
    this.interactionManager.setSelectionDirty();
    return { rebuiltLines: this.takeRebuiltLines() };
  }

  // Lays out the current window again and patches the rows that changed,
  // leaving the header, buffers and managers as they are.
  private patchRows(): void {
    const { pre, fileContainer } = this;
    const workingDiff = this.getWorkingDiff();
    if (pre == null || fileContainer == null || workingDiff == null) {
      this.rerender();
      return;
    }
    const result = this.hunksRenderer.renderDiff(workingDiff, this.renderRange);
    if (result != null) {
      // An edit can change the header's line counts without changing the
      // file's line count.
      if (result.headerElement != null) {
        this.applyHeaderToDOM(
          result.headerElement,
          fileContainer,
          result.fileDiff
        );
      }
      this.applyHunksToDOM(pre, result);
      // Annotation elements are slotted into rows, so rebuilt rows need them
      // slotted again, and the managers watching those rows set up again.
      this.renderAnnotations();
      if (this.changedRowKeys.some((key) => key.startsWith('ann:'))) {
        this.managersDirty = true;
        this.flushManagers();
      }
    }
  }

  /** @internal Repaints lines the editor tokenized in the background. */
  public applyTokens(tokens: ReadonlyMap<number, HighlightedToken[]>): void {
    if (this.editSession == null) {
      return;
    }
    const changed = this.hunksRenderer.setTokens(tokens);
    if (changed.length > 0 && this.fileContainer != null) {
      this.patchRows();
    }
  }

  /** @internal The element showing a line of the editor's document, if rendered. */
  public lineElement(line: number): HTMLElement | undefined {
    const code = this.codeAdditions ?? this.codeUnified;
    if (code == null || this.editSession == null) {
      return undefined;
    }
    const key = this.hunksRenderer.lineKey(line);
    return key == null
      ? undefined
      : this.columnReconcilers.get(code)?.elementFor(key)?.content;
  }

  // The document lines whose rows the last render rebuilt; cleared on read.
  private takeRebuiltLines(): number[] {
    const keys = this.changedRowKeys;
    this.changedRowKeys = [];
    const lines: number[] = [];
    for (const key of keys) {
      const line = this.hunksRenderer.lineOfKey(key);
      if (line != null) {
        lines.push(line);
      }
    }
    return lines;
  }

  // Editor-facing visibility oracle: whether a one-based new-file line has
  // (or will have on scroll) a rendered row under the current expansion
  // state. See isAdditionLineRenderable.
  public isLineRenderable(lineNumber: number): boolean {
    const fileDiff = this.getRenderedDiff();
    if (fileDiff == null) {
      return true;
    }
    const {
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    return isAdditionLineRenderable({
      fileDiff,
      lineNumber,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
    });
  }

  // Fold-skip companion to isLineRenderable: the nearest renderable one-based
  // new-file line at or beyond lineNumber in the given direction.
  public getNearestRenderableLine(
    lineNumber: number,
    direction: 'up' | 'down'
  ): number | undefined {
    const fileDiff = this.getRenderedDiff();
    if (fileDiff == null) {
      return lineNumber;
    }
    const {
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
    } = this.options;
    return getNearestRenderableAdditionLine({
      fileDiff,
      lineNumber,
      direction,
      expandedHunks: expandUnchanged
        ? true
        : this.hunksRenderer.getExpandedHunksMap(),
      collapsedContextThreshold,
    });
  }

  // Expand collapsed context so a one-based new-file line can render: one
  // deterministic expansion from the nearest gap edge, sized to reach the
  // target plus the normal expansion step (clamped to the gap at render).
  // Routed through expandHunk so subclass expansion flows (CodeView's
  // deferred pendingExpansions) apply.
  public revealLine(lineNumber: number): boolean {
    const fileDiff = this.getRenderedDiff();
    const {
      expandUnchanged = false,
      collapsedContextThreshold = DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
      expansionLineCount = 100,
    } = this.options;
    if (fileDiff == null || fileDiff.isPartial || expandUnchanged) {
      return false;
    }
    const expandedHunks = this.hunksRenderer.getExpandedHunksMap();

    for (const [hunkIndex, hunk] of fileDiff.hunks.entries()) {
      const [hunkStart, hunkEnd] = getHunkAdditionLineRange(hunk);
      if (lineNumber < hunkStart) {
        const region = getExpandedRegion({
          isPartial: fileDiff.isPartial,
          rangeSize: hunk.collapsedBefore,
          expandedHunks,
          hunkIndex,
          collapsedContextThreshold,
        });
        const gapStart = hunkStart - region.rangeSize;
        if (
          region.renderAll ||
          lineNumber < gapStart + region.fromStart ||
          lineNumber >= hunkStart - region.fromEnd
        ) {
          return false;
        }
        const fromStartDistance =
          lineNumber - (gapStart + region.fromStart) + 1;
        const fromEndDistance = hunkStart - region.fromEnd - lineNumber;
        if (fromStartDistance <= fromEndDistance) {
          this.expandHunk(
            hunkIndex,
            'up',
            fromStartDistance + expansionLineCount
          );
        } else {
          this.expandHunk(
            hunkIndex,
            'down',
            fromEndDistance + expansionLineCount
          );
        }
        return true;
      }
      if (lineNumber < hunkEnd) {
        return false;
      }
    }

    const trailingRegion = getTrailingExpandedRegion({
      fileDiff,
      hunkIndex: fileDiff.hunks.length - 1,
      expandedHunks,
      collapsedContextThreshold,
      errorPrefix: 'FileDiff.revealLine',
    });
    if (trailingRegion == null || trailingRegion.renderAll) {
      return false;
    }
    const lastHunk = fileDiff.hunks[fileDiff.hunks.length - 1];
    const [, trailingStart] = getHunkAdditionLineRange(lastHunk);
    if (
      lineNumber < trailingStart + trailingRegion.fromStart ||
      lineNumber >= trailingStart + trailingRegion.rangeSize
    ) {
      return false;
    }
    this.expandHunk(
      fileDiff.hunks.length,
      'up',
      lineNumber -
        (trailingStart + trailingRegion.fromStart) +
        1 +
        expansionLineCount
    );
    return true;
  }

  // Whether render() may run the session-exit recompute on dirty metadata.
  // False while an editor is attached (the session is live). CodeView-managed
  // instances override this: their sessions survive recycling with no editor
  // attached, and CodeView runs the exit recompute itself when it reaps a
  // session.
  protected shouldSelfHealEditSession(): boolean {
    return this.editor == null;
  }

  // Deferred full re-render for session region changes. The subsequent
  // render() ends in syncRenderViewToEditor, which resets the editor's
  // geometry caches against the rebuilt rows. VirtualizedFileDiff overrides
  // this to also invalidate its layout caches.
  protected escalateEditSessionRender(): void {
    queueRender(this.handleEditSessionRender);
  }

  private handleEditSessionRender = (): void => {
    this.rerender();
    this.flushDeferredLineState();
  };

  private removeRenderedCode(): void {
    this.resizeManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.interactionManager.cleanUp();

    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;

    this.codeUnified?.remove();
    this.codeUnified = undefined;
    this.codeDeletions?.remove();
    this.codeDeletions = undefined;
    this.codeAdditions?.remove();
    this.codeAdditions = undefined;

    this.pre?.remove();
    this.pre = undefined;

    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
  }

  private clearAuxiliaryNodes(): void {
    for (const { element } of this.separatorCache.values()) {
      element.remove();
    }
    this.separatorCache.clear();

    for (const { element } of this.annotationCache.values()) {
      element.remove();
    }
    this.annotationCache.clear();

    this.gutterUtilityContent?.remove();
    this.gutterUtilityContent = undefined;
  }

  public renderPlaceholder(height: number): boolean {
    if (this.fileContainer == null) {
      return false;
    }
    this.emitPostRender(true);
    this.cleanChildNodes();

    if (this.placeHolder == null) {
      const shadowRoot =
        this.fileContainer.shadowRoot ??
        this.fileContainer.attachShadow({ mode: 'open' });
      this.placeHolder = document.createElement('div');
      this.placeHolder.dataset.placeholder = '';
      shadowRoot.appendChild(this.placeHolder);
    }
    return this.setPlaceholderHeight(height);
  }

  protected setPlaceholderHeight(height: number): boolean {
    if (this.placeHolder == null) {
      return false;
    }
    this.placeHolder.style.setProperty('height', `${height}px`);
    return true;
  }

  public async primeHighlightCache(
    fileDiff: FileDiffMetadata | undefined = this.getInputDiff()
  ): Promise<void> {
    const { workerManager } = this;
    if (
      fileDiff == null ||
      workerManager == null ||
      !workerManager.isWorkingPool() ||
      fileDiff.cacheKey == null ||
      isDiffPlainText(fileDiff)
    ) {
      return;
    }
    const tokenizeMaxLength =
      this.options.tokenizeMaxLength ?? DEFAULT_TOKENIZE_MAX_LENGTH;
    if (
      Math.max(fileDiff.additionLines.length, fileDiff.deletionLines.length) >
      tokenizeMaxLength
    ) {
      return;
    }

    await workerManager
      .primeDiffHighlightCache(fileDiff)
      .catch((error: unknown) => {
        if (isHandledWorkerPoolError(error)) {
          return;
        }
        console.error(error);
      });
  }

  private cleanChildNodes() {
    this.resizeManager.cleanUp();
    this.scrollSyncManager.cleanUp();
    this.interactionManager.cleanUp();
    this.clearAuxiliaryNodes();

    this.bufferAfter?.remove();
    this.bufferBefore?.remove();
    this.codeAdditions?.remove();
    this.codeDeletions?.remove();
    this.codeUnified?.remove();
    this.errorWrapper?.remove();
    this.headerElement?.remove();
    this.headerPrefix?.remove();
    this.headerFilenameSuffix?.remove();
    this.headerMetadata?.remove();
    this.headerCustom?.remove();
    this.pre?.remove();
    this.spriteSVG?.remove();
    this.themeCSSStyle?.remove();
    this.unsafeCSSStyle?.remove();

    this.bufferAfter = undefined;
    this.bufferBefore = undefined;
    this.codeAdditions = undefined;
    this.codeDeletions = undefined;
    this.codeUnified = undefined;
    this.errorWrapper = undefined;
    this.headerElement = undefined;
    this.headerPrefix = undefined;
    this.headerFilenameSuffix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
    this.pre = undefined;
    this.spriteSVG = undefined;
    this.themeCSSStyle = undefined;
    this.appliedThemeCSS = undefined;
    this.hasAdoptedThemeCSS = false;
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;

    this.headerCache.lastRenderedHTML = undefined;
    this.lastRowCount = undefined;
    this.mounted = false;
  }

  private renderSeparators(hunkData: HunkData[]): void {
    const { hunkSeparators } = this.options;
    if (
      this.isComponentManaged ||
      this.fileContainer == null ||
      typeof hunkSeparators !== 'function'
    ) {
      for (const { element } of this.separatorCache.values()) {
        element.remove();
      }
      this.separatorCache.clear();
      return;
    }
    const staleSeparators = new Map(this.separatorCache);
    for (const hunk of hunkData) {
      const id = hunk.slotName;
      let cache = this.separatorCache.get(id);
      if (cache == null || !areHunkDataEqual(hunk, cache.hunkData)) {
        cache?.element.remove();
        const element = document.createElement('div');
        element.style.display = 'contents';
        element.slot = hunk.slotName;
        const child = hunkSeparators(hunk, this);
        if (child != null) {
          element.appendChild(child);
        }
        this.fileContainer.appendChild(element);
        cache = { element, hunkData: hunk };
        this.separatorCache.set(id, cache);
      }
      staleSeparators.delete(id);
    }
    for (const [id, { element }] of staleSeparators.entries()) {
      this.separatorCache.delete(id);
      element.remove();
    }
  }

  protected renderAnnotations(): void {
    if (this.isComponentManaged || this.fileContainer == null) {
      for (const { element } of this.annotationCache.values()) {
        element.remove();
      }
      this.annotationCache.clear();
      return;
    }
    const staleAnnotations = new Map(this.annotationCache);
    const {
      renderedData,
      options: { renderAnnotation },
    } = this;
    if (renderAnnotation != null && renderedData != null) {
      const { fileDiff, lineAnnotations } = renderedData;
      for (const [index, annotation] of lineAnnotations.entries()) {
        const name = this.getAnnotationSlotName(annotation);
        const id = `${index}-${name}`;
        let cache = this.annotationCache.get(id);
        if (
          cache == null ||
          cache.fileDiff !== fileDiff ||
          !areDiffLineAnnotationsEqual(annotation, cache.annotation)
        ) {
          cache?.element.remove();
          const content = renderAnnotation(annotation, fileDiff);
          // If we can't render anything, then we should not render anything
          // and clear the annotation cache if necessary.
          if (content == null) {
            continue;
          }
          cache = {
            element: createAnnotationWrapperNode(name),
            annotation,
            fileDiff,
          };
          cache.element.appendChild(content);
          this.fileContainer.appendChild(cache.element);
          this.annotationCache.set(id, cache);
        }
        staleAnnotations.delete(id);
      }
    }
    for (const [id, { element }] of staleAnnotations.entries()) {
      this.annotationCache.delete(id);
      element.remove();
    }
  }

  protected renderGutterUtility(): void {
    const { renderGutterUtility } = this.options;
    if (this.fileContainer == null || renderGutterUtility == null) {
      this.gutterUtilityContent?.remove();
      this.gutterUtilityContent = undefined;
      return;
    }
    const element = renderGutterUtility(this.interactionManager.getHoveredLine);
    if (element != null && this.gutterUtilityContent != null) {
      return;
    } else if (element == null) {
      this.gutterUtilityContent?.remove();
      this.gutterUtilityContent = undefined;
      return;
    }
    const gutterUtilityContent = createGutterUtilityContentNode();
    gutterUtilityContent.appendChild(element);
    this.fileContainer.appendChild(gutterUtilityContent);
    this.gutterUtilityContent = gutterUtilityContent;
  }

  protected getOrCreateFileContainer(
    fileContainer?: HTMLElement,
    parentNode?: HTMLElement
  ): HTMLElement {
    const { fileContainer: previousContainer } = this;
    const nextContainer =
      fileContainer ??
      previousContainer ??
      document.createElement(DIFFS_TAG_NAME);
    const containerChanged = previousContainer !== nextContainer;
    if (previousContainer != null && containerChanged) {
      this.editor?.__captureFocusForDOMReplacement();
    }
    if (containerChanged) {
      this.emitPostRender(true);
    }
    this.fileContainer = nextContainer;
    if (previousContainer != null && containerChanged) {
      this.headerCache.lastRenderedHTML = undefined;
      this.headerElement = undefined;
    }
    if (parentNode != null && this.fileContainer.parentNode !== parentNode) {
      parentNode.appendChild(this.fileContainer);
    }
    if (containerChanged) {
      this.adoptReusableShellElements(this.fileContainer);
    }
    this.ensureSpriteSVG(this.fileContainer);
    return this.fileContainer;
  }

  // NOTE(amadeus): Technically this method is not safe for use outside of
  // the CodeView component, however I don't think in practice it really
  // should matter, but maybe there's some system we need in place to prevent
  // this from running outside of that environment?
  //
  // It's making very specific assumptions that all the elements will have the
  // correct content based on CodeView global options
  private adoptReusableShellElements(fileContainer: HTMLElement): void {
    const { shadowRoot } = fileContainer;
    if (shadowRoot == null) {
      return;
    }

    for (const element of shadowRoot.children) {
      if (element instanceof SVGElement) {
        this.spriteSVG ??= element;
      } else if (
        isStyleNode(element) &&
        element.hasAttribute(THEME_CSS_ATTRIBUTE)
      ) {
        this.themeCSSStyle ??= element;
        this.hasAdoptedThemeCSS = true;
      } else if (
        isStyleNode(element) &&
        element.hasAttribute(UNSAFE_CSS_ATTRIBUTE)
      ) {
        this.unsafeCSSStyle ??= element;
        this.appliedUnsafeCSS ??= this.options.unsafeCSS ?? undefined;
      }
    }
  }

  private ensureSpriteSVG(fileContainer: HTMLElement): void {
    const shadowRoot =
      fileContainer.shadowRoot ?? fileContainer.attachShadow({ mode: 'open' });
    if (this.spriteSVG == null) {
      const fragment = document.createElement('div');
      fragment.innerHTML = SVGSpriteSheet;
      const firstChild = fragment.firstChild;
      if (firstChild instanceof SVGElement) {
        this.spriteSVG = firstChild;
      }
    }
    if (this.spriteSVG != null && this.spriteSVG.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.spriteSVG);
    }
  }

  private getOrCreatePreNode(container: HTMLElement): HTMLPreElement {
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    // If we haven't created a pre element yet, lets go ahead and do that
    if (this.pre == null) {
      this.pre = document.createElement('pre');
      this.appliedPreAttributes = undefined;
      this.codeUnified = undefined;
      this.codeDeletions = undefined;
      this.codeAdditions = undefined;
      shadowRoot.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== shadowRoot) {
      this.editor?.__captureFocusForDOMReplacement();
      shadowRoot.appendChild(this.pre);
      this.appliedPreAttributes = undefined;
    }

    this.placeHolder?.remove();
    this.placeHolder = undefined;

    return this.pre;
  }

  protected syncCodeNodesFromPre(pre: HTMLPreElement): void {
    this.codeUnified = undefined;
    this.codeDeletions = undefined;
    this.codeAdditions = undefined;
    for (const child of Array.from(pre.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      if (child.hasAttribute('data-unified')) {
        this.codeUnified = child;
      } else if (child.hasAttribute('data-deletions')) {
        this.codeDeletions = child;
      } else if (child.hasAttribute('data-additions')) {
        this.codeAdditions = child;
      }
    }
  }

  private applyHeaderToDOM(
    headerAST: HASTElement,
    container: HTMLElement,
    fileDiff: FileDiffMetadata
  ): void {
    this.cleanupErrorWrapper();
    this.placeHolder?.remove();
    this.placeHolder = undefined;
    // Session metadata changes in place, so an HTML cache created from the
    // input diff cannot describe the current edit-session header.
    const {
      headerCache: {
        fileDiff: cachedHeaderDiff,
        html: cachedHeaderHTML,
        lastRenderedHTML,
      },
    } = this;
    const editSessionDiff = this.editSession?.diff;
    const reusableHeaderHTML =
      fileDiff !== editSessionDiff &&
      areDiffTargetsEqual(cachedHeaderDiff, fileDiff)
        ? cachedHeaderHTML
        : undefined;
    const headerHTML = reusableHeaderHTML ?? hastToHtml(headerAST);
    this.headerCache.html = headerHTML;
    this.headerCache.fileDiff = fileDiff;
    if (headerHTML !== lastRenderedHTML) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = headerHTML;
      const newHeader = tempDiv.firstElementChild;
      if (!(newHeader instanceof HTMLElement)) {
        return;
      }
      if (this.headerElement != null) {
        container.shadowRoot?.replaceChild(newHeader, this.headerElement);
      } else {
        container.shadowRoot?.prepend(newHeader);
      }
      this.headerElement = newHeader;
      this.headerCache.lastRenderedHTML = headerHTML;
    }

    if (this.isComponentManaged) {
      return;
    }

    const {
      renderCustomHeader,
      renderHeaderPrefix,
      renderHeaderFilenameSuffix,
      renderHeaderMetadata,
    } = this.options;

    if (renderCustomHeader != null) {
      const content = renderCustomHeader(fileDiff) ?? undefined;
      this.headerCustom = this.upsertHeaderSlotElement(
        container,
        this.headerCustom,
        CUSTOM_HEADER_SLOT_ID,
        content
      );
      this.headerPrefix?.remove();
      this.headerFilenameSuffix?.remove();
      this.headerMetadata?.remove();
      this.headerPrefix = undefined;
      this.headerFilenameSuffix = undefined;
      this.headerMetadata = undefined;
      return;
    }

    const prefix = renderHeaderPrefix?.(fileDiff) ?? undefined;
    const suffix = renderHeaderFilenameSuffix?.(fileDiff) ?? undefined;
    const content = renderHeaderMetadata?.(fileDiff) ?? undefined;
    this.headerPrefix = this.upsertHeaderSlotElement(
      container,
      this.headerPrefix,
      HEADER_PREFIX_SLOT_ID,
      prefix
    );
    this.headerFilenameSuffix = this.upsertHeaderSlotElement(
      container,
      this.headerFilenameSuffix,
      HEADER_FILENAME_SUFFIX_SLOT_ID,
      suffix
    );
    this.headerMetadata = this.upsertHeaderSlotElement(
      container,
      this.headerMetadata,
      HEADER_METADATA_SLOT_ID,
      content
    );
    this.headerCustom?.remove();
    this.headerCustom = undefined;
  }

  protected clearReusableHeader(): void {
    this.headerCache.html = undefined;
    this.headerCache.fileDiff = undefined;
  }

  private clearHeaderSlots(): void {
    this.headerPrefix?.remove();
    this.headerFilenameSuffix?.remove();
    this.headerMetadata?.remove();
    this.headerCustom?.remove();
    this.headerPrefix = undefined;
    this.headerFilenameSuffix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
  }

  // Header slot callbacks are presence-based render hooks, not reactive views.
  private upsertHeaderSlotElement(
    container: HTMLElement,
    current: HTMLElement | undefined,
    slot: string,
    content: Element | string | number | undefined
  ): HTMLElement | undefined {
    if (content == null) {
      current?.remove();
      return undefined;
    }
    const element = current ?? this.createHeaderSlotElement(slot);
    if (current == null) {
      container.appendChild(element);
    }
    this.replaceHeaderSlotContent(element, content);
    return element;
  }

  private replaceHeaderSlotContent(
    element: HTMLElement,
    content: Element | string | number
  ): void {
    element.replaceChildren();
    if (content instanceof Element) {
      element.appendChild(content);
    } else {
      element.innerText = `${content}`;
    }
  }

  private createHeaderSlotElement(slot: string): HTMLElement {
    const element = document.createElement('div');
    element.slot = slot;
    return element;
  }

  protected injectUnsafeCSS(): void {
    const { unsafeCSS } = this.options;
    this.pre?.toggleAttribute('data-custom-styles', Boolean(unsafeCSS));
    const shadowRoot = this.fileContainer?.shadowRoot;
    if (shadowRoot == null) {
      return;
    }

    if (unsafeCSS == null || unsafeCSS === '') {
      if (this.unsafeCSSStyle != null) {
        this.unsafeCSSStyle.remove();
        this.unsafeCSSStyle = undefined;
      }
      this.appliedUnsafeCSS = undefined;
      return;
    }

    if (
      this.unsafeCSSStyle?.parentNode === shadowRoot &&
      this.appliedUnsafeCSS === unsafeCSS
    ) {
      return;
    }

    // Create or update the style element
    this.unsafeCSSStyle ??= createUnsafeCSSStyleNode();
    if (this.unsafeCSSStyle.parentNode !== shadowRoot) {
      shadowRoot.appendChild(this.unsafeCSSStyle);
    }
    // Wrap in @layer unsafe to match SSR behavior
    this.unsafeCSSStyle.textContent = wrapUnsafeCSS(unsafeCSS);
    this.appliedUnsafeCSS = unsafeCSS;
  }

  private applyThemeState(
    container: HTMLElement,
    themeStyles: string,
    themeType: ThemeTypes,
    baseThemeType?: 'light' | 'dark'
  ): void {
    // A result without theme styles, the rows an edit session lays out before
    // anything is highlighted, keeps the styles already on screen.
    if (themeStyles === '') {
      return;
    }
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    const effectiveThemeType = baseThemeType ?? themeType;
    const currentTheme = this.getTheme();
    const theme =
      typeof currentTheme === 'string' ? currentTheme : { ...currentTheme };
    const scrollbarGutter = getMeasuredScrollbarGutter(shadowRoot);
    if (
      this.themeCSSStyle?.parentNode === shadowRoot &&
      this.appliedThemeCSS?.themeStyles === themeStyles &&
      this.appliedThemeCSS.themeType === effectiveThemeType &&
      this.appliedThemeCSS.scrollbarGutter === scrollbarGutter
    ) {
      this.appliedThemeCSS.theme = theme;
      return;
    }
    if (
      this.hasAdoptedThemeCSS &&
      this.themeCSSStyle?.parentNode === shadowRoot
    ) {
      this.hasAdoptedThemeCSS = false;
      this.appliedThemeCSS = {
        theme,
        themeStyles,
        themeType: effectiveThemeType,
        baseThemeType,
        scrollbarGutter,
      };
      return;
    }
    this.themeCSSStyle = upsertHostThemeStyle({
      shadowRoot,
      currentNode: this.themeCSSStyle,
      themeCSS: wrapThemeCSS(themeStyles, effectiveThemeType, scrollbarGutter),
    });
    this.appliedThemeCSS =
      this.themeCSSStyle != null
        ? {
            theme,
            themeStyles,
            themeType: effectiveThemeType,
            baseThemeType,
            scrollbarGutter,
          }
        : undefined;
  }

  private hydrateMeasuredScrollbar(): void {
    const shadowRoot = this.fileContainer?.shadowRoot;
    if (shadowRoot == null || this.themeCSSStyle == null) {
      return;
    }
    this.themeCSSStyle.textContent = patchScrollbarGutterSize(
      this.themeCSSStyle.textContent ?? '',
      getMeasuredScrollbarGutter(shadowRoot)
    );
  }

  // A boolean check to ensure that edit mode in WebKit doesn't cause potential
  // scroll jumps to due bugs with WebKit. The workarounds have performance
  // implications so we avoid running the workarounds on browsers or scenarios
  // where they are not applicable
  protected shouldGuardRebuildScroll(): boolean {
    return this.editor != null && isSafari();
  }

  private applyHunksToDOM(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    if (this.shouldGuardRebuildScroll()) {
      guardWebKitScrollDuringRebuild(pre, () =>
        this.replaceCodeColumns(pre, result)
      );
    } else {
      this.replaceCodeColumns(pre, result);
    }
  }

  // Writes a column's rows into its code element. A fresh code element gets
  // its gutter and content elements with every row in one string each. After
  // that, rows are patched by key, so the element identity of a row and of
  // the content element (the focused contenteditable in edit mode) survives,
  // unless every row changed, when the columns are written whole again.
  private writeColumn(
    code: HTMLElement,
    specs: readonly RowSpec[],
    { rowCount, allRowsChanged }: HunksRenderResult
  ): void {
    let columns = this.getColumnPair(code);
    if (columns == null) {
      columns = this.createColumns(code, rowCount);
    } else if (rowCount !== this.lastRowCount) {
      columns.gutter.style.setProperty('grid-row', `span ${rowCount}`);
      columns.content.style.setProperty('grid-row', `span ${rowCount}`);
    }
    let reconciler = this.columnReconcilers.get(code);
    if (reconciler == null) {
      reconciler = new ColumnReconciler(columns.gutter, columns.content);
      this.columnReconcilers.set(code, reconciler);
      // Rows already in the column, such as server-rendered markup, stand in
      // for the specs by position until the reconcile below corrects them.
      if (!allRowsChanged && columns.content.childElementCount > 0) {
        reconciler.adopt(specs);
      }
    }
    if (allRowsChanged) {
      reconciler.replaceAll(specs);
      for (const spec of specs) {
        this.changedRowKeys.push(spec.key);
      }
    } else {
      const { changed } = reconciler.reconcile(specs);
      for (const key of changed) {
        this.changedRowKeys.push(key);
      }
    }
  }

  // Whether a render has written every column on screen. Hydrated markup has
  // rows no render wrote, and the editor cannot address them until one does.
  private columnsWritten(): boolean {
    for (const code of [
      this.codeUnified,
      this.codeDeletions,
      this.codeAdditions,
    ]) {
      if (code != null && !this.columnReconcilers.has(code)) {
        return false;
      }
    }
    return true;
  }

  // Drops the rows a column is about to lose, before any column gains rows.
  private removeStaleRows(
    code: HTMLElement | undefined,
    specs: readonly RowSpec[] | undefined
  ): void {
    if (code == null || specs == null) return;
    this.columnReconcilers.get(code)?.removeStale(specs);
  }

  // Creates the empty gutter and content elements of a code element.
  private createColumns(code: HTMLElement, rowCount: number): ColumnElements {
    const gutter = createGutterWrapper();
    gutter.properties.style = `grid-row: span ${rowCount}`;
    code.innerHTML = hastToHtml([gutter, createContentColumn([], rowCount)]);
    const columns = this.getColumnPair(code);
    if (columns == null) {
      throw new Error('FileDiff.createColumns: the columns did not parse');
    }
    return columns;
  }

  private replaceCodeColumns(
    pre: HTMLPreElement,
    result: HunksRenderResult
  ): void {
    const { overflow = 'scroll' } = this.options;
    const containerSize =
      (this.options.hunkSeparators ?? 'line-info') === 'line-info';
    const rowSpan = overflow === 'wrap' ? result.rowCount : undefined;
    this.cleanupErrorWrapper();
    this.applyPreNodeAttributes(pre, result);
    this.changedRowKeys = [];

    let shouldReplace = false;
    const codeElements: HTMLElement[] = [];
    const { unified, deletions, additions } = result.columns;
    this.editor?.__captureFocusForDOMReplacement();
    if (!result.allRowsChanged) {
      this.removeStaleRows(this.codeUnified, unified);
      this.removeStaleRows(this.codeDeletions, deletions);
      this.removeStaleRows(this.codeAdditions, additions);
    }
    if (unified != null) {
      shouldReplace =
        this.codeUnified == null ||
        this.codeAdditions != null ||
        this.codeDeletions != null;

      // Clean up addition/deletion elements if necessary
      this.codeDeletions?.remove();
      this.codeDeletions = undefined;
      this.codeAdditions?.remove();
      this.codeAdditions = undefined;

      this.codeUnified = getOrCreateCodeNode({
        code: this.codeUnified,
        columnType: 'unified',
        rowSpan,
        containerSize,
      });
      this.writeColumn(this.codeUnified, unified, result);
      codeElements.push(this.codeUnified);
    } else if (deletions != null || additions != null) {
      if (deletions != null) {
        shouldReplace = this.codeDeletions == null || this.codeUnified != null;

        // Clean up unified column if necessary
        this.codeUnified?.remove();
        this.codeUnified = undefined;

        this.codeDeletions = getOrCreateCodeNode({
          code: this.codeDeletions,
          columnType: 'deletions',
          rowSpan,
          containerSize,
        });
        this.writeColumn(this.codeDeletions, deletions, result);
        codeElements.push(this.codeDeletions);
      } else {
        // If we have no deletion column, lets clean it up if it exists
        this.codeDeletions?.remove();
        this.codeDeletions = undefined;
      }

      if (additions != null) {
        shouldReplace =
          shouldReplace ||
          this.codeAdditions == null ||
          this.codeUnified != null;

        // Clean up unified column if necessary
        this.codeUnified?.remove();
        this.codeUnified = undefined;

        this.codeAdditions = getOrCreateCodeNode({
          code: this.codeAdditions,
          columnType: 'additions',
          rowSpan,
          containerSize,
        });
        this.writeColumn(this.codeAdditions, additions, result);
        codeElements.push(this.codeAdditions);
      } else {
        // If we have no addition column, lets clean it up if it exists
        this.codeAdditions?.remove();
        this.codeAdditions = undefined;
      }
    } else {
      // if we get in here, there's no content to render, so lets just clean
      // everything up
      this.codeUnified?.remove();
      this.codeUnified = undefined;
      this.codeDeletions?.remove();
      this.codeDeletions = undefined;
      this.codeAdditions?.remove();
      this.codeAdditions = undefined;
    }

    if (codeElements.length === 0) {
      pre.textContent = '';
    } else if (shouldReplace) {
      pre.replaceChildren(...codeElements);
    }

    this.lastRowCount = result.rowCount;
  }

  private getColumnPair(
    code: HTMLElement | undefined
  ): ColumnElements | undefined {
    if (code == null) {
      return undefined;
    }
    const gutter = code.children[0];
    const content = code.children[1];
    if (
      !(gutter instanceof HTMLElement) ||
      !(content instanceof HTMLElement) ||
      gutter.dataset.gutter == null ||
      content.dataset.content == null
    ) {
      return undefined;
    }
    return { gutter, content };
  }

  protected updateBuffers(renderRange: RenderRange): void {
    if (this.pre != null) {
      this.applyBuffers(this.pre, renderRange);
    }
  }

  private applyBuffers(
    pre: HTMLPreElement,
    renderRange: RenderRange | undefined
  ) {
    if (renderRange == null || this.shouldDisableVirtualizationBuffers()) {
      if (this.bufferBefore != null) {
        this.bufferBefore.remove();
        this.bufferBefore = undefined;
      }
      if (this.bufferAfter != null) {
        this.bufferAfter.remove();
        this.bufferAfter = undefined;
      }
      return;
    }
    // NOTE(amadeus): A very hacky pass at buffers outside the pre elements...
    // i may need to improve this...
    if (renderRange.bufferBefore > 0) {
      if (this.bufferBefore == null) {
        this.bufferBefore = document.createElement('div');
        this.bufferBefore.dataset.virtualizerBuffer = 'before';
        pre.before(this.bufferBefore);
      }
      this.bufferBefore.style.setProperty(
        'height',
        `${renderRange.bufferBefore}px`
      );
      this.bufferBefore.style.setProperty('contain', 'strict');
    } else if (this.bufferBefore != null) {
      this.bufferBefore.remove();
      this.bufferBefore = undefined;
    }

    if (renderRange.bufferAfter > 0) {
      if (this.bufferAfter == null) {
        this.bufferAfter = document.createElement('div');
        this.bufferAfter.dataset.virtualizerBuffer = 'after';
        pre.after(this.bufferAfter);
      }
      this.bufferAfter.style.setProperty(
        'height',
        `${renderRange.bufferAfter}px`
      );
      this.bufferAfter.style.setProperty('contain', 'strict');
    } else if (this.bufferAfter != null) {
      this.bufferAfter.remove();
      this.bufferAfter = undefined;
    }
  }

  protected shouldDisableVirtualizationBuffers(): boolean {
    return this.options.disableVirtualizationBuffers ?? false;
  }

  protected applyPreNodeAttributes(
    pre: HTMLPreElement,
    { columns, totalLines }: HunksRenderResult,
    customProperties?: CustomPreProperties
  ): void {
    const {
      diffIndicators = 'bars',
      disableBackground = false,
      disableLineNumbers = false,
      overflow = 'scroll',
      diffStyle = 'split',
    } = this.options;
    const preProperties: PrePropertiesConfig = {
      type: 'diff',
      diffIndicators,
      disableBackground,
      disableLineNumbers,
      overflow,
      split:
        diffStyle === 'unified'
          ? false
          : columns.additions != null && columns.deletions != null,
      totalLines,
      customProperties,
    };
    if (arePrePropertiesEqual(preProperties, this.appliedPreAttributes)) {
      return;
    }
    setPreNodeProperties(pre, preProperties);
    this.appliedPreAttributes = preProperties;
  }

  private applyErrorToDOM(error: Error, container: HTMLElement) {
    this.cleanupErrorWrapper();
    this.pre?.remove();
    this.pre = undefined;
    this.appliedPreAttributes = undefined;
    const shadowRoot =
      container.shadowRoot ?? container.attachShadow({ mode: 'open' });
    this.errorWrapper ??= document.createElement('div');
    this.errorWrapper.dataset.errorWrapper = '';
    this.errorWrapper.textContent = '';
    shadowRoot.appendChild(this.errorWrapper);
    const errorMessage = document.createElement('div');
    errorMessage.dataset.errorMessage = '';
    errorMessage.innerText = error.message;
    this.errorWrapper.appendChild(errorMessage);
    const errorStack = document.createElement('pre');
    errorStack.dataset.errorStack = '';
    errorStack.innerText = error.stack ?? 'No Error Stack';
    this.errorWrapper.appendChild(errorStack);
  }

  private cleanupErrorWrapper() {
    this.errorWrapper?.remove();
    this.errorWrapper = undefined;
  }
}

interface HasContentProps {
  fileDiff: FileDiffMetadata | undefined;
  oldFile: FileContents | null | undefined;
  newFile: FileContents | null | undefined;
}

function getAdditionFile(fileDiff: FileDiffMetadata): FileContents {
  return {
    name: fileDiff.name,
    lang: fileDiff.lang,
    contents: fileDiff.additionLines.join(''),
  };
}

function areOptionalFilesEqual(
  fileA: FileContents | null | undefined,
  fileB: FileContents | null | undefined
): boolean {
  if (fileA == null || fileB == null) {
    return fileA == null && fileB == null;
  }
  return areFilesEqual(fileA, fileB);
}

function hasDiffContent({
  fileDiff,
  oldFile,
  newFile,
}: HasContentProps): boolean {
  return (
    (fileDiff != null && fileDiff.hunks.length > 0) ||
    oldFile != null ||
    newFile != null
  );
}

function hasDiffHeaderContent({
  fileDiff,
  oldFile,
  newFile,
}: HasContentProps): boolean {
  return fileDiff != null || oldFile != null || newFile != null;
}

function shouldRenderCode(
  pre: HTMLPreElement | undefined,
  hasContent: boolean,
  collapsed = false
): boolean {
  return !collapsed && pre == null && hasContent;
}

function shouldRenderHeader(
  headerElement: HTMLElement | undefined,
  hasContent: boolean,
  disableFileHeader = false
): boolean {
  return headerElement == null && hasContent && !disableFileHeader;
}
