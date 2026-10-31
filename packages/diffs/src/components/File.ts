import type { Element as HASTElement } from 'hast';

import {
  CUSTOM_HEADER_SLOT_ID,
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
import { CodeColumns } from '../dom/CodeColumns';
import {
  ColumnReconciler,
  type ReconcileResult,
} from '../dom/ColumnReconciler';
import type { Editor } from '../editor/editor';
import type { TextDocument, TextDocumentChange } from '../editor/textDocument';
import type {
  ApplyChangeOptions,
  ApplyChangeResult,
  EditCompletionDecision,
  EditorActiveLineOptions,
  EditorChangeEvent,
  EditorColumns,
  FileEditCompleteEvent,
} from '../editor/types';
import { isLineKey } from '../layout/RowSpec';
import type { RowKey } from '../layout/RowSpec';
import {
  type GetHoveredLineResult,
  InteractionManager,
  type InteractionManagerBaseOptions,
  pluckInteractionOptions,
  type SelectionWriteOptions,
} from '../managers/InteractionManager';
import { ResizeManager } from '../managers/ResizeManager';
import { FileRenderer, type FileRenderResult } from '../renderers/FileRenderer';
import { SVGSpriteSheet } from '../sprite';
export type { FileEditCompleteEvent } from '../editor/types';
import {
  getHighlighterIfLoaded,
  getSharedHighlighter,
  HighlighterDisposedError,
} from '../highlighter/shared_highlighter';
import type {
  AppliedThemeStyleCache,
  BaseCodeOptions,
  DiffLineAnnotation,
  DiffsHighlighter,
  FileContents,
  HighlightedToken,
  LineAnnotation,
  PostRenderPhase,
  PrePropertiesConfig,
  RenderFileMetadata,
  RenderRange,
  SelectedLineRange,
  ThemeTypes,
} from '../types';
import { areFileTargetsEqual } from '../utils/areFileTargetsEqual';
import { areLineAnnotationsEqual } from '../utils/areLineAnnotationsEqual';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { arePrePropertiesEqual } from '../utils/arePrePropertiesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
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
import { getFileRendererOptions } from '../utils/getFileRendererOptions';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import { getLineAnnotationName } from '../utils/getLineAnnotationName';
import { getOrCreateCodeNode } from '../utils/getOrCreateCodeNode';
import { getThemes } from '../utils/getThemes';
import { guardWebKitScrollDuringRebuild } from '../utils/guardWebKitScrollDuringRebuild';
import { createGutterWrapper } from '../utils/hast_utils';
import { hastToHtml } from '../utils/hastToHtml';
import { upsertHostThemeStyle } from '../utils/hostTheme';
import { isFilePlainText } from '../utils/isFilePlainText';
import { isStyleNode } from '../utils/isStyleNode';
import { isSafari } from '../utils/platform';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { resolvePreferredHighlighter } from '../utils/resolvePreferredHighlighter';
import { getMeasuredScrollbarGutter } from '../utils/scrollbarGutter';
import { setPreNodeProperties } from '../utils/setWrapperNodeProps';
import type { WorkerPoolManager } from '../worker';
import { isHandledWorkerPoolError } from '../worker/errors';
import { DiffsContainerLoaded } from './web-components';

export interface FileRenderProps<LAnnotation> {
  file: FileContents;
  fileContainer?: HTMLElement;
  containerWrapper?: HTMLElement;
  deferManagers?: boolean;
  forceRender?: boolean;
  preventEmit?: boolean;
  lineAnnotations?: LineAnnotation<LAnnotation>[];
  renderRange?: RenderRange;
}

export interface FileHydrateProps<LAnnotation> extends Omit<
  FileRenderProps<LAnnotation>,
  'fileContainer'
> {
  fileContainer: HTMLElement;
  prerenderedHTML?: string;
}

export type FileEditChangeHandler<LAnnotation, Caret> = (
  event: EditorChangeEvent<'file', LAnnotation, Caret>
) => void;

/**
 * Decides a completed edit synchronously: return `'accept'` to install the
 * event's `file` and annotations, or `'reject'` to restore the original values.
 * The event is frozen, so re-key the accepted file in place
 * (`event.file.cacheKey = '…'`) before accepting. The event's editor is
 * detached and returns its final state from `getViewState()`. A missing handler
 * rejects.
 */
export type FileEditCompleteHandler<LAnnotation, Caret> = (
  event: FileEditCompleteEvent<LAnnotation, Caret>
) => EditCompletionDecision;

export interface FileOptions<LAnnotation, Caret>
  extends BaseCodeOptions, InteractionManagerBaseOptions<'file'> {
  disableFileHeader?: boolean;
  renderHeaderPrefix?: RenderFileMetadata;
  renderHeaderFilenameSuffix?: RenderFileMetadata;
  renderHeaderMetadata?: RenderFileMetadata;
  renderCustomHeader?: RenderFileMetadata;
  /**
   * When true, errors during rendering are rethrown instead of being caught
   * and displayed in the DOM. Useful for testing or when you want to handle
   * errors yourself.
   */
  disableErrorHandling?: boolean;
  /** Receives the matching file, including any editor changes. */
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>,
    file: FileContents
  ): HTMLElement | undefined;
  renderGutterUtility?(
    getHoveredRow: () => GetHoveredLineResult<'file'> | undefined
  ): HTMLElement | null | undefined;

  onPostRender?(
    node: HTMLElement,
    instance: File<LAnnotation, Caret>,
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
  onEditChange?: FileEditChangeHandler<LAnnotation, Caret>;

  /**
   * Fired when `edit` toggles false or a component unmounts, including when the
   * final contents are unchanged. If no callback is provided, the component
   * reverts to the last `file` and annotations passed into it. The callback
   * receives the detached editor with its final pre-detach state.
   */
  onEditComplete?: FileEditCompleteHandler<LAnnotation, Caret>;
}

interface AnnotationElementCache<LAnnotation> {
  element: HTMLElement;
  annotation: LineAnnotation<LAnnotation>;
  file: FileContents;
}

interface ColumnElements {
  gutter: HTMLElement;
  content: HTMLElement;
}

interface HydrationSetup<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
}

export interface FileRenderData<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[];
}

export interface FileRenderInput<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
}

