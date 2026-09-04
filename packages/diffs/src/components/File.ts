import type { Element as HASTElement } from 'hast';
import { toHtml } from 'hast-util-to-html';

import {
  CUSTOM_HEADER_SLOT_ID,
  DEFAULT_THEMES,
  DEFAULT_TOKENIZE_MAX_LENGTH,
  DIFFS_TAG_NAME,
  EMPTY_RENDER_RANGE,
  HEADER_FILENAME_SUFFIX_SLOT_ID,
  HEADER_METADATA_SLOT_ID,
  HEADER_PREFIX_SLOT_ID,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import type { Editor } from '../editor/editor';
import type { TextDocument } from '../editor/textDocument';
import type {
  EditCompletionDecision,
  EditorActiveLineOptions,
  EditorChangeEvent,
  FileEditCompleteEvent,
} from '../editor/types';
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
import { arePrePropertiesEqual } from '../utils/arePrePropertiesEqual';
import { areRenderRangesEqual } from '../utils/areRenderRangesEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createAnnotationWrapperNode } from '../utils/createAnnotationWrapperNode';
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
import { upsertHostThemeStyle } from '../utils/hostTheme';
import { isFilePlainText } from '../utils/isFilePlainText';
import { isStyleNode } from '../utils/isStyleNode';
import { isSafari } from '../utils/platform';
import { prerenderHTMLIfNecessary } from '../utils/prerenderHTMLIfNecessary';
import { getMeasuredScrollbarGutter } from '../utils/scrollbarGutter';
import { setPreNodeProperties } from '../utils/setWrapperNodeProps';
import type { WorkerPoolManager } from '../worker';
import { DiffsContainerLoaded } from './web-components';

const EMPTY_STRINGS: string[] = [''];

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
  renderAnnotation?(
    annotation: LineAnnotation<LAnnotation>
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
   * Fired for every document change of an active edit session on this
   * component, with the same `EditorChangeEvent` the editor reports through
   * its own `onChange`. Do not feed the event's file back into the component
   * while the session is active.
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
}

interface ColumnElements {
  gutter: HTMLElement;
  content: HTMLElement;
}

interface HydrationSetup<LAnnotation> {
  file: FileContents;
  lineAnnotations: LineAnnotation<LAnnotation>[] | undefined;
}

interface EditSession<LAnnotation> {
  file: FileContents;
  annotations: EditSessionAnnotations<LineAnnotation<LAnnotation>> | undefined;
  /*
   * `externalReplacement` records that the host swapped in a new file
   * mid-session, so the next sync tells the editor to adopt `file` over its
   * own document
   */
  externalReplacement: boolean;
}

function createEditSessionFile(file: FileContents): FileContents {
  const editSessionFile = { ...file };
  delete editSessionFile.cacheKey;
  return editSessionFile;
}

let instanceId = -1;

export class File<LAnnotation = undefined, Caret = undefined> {
  static LoadedCustomComponent: boolean = DiffsContainerLoaded;

  readonly __id: string = `file:${++instanceId}`;
  readonly type = 'file';

  protected fileContainer: HTMLElement | undefined;
  protected spriteSVG: SVGElement | undefined;
  protected pre: HTMLPreElement | undefined;
  protected code: HTMLElement | undefined;
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
  protected lineAnnotations: LineAnnotation<LAnnotation>[] = [];
  protected managersDirty = false;

  public file: FileContents | undefined;
  private editSession: EditSession<LAnnotation> | undefined;
  protected renderedFile: FileContents | undefined;
  protected renderRange: RenderRange | undefined;
  protected enabled = true;

  protected editor: Editor<'file', LAnnotation, Caret> | undefined;

  constructor(
    public options: FileOptions<LAnnotation, Caret> = {
      theme: DEFAULT_THEMES,
    },
    private workerManager?: WorkerPoolManager | undefined,
    private isContainerManaged = false
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
    if (!this.enabled || this.file == null) return;
    this.render({
      file: this.file,
      forceRender: true,
      renderRange: this.renderRange,
    });
  }

  private getTheme() {
    return (
      this.workerManager?.getFileRenderOptions().theme ??
      this.options.theme ??
      DEFAULT_THEMES
    );
  }

  // Return the newest file this component intends to display. Once editing
  // starts, the private edit-session file owns that state.
  protected getLatestFile(
    file: FileContents | undefined = this.file
  ): FileContents | undefined {
    return this.editSession?.file ?? file;
  }

  // Return the file that produced the DOM currently owned by this instance.
  protected getRenderedFile(): FileContents | undefined {
    return this.renderedFile;
  }

  protected getLatestAnnotations(): LineAnnotation<LAnnotation>[] {
    return this.editSession?.annotations?.current ?? this.lineAnnotations;
  }

  // Returns true when the caller passed annotations this component has not
  // handled yet. Re-renders often re-pass an annotations array the component
  // already holds — the external one, or one the active session tracks — and
  // treating those repeats as new writes would move annotations, so they are
  // recognized by identity and ignored.
  protected isNewAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): boolean {
    const session = this.editSession?.annotations;
    const externalAnnotations = this.lineAnnotations;
    if (lineAnnotations === externalAnnotations) {
      return false;
    }
    return (
      session == null ||
      (lineAnnotations !== session.provided &&
        lineAnnotations !== session.current)
    );
  }

  // Install a replacement file from the caller; returns false when it is the
  // file already installed. During an edit session the swap re-seeds the
  // session as a host replacement, and the next sync decides whether it keeps
  // or resets undo history.
  protected updateExternalFile(
    incomingFile: FileContents,
    lineAnnotations?: LineAnnotation<LAnnotation>[]
  ): boolean {
    if (areFileTargetsEqual(this.file, incomingFile)) {
      return false;
    }

    const hadSession = this.editSession != null;
    this.file = incomingFile;

    if (hadSession || this.editor != null) {
      this.installEditSession(
        incomingFile,
        hadSession
          ? undefined
          : this.editor?.__getDocumentContents(incomingFile),
        true
      );
    } else {
      this.editSession = undefined;
    }
    if (this.editSession?.annotations != null && lineAnnotations != null) {
      // These annotations arrived with the new file, so their line numbers
      // describe it. The positions the session tracked for the old document
      // mean nothing now: the session restarts from these annotations, and
      // they also become what renders once the session ends.
      this.lineAnnotations = lineAnnotations;
      this.editSession.annotations = adoptEditSessionAnnotations(
        lineAnnotations,
        getLineAnnotationName,
        this.editSession.annotations
      );
    }
    return true;
  }

  // Set up the edit session's working copy — the editable copy of this file that
  // edit mode operates on: create the session if there isn't one, or replace its
  // file if one is already running (its annotations carry over). The working
  // copy's text is normally `externalFile`, but if `retainedDocument` is given
  // and its text differs, the session keeps that content instead so text carried
  // over from an earlier session isn't lost.
  //
  // `hostReplacement` is true only when the host swapped in a new file, not on a
  // plain first attach — the one case where the editor should overwrite whatever
  // it is currently showing with this file. It is recorded on the session for
  // the next sync to act on.
  private installEditSession(
    externalFile: FileContents,
    retainedDocument?: FileContents,
    hostReplacement = false
  ): void {
    const usesExternalDocument =
      retainedDocument == null ||
      (retainedDocument.name === externalFile.name &&
        retainedDocument.lang === externalFile.lang &&
        retainedDocument.contents === externalFile.contents);
    const file = createEditSessionFile(retainedDocument ?? externalFile);
    this.editSession = {
      file,
      externalReplacement: hostReplacement && usesExternalDocument,
      // Seed annotations when the session is created so the adopt-block in
      // updateExternalFile fires on the next external update — this is what an
      // attach-before-hydrate (React) mount relies on, since the session does
      // not exist yet at attach. A live session keeps the ones it tracks.
      annotations:
        this.editSession?.annotations ??
        adoptEditSessionAnnotations(
          this.lineAnnotations,
          getLineAnnotationName
        ),
    };
    this.fileRenderer.beginEditSession(
      file,
      usesExternalDocument ? externalFile : undefined
    );
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

  public getHoveredLine = (): GetHoveredLineResult<'file'> | undefined => {
    return this.interactionManager.getHoveredLine();
  };

  public setLineAnnotations(
    lineAnnotations: LineAnnotation<LAnnotation>[]
  ): void {
    const sessionAnnotations = this.editSession?.annotations;
    if (sessionAnnotations == null) {
      this.lineAnnotations = lineAnnotations;
      return;
    }
    if (!this.isNewAnnotations(lineAnnotations)) {
      return;
    }
    // Externally provided annotations are the source of truth: they become the
    // new external collection and the session renders them at the line numbers
    // given. The caller owns whether those positions still make sense after an
    // edit; a revert renders this collection unchanged rather than moving them.
    this.lineAnnotations = lineAnnotations;
    writeEditSessionAnnotations(
      sessionAnnotations,
      lineAnnotations,
      getLineAnnotationName
    );
  }

  // Takes annotations the editor remapped and makes them what the session
  // renders: updates the session, feeds the renderer, and re-renders
  // annotation rows. Returns true when new annotations were adopted —
  // virtualized subclasses override this and refresh their layout on true.
  //
  // The editor delivers annotations through two calls. An edit that changes
  // the line count sends them with the structural rebuild
  // (applyDocumentChange) and again with the change event (__acceptEditorChange);
  // the identity check makes the second call a no-op. An edit that keeps the
  // line count skips the rebuild, so the event is its only path here.
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

  public getCodeScrollLeft(): number {
    return this.code?.scrollLeft ?? 0;
  }

  public setCodeScrollLeft(position: number): void {
    if (this.code != null) {
      this.code.scrollLeft = position;
    }
  }

  public __getEffectiveCodeOptions(): BaseCodeOptions {
    return { ...this.options, ...this.fileRenderer.getEffectiveCodeOptions() };
  }

  public flushManagers(): void {
    if (!this.managersDirty || this.pre == null) {
      this.managersDirty = false;
      return;
    }

    const { overflow = 'scroll' } = this.options;
    this.interactionManager.setup(this.pre);
    this.resizeManager.setup(this.pre, {
      disableAnnotations: overflow === 'wrap',
      columnVariables: this.shouldApplyColumnVariables(overflow)
        ? 'apply'
        : 'measure',
    });
    this.managersDirty = false;
  }

  protected shouldApplyColumnVariables(overflow: 'scroll' | 'wrap'): boolean {
    return overflow === 'scroll' && this.getLatestAnnotations().length > 0;
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
    if (!this.isContainerManaged) {
      this.fileContainer?.remove();
    }
    this.fileContainer = undefined;
    this.mounted = false;
    if (!recycle) {
      this.lineAnnotations = [];
    }
    this.clearAuxiliaryNodes();
    this.pre = undefined;
    this.code = undefined;
    this.bufferBefore?.remove();
    this.bufferBefore = undefined;
    this.bufferAfter?.remove();
    this.bufferAfter = undefined;
    this.appliedPreAttributes = undefined;
    this.lastRowCount = undefined;
    this.headerElement = undefined;
    this.headerPrefix = undefined;
    this.headerFilenameSuffix = undefined;
    this.headerMetadata = undefined;
    this.headerCustom = undefined;
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
      this.renderedFile = undefined;
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
    this.lineAnnotations = lineAnnotations ?? this.lineAnnotations;
    this.file = file;
    this.fileRenderer.setOptions(getFileRendererOptions(this.options));
    this.syncInteractionOptions();
    if (this.pre == null) {
      return;
    }
    this.fileRenderer.hydrate(file);
    this.renderedFile = file;
    this.renderAnnotations();
    this.renderGutterUtility();
    this.injectUnsafeCSS();
    this.managersDirty = true;
    this.flushManagers();
  }

  public getOrCreateLineCache(
    file: FileContents | undefined = this.getLatestFile()
  ): string[] {
    return file != null
      ? this.fileRenderer.getOrCreateLineCache(file)
      : EMPTY_STRINGS;
  }

  protected updateBuffers(renderRange: RenderRange): void {
    if (this.pre != null) {
      this.applyBuffers(this.pre, renderRange);
    }
  }

  private syncRenderViewToEditor(): void {
    const { editor, fileContainer, renderRange } = this;
    const lineAnnotations = this.getLatestAnnotations();
    const file = this.getLatestFile();
    if (editor == null || fileContainer == null || file == null) {
      return;
    }
    const syncEditor = (highlighter: DiffsHighlighter): void => {
      if (
        !this.enabled ||
        this.editor !== editor ||
        this.fileContainer !== fileContainer ||
        this.getLatestFile() !== file
      ) {
        return;
      }
      editor.__syncRenderView({
        highlighter,
        fileContainer,
        file,
        lineAnnotations,
        renderRange,
        externalDocument: this.editSession?.externalReplacement === true,
      });
    };

    const theme = this.getTheme();
    const lang = file.lang ?? getFiletypeFromFileName(file.name);
    // Sync editor synchronously whenever the shared highlighter is ready;
    // otherwise load it and sync once it resolves.
    const highlighter = getHighlighterIfLoaded({ theme, lang });
    if (highlighter != null) {
      syncEditor(highlighter);
    } else {
      void getSharedHighlighter({
        themes: getThemes(theme),
        langs: Array.from(new Set(['text', lang])),
        preferredHighlighter:
          this.workerManager?.getPreferredHighlighter() ??
          this.options.preferredHighlighter,
      }).then(syncEditor);
    }
  }

  /** @internal Settle component state before either observer can install a newer file. */
  public __acceptEditorChange(
    event: EditorChangeEvent<'file', LAnnotation, Caret>
  ): void {
    // A change means the editor's document now carries the pending external
    // replacement (or the user has edited past it), so the next sync no longer
    // needs to force that content over the document.
    if (this.editSession != null) {
      this.editSession.externalReplacement = false;
    }
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
    // A retained session just re-starts its render; a fresh attach with a file
    // installs a session seeded from the editor's document. The editor can also
    // attach before the file arrives, there is nothing to begin yet, so the
    // session installs on the later hydrate.
    if (this.editSession != null) {
      this.fileRenderer.beginEditSession(this.editSession.file);
    } else if (this.file != null) {
      this.installEditSession(
        this.file,
        editor.__getDocumentContents(this.file)
      );
    }
    const editSessionFile = this.editSession?.file;
    if (this.fileRenderer.editorRenderReady()) {
      if (this.fileRenderer.fileCache === editSessionFile) {
        this.renderedFile = editSessionFile;
      }
      this.syncRenderViewToEditor();
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
   * Ends the edit session and settles which file this component renders.
   * Requires the editor to be detached first. Does nothing when no session
   * exists, so callers can invoke it again safely after it has settled.
   *
   * `onEditComplete` receives the completed file, current external file, and
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
    const {
      editSession,
      file: externalFile,
      lineAnnotations: externalAnnotations,
    } = this;
    if (editSession == null || externalFile == null) {
      return;
    }
    const { file: editSessionFile, annotations: editSessionAnnotations } =
      editSession;
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
      originalFile: externalFile,
      lineAnnotations: sessionAnnotationsCurrent,
      originalLineAnnotations: externalAnnotations,
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
          completedFile.cacheKey === externalFile.cacheKey
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

    if (installResult && acceptedFile != null) {
      this.file = acceptedFile;
      if (sessionAnnotationsCurrent != null) {
        this.lineAnnotations = sessionAnnotationsCurrent;
      }
    }
    this.editSession = undefined;
    // Ending the session with the settled file lets the renderer adopt it as
    // the rendered identity when its cache already shows this content, so
    // the next render treats it as current instead of a new file.
    const { renderedFile, file: settledFile } = this;
    this.fileRenderer.endEditSession(settledFile);
    if (
      renderedFile != null &&
      settledFile != null &&
      renderedFile !== settledFile &&
      areFileTargetsEqual(renderedFile, settledFile)
    ) {
      this.renderedFile = settledFile;
    }
    if (installResult && this.fileContainer != null) {
      this.rerender();
    }
    if (failed) {
      throw failure;
    }
  }

  // normally triggered by the host when the document line count changes
  public applyDocumentChange(
    textDocument: TextDocument<'file', LAnnotation>,
    newLineAnnotations?: LineAnnotation<LAnnotation>[]
  ): void {
    const editSessionFile = this.editSession?.file;
    if (editSessionFile == null) {
      throw new Error(
        'File.applyDocumentChange: requires an active edit session'
      );
    }
    this.fileRenderer.beginEditSession(editSessionFile);
    this.fileRenderer.applyDocumentChange(textDocument);
    if (newLineAnnotations != null) {
      this.syncEditSessionAnnotationsFromEditor(newLineAnnotations);
    }
  }

  public updateRenderCache(
    dirtyLines: Map<number, Array<HighlightedToken>>,
    themeType: 'dark' | 'light',
    options?: {
      lineCountChangeInFlight?: boolean;
    }
  ): void {
    const editSessionFile = this.editSession?.file;
    if (editSessionFile == null) {
      throw new Error(
        'File.updateRenderCache: requires an active edit session'
      );
    }
    this.fileRenderer.beginEditSession(editSessionFile);
    this.fileRenderer.updateRenderCache(
      dirtyLines,
      themeType,
      options?.lineCountChangeInFlight
    );
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

    // postpone background tokenizing to next frame for avoiding UI freeze
    // during render
    this.editor?.__postponeBgTokenizeToNextFrame();

    const { collapsed = false, themeType = 'system' } = this.options;
    const nextRenderRange = collapsed ? undefined : renderRange;
    const previousRenderRange = this.renderRange;
    const themeChanged = this.hasThemeChanged();
    const annotationsChanged =
      lineAnnotations != null &&
      (lineAnnotations.length > 0 || this.getLatestAnnotations().length > 0)
        ? this.isNewAnnotations(lineAnnotations)
        : false;
    const didFileChange = !areFileTargetsEqual(this.file, file);
    if (didFileChange) {
      this.updateExternalFile(file, lineAnnotations);
    }
    const latestFile = this.getLatestFile(file) ?? file;
    if (
      !collapsed &&
      !forceRender &&
      areRenderRangesEqual(nextRenderRange, this.renderRange) &&
      !didFileChange &&
      !annotationsChanged &&
      !themeChanged
    ) {
      return this.applyCachedThemeState(themeType);
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
    this.fileRenderer.setLineAnnotations(this.getLatestAnnotations());

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
          latestFile,
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
        this.renderedFile = fileResult?.file ?? latestFile;
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
      if (!preventEmit) {
        this.emitPostRender();
      }
      return true;
    }

    try {
      const pre = this.getOrCreatePreNode(fileContainer);
      if (
        !this.canPartiallyRender(
          forceRender,
          annotationsChanged,
          didFileChange ||
            themeChanged ||
            !areFileTargetsEqual(this.renderedFile, latestFile)
        ) ||
        !this.applyPartialRender(
          latestFile,
          previousRenderRange,
          nextRenderRange
        )
      ) {
        const fileResult = this.fileRenderer.renderFile(
          latestFile,
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
        this.applyFullRender(fileResult, pre);
        this.renderedFile = fileResult.file;
      }

      this.applyBuffers(pre, nextRenderRange);
      this.injectUnsafeCSS();
      this.renderAnnotations();
      this.renderGutterUtility();

      this.managersDirty = true;
      if (!deferManagers) {
        this.flushManagers();
      }

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
    this.code = undefined;

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

  private canPartiallyRender(
    forceRender: boolean,
    annotationsChanged: boolean,
    didContentChange: boolean
  ): boolean {
    if (forceRender || annotationsChanged || didContentChange) {
      return false;
    }
    return true;
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
    this.placeHolder.style.setProperty('height', `${height}px`);
    return true;
  }

  public async primeHighlightCache(
    file: FileContents | undefined = this.file
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
    const lines = this.fileRenderer.getOrCreateLineCache(file);
    if (lines.length > tokenizeMaxLength) {
      return;
    }

    await workerManager
      .primeFileHighlightCache(file)
      .catch((error: unknown) => {
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
    this.code = undefined;
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
    if (this.isContainerManaged || this.fileContainer == null) {
      for (const { element } of this.annotationCache.values()) {
        element.remove();
      }
      this.annotationCache.clear();
      return;
    }
    const staleAnnotations = new Map(this.annotationCache);
    const { renderAnnotation } = this.options;
    const lineAnnotations = this.getLatestAnnotations();
    if (renderAnnotation != null && lineAnnotations.length > 0) {
      for (const [index, annotation] of lineAnnotations.entries()) {
        const name = this.getAnnotationSlotName(annotation);
        const id = `${index}-${name}`;
        let cache = this.annotationCache.get(id);
        if (
          cache == null ||
          !areLineAnnotationsEqual(annotation, cache.annotation)
        ) {
          cache?.element.remove();
          const content = renderAnnotation(annotation);
          // If we can't render anything, then we should not render anything
          // and clear the annotation cache if necessary.
          if (content == null) {
            continue;
          }
          cache = {
            element: createAnnotationWrapperNode(name),
            annotation,
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

  private applyFullRender(result: FileRenderResult, pre: HTMLPreElement): void {
    this.cleanupErrorWrapper();
    this.applyPreNodeAttributes(pre, result);
    const code = (this.code = getOrCreateCodeNode({ code: this.code }));
    const codeAst = this.fileRenderer.renderCodeAST(result);
    this.editor?.__captureFocusForDOMReplacement();
    const applyColumns = () => {
      if (code.childElementCount >= 2) {
        for (let i = 0; i < 2; i++) {
          const domEl = code.children[i] as HTMLElement;
          const astEl = codeAst[i] as HASTElement;
          domEl.innerHTML = toHtml(astEl.children);
          domEl.style.cssText = astEl.properties.style as string;
        }
      } else {
        code.innerHTML = toHtml(codeAst);
      }
      if (!pre.contains(code)) {
        pre.replaceChildren(code);
      }
    };
    if (this.shouldGuardRebuildScroll()) {
      guardWebKitScrollDuringRebuild(pre, applyColumns);
    } else {
      applyColumns();
    }
    this.lastRowCount = result.rowCount;
  }

  private applyPartialRender(
    file: FileContents,
    previousRenderRange: RenderRange | undefined,
    renderRange: RenderRange | undefined
  ): boolean {
    if (previousRenderRange == null || renderRange == null) {
      return false;
    }
    const { code } = this;
    const columns = code != null ? this.getColumns(code) : undefined;
    if (code == null || columns == null) {
      return false;
    }

    const previousStart = previousRenderRange.startingLine;
    const nextStart = renderRange.startingLine;
    const previousEnd =
      previousRenderRange.totalLines === Infinity
        ? Number.POSITIVE_INFINITY
        : previousStart + previousRenderRange.totalLines;
    const nextEnd =
      renderRange.totalLines === Infinity
        ? Number.POSITIVE_INFINITY
        : nextStart + renderRange.totalLines;

    const overlapStart = Math.max(previousStart, nextStart);
    const overlapEnd = Math.min(previousEnd, nextEnd);
    if (overlapEnd <= overlapStart) {
      return false;
    }

    if (
      !this.trimDOMToOverlap(columns.gutter, overlapStart, overlapEnd) ||
      !this.trimDOMToOverlap(columns.content, overlapStart, overlapEnd)
    ) {
      throw new Error('File.applyPartialRender: failed to trim to overlap');
    }

    let { length: rowCount } = columns.content.children;

    const renderChunk = (
      startingLine: number,
      totalLines: number
    ): FileRenderResult | undefined => {
      if (totalLines <= 0) {
        return undefined;
      }
      return this.fileRenderer.renderFile(file, {
        startingLine,
        totalLines,
        bufferBefore: 0,
        bufferAfter: 0,
      });
    };

    const prependResult =
      nextStart < overlapStart
        ? renderChunk(nextStart, overlapStart - nextStart)
        : undefined;
    if (prependResult === undefined && nextStart < overlapStart) {
      return false;
    }

    const appendTotalLines =
      nextEnd === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, nextEnd - overlapEnd);
    const appendResult =
      nextEnd > overlapEnd
        ? renderChunk(overlapEnd, appendTotalLines)
        : undefined;
    if (appendResult === undefined && nextEnd > overlapEnd) {
      return false;
    }

    this.cleanupErrorWrapper();
    if (prependResult != null) {
      columns.gutter.insertAdjacentHTML(
        'afterbegin',
        this.fileRenderer.renderPartialHTML(prependResult.gutterAST)
      );
      columns.content.insertAdjacentHTML(
        'afterbegin',
        this.fileRenderer.renderPartialHTML(prependResult.contentAST)
      );
      rowCount += prependResult.rowCount;
    }

    if (appendResult != null) {
      columns.gutter.insertAdjacentHTML(
        'beforeend',
        this.fileRenderer.renderPartialHTML(appendResult.gutterAST)
      );
      columns.content.insertAdjacentHTML(
        'beforeend',
        this.fileRenderer.renderPartialHTML(appendResult.contentAST)
      );
      rowCount += appendResult.rowCount;
    }

    if (this.lastRowCount !== rowCount) {
      columns.gutter.style.setProperty('grid-row', `span ${rowCount}`);
      columns.content.style.setProperty('grid-row', `span ${rowCount}`);
      this.lastRowCount = rowCount;
    }

    return true;
  }

  private getColumns(code: HTMLElement): ColumnElements | undefined {
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

  private trimDOMToOverlap(
    container: HTMLElement,
    overlapStart: number,
    overlapEnd: number
  ): boolean {
    const boundaryIndices = this.getDOMBoundaryIndices(container, [
      overlapStart,
      overlapEnd,
    ]);
    const startIndex =
      boundaryIndices.get(overlapStart) ?? container.children.length;
    const endIndex =
      boundaryIndices.get(overlapEnd) ?? container.children.length;

    if (startIndex > endIndex) {
      return false;
    }

    for (let i = container.children.length - 1; i >= endIndex; i -= 1) {
      container.children[i]?.remove();
    }
    for (let i = startIndex - 1; i >= 0; i -= 1) {
      container.children[i]?.remove();
    }
    return true;
  }

  private getDOMBoundaryIndices(
    container: HTMLElement,
    boundaries: number[]
  ): Map<number, number> {
    const sortedBoundaries = [...new Set(boundaries)].sort((a, b) => a - b);
    const boundaryIndices = new Map<number, number>();
    if (sortedBoundaries.length === 0) {
      return boundaryIndices;
    }
    let boundaryIndex = 0;
    let nextBoundary = sortedBoundaries[boundaryIndex];
    const { children } = container;

    if (nextBoundary === 0) {
      boundaryIndices.set(0, 0);
      boundaryIndex += 1;
      nextBoundary = sortedBoundaries[boundaryIndex];
    }

    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (!(child instanceof HTMLElement)) {
        continue;
      }
      const lineIndex = this.getLineIndexFromDOMNode(child);
      if (lineIndex == null) {
        continue;
      }
      while (nextBoundary != null && lineIndex >= nextBoundary) {
        boundaryIndices.set(nextBoundary, i);
        boundaryIndex += 1;
        nextBoundary = sortedBoundaries[boundaryIndex];
      }
      if (boundaryIndex >= sortedBoundaries.length) {
        break;
      }
    }

    for (const boundary of sortedBoundaries) {
      if (!boundaryIndices.has(boundary)) {
        boundaryIndices.set(boundary, children.length);
      }
    }
    return boundaryIndices;
  }

  private getLineIndexFromDOMNode(node: HTMLElement): number | undefined {
    const lineIndexAttr = node.dataset.lineIndex;
    if (lineIndexAttr == null) {
      return undefined;
    }
    const parsed = Number(lineIndexAttr);
    return Number.isNaN(parsed) ? undefined : parsed;
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
    const headerHTML = this.cachedHeaderHTML ?? toHtml(headerAST);
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

    if (this.isContainerManaged) return;

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
      this.code = undefined;
      shadowRoot.appendChild(this.pre);
    }
    // If we have a new parent container for the pre element, lets go ahead and
    // move it into the new container
    else if (this.pre.parentNode !== shadowRoot) {
      this.editor?.__captureFocusForDOMReplacement();
      container.shadowRoot?.appendChild(this.pre);
      this.appliedPreAttributes = undefined;
    }

    this.placeHolder?.remove();
    this.placeHolder = undefined;

    return this.pre;
  }

  private syncCodeNodeFromPre(pre: HTMLPreElement): void {
    this.code = undefined;
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