interface EditSession<LAnnotation> {
  // The file as edited so far. The renderer's model keeps it current.
  file: FileContents;
  // The input the session started from or was last replaced with, so
  // rejecting the edits can restore it.
  inputFile: FileContents;
  annotations: EditSessionAnnotations<LineAnnotation<LAnnotation>> | undefined;
}

// The settings the managers (resize observers, scroll sync, pointer
// handling) attach to the rendered DOM with. flushManagers compares them
// with the last render's so the managers only re-attach when a setting or
// the DOM changed, instead of on every render.
interface ManagerSetup {
  overflow: 'scroll' | 'wrap';
  disableAnnotations: boolean;
  columnVariables: 'apply' | 'measure';
}

let instanceId = -1;

export class File<LAnnotation = undefined, Caret = undefined> {
  static LoadedCustomComponent: boolean = DiffsContainerLoaded;

  readonly __id: string = `file:${++instanceId}`;
  readonly type = 'file';

  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  private readonly codeColumns = new CodeColumns<'code'>();
  protected bufferBefore: HTMLElement | undefined;
  protected bufferAfter: HTMLElement | undefined;
  protected themeCSSStyle: HTMLStyleElement | undefined;
  protected appliedThemeCSS: AppliedThemeStyleCache | undefined;
  protected hasAdoptedThemeCSS = false;
  protected unsafeCSSStyle: HTMLStyleElement | undefined;
  protected appliedUnsafeCSS: string | undefined;
  protected gutterUtilityContent: HTMLElement | undefined;
  protected errorWrapper: HTMLElement | undefined;
  protected placeHolder: HTMLElement | undefined;
  protected lastRenderedHeaderHTML: string | undefined;
  protected cachedHeaderHTML: string | undefined;
  protected appliedPreAttributes: PrePropertiesConfig | undefined;
  protected lastRowCount: number | undefined;
  // The keyed row writer of each code element on screen.
  private readonly columnReconcilers = new WeakMap<
    HTMLElement,
    ColumnReconciler
  >();
  // Keys of the rows the last column write inserted or rewrote.
  private changedRowKeys: RowKey[] = [];
  private mounted = false;

  protected headerElement: HTMLElement | undefined;
  protected headerCustom: HTMLElement | undefined;
  protected headerPrefix: HTMLElement | undefined;
  protected headerFilenameSuffix: HTMLElement | undefined;
  protected headerMetadata: HTMLElement | undefined;

  protected fileRenderer: FileRenderer<LAnnotation>;
  protected resizeManager: ResizeManager;
  protected interactionManager: InteractionManager<'file'>;

  protected annotationCache: Map<string, AnnotationElementCache<LAnnotation>> =
    new Map();
  // Annotations for the displayed file, stored with that file in renderedData.
  protected get lineAnnotations(): LineAnnotation<LAnnotation>[] {
    return this.renderedData?.lineAnnotations ?? EMPTY_LINE_ANNOTATIONS;
  }
  protected managersDirty = false;
  // The settings the managers were last attached with.
  private appliedManagerSetup: ManagerSetup | undefined;

  // Latest input. Editor changes are kept in the private edit session.
  public file: FileContents | undefined;
  private editSession: EditSession<LAnnotation> | undefined;
  // File and annotations currently displayed. Absent until a file is rendered.
  private renderedData: FileRenderData<LAnnotation> | undefined;
  // Keep the next file and its annotations together until that file renders.
  private pendingData: FileRenderData<LAnnotation> | undefined;
  // Forces the next render() call, such as the one the owner makes after
  // requestOwnerRender.
  protected forceRenderOverride: true | undefined;
  protected renderRange: RenderRange | undefined;
  protected enabled = true;

  protected editor: Editor<'file', LAnnotation, Caret> | undefined;

  constructor(
    public options: FileOptions<LAnnotation, Caret> = {
      theme: DEFAULT_THEMES,
    },
    private workerManager?: WorkerPoolManager | undefined,
    // Set when an owner such as React manages the container. Internal renders
    // call it, and the owner must call render().
    private requestOwnerRender?: () => void
  ) {
    this.fileRenderer = new FileRenderer<LAnnotation>(
      options,
      this.getAnnotationSlotName,
      this.handleHighlightRender,
      this.workerManager
    );
    this.resizeManager = new ResizeManager();
    this.interactionManager = new InteractionManager(
      'file',
      pluckInteractionOptions(options)
    );
    this.workerManager?.subscribeToThemeChanges(this);
  }

  public getAnnotationSlotName = (
    annotation: LineAnnotation<LAnnotation> | DiffLineAnnotation<LAnnotation>
  ): string => {
    return resolveEditSessionSlotName(
      this.editSession?.annotations,
      annotation,
      getLineAnnotationName
    );
  };

  private handleHighlightRender = (): void => {
    this.rerender();
  };

  public rerender(): void {
    const file = this.getInputFile();
    if (!this.enabled || file == null) return;
    if (this.requestRender()) return;
    this.render({
      file,
      forceRender: true,
      renderRange: this.renderRange,
    });
  }

  // An edit session renders in place. Other internal renders can be driven
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

  private getTheme() {
    return (
      this.workerManager?.getFileRenderOptions().theme ??
      this.options.theme ??
      DEFAULT_THEMES
    );
  }

  // Return the latest input without editor changes. It may be newer than the
  // displayed file while a replacement is being highlighted.
  protected getInputFile(): FileContents | undefined {
    return this.file;
  }

  // Return the editor's copy, including its changes, or the input when there
  // is no edit session. Use fallbackFile if the new input is not stored yet.
  protected getWorkingFile(
    fallbackFile: FileContents | undefined = this.file
  ): FileContents | undefined {
    return this.editSession?.file ?? fallbackFile;
  }

  // Return the displayed file. While a replacement is being highlighted, this
  // still returns the previous file.
  protected getRenderedFile(): FileContents | undefined {
    return this.renderedData?.file;
  }

  /**
   * @internal Data the next render() with this input will display. While a
   * replacement file is being highlighted, this is still the displayed data.
   */
  public __getNextRenderData({
    file,
    lineAnnotations,
  }: FileRenderInput<LAnnotation>): FileRenderData<LAnnotation> {
    const sessionAnnotations = this.editSession?.annotations;
    // Keep the supplied content during editing. The editor moves annotation
    // rows through stable slots without rerendering their React children.
    if (sessionAnnotations != null) {
      return {
        file,
        lineAnnotations:
          lineAnnotations != null && this.isNewAnnotations(lineAnnotations)
            ? lineAnnotations
            : sessionAnnotations.provided,
      };
    }
    const workingFile = this.getWorkingFile(file) ?? file;
    const nextFile = this.fileRenderer.getFileForNextRender(workingFile);
    return {
      file: nextFile,
      lineAnnotations:
        lineAnnotations != null && areFileTargetsEqual(nextFile, workingFile)
          ? lineAnnotations
          : this.getAnnotationsForFile(nextFile),
    };
  }

  // Return the working file's annotations, including updates that have not
  // rendered yet.
  protected getLatestAnnotations(): LineAnnotation<LAnnotation>[] {
    return (
      this.pendingData?.lineAnnotations ??
      this.editSession?.annotations?.current ??
      this.lineAnnotations
    );
  }

  // Use pending annotations only when their file is selected for rendering.
  protected getAnnotationsForFile(
    file: FileContents
  ): LineAnnotation<LAnnotation>[] {
    const { pendingData } = this;
    return pendingData != null && areFileTargetsEqual(file, pendingData.file)
      ? pendingData.lineAnnotations
      : this.lineAnnotations;
  }

  // Update the displayed file and its annotations together after rendering. If
  // highlighting keeps the previous file displayed, leave the next pair queued
  // in pendingData.
  private adoptRenderData(file: FileContents): void {
    const { pendingData } = this;
    const matchesPending =
      pendingData != null && areFileTargetsEqual(file, pendingData.file);
    this.renderedData = {
      file,
      lineAnnotations: matchesPending
        ? pendingData.lineAnnotations
        : this.lineAnnotations,
    };
    if (matchesPending) {
      this.pendingData = undefined;
    }
  }

  // Check whether the annotation array is new. Reusing a tracked array must
  // not reset positions moved by editing.
  protected isNewAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
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

  // Store a new input. An active session restarts from it: the renderer's
  // model takes the new file and the editor's document is replaced, which
  // reports the change before anything renders. Returns false if the input
  // has not changed.
  protected updateInputFile(
    incomingFile: FileContents,
    lineAnnotations?: LineAnnotation<LAnnotation>[]
  ): boolean {
    if (areFileTargetsEqual(this.getInputFile(), incomingFile)) {
      return false;
    }
    this.editor?.__assertOutsideChangeCallback('File.render');
    const previousAnnotations = this.getLatestAnnotations();
    this.file = incomingFile;
    const { editSession, editor } = this;
    if (editSession?.annotations != null && lineAnnotations != null) {
      // These annotations arrived with the new file, so their line numbers
      // describe it. The positions the session tracked for the old document
      // mean nothing now: the session restarts from these annotations, and
      // they also become what renders once the session ends.
      editSession.annotations = adoptEditSessionAnnotations(
        lineAnnotations,
        getLineAnnotationName,
        editSession.annotations
      );
    }
    if (editSession != null) {
      this.replaceEditSession(
        incomingFile,
        editSession.annotations?.current ??
          lineAnnotations ??
          previousAnnotations
      );
    } else if (editor != null) {
      // The editor attached before the first file arrived. A document it
      // kept from an earlier session seeds the new one.
      this.installEditSession(
        incomingFile,
        editor.__getDocumentContents(incomingFile)
      );
    }
    this.pendingData = {
      file: this.editSession?.file ?? incomingFile,
      lineAnnotations:
        this.editSession?.annotations?.current ??
        lineAnnotations ??
        previousAnnotations,
    };
    return true;
  }

  // Restarts the session from a new file and gives the editor's document the
  // new contents. Undo history is kept unless the name or language changed.
  private replaceEditSession(
    incomingFile: FileContents,
    lineAnnotations: LineAnnotation<LAnnotation>[] | undefined
  ): void {
    const { editor, editSession } = this;
    this.installEditSession(incomingFile);
    if (editor != null && editSession != null) {
      editor.__replaceDocument(incomingFile, false, lineAnnotations);
    }
  }

  // Start the renderer's session on inputFile, or on the document the editor
  // retained from an earlier session. A session that already exists keeps
  // its tracked annotations.
  private installEditSession(
    inputFile: FileContents,
    retainedDocument?: FileContents
  ): void {
    const file = this.fileRenderer.startEditSession(
      inputFile,
      retainedDocument
    );
    // Seed annotations on first attach so a later replacement can restart
    // their positions.
    const annotations =
      this.editSession?.annotations ??
      adoptEditSessionAnnotations(
        this.getLatestAnnotations(),
        getLineAnnotationName
      );
    this.editSession = { file, inputFile, annotations };
    this.pendingData = { file, lineAnnotations: annotations.current };
  }

  public onThemeChange(): void {
    this.fileRenderer.clearRenderCache();
    this.rerender();
  }

  public setOptions(
    options: FileOptions<LAnnotation, Caret> | undefined
  ): void {
    if (options == null) return;
    this.options = options;
    this.cachedHeaderHTML = undefined;
    this.syncInteractionOptions();
    this.managersDirty = true;
  }

  protected syncInteractionOptions(): void {
    this.interactionManager.setOptions(pluckInteractionOptions(this.options));
  }

  private mergeOptions(
    options: Partial<FileOptions<LAnnotation, Caret>>
  ): void {
    this.options = { ...this.options, ...options };
  }

  public setThemeType(themeType: ThemeTypes): void {
    if ((this.options.themeType ?? 'system') === themeType) {
      return;
    }
    this.mergeOptions({ themeType });
    // Rows the editor built from its tokens carry one theme, so a session is
    // highlighted again; read-only rows switch through their theme styles.
    if (this.editSession != null) {
      this.onThemeChange();
    } else {
      this.applyCachedThemeState(themeType);
    }
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

  public getHoveredLine = (): GetHoveredLineResult<'file'> | undefined => {
    return this.interactionManager.getHoveredLine();
  };

  public setLineAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): void {
    const sessionAnnotations = this.editSession?.annotations;
    if (sessionAnnotations != null) {
      if (!this.isNewAnnotations(lineAnnotations)) {
        return;
      }
      // Keep the caller's collection for completion and revert; editing can
      // remap the displayed collection without changing this baseline.
      writeEditSessionAnnotations(
        sessionAnnotations,
        lineAnnotations,
        getLineAnnotationName
      );
    }
    const file = this.getWorkingFile();
    if (file != null) {
      this.pendingData = { file, lineAnnotations };
    }
  }

  // Takes annotations the editor remapped and makes them what the session
  // renders: updates the session, feeds the renderer, and re-renders
  // annotation rows. Returns true when new annotations were adopted —
  // virtualized subclasses override this and refresh their layout on true.
  //
  // The editor sends moved annotations with the edit (applyChange) and again
  // with the change event (__acceptEditorChange). The identity check makes
  // the second call a no-op.
  //
  // The annotations the caller passed in are never touched — stale
  // re-renders keep deduping against them.
  protected syncEditSessionAnnotationsFromEditor(
    lineAnnotations: LineAnnotation<LAnnotation>[]
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
    this.fileRenderer.setLineAnnotations(lineAnnotations);
    this.renderAnnotations();
    return true;
  }

  public setSelectedLines(
    range: SelectedLineRange | null,
    options?: SelectionWriteOptions
  ): void {
    this.interactionManager.setSelection(range, options);
  }

  public setEditorActiveLine(
    lineNumber: number | null,
    options?: EditorActiveLineOptions
  ): void {
    this.interactionManager.setEditorActiveLine(lineNumber, {
      lineNumberOnly: options?.lineNumberOnly,
      side: options?.side ?? 'additions',
    });
  }

  protected get code(): HTMLElement | undefined {
    return this.codeColumns.get('code');
  }

  protected set code(code: HTMLElement | undefined) {
    this.codeColumns.set('code', code);
  }

  public getCodeScrollLeft(): number {
    return this.codeColumns.scrollLeft;
  }

  public setCodeScrollLeft(position: number): void {
    this.codeColumns.setScrollLeft(position);
  }

  /**
   * @internal Applies one change of the editor's document to the file and the
   * rows on screen.
   */
  public applyChange(
    document: TextDocument<'file', LAnnotation>,
    change: TextDocumentChange,
    options: ApplyChangeOptions<'file', LAnnotation> = {}
  ): ApplyChangeResult {
    if (this.editSession == null) {
      throw new Error('File.applyChange: requires an active edit session');
    }
    const { tokens, lineAnnotations } = options;
    const { lineDelta, removedLineIds } = this.fileRenderer.applyChange(
      change,
      document,
      tokens
    );
    if (lineAnnotations != null) {
      this.syncEditSessionAnnotationsFromEditor(lineAnnotations);
    }
    // Render the change. The flag says whether rows moved, which a
    // virtualized file needs to know up front to redo its row layout before
    // the host's frame renders: rows move when the line count changes, or
    // when a batch removed lines and added others at the same count. A plain
    // file renders either way.
    this.renderChange(lineDelta !== 0 || removedLineIds.length > 0);
    // Nothing was on screen, or a render callback ended the session.
    if (this.fileContainer == null || this.editSession == null) {
      return { rebuiltLines: [] };
    }
    // A patched row keeps its selection marks. After a line-count change the
    // rows that moved still carry theirs but show other lines, so the marks
    // are drawn again from the selection state.
    if (lineDelta !== 0) {
      this.interactionManager.setSelectionDirty();
    }
    return { rebuiltLines: this.takeRebuiltLines() };
  }

  // Renders the rows after the model changed. `structural` is true when the
  // line count changed, which moves every row below the edit.
  protected renderChange(_structural: boolean): void {
    if (this.fileContainer == null) {
      return;
    }
    this.rerender();
  }

  /** @internal Background tokenizing finished coloring these lines. */
  public applyTokens(tokens: ReadonlyMap<number, HighlightedToken[]>): void {
    if (this.editSession == null) {
      return;
    }
    const changed = this.fileRenderer.setTokens(tokens);
    // Lines without a row on screen are drawn from the new tokens when a
    // render brings them in; nothing to show until then.
    if (changed.some((line) => this.lineElement(line) != null)) {
      this.rerender();
    }
  }

  // Keeps the keys of the rows a reconcile wrote for the editor to measure.
  // Rows written anew carry no selection marks and are unknown to the
  // managers, so both are brought up to date; a rewritten gutter cell lost
  // the gutter utility the interaction manager keeps inside it.
  private recordRowsWritten({
    changed,
    attributesReset,
    gutterRewritten,
  }: ReconcileResult) {
    for (const key of changed) {
      this.changedRowKeys.push(key);
      // The managers pair and measure annotation rows, so any row that is
      // not a line changing concerns them.
      if (!isLineKey(key)) {
        this.managersDirty = true;
      }
    }
    if (attributesReset) {
      this.interactionManager.setSelectionDirty();
    }
    if (attributesReset || gutterRewritten) {
      this.managersDirty = true;
    }
  }

  /** @internal The content element of a document line's row, if on screen. */
  public lineElement(line: number): HTMLElement | undefined {
    const { code } = this;
    if (code == null || this.editSession == null) {
      return undefined;
    }
    const key = this.fileRenderer.lineKey(line);
    return key == null
      ? undefined
      : this.columnReconcilers.get(code)?.elementFor(key)?.content;
  }

  // The document lines of the rows the last render inserted or rewrote.
  private takeRebuiltLines(): number[] {
    const { changedRowKeys: keys } = this;
    this.changedRowKeys = [];
    const lines: number[] = [];
    for (const key of keys) {
      const line = this.fileRenderer.lineOfKey(key);
      if (line != null) {
        lines.push(line);
      }
    }
    return lines;
  }

  public __getEffectiveCodeOptions(): BaseCodeOptions {
    return { ...this.options, ...this.fileRenderer.getEffectiveCodeOptions() };
  }

  // Sets the managers up again when the DOM they watch changed (the dirty
  // bit, set by the code that wrote it) or when what they are set up with
  // changed; otherwise a render leaves them alone.
  public flushManagers(): void {
    if (this.pre == null) {
      this.managersDirty = false;
      return;
    }
    const { overflow = 'scroll' } = this.options;
    const setup: ManagerSetup = {
      overflow,
      disableAnnotations: overflow === 'wrap',
      columnVariables: this.shouldApplyColumnVariables(overflow)
        ? 'apply'
        : 'measure',
    };
    if (
      !this.managersDirty &&
      areObjectsEqual(setup, this.appliedManagerSetup)
    ) {
      return;
    }
    this.interactionManager.setup(this.pre);
    this.resizeManager.setup(this.pre, {
      disableAnnotations: setup.disableAnnotations,
      columnVariables: setup.columnVariables,
    });
    this.appliedManagerSetup = setup;
    this.managersDirty = false;
  }

  protected shouldApplyColumnVariables(overflow: 'scroll' | 'wrap'): boolean {
    return overflow === 'scroll' && this.lineAnnotations.length > 0;
  }

  public cleanUp(recycle = false): void {
    const editor = this.editor;
    this.emitPostRender(true);
    // Tear the editor down while the code scroller still exists. A recycle
    // keeps its document and undo history; a full teardown drops them as the
    // session ends.
    editor?.cleanUp(recycle ? 'recycle' : 'discard');
    if (!recycle) {
      this.editor = undefined;
    }
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();
    this.managersDirty = false;
    this.workerManager?.unsubscribeToThemeChanges(this);
    this.renderRange = undefined;

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
    this.pre?.remove();
    this.pre = undefined;
    this.codeColumns.cleanUp();
    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;
    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
    this.headerElement?.remove();
    this.headerElement = undefined;
    this.clearHeaderSlots();
    this.lastRenderedHeaderHTML = undefined;
    if (!recycle) {
      this.cachedHeaderHTML = undefined;
    }
    this.errorWrapper?.remove();
    this.errorWrapper = undefined;
    this.spriteSVG = undefined;
    this.themeCSSStyle = undefined;
    this.appliedThemeCSS = undefined;
    this.hasAdoptedThemeCSS = false;
    this.unsafeCSSStyle = undefined;
    this.appliedUnsafeCSS = undefined;
    this.placeHolder?.remove();
    this.placeHolder = undefined;

    if (recycle) {
      this.fileRenderer.recycle();
    } else {
      this.fileRenderer.cleanUp();
      this.workerManager = undefined;
      this.file = undefined;
      this.editSession = undefined;
    }
    this.enabled = false;
  }

  public virtualizedSetup(): void {
    this.enabled = true;
    this.workerManager?.subscribeToThemeChanges(this);
  }

  public hydrate(props: FileHydrateProps<LAnnotation>): void {
    const {
      fileContainer,
      prerenderedHTML,
      preventEmit = false,
      file,
      lineAnnotations,
    } = props;
    if (!this.enabled) {
      throw new Error(
        'File.hydrate: attempting to call hydrate after cleaned up'
      );
    }
    if (this.fileContainer != null) {
      throw new Error(
        'File.hydrate: hydrate can only be called before the instance has rendered or hydrated'
      );
    }
    this.hydrateElements(fileContainer, prerenderedHTML);
    // An editor attached before hydration may carry a retained keyed document.
    // Render through the private edit session instead of adopting external
    // markup, so the restored document owns the first hydrated paint.
    const forceEditorRender = this.editor != null;
    if (
      forceEditorRender ||
      shouldRenderCode(this.pre, file, this.options.collapsed) ||
      shouldRenderHeader(
        this.headerElement,
        file,
        this.options.disableFileHeader
      )
    ) {
      this.render({
        ...props,
        forceRender: forceEditorRender || props.forceRender,
        preventEmit: true,
      });
    }
    // Otherwise orchestrate our setup.
    else {
      this.hydrationSetup({ file, lineAnnotations });
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
    for (const element of Array.from(
      fileContainer.shadowRoot?.children ?? []
    )) {
      if (element instanceof SVGElement) {
        this.spriteSVG = element;
        continue;
      }
      if (!(element instanceof HTMLElement)) {
        continue;
      }
      if (element instanceof HTMLPreElement) {
        this.pre = element;
        this.appliedPreAttributes = undefined;
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
      if ('diffsHeader' in element.dataset) {
        this.headerElement = element;
        this.lastRenderedHeaderHTML = undefined;
        continue;
      }
    }
    if (this.pre != null) {
      this.syncCodeNodeFromPre(this.pre);
      this.pre.removeAttribute('data-dehydrated');
    }
    this.fileContainer = fileContainer;
    this.hydrateMeasuredScrollbar();
  }

  protected hydrationSetup({
    file,
    lineAnnotations,
  }: HydrationSetup<LAnnotation>): void {
    this.renderedData = {
      file,
      lineAnnotations: lineAnnotations ?? this.getLatestAnnotations(),
    };
    this.pendingData = undefined;
    this.file = file;
    this.fileRenderer.setOptions(getFileRendererOptions(this.options));
    this.syncInteractionOptions();
    if (this.pre == null) {
      return;
    }
    this.fileRenderer.hydrate(file);
    this.renderAnnotations();
    this.renderGutterUtility();
    this.injectUnsafeCSS();
    this.managersDirty = true;
    this.flushManagers();
  }

  private syncRenderViewToEditor(): void {
    const { editor, fileContainer, renderRange } = this;
    const lineAnnotations = this.getLatestAnnotations();
    const file = this.getWorkingFile();
    if (editor == null || fileContainer == null || file == null) {
      return;
    }
    const syncEditor = (highlighter: DiffsHighlighter): void => {
      if (
        !this.enabled ||
        this.editor !== editor ||
        this.fileContainer !== fileContainer ||
        this.getWorkingFile() !== file
      ) {
        return;
      }
      editor.__syncRenderView({
        highlighter,
        fileContainer,
        columns: this.editorColumns(),
        file,
        lineAnnotations,
        renderRange,
        domCurrent: this.fileRenderer.editorRenderReady(),
      });
    };

    const theme = this.getTheme();
    const lang = file.lang ?? getFiletypeFromFileName(file.name);
    // Sync editor synchronously whenever the shared highlighter is ready;
    // otherwise load it and sync once it resolves.
    const highlighter = getHighlighterIfLoaded({
      theme,
      lang,
    });
    if (highlighter != null) {
      syncEditor(highlighter);
    } else {
      void getSharedHighlighter({
        themes: getThemes(theme),
        langs: Array.from(new Set(['text', lang])),
        preferredHighlighter: resolvePreferredHighlighter(
          this.workerManager,
          this.options
        ),
      })
        .then(syncEditor)
        .catch((error: unknown) => {
          if (!(error instanceof HighlighterDisposedError)) {
            console.error(error);
          }
        });
    }
  }

  /** @internal Settle annotations */
  public __acceptEditorChange(
    event: EditorChangeEvent<'file', LAnnotation, Caret>
  ): void {
    const { lineAnnotations } = event;
    if (lineAnnotations != null) {
      this.syncEditSessionAnnotationsFromEditor(lineAnnotations);
    }
  }

  public emitEditChange(
    event: EditorChangeEvent<'file', LAnnotation, Caret>
  ): void {
    const { onEditChange } = this.options;
    onEditChange?.(event);
  }

  /** @internal Plain files have no component-owned diff session state. */
  public __captureDocumentSessionState(): undefined {
    return undefined;
  }

  /** @internal Associate this component with its editor for a render lifecycle. */
  public __attachEditor(
    editor: Editor<'file', LAnnotation, Caret>
  ): () => void {
    if (this.editor != null) {
      throw new Error('File.__attachEditor: an editor is already attached');
    }
    this.editor = editor;
    const detach = () => {
      this.editor = undefined;
      this.fileRenderer.endEditSession();
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
  public __resumeEditor(editor: Editor<'file', LAnnotation, Caret>): void {
    if (this.editor !== editor) {
      throw new Error('File.__resumeEditor: editor association changed');
    }
    this.resumeEditorRendering(editor);
  }

  private resumeEditorRendering(
    editor: Editor<'file', LAnnotation, Caret>
  ): void {
    // Start a session unless one is retained from an earlier attach. Without
    // a file yet, updateInputFile starts it when the file arrives.
    const inputFile = this.getInputFile();
    if (this.editSession == null && inputFile != null) {
      this.installEditSession(
        inputFile,
        editor.__getDocumentContents(inputFile)
      );
    }
    const editSessionFile = this.editSession?.file;
    if (this.fileRenderer.editorRenderReady()) {
      // The rows on screen have the token spans the editor needs. When the
      // session took over the input's highlight, what is on screen is now the
      // session file.
      if (
        editSessionFile != null &&
        this.fileRenderer.fileCache === editSessionFile
      ) {
        this.adoptRenderData(editSessionFile);
      }
      // Rows this instance wrote take the editor as they are. Hydrated markup
      // is rendered once first, so its rows are written by key.
      if (this.columnsWritten()) {
        this.syncRenderViewToEditor();
      } else {
        this.rerender();
      }
    } else {
      // The rows lack token spans, or the highlight is still pending. A render
      // through the session gives the editor its rows and syncs it after.
      this.rerender();
    }
  }

  /**
   * @internal
   *
   * Ends the edit session and settles which file this component renders.
   * Requires the editor to be detached first. Does nothing when no session
   * exists, so callers can invoke it again safely after it has settled.
   *
   * `onEditComplete` receives the completed file, current input file, and
   * both annotation collections even when the final text is unchanged. In
   * `install` mode, accepting installs the completed file and its annotations;
   * rejecting or having no handler restores the external values. `discard`
   * mode always restores the external values. An accepted file cannot reuse
   * the replaced file's `cacheKey`.
   */
  public __completeEditSession(
    editor: Editor<'file', LAnnotation, Caret>,
    mode: 'install' | 'discard'
  ): void {
    this.settleEditSession(mode === 'install', editor);
  }

  private settleEditSession(
    installResult: boolean,
    editor: Editor<'file', LAnnotation, Caret> | undefined
  ): void {
    const { editSession } = this;
    if (editSession == null) {
      return;
    }
    const {
      file: editSessionFile,
      inputFile,
      annotations: editSessionAnnotations,
    } = editSession;
    const inputAnnotations =
      editSessionAnnotations?.provided ?? this.lineAnnotations;
    if (this.editor != null) {
      throw new Error(
        'File.__completeEditSession: detach the editor before completing the session'
      );
    }

    const sessionAnnotationsCurrent = editSessionAnnotations?.current;
    let acceptedFile: FileContents | undefined;
    let failed = false;
    let failure: unknown;
    if (editor == null) {
      throw new Error(
        'File.__completeEditSession: editor is required for completion'
      );
    }
    const completedFile = { ...editSessionFile };
    const event: FileEditCompleteEvent<LAnnotation, Caret> = {
      file: completedFile,
      editor,
      originalFile: inputFile,
      lineAnnotations: sessionAnnotationsCurrent,
      originalLineAnnotations: inputAnnotations,
    };
    // Frozen so a handler cannot swap the event's file/originalFile
    // references; nested mutation (a fresh cacheKey on event.file) still
    // works.
    Object.freeze(event);
    try {
      editor.__emitEditComplete(event);
      const decision = this.options.onEditComplete?.(event);
      if (decision === 'accept') {
        if (
          completedFile.cacheKey != null &&
          completedFile.cacheKey === inputFile.cacheKey
        ) {
          throw new Error(
            'File.__completeEditSession: an accepted file must not reuse the replaced file cacheKey'
          );
        }
        acceptedFile = completedFile;
      }
    } catch (error) {
      failed = true;
      failure = error;
    }

    const settledFile =
      installResult && acceptedFile != null ? acceptedFile : inputFile;
    const settledAnnotations =
      installResult && acceptedFile != null
        ? (sessionAnnotationsCurrent ?? inputAnnotations)
        : inputAnnotations;
    this.editSession = undefined;
    this.file = settledFile;
    this.pendingData = {
      file: settledFile,
      lineAnnotations: settledAnnotations,
    };
    if (areFileTargetsEqual(this.getRenderedFile(), settledFile)) {
      this.adoptRenderData(settledFile);
    }
    if (installResult && this.fileContainer != null) {
      this.rerender();
    }
    if (failed) {
      throw failure;
    }
  }

  public render({
    file,
    fileContainer,
    forceRender = false,
    preventEmit = false,
    containerWrapper,
    deferManagers = false,
    lineAnnotations,
    renderRange,
  }: FileRenderProps<LAnnotation>): boolean {
    if (!this.enabled) {
      throw new Error(
        'File.render: attempting to call render after cleaned up'
      );
    }
    forceRender = this.forceRenderOverride ?? forceRender;
    this.forceRenderOverride = undefined;

    // postpone background tokenizing to next frame for avoiding UI freeze
    // during render
    this.editor?.__postponeBgTokenizeToNextFrame();

    const { collapsed = false, themeType = 'system' } = this.options;
    const nextRenderRange = collapsed ? undefined : renderRange;
    const themeChanged = this.hasThemeChanged();
    const annotationsChanged =
      lineAnnotations != null &&
      (lineAnnotations.length > 0 || this.getLatestAnnotations().length > 0)
        ? this.isNewAnnotations(lineAnnotations)
        : false;
    const didFileChange = !areFileTargetsEqual(this.getInputFile(), file);
    if (didFileChange) {
      this.updateInputFile(file, lineAnnotations);
    }
    const workingFile = this.getWorkingFile(file) ?? file;
    if (
      !collapsed &&
      !forceRender &&
      areRenderRangesEqual(nextRenderRange, this.renderRange) &&
      !didFileChange &&
      !annotationsChanged &&
      !themeChanged
    ) {
      const rendered = this.applyCachedThemeState(themeType);
      if (rendered) {
        this.finalizeRender();
      }
      return rendered;
    }

    this.renderRange = nextRenderRange;
    if (didFileChange) {
      this.cachedHeaderHTML = undefined;
    }
    this.fileRenderer.setOptions(getFileRendererOptions(this.options));
    this.syncInteractionOptions();
    if (lineAnnotations != null) {
      this.setLineAnnotations(lineAnnotations);
    }
    // The managers pair annotation heights, so new or changed annotations
    // are set up again in this render.
    if (annotationsChanged) {
      this.managersDirty = true;
    }
    const nextRenderFile = this.fileRenderer.getFileForNextRender(workingFile);
    this.fileRenderer.setLineAnnotations(
      this.getAnnotationsForFile(nextRenderFile)
    );

    const { disableErrorHandling = false, disableFileHeader = false } =
      this.options;
    if (disableFileHeader) {
      // Remove existing header from DOM
      if (this.headerElement != null) {
        this.headerElement.remove();
        this.headerElement = undefined;
        this.lastRenderedHeaderHTML = undefined;
      }
      this.clearHeaderSlots();
    }

    fileContainer = this.getOrCreateFileContainerNode(
      fileContainer,
      containerWrapper
    );
    this.applyCachedThemeState(themeType);

    if (collapsed) {
      this.removeRenderedCode();
      this.clearAuxiliaryNodes();

      try {
        const fileResult = this.fileRenderer.renderFile(
          workingFile,
          EMPTY_RENDER_RANGE
        );
        if (fileResult != null) {
          this.applyThemeState(
            fileContainer,
            fileResult.themeStyles,
            themeType,
            fileResult.baseThemeType
          );
        }
        if (fileResult?.headerAST != null) {
          this.applyHeaderToDOM(
            fileResult.headerAST,
            fileContainer,
            fileResult.file
          );
        }
        this.adoptRenderData(fileResult?.file ?? workingFile);
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

    const finishedTokens = this.editor?.__prepareRender(nextRenderRange);
    if (finishedTokens != null) {
      this.fileRenderer.setTokens(finishedTokens);
    }
    try {
      const pre = this.getOrCreatePreNode(fileContainer);
      const fileResult = this.fileRenderer.renderFile(
        workingFile,
        nextRenderRange
      );
      if (fileResult == null) {
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
        fileResult.themeStyles,
        themeType,
        fileResult.baseThemeType
      );
      if (fileResult.headerAST != null) {
        this.applyHeaderToDOM(
          fileResult.headerAST,
          fileContainer,
          fileResult.file
        );
      }
      this.applyRowsToDOM(fileResult, pre);
      this.applyBuffers(pre, nextRenderRange);
      this.injectUnsafeCSS();
      this.adoptRenderData(fileResult.file);
      this.renderAnnotations();
      this.renderGutterUtility();

      if (!deferManagers) {
        this.flushManagers();
      }

      this.finalizeRender();
      if (this.editor != null) {
        this.syncRenderViewToEditor();
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

  // Finish subclass layout bookkeeping before editor sync or post-render
  // callbacks can synchronously replace or dispose this component.
  protected finalizeRender(): void {}

  private emitPostRender(unmount = false) {
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
      onPostRender?.(fileContainer, this, 'unmount');
      return;
    }

    if (fileContainer == null) {
      return;
    }

    const phase: PostRenderPhase = this.mounted ? 'update' : 'mount';
    this.mounted = true;
    onPostRender?.(fileContainer, this, phase);
  }

  private removeRenderedCode(): void {
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();

    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;

    this.code?.remove();
    this.codeColumns.cleanUp();

    this.pre?.remove();
    this.pre = undefined;

    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
  }

  private clearAuxiliaryNodes(): void {
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
    // The placeholder removes the rows the caret sits in. The editor keeps
    // the focus it had, to put back when the rows render again.
    this.editor?.__captureFocusForDOMReplacement();
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
    file: FileContents | undefined = this.getInputFile()
  ): Promise<void> {
    const { workerManager } = this;
    if (
      file == null ||
      workerManager == null ||
      !workerManager.isWorkingPool() ||
      file.cacheKey == null ||
      isFilePlainText(file)
    ) {
      return;
    }
    const tokenizeMaxLength =
      this.options.tokenizeMaxLength ?? DEFAULT_TOKENIZE_MAX_LENGTH;
    if (this.fileRenderer.getLineCount(file) > tokenizeMaxLength) {
      return;
    }

    await workerManager
      .primeFileHighlightCache(file)
      .catch((error: unknown) => {
        if (isHandledWorkerPoolError(error)) {
          return;
        }
        console.error(error);
      });
  }

  private cleanChildNodes() {
    this.resizeManager.cleanUp();
    this.interactionManager.cleanUp();
    this.clearAuxiliaryNodes();

    this.bufferAfter?.remove();
    this.bufferBefore?.remove();
    this.code?.remove();
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
    this.codeColumns.cleanUp();
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

    this.lastRenderedHeaderHTML = undefined;
    this.lastRowCount = undefined;

    this.mounted = false;
  }

  private renderAnnotations(): void {
    if (this.isComponentManaged || this.fileContainer == null) {
      for (const { element } of this.annotationCache.values()) {
        element.remove();
      }
      this.annotationCache.clear();
      return;
    }
    const staleAnnotations = new Map(this.annotationCache);
    const { renderAnnotation } = this.options;
    const { renderedData } = this;
    if (renderAnnotation != null && renderedData != null) {
      const { file, lineAnnotations } = renderedData;
      for (const [index, annotation] of lineAnnotations.entries()) {
        const name = this.getAnnotationSlotName(annotation);
        const id = `${index}-${name}`;
        let cache = this.annotationCache.get(id);
        if (
          cache == null ||
          cache.file !== file ||
          !areLineAnnotationsEqual(annotation, cache.annotation)
        ) {
          cache?.element.remove();
          const content = renderAnnotation(annotation, file);
          // If we can't render anything, then we should not render anything
          // and clear the annotation cache if necessary.
          if (content == null) {
            continue;
          }
          cache = {
            element: createAnnotationWrapperNode(name),
            annotation,
            file,
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

  private renderGutterUtility() {
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

  private injectUnsafeCSS(): void {
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

  private applyRowsToDOM(result: FileRenderResult, pre: HTMLPreElement): void {
    this.cleanupErrorWrapper();
    this.applyPreNodeAttributes(pre, result);
    this.changedRowKeys = [];
    const code = (this.code = getOrCreateCodeNode({ code: this.code }));
    this.editor?.__captureFocusForDOMReplacement();
    const write = () => {
      this.writeColumn(code, result);
      if (!pre.contains(code)) {
        pre.replaceChildren(code);
        this.managersDirty = true;
      }
    };
    if (this.shouldGuardRebuildScroll()) {
      guardWebKitScrollDuringRebuild(pre, write);
    } else {
      write();
    }
    this.lastRowCount = result.rowCount;
  }

  // Writes the window's rows into the code element. The first write creates
  // the gutter and content elements and fills them. Later writes patch rows
  // by key, so rows that stayed keep their elements, as does the content
  // element the editor focuses; a result that names the rows an edit changed
  // patches just those. A new highlight result rewrites every row. The keys
  // of the rows written are kept for the editor to re-measure.
  private writeColumn(
    code: HTMLElement,
    { column: specs, patched, rowCount, allRowsChanged }: FileRenderResult
  ): void {
    let columns = this.getColumnPair(code);
    if (columns == null) {
      columns = this.createColumns(code, rowCount);
      this.managersDirty = true;
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
    // Rows written anew carry no selection marks; rows patched in place
    // keep theirs, so the marks are only rendered again when some were lost.
    if (allRowsChanged) {
      reconciler.replaceAll(specs);
      for (const spec of specs) {
        this.changedRowKeys.push(spec.key);
      }
      this.interactionManager.setSelectionDirty();
      this.managersDirty = true;
    } else {
      this.recordRowsWritten(reconciler.reconcile(specs, patched));
    }
  }

  // Whether the code element on screen was written by this instance, so its
  // rows can be patched by key.
  private columnsWritten(): boolean {
    const { code } = this;
    return code == null || this.columnReconcilers.has(code);
  }

  private createColumns(code: HTMLElement, rowCount: number): ColumnElements {
    const gutter = createGutterWrapper();
    gutter.properties.style = `grid-row: span ${rowCount}`;
    code.innerHTML = hastToHtml([gutter, createContentColumn([], rowCount)]);
    const columns = this.getColumnPair(code);
    if (columns == null) {
      throw new Error('File.createColumns: the columns did not parse');
    }
    return columns;
  }

  // The one code column the editor types in, from the elements already held.
  private editorColumns(): EditorColumns | undefined {
    const code = this.codeColumns.get('code');
    const pair = code == null ? undefined : this.getColumnPair(code);
    if (code == null || pair == null) {
      return undefined;
    }
    return {
      code,
      gutter: pair.gutter,
      content: pair.content,
      deletions: undefined,
    };
  }

  private getColumnPair(code: HTMLElement): ColumnElements | undefined {
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

  private applyHeaderToDOM(
    headerAST: HASTElement,
    container: HTMLElement,
    file: FileContents
  ): void {
    this.cleanupErrorWrapper();
    this.placeHolder?.remove();
    this.placeHolder = undefined;
    const headerHTML = this.cachedHeaderHTML ?? hastToHtml(headerAST);
    this.cachedHeaderHTML = headerHTML;
    if (headerHTML !== this.lastRenderedHeaderHTML) {
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
      this.lastRenderedHeaderHTML = headerHTML;
    }

    if (this.isComponentManaged) return;

    const {
      renderHeaderPrefix,
      renderHeaderFilenameSuffix,
      renderCustomHeader,
      renderHeaderMetadata,
    } = this.options;

    if (renderCustomHeader != null) {
      const content = renderCustomHeader(file) ?? undefined;
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
    } else {
      const prefix = renderHeaderPrefix?.(file) ?? undefined;
      const suffix = renderHeaderFilenameSuffix?.(file) ?? undefined;
      const content = renderHeaderMetadata?.(file) ?? undefined;
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

  protected getOrCreateFileContainerNode(
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
      this.lastRenderedHeaderHTML = undefined;
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
      this.codeColumns.cleanUp();
      shadowRoot.appendChild(this.pre);
      this.managersDirty = true;
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== shadowRoot) {
      this.editor?.__captureFocusForDOMReplacement();
      container.shadowRoot?.appendChild(this.pre);
      this.appliedPreAttributes = undefined;
      this.managersDirty = true;
    }

    this.placeHolder?.remove();
    this.placeHolder = undefined;

    return this.pre;
  }

  private syncCodeNodeFromPre(pre: HTMLPreElement): void {
    this.codeColumns.cleanUp();
    for (const child of Array.from(pre.children)) {
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      if (child.hasAttribute('data-code')) {
        this.code = child;
        return;
      }
    }
  }

  private applyPreNodeAttributes(
    pre: HTMLPreElement,
    { totalLines }: FileRenderResult
  ): void {
    const { overflow = 'scroll', disableLineNumbers = false } = this.options;
    const preProperties: PrePropertiesConfig = {
      type: 'file',
      split: false,
      overflow,
      disableLineNumbers,
      diffIndicators: 'none',
      disableBackground: true,
      totalLines,
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

function shouldRenderCode(
  pre: HTMLPreElement | undefined,
  file: FileContents | undefined,
  collapsed = false
): boolean {
  return !collapsed && pre == null && file != null;
}

function shouldRenderHeader(
  headerElement: HTMLElement | undefined,
  file: FileContents | undefined,
  disableFileHeader: boolean = false
): boolean {
  return headerElement == null && file != null && !disableFileHeader;
}
