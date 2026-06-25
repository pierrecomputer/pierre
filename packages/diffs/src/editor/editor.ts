import { queueRender } from '../managers/UniversalRenderingManager';
import type {
  DiffLineAnnotation,
  DiffsEditableComponent,
  DiffsEditor,
  DiffsEditorSelection,
  DiffsHighlighter,
  FileContents,
  FileDiffMetadata,
  HighlightedToken,
  RenderRange,
} from '../types';
import { getFiletypeFromFileName } from '../utils/getFiletypeFromFileName';
import {
  type EditorCommand,
  resolveEditorCommandFromKeyboardEvent,
  resolveFindAgainShortcut,
} from './command';
import editorCSS from './editor.css?inline';
import { EditStack } from './editStack';
import {
  applyDocumentChangeToLineAnnotations,
  renderLineAnnotations,
} from './lineAnnotations';
import {
  type Marker,
  MarkerRenderer,
  markerSeverityDatasetKey,
} from './marker';
import { isMoveCursorShortcut, isPrimaryModifier, isSafari } from './platform';
import {
  type MatchRange,
  type SearchPanelMode,
  SearchPanelWidget,
} from './searchPanel';
import type { AutoSurround, EditorSelection } from './selection';
import {
  applyDeleteCharacterToSelections,
  applyDeleteHardLineForwardToSelections,
  applyDeleteSoftLineBackwardToSelections,
  applyDeleteWordBackwardToSelections,
  applyTextChangeToSelections,
  applyTextReplaceToSelections,
  applyTransposeToSelections,
  comparePosition,
  convertSelection,
  createSelectionFrom,
  createSelectionFromAnchorAndFocusOffsets,
  DirectionBackward,
  DirectionForward,
  DirectionNone,
  expandCollapsedSelectionToWord,
  extendSelection,
  extendSelections,
  findNexMatch,
  getAutoSurroundReplacementTexts,
  getCaretPosition,
  getDocumentBoundarySelection,
  getDocumentFullSelection,
  getSelectionAnchor,
  getSelectionText,
  isCollapsedSelection,
  isLineEditable,
  mapCursorMove,
  mapSelectionShift,
  mergeOverlappingSelections,
  remapSelectionsAfterEdits,
  resolveIndentEdits,
  resolveSelectionCut,
  selectionIntersects,
} from './selection';
import {
  type SelectionActionContext,
  SelectionActionWidget,
} from './selectionAction';
import { createSpriteElement } from './sprite';
import {
  type Position,
  type Range,
  type ResolvedTextEdit,
  TextDocument,
  type TextDocumentChange,
  type TextEdit,
} from './textDocument';
import {
  getExpandedAsciiTextColumns,
  getUnicodeMeasurementOffsets,
  Metrics,
  snapTextOffsetToUnicodeBoundary,
} from './textMeasure';
import { EditorTokenizer, renderLineTokens } from './tokenzier';
import {
  addEventListener,
  clampDomOffset,
  extend,
  getLineNumberAttr,
  h,
  round,
} from './utils';

export interface EditorOptions<LAnnotation> {
  /** The maximum number of entries to keep in the undo stack. */
  historyMaxEntries?: number;
  /** Render rounded corners for selection ranges, default is true. */
  roundedSelection?: boolean;
  /**
   * Controls auto-surround when typing quotes or brackets over a selection.
   * Default is `"default"` (both quotes and brackets).
   */
  autoSurround?: AutoSurround;
  /**
   * Show a floating selection action popover anchored to the active selection,
   * default is disabled.
   */
  enabledSelectionAction?: boolean;
  /**
   * Custom clipboard provider.
   * Highly recommended to use native clipboard API if you are building an electron app.
   * see https://www.electronjs.org/docs/latest/api/clipboard
   */
  clipboard?: {
    readText: () => Promise<string> | string;
  };
  /** Render the selection action widget element. */
  renderSelectionAction?: (
    context: SelectionActionContext<LAnnotation>
  ) => HTMLElement;
  /** Callback when the editor is attached to a file. */
  onAttach?: (
    editor: Editor<LAnnotation>,
    fileInstance: DiffsEditableComponent<LAnnotation>
  ) => void;
  /** Callback when the editor document changes. */
  onChange?: (
    file: FileContents,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ) => void;
  __debug?: boolean;
}

export interface EditorState<LAnnotation> {
  file: FileContents;
  lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  selections?: EditorSelection[];
  renderRange?: RenderRange;
}

// Cap on how far an edit may widen the virtualized render window, as a multiple
// of the bounded window the virtualizer last synced (~viewport + 2*hunkLineCount).
// Edits within this many lines of the window bottom widen so their caret renders;
// larger inserts fall back to the bounded buffer-only path instead of building a
// row per inserted line. A safety bound, not a correctness-critical value.
const MAX_EDIT_WIDEN_WINDOW_MULTIPLE = 2;

export class Editor<LAnnotation> implements DiffsEditor<LAnnotation> {
  #options: EditorOptions<LAnnotation>;
  #metrics = new Metrics();
  #tokenizer?: EditorTokenizer;

  // event disposes
  #editorEventDisposes?: (() => void)[];
  #globalEventDisposes?: (() => void)[];
  #selectEventDisposes?: (() => void)[];
  #detach?: () => void;

  // cache
  #contentOffset?: { left: number; top: number };
  #gutterWidthCache?: number;
  #contentWidthCache?: number;
  #lineYCache = new Map<number, number>();
  #wrapLineOffsetsCache = new Map<number, Uint32Array>();
  #lastAccessedLineElement?: [number, HTMLElement];
  #lastAccessedCharX?: [
    line: number,
    character: number,
    x: number,
    wrapLine: number,
  ];

  // dom
  #globalStyleElement?: HTMLStyleElement;
  #editorStyleElement?: HTMLStyleElement;
  #themeStyleElement?: HTMLStyleElement;
  #spriteElement?: SVGSVGElement;
  #fileContainer?: HTMLElement;
  #gutterElement?: HTMLElement;
  #contentElement?: HTMLElement;
  #overlayElement?: HTMLElement;
  #overlayElements?: Map<string, HTMLElement>;
  #primaryCaretElement?: HTMLElement;
  #resizeObserver?: ResizeObserver;

  // state
  #fileInstance?: DiffsEditableComponent<LAnnotation>;
  #fileInfo?: Omit<FileContents, 'contents'>;
  #lineAnnotations?: DiffLineAnnotation<LAnnotation>[];
  #textDocument?: TextDocument<LAnnotation>;
  #renderRange?: RenderRange;
  // Bounded render-window size (~viewport + 2*hunkLineCount) from the last view
  // sync. Used to cap how far #applyChange widens the window for an edit, so a
  // large insert can't materialize an unbounded number of rows. Captured at sync
  // time so consecutive edits that grow #renderRange can't ratchet the cap up.
  // undefined until the first sync; Infinity for non-virtualized (whole-file)
  // windows, where no cap is needed.
  #viewportWindowLines?: number;
  #markerRenderer?: MarkerRenderer;
  #searchPanel?: SearchPanelWidget;
  #selectionAction?: SelectionActionWidget;
  #shouldIgnoreSelectionChange = false;
  // Whether the contenteditable holds (or is claiming) focus. Synced by
  // focus/blur listeners and set eagerly by #focus(), whose real focus() call is
  // deferred to a rAF. Lets applyEdits skip focus/scroll only on unfocused
  // editors, without regressing a same-tick setSelections-then-applyEdits flow.
  #contentHasFocus = false;
  #isComposing = false;
  #isGutterMouseDown = false;
  #isContentMouseDown = false;
  #shiftKeyPressed = false;
  #selectionStart: EditorSelection | undefined;
  // The full text of a read-only deleted-line selection built from the gutter,
  // captured when the selection is made. Deleted lines are separate read-only
  // hosts, so window.getSelection() only spans the first line; the copy/cut
  // handlers prefer this. Empty for a direct content drag (no gutter range).
  #deletedSelectionText = '';
  #reservedSelections?: EditorSelection[];
  #initSelections?: EditorSelection[];
  #selections?: EditorSelection[];
  #matches?: MatchRange[];
  #scrollingToLine?: number;
  #scrollingToLineChar?: number;
  #scrollingToLineNoFocus = false;
  #retainSearchPanelFocus = false;
  #fontRemeasureScheduled = false;

  #onDeferTokenize = (
    lines: Map<number, Array<HighlightedToken>>,
    themeType: 'light' | 'dark'
  ) => {
    this.#fileInstance?.updateRenderCache(lines, themeType);
    // update the view if the render range is updated by scrolling
    // and the deferred tokenized lines inside the render range
    if (
      this.#renderRange !== undefined &&
      this.#renderRange.totalLines !== Infinity
    ) {
      const { startingLine, totalLines } = this.#renderRange;
      const endLine = Math.min(
        startingLine + totalLines,
        this.#textDocument?.lineCount ?? 0
      );
      for (const [line, tokens] of lines) {
        if (line >= startingLine && line < endLine) {
          const lineElement = this.#getLineElement(line);
          if (lineElement !== undefined) {
            lineElement.replaceChildren(...renderLineTokens(tokens, themeType));
          }
        }
      }
    }
  };

  constructor(options: EditorOptions<LAnnotation> = {}) {
    this.#options = options;
  }

  edit(component: DiffsEditableComponent<LAnnotation>): () => void {
    const {
      useTokenTransformer,
      enableGutterUtility,
      enableLineSelection,
      expandUnchanged,
      lineHoverHighlight,
      ...rest
    } = component.options;
    const isDiff = component.type === 'file-diff';
    if (
      useTokenTransformer !== true ||
      enableGutterUtility === true ||
      enableLineSelection === true ||
      (expandUnchanged !== true && isDiff) ||
      lineHoverHighlight !== 'disabled'
    ) {
      component.setOptions({
        ...rest,
        useTokenTransformer: true,
        enableGutterUtility: false,
        enableLineSelection: false,
        expandUnchanged: true,
        lineHoverHighlight: 'disabled',
      });
      component.rerender();
    }
    this.#fileInstance = component;
    this.#initialize();
    this.#detach = component.attachEditor(this);
    return () => this.cleanUp();
  }

  /**
   * Apply edits to current attached file.
   */
  applyEdits(edits: TextEdit[], updateHistory = false): void {
    const textDocument = this.#textDocument;
    if (textDocument == null) {
      throw new Error('Editor is not attached');
    }
    // Only reposition focus and scroll when the editor already holds focus. A
    // programmatic edit must not pull focus from another input the user is
    // typing in; the selection state below is re-anchored either way.
    const wasFocused = this.#contentHasFocus;
    // Capture the current selection edges and the edit ranges as pre-edit
    // offsets so the caret can be re-anchored once the buffer changes. Reading
    // them after applyEdits would resolve against the new buffer and desync.
    const selectionsBefore = this.#selections;
    const selectionOffsetsBefore = selectionsBefore?.map(
      (selection) =>
        [
          textDocument.offsetAt(selection.start),
          textDocument.offsetAt(selection.end),
        ] as [number, number]
    );
    // Resolve edits to pre-edit offsets, mirroring TextDocument's own
    // resolution (swap reversed ranges, sort ascending), so the remap matches
    // the edits TextDocument actually applies below.
    const resolvedEditOffsets =
      selectionsBefore === undefined
        ? undefined
        : edits
            .map((edit) => {
              const a = textDocument.offsetAt(edit.range.start);
              const b = textDocument.offsetAt(edit.range.end);
              return {
                start: Math.min(a, b),
                end: Math.max(a, b),
                text: edit.newText,
              };
            })
            .sort((a, b) => a.start - b.start);

    const change = textDocument.applyEdits(
      edits,
      updateHistory,
      selectionsBefore
    );
    if (change === undefined) {
      return;
    }

    // Re-anchor selections against the applied edits so the editor #selections,
    // the native window selection, and the on-screen caret stay in sync with
    // the new buffer. Skipping this leaves a programmatic edit (e.g. an AI or
    // codemod insertion) with a stale caret and corrupts the next keystroke.
    let nextSelections: EditorSelection[] | undefined;
    if (
      selectionsBefore !== undefined &&
      selectionOffsetsBefore !== undefined &&
      resolvedEditOffsets !== undefined
    ) {
      nextSelections = remapSelectionsAfterEdits(
        textDocument,
        selectionsBefore,
        selectionOffsetsBefore,
        resolvedEditOffsets
      );
      if (updateHistory) {
        textDocument.setLastUndoSelectionsAfter(nextSelections);
      }
    }

    this.#applyChange(
      change,
      nextSelections,
      this.#applyChangeToLineAnnotations(change),
      { skipFocus: !wasFocused }
    );
  }

  /** Whether there is an edit to undo. */
  get canUndo(): boolean {
    return this.#textDocument?.canUndo ?? false;
  }

  /** Whether there is an undone edit to redo. */
  get canRedo(): boolean {
    return this.#textDocument?.canRedo ?? false;
  }

  /** Undo the last edit. Does nothing when there is nothing to undo. */
  undo(): void {
    this.#runCommand('undo');
  }

  /** Redo the last undone edit. Does nothing when there is nothing to redo. */
  redo(): void {
    this.#runCommand('redo');
  }

  getState(): EditorState<LAnnotation> {
    const fileRef = this.#getFileRef();
    if (fileRef === undefined) {
      throw new Error('Editor is not attached');
    }
    return {
      file: { ...fileRef, cacheKey: 'edited-at-' + Date.now() },
      selections: this.#selections,
      lineAnnotations: this.#lineAnnotations,
      renderRange: this.#renderRange,
    };
  }

  setState({
    file,
    lineAnnotations,
    renderRange,
    selections,
  }: EditorState<LAnnotation>): void {
    this.#resetCache();
    this.#resetState();
    this.#initSelections = selections;
    this.#fileInstance?.render({
      file: { ...file, cacheKey: 'edited-at-' + Date.now() },
      lineAnnotations,
      renderRange,
    });
  }

  setSelections(selections: DiffsEditorSelection[]): void {
    const textDocument = this.#textDocument;
    if (textDocument === undefined) {
      throw new Error('Text document is not initialized');
    }
    const resolvedSelections = selections.map<EditorSelection>((selection) => {
      const start = textDocument.normalizePosition(selection.start);
      const end = textDocument.normalizePosition(selection.end);
      const direction =
        selection.direction === 'none'
          ? DirectionNone
          : selection.direction === 'backward'
            ? DirectionBackward
            : DirectionForward;
      return { direction, start, end };
    });
    this.#updateSelections(resolvedSelections);
    this.#scrollToPrimaryCaret(false, 'center');
  }

  setMarkers(markers: Marker[]): void {
    const textDocument = this.#textDocument;
    if (textDocument === undefined) {
      throw new Error('Text document is not initialized');
    }

    if (markers.length === 0) {
      this.#markerRenderer?.cleanup();
      this.#markerRenderer = undefined;
      this.#updateSelections(this.#selections ?? []);
      return;
    }

    this.#markerRenderer ??= new MarkerRenderer({
      getLineHeight: () => this.#metrics.lineHeight,
      getOverlayElement: () => this.#overlayElement,
      getGutterWidth: () => this.#getGutterWidth(),
      getCharX: (line, character) => this.#getCharX(line, character),
      getLineY: (line) => this.#getLineY(line),
      isMouseDown: () => this.#isContentMouseDown || this.#isGutterMouseDown,
    });
    this.#markerRenderer.setMarkers(markers, textDocument);
    if (this.#contentElement !== undefined) {
      this.#markerRenderer.listenHover(this.#contentElement);
    }
    this.#updateSelections(this.#selections ?? []);
  }

  focus(options?: FocusOptions): void {
    const preventScroll = options?.preventScroll ?? false;
    const primarySelection = this.#selections?.at(-1);
    if (primarySelection !== undefined) {
      const pos =
        primarySelection.direction === DirectionBackward
          ? primarySelection.end
          : primarySelection.start;
      this.#focus(pos, preventScroll);
    } else {
      this.#focus(undefined, preventScroll);
    }
  }

  blur(): void {
    this.#contentElement?.blur();
  }

  cleanUp(): void {
    this.#tokenizer?.cleanUp();
    this.#tokenizer = undefined;

    // dispse event listeners
    this.#globalEventDisposes?.forEach((dispose) => dispose());
    this.#globalEventDisposes = undefined;
    this.#editorEventDisposes?.forEach((dispose) => dispose());
    this.#editorEventDisposes = undefined;
    this.#selectEventDisposes?.forEach((dispose) => dispose());
    this.#selectEventDisposes = undefined;
    this.#detach?.();
    this.#detach = undefined;

    // cache
    this.#gutterWidthCache = undefined;
    this.#contentWidthCache = undefined;
    this.#lineYCache.clear();
    this.#wrapLineOffsetsCache.clear();
    this.#lastAccessedLineElement = undefined;
    this.#lastAccessedCharX = undefined;

    // clean up dom elements
    this.#globalStyleElement?.remove();
    this.#globalStyleElement = undefined;
    this.#editorStyleElement?.remove();
    this.#editorStyleElement = undefined;
    this.#themeStyleElement?.remove();
    this.#themeStyleElement = undefined;
    this.#spriteElement?.remove();
    this.#spriteElement = undefined;
    this.#fileContainer = undefined;
    this.#gutterElement = undefined;
    this.#contentElement?.removeAttribute('contentEditable');
    this.#contentElement = undefined;
    this.#contentHasFocus = false;
    this.#overlayElement?.remove();
    this.#overlayElement = undefined;
    this.#resizeObserver?.disconnect();
    this.#resizeObserver = undefined;
    // Let a reused instance schedule the font re-measure again on its next
    // mount, where a different font-family string may not be loaded yet.
    this.#fontRemeasureScheduled = false;

    this.#resetState();
  }

  /** @internal */
  __postponeBackgroundTokenizeToNextFrame(): void {
    const tokenizer = this.#tokenizer;
    if (tokenizer !== undefined) {
      tokenizer.pauseBackgroundTokenize();
      requestAnimationFrame(() => {
        tokenizer.resumeBackgroundTokenize();
      });
    }
  }

  /** @internal */
  __syncRenderView: DiffsEditor<LAnnotation>['__syncRenderView'] = (
    highlighter: DiffsHighlighter,
    fileContainer: HTMLElement,
    fileOrDiff: FileContents | FileDiffMetadata,
    lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined,
    renderRange: RenderRange | undefined
  ) => {
    const shadowRoot = fileContainer.shadowRoot;
    if (shadowRoot == null) {
      console.error('[editor] Could not find the shadow root.');
      return;
    }

    let codeElement: HTMLElement | undefined;
    let gutterEl: HTMLElement | undefined;
    let contentEl: HTMLElement | undefined;
    for (const el of shadowRoot.querySelectorAll<HTMLElement>('[data-code]')) {
      if (el.dataset.deletions === undefined) {
        codeElement = el;
        for (const child of el.children) {
          const el = child as HTMLElement;
          const { gutter, content } = el.dataset;
          if (gutter !== undefined) {
            gutterEl = el;
          } else if (content !== undefined) {
            contentEl = el;
          }
        }
        break;
      }
    }
    if (codeElement === undefined || contentEl === undefined) {
      return;
    }

    // inject editor&theme style to the file container
    if (this.#fileContainer !== fileContainer) {
      this.#fileContainer = fileContainer;
      if (this.#globalStyleElement !== undefined) {
        fileContainer.appendChild(this.#globalStyleElement);
      }
      if (this.#editorStyleElement !== undefined) {
        shadowRoot.appendChild(this.#editorStyleElement);
      }
      if (this.#themeStyleElement !== undefined) {
        shadowRoot.appendChild(this.#themeStyleElement);
      }
      if (this.#spriteElement !== undefined) {
        shadowRoot.prepend(this.#spriteElement);
      }
    }

    // Whether this sync replaces the document with a freshly parsed one (a new
    // file, language, or cache key) versus reusing the existing one. A reused
    // document keeps any edits the host's file contents do not have, which the
    // rebuilt line DOM below must be reconciled against.
    const documentReplaced =
      this.#textDocument === undefined ||
      this.#fileInfo === undefined ||
      this.#fileInfo.name !== fileOrDiff.name ||
      this.#fileInfo.lang !== fileOrDiff.lang ||
      this.#fileInfo.cacheKey !== fileOrDiff.cacheKey;
    if (documentReplaced) {
      let contents = '';
      if ('contents' in fileOrDiff) {
        contents = fileOrDiff.contents;
      } else {
        contents = fileOrDiff.additionLines.join('');
      }
      const editStack = new EditStack<LAnnotation>({
        maxEntries: this.#options.historyMaxEntries,
      });
      const textDocument = new TextDocument<LAnnotation>(
        fileOrDiff.name,
        contents,
        fileOrDiff.lang ?? getFiletypeFromFileName(fileOrDiff.name),
        0,
        editStack
      );
      const { name, lang, cacheKey } = fileOrDiff;
      this.#fileInfo = { name, lang, cacheKey };
      this.#textDocument = textDocument;
      this.#tokenizer?.cleanUp();
      this.#tokenizer = new EditorTokenizer({
        highlighter,
        textDocument,
        codeOptions: this.#fileInstance?.options ?? {},
        onDeferTokenize: this.#onDeferTokenize,
        setStyle: (css) => {
          this.#themeStyleElement!.textContent = css;
        },
        __debug: this.#options.__debug,
      });
      this.#resetState();
      this.#selections = this.#initSelections;
      requestAnimationFrame(() => {
        this.#options.onAttach?.(this, this.#fileInstance!);
      });
      if (this.#textDocument !== undefined && this.#options.__debug === true) {
        console.log('[diffs/editor] text document changed !!!');
      }
    }

    // A full re-render swaps in a new content element, so comparing identity
    // detects one. This is reliable for FileDiff, which rebuilds the column
    // (a new node) on a full render and reuses it on a partial one (scrolling).
    // File reuses its content element in place, so this would not fire for a
    // File full render - but File has no rerenderFromDocument path, so the
    // re-render gate below never applies to it. If File ever gains one, this
    // detection must be revisited.
    let fullRerender = false;
    if (this.#contentElement !== contentEl) {
      fullRerender = true;
      this.#gutterElement = gutterEl;
      this.#contentElement = extend(contentEl, {
        contentEditable: 'true',
        role: 'textbox',
        ariaMultiLine: 'true',
        autocapitalize: 'off',
        writingSuggestions: 'off',
        autocorrect: false,
        spellcheck: false,
        translate: false,
      });
      if (this.#overlayElement !== undefined) {
        contentEl.after(this.#overlayElement);
      }
      this.#metrics.init(contentEl);
      this.#remeasureMetricsOnFontLoad();
      this.#listenContentElement(contentEl, gutterEl);
      if (
        this.#contentElement !== undefined &&
        this.#options.__debug === true
      ) {
        console.log('[diffs/editor] full re-render triggered !!!');
      }
    }

    // The contenteditable host advertises role="textbox", so without an
    // accessible name screen readers announce an unlabeled text field. Label it
    // with the file name. The same content element is reused across file
    // switches (see File#applyFullRender), so refresh the label on every sync
    // rather than only when the element is first initialized above.
    if (contentEl.ariaLabel !== fileOrDiff.name) {
      contentEl.ariaLabel = fileOrDiff.name;
    }

    if (
      (lineAnnotations !== undefined && lineAnnotations.length > 0) ||
      (this.#isDiff && this.#diffSyle === 'unified')
    ) {
      for (const child of this.#contentElement.children) {
        const el = child as HTMLElement;
        const { lineAnnotation, lineType } = el.dataset;
        if (lineAnnotation !== undefined || lineType === 'change-deletion') {
          el.setAttribute('contenteditable', 'false');
        }
      }
    }

    this.#resetCache();

    // The tokenizer is created once per attached document and reused across
    // re-renders, so a host-driven theme swap (theme picker, light/dark toggle)
    // wouldn't otherwise reach it. Re-apply the surface's current theme on every
    // sync so the editor's line-highlight/token colors track the active theme.
    this.#tokenizer?.syncTheme(this.#fileInstance?.options ?? {});

    this.#lineAnnotations = lineAnnotations;
    this.#renderRange = renderRange;
    // Remember the bounded window the virtualizer just synced so #applyChange
    // can clamp any edit-time widening against it. Refreshed on every scroll;
    // undefined/Infinity windows leave the clamp disabled.
    this.#viewportWindowLines = renderRange?.totalLines;
    this.#tokenizer?.prebuildStateStack(renderRange);

    // A host-driven full re-render (theme, diff style, wrap, or line-number
    // toggle) rebuilds the diff rows from the file contents the host passes in.
    // When the editor's document survived that re-render it stays the source of
    // truth and may hold edits the host's contents do not, so the rebuilt rows
    // show the pre-edit content. Re-render the diff from the editor's document
    // instead, so the rows match it - text, syntax colors, and line count - in
    // one pass, rather than reconciling the rebuilt rows after the fact.
    //
    // Gated three ways:
    // - documentReplaced: a new file/lang/cacheKey already rebuilt the document
    //   from the host's contents, so there is nothing to restore.
    // - contentRebuilt: a partial render (scrolling a virtualized file) reuses
    //   the existing edited rows, so it needs no re-render.
    // - divergence: when the rebuilt content already matches the document there
    //   is nothing to do. This also stops the recursion, since the re-render
    //   below comes back through here with content that now matches.
    // Only components with a document-backed re-render (FileDiff) implement
    // rerenderFromDocument; the plain File has no such path yet and is skipped.
    const fileInstance = this.#fileInstance;
    const textDocument = this.#textDocument;
    if (
      !documentReplaced &&
      fullRerender &&
      fileInstance?.rerenderFromDocument !== undefined &&
      textDocument !== undefined &&
      this.#shouldRenderDivergeFromDocument(textDocument)
    ) {
      fileInstance.rerenderFromDocument(textDocument);
      return;
    }

    this.#markerRenderer?.removePopup();

    // re-render the existing selections, matches, and markers
    if (
      this.#selections !== undefined ||
      this.#matches !== undefined ||
      this.#markerRenderer !== undefined
    ) {
      this.#updateSelections(this.#selections ?? []);
    }

    if (
      this.#initSelections !== undefined &&
      this.#primaryCaretElement !== undefined
    ) {
      this.#initSelections = undefined;
      this.#scrollToPrimaryCaret(false, 'center');
    } else if (this.#scrollingToLine !== undefined) {
      this.#scrollToLine(
        this.#scrollingToLine,
        this.#scrollingToLineChar,
        this.#scrollingToLineNoFocus
      );
    } else if (
      this.#selections !== undefined &&
      this.#selections.length > 0 &&
      !this.#retainSearchPanelFocus
    ) {
      this.focus({ preventScroll: true });
    }

    if (this.#retainSearchPanelFocus) {
      this.#searchPanel?.focus();
    }

    if (this.#options.__debug === true && renderRange !== undefined) {
      const { startingLine, totalLines } = renderRange;
      console.log(
        '[diffs/editor] render file:',
        fileOrDiff.name,
        'RenderRange:',
        startingLine + '-' + (startingLine + totalLines),
        'of',
        this.#textDocument?.lineCount,
        'lines'
      );
    }
  };

  get #diffSyle(): 'unified' | 'split' {
    return this.#fileInstance?.options.diffStyle ?? 'split';
  }

  get #isDiff(): boolean {
    return this.#fileInstance?.type === 'file-diff';
  }

  get #isWrap(): boolean {
    return this.#fileInstance?.options.overflow === 'wrap';
  }

  #resetCache(): void {
    this.#lineYCache.clear();
    this.#wrapLineOffsetsCache.clear();
    this.#lastAccessedLineElement = undefined;
    this.#lastAccessedCharX = undefined;
  }

  #resetState(): void {
    this.#setSelectedLinesSafe(null);
    this.#gutterWidthCache = undefined;
    this.#contentWidthCache = undefined;
    this.#shouldIgnoreSelectionChange = false;
    this.#overlayElements?.forEach((el) => el.remove());
    this.#overlayElements = undefined;
    this.#selections = undefined;
    this.#reservedSelections = undefined;
    this.#scrollingToLine = undefined;
    this.#markerRenderer?.cleanup();
    this.#markerRenderer = undefined;
    this.#searchPanel?.cleanup();
    this.#searchPanel = undefined;
    this.#selectionAction?.cleanup();
    this.#selectionAction = undefined;
  }

  #initialize(): void {
    // Safari doesn't support `::selection` for slot elements in ShadowDOM,
    // Add a global style to disable selection for slot elements
    this.#globalStyleElement = h('style', {
      dataset: 'editorGlobalCss',
      textContent: `
        [data-annotation-slot] {
          user-select: none;
          -webkit-user-select: none;
        }
      `,
    });

    this.#editorStyleElement = h('style', {
      dataset: 'editorCss',
      textContent: editorCSS,
    });

    this.#themeStyleElement = h('style', {
      dataset: 'editorThemeCss',
    });

    this.#spriteElement = createSpriteElement();

    this.#overlayElement = h('div', {
      dataset: 'editorOverlay',
    });

    this.#globalEventDisposes = [
      addEventListener(
        document,
        'selectionchange',
        () => {
          const shadowRoot = this.#fileContainer?.shadowRoot;
          // Ignore selection changes while the contenteditable is unfocused. A
          // programmatic applyEdits (skipFocus) re-anchors #selections without
          // syncing the native Selection, so a DOM-driven or refocus
          // selectionchange whose range still belongs to the editor must not
          // overwrite the remapped #selections before the user returns to type.
          if (
            this.#shouldIgnoreSelectionChange ||
            shadowRoot == null ||
            !this.#contentHasFocus
          ) {
            return;
          }

          // Native selection only tracks one range. focus() and DOM updates while
          // typing mirror the primary caret there, so selectionchange must not
          // overwrite multi-cursor editor state outside an active pointer gesture.
          if (
            this.#selections !== undefined &&
            this.#selections.length > 1 &&
            !this.#isContentMouseDown
          ) {
            return;
          }

          const selectionRaw = document.getSelection();
          // getComposedRanges is the only selection API that reads through the
          // editor's shadow root, but it is newly available and missing on
          // older browsers and embedded WebViews. Bail out instead of throwing
          // out of this listener on every selectionchange when it is absent.
          if (
            selectionRaw == null ||
            typeof selectionRaw.getComposedRanges !== 'function'
          ) {
            return;
          }
          const composedRange = selectionRaw.getComposedRanges({
            shadowRoots: [shadowRoot],
          })?.[0];
          if (
            composedRange === undefined ||
            !this.#rangeBelongsToEditor(composedRange)
          ) {
            return;
          }

          let selection = convertSelection(composedRange, DirectionNone);
          if (selection === undefined) {
            return;
          }

          // extend selection by shift + click
          if (
            this.#isContentMouseDown &&
            this.#shiftKeyPressed &&
            this.#selections !== undefined &&
            this.#selections.length > 0
          ) {
            const primarySelection = this.#selections.at(-1)!;
            this.#updateSelections([
              extendSelection(primarySelection, selection),
            ]);
            return;
          }

          if (this.#isContentMouseDown) {
            if (this.#selectionStart !== undefined) {
              selection = createSelectionFrom(this.#selectionStart, selection);
            } else {
              this.#selectionStart = selection;
            }
          } else if (this.#selectionStart !== undefined) {
            selection.direction = createSelectionFrom(
              this.#selectionStart,
              selection
            ).direction;
          }

          if (this.#reservedSelections !== undefined) {
            this.#updateSelections([
              ...this.#reservedSelections.filter(
                (reservedSelection) =>
                  !selectionIntersects(reservedSelection, selection)
              ),
              selection,
            ]);
          } else {
            this.#updateSelections([selection]);
          }
        },
        { passive: true }
      ),

      addEventListener(
        document,
        'pointerup',
        (e) => {
          if (e.pointerType !== 'mouse') {
            return;
          }

          this.#selectEventDisposes?.forEach((dispose) => dispose());
          this.#selectEventDisposes = undefined;

          if (this.#isGutterMouseDown) {
            this.#isGutterMouseDown = false;
            this.#focus();
          }
          this.#shouldIgnoreSelectionChange = false;
          this.#isContentMouseDown = false;
          this.#shiftKeyPressed = false;
          this.#selectionStart = undefined;
          this.#reservedSelections = undefined;
          // The popover is suppressed while the mouse is down so it doesn't
          // flicker under the cursor mid-drag. Now that the drag has ended,
          // re-run the overlay pass so a settled ranged selection reveals it.
          if (
            this.#options.enabledSelectionAction === true &&
            this.#selections !== undefined &&
            this.#selections.length > 0 &&
            !isCollapsedSelection(this.#selections.at(-1)!)
          ) {
            this.#updateSelections(this.#selections);
          }
        },
        { passive: true }
      ),

      addEventListener(
        document,
        'keydown',
        (e) => {
          if (e.key === 'Shift') {
            this.#selectionStart = this.#selections?.at(-1);
          }
        },
        { passive: true }
      ),

      addEventListener(
        document,
        'keyup',
        (e) => {
          if (e.key === 'Shift') {
            this.#selectionStart = undefined;
          }
        },
        { passive: true }
      ),
    ];
  }

  // Swaps in a new batch of transient "select" listeners — gutter drag
  // tracking or the Safari annotation-hover workaround — disposing the
  // previous batch first. Routing every reassignment through here keeps the
  // dispose-before-replace invariant in one place: a stale set (e.g. from a
  // pointerup that never fired after a canceled gesture, or a fresh
  // pointerdown before the previous interaction tore down) can never be
  // overwritten while its listeners are still attached to the document.
  #replaceSelectEventListeners(disposes: (() => void)[]): void {
    this.#selectEventDisposes?.forEach((dispose) => dispose());
    this.#selectEventDisposes = disposes;
  }

  #listenContentElement(contentEl: HTMLElement, gutterEl?: HTMLElement): void {
    const targetIsContentElement = (e: Event) => {
      const target = e.composedPath()[0] as HTMLElement | undefined;
      return (
        target !== undefined &&
        (target === contentEl || contentEl.contains(target))
      );
    };

    this.#editorEventDisposes?.forEach((dispose) => dispose());
    this.#editorEventDisposes = [
      addEventListener(
        contentEl,
        'focus',
        () => {
          this.#contentHasFocus = true;
          // A keyboard or direct programmatic refocus restores a stale native
          // Selection that the selectionchange handler would apply over the
          // remapped #selections (after an applyEdits inserted a line above the
          // unfocused caret). Re-assert the editor's selection so the caret
          // stays anchored. A pointer focus is left to the click, and #focus()
          // already syncs the selection during an editor-driven focus.
          if (
            !this.#isContentMouseDown &&
            !this.#shouldIgnoreSelectionChange &&
            this.#selections !== undefined &&
            this.#selections.length > 0
          ) {
            this.#setWindowSelection(this.#selections.at(-1)!);
          }
        },
        { passive: true }
      ),
      addEventListener(
        contentEl,
        'blur',
        () => {
          this.#contentHasFocus = false;
        },
        { passive: true }
      ),
      addEventListener(
        contentEl,
        'pointerdown',
        (e) => {
          if (e.pointerType !== 'mouse') {
            return;
          }

          // A click on a read-only deleted line (unified view) selects it
          // natively. Hand the selection to the deleted text and drop the
          // editor's own selection, so only one region is highlighted at a
          // time and the deleted line is not swept into an editable selection.
          if (this.#isDeletedLineTarget(e)) {
            this.#setDeletedTextSelectionActive(true);
            if (this.#selections !== undefined) {
              this.#updateSelections([]);
            }
            return;
          }
          this.#setDeletedTextSelectionActive(false);

          this.#markerRenderer?.removePopup();

          // this is a workaround for the selection rendering glitch
          // happens when selecting content in shadow DOM on Safari
          if (
            isSafari() &&
            this.#lineAnnotations !== undefined &&
            this.#lineAnnotations.length > 0
          ) {
            const annotationDisposes = [
              ...contentEl.querySelectorAll<HTMLElement>(
                '[data-line-annotation]'
              ),
            ]
              .map((el) => [
                addEventListener(el, 'mouseenter', () => {
                  this.#shouldIgnoreSelectionChange = true;
                }),
                addEventListener(el, 'mouseleave', () => {
                  this.#shouldIgnoreSelectionChange = false;
                }),
              ])
              .flat();
            this.#replaceSelectEventListeners(annotationDisposes);
          }

          this.#isContentMouseDown = true;
          this.#selectionStart = undefined;
          if (e.button === 0 && isPrimaryModifier(e)) {
            this.#reservedSelections = this.#selections?.map((selection) => ({
              ...selection,
            }));
          }
          if (e.shiftKey) {
            const primarySelection = this.#selections?.at(-1);
            if (primarySelection !== undefined) {
              const pos =
                primarySelection.direction === DirectionBackward
                  ? primarySelection.end
                  : primarySelection.start;
              // fix the window selection for shift mode
              this.#setWindowSelection({
                start: pos,
                end: pos,
                direction: DirectionNone,
              });
            }
            this.#shiftKeyPressed = true;
          }
        },
        { passive: true }
      ),

      addEventListener(contentEl, 'keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          this.#searchPanel?.cleanup();
          this.#searchPanel = undefined;
          this.#retainSearchPanelFocus = false;
          this.#selectionAction?.cleanup();
          this.#selectionAction = undefined;
          if (this.#selections !== undefined && this.#selections.length > 0) {
            const primarySelection = this.#selections.at(-1)!;
            if (
              !isCollapsedSelection(primarySelection) ||
              this.#selections.length > 1
            ) {
              const pos = getCaretPosition(primarySelection);
              this.#updateSelections([
                {
                  start: pos,
                  end: pos,
                  direction: DirectionNone,
                },
              ]);
              this.#focus(pos);
            }
          }
          return;
        }
        if (!targetIsContentElement(e)) {
          return;
        }

        // handle the cursor move events manually for multiple selections and virtual viewport
        const mvShortcut = isMoveCursorShortcut(e);
        const textDocument = this.#textDocument;
        if (
          this.#selections !== undefined &&
          this.#selections.length > 0 &&
          mvShortcut !== undefined &&
          textDocument !== undefined
        ) {
          if (e.shiftKey) {
            this.#updateSelections(
              mapSelectionShift(textDocument, this.#selections, mvShortcut)
            );
          } else {
            this.#updateSelections(
              mapCursorMove(textDocument, this.#selections, mvShortcut)
            );
          }
          this.#scrollToPrimaryCaret();
          e.preventDefault();
          return;
        }

        // Handle the 'paste' event manually with the custom clipboard API.
        if (
          e.key === 'v' &&
          isPrimaryModifier(e) &&
          this.#options.clipboard !== undefined
        ) {
          e.preventDefault();
          queueRender(this.#handleCustomPasteEvent);
          return;
        }

        // Only hijack the native find-again shortcut while the panel is open
        // so cmd+g/cmd+shift+g step through matches; otherwise leave it alone.
        if (this.#searchPanel !== undefined) {
          const findAgain = resolveFindAgainShortcut(e);
          if (findAgain !== undefined) {
            e.preventDefault();
            this.#searchPanel.navigate(findAgain === 'previous');
            return;
          }
        }

        const command = resolveEditorCommandFromKeyboardEvent(e);
        if (command !== undefined) {
          e.preventDefault();
          this.#runCommand(command);
        }
      }),

      addEventListener(contentEl, 'copy', (e) => {
        if (!targetIsContentElement(e)) {
          return;
        }
        e.preventDefault();
        // A read-only deleted-text selection lives outside the editor's
        // document, so #getSelectionText() would be empty. Copy the selected
        // deleted text instead.
        e.clipboardData?.setData(
          'text',
          this.#isDeletedTextSelectionActive()
            ? this.#deletedTextForClipboard()
            : this.#getSelectionText()
        );
      }),

      addEventListener(contentEl, 'cut', (e) => {
        if (!targetIsContentElement(e)) {
          return;
        }
        e.preventDefault();
        // Deleted text is read-only and can't be removed, so a cut there copies
        // the selected deleted text (like the copy handler) without editing.
        e.clipboardData?.setData(
          'text',
          this.#isDeletedTextSelectionActive()
            ? this.#deletedTextForClipboard()
            : this.#cutSelectionText()
        );
      }),

      addEventListener(contentEl, 'paste', (e) => {
        if (!targetIsContentElement(e)) {
          return;
        }
        e.preventDefault();
        const text = e.clipboardData?.getData('text');
        const textDocument = this.#textDocument;
        if (text !== undefined && textDocument !== undefined) {
          // Rewrite clipboard line breaks to the document's EOL so a Windows
          // clipboard (\r\n or \r) doesn't leave mixed line endings behind.
          // TODO(@ije): Add support of multiple selections copy&paste
          this.#replaceSelectionText(
            textDocument.normalizeEol(text),
            undefined,
            true
          );
        }
      }),

      addEventListener(contentEl, 'beforeinput', (e) => {
        if (!targetIsContentElement(e)) {
          return;
        }
        if (e.inputType === 'insertCompositionText') {
          return;
        }
        e.preventDefault();
        this.#handleInput(e.inputType, e.data);
      }),

      addEventListener(contentEl, 'drop', (e) => {
        if (!targetIsContentElement(e)) {
          return;
        }
        e.preventDefault();
        // TODO(@ije): Add support of drag move selection
      }),

      addEventListener(
        contentEl,
        'compositionstart',
        (e) => {
          if (!targetIsContentElement(e)) {
            return;
          }
          this.#isComposing = true;
          this.#shouldIgnoreSelectionChange = true;
        },
        { passive: true }
      ),

      addEventListener(
        contentEl,
        'compositionend',
        (e) => {
          if (!targetIsContentElement(e)) {
            return;
          }
          this.#shouldIgnoreSelectionChange = false;
          const wasComposing = this.#isComposing;
          this.#isComposing = false;
          // An empty compositionend during a tracked composition means the
          // candidate was canceled (e.g. Esc), so there is nothing to commit.
          if (e.data !== '' || !wasComposing) {
            this.#handleInput('insertText', e.data);
          }
        },
        { passive: true }
      ),
    ];

    // A selection in the read-only deletions column is painted natively (see
    // the gated ::selection rule). Starting one there reveals that selection
    // and clears the editor's own selection on the additions side, so only one
    // column shows a selection at a time. Non-diff files have no deletions
    // column.
    const deletionsCode =
      this.#fileContainer?.shadowRoot?.querySelector<HTMLElement>(
        '[data-deletions]'
      );
    if (deletionsCode != null) {
      this.#editorEventDisposes.push(
        addEventListener(
          deletionsCode,
          'pointerdown',
          (e) => {
            // Clicking a deletion line's number selects the whole line's text
            // and dragging extends the selection across deletion lines (like a
            // click/drag on an addition line number); clicking its text lets
            // the browser place/extend the selection directly. Either way the
            // deleted-text marker reveals it and the editor drops its own
            // selection.
            const target = e.composedPath()[0];
            const gutterRow =
              target instanceof HTMLElement
                ? target.closest('[data-column-number]')
                : null;
            if (
              gutterRow instanceof HTMLElement &&
              this.#beginDeletionGutterSelection(
                gutterRow,
                deletionsCode,
                e.pointerType === 'mouse'
              )
            ) {
              return;
            }
            this.#setDeletedTextSelectionActive(true);
            if (this.#selections !== undefined) {
              this.#updateSelections([]);
            }
          },
          { passive: true }
        )
      );
    }

    if (gutterEl !== undefined) {
      const resolveGutterTarget = (
        eventTarget: HTMLElement | undefined,
        includeContentLine = false
      ) => {
        let target = eventTarget;
        if (target?.dataset.lineNumberContent !== undefined) {
          target = target.parentElement ?? undefined;
        } else if (includeContentLine && target?.tagName === 'SPAN') {
          target = target.closest('[data-line]') as HTMLElement | undefined;
        }
        return target;
      };

      const resolveEditableLine = (target: HTMLElement | undefined) => {
        if (target === undefined) {
          return;
        }
        const lineType = target.dataset.lineType;
        const lineNumber =
          getLineNumberAttr(target) ??
          getLineNumberAttr(target, 'columnNumber');
        if (
          lineNumber === undefined ||
          lineType === undefined ||
          !isLineEditable(lineType)
        ) {
          return;
        }
        return lineNumber - 1;
      };

      this.#editorEventDisposes.push(
        addEventListener(
          gutterEl,
          'pointerdown',
          (e) => {
            const gutterRow = resolveGutterTarget(
              e.composedPath()[0] as HTMLElement | undefined
            );
            // Clicking a read-only deleted line's number (unified view) selects
            // that line's text natively, since the line is not in the editor's
            // document. This runs before the mouse-only gate below: a deletion
            // tap registers no drag state to strand, so it works on touch too,
            // matching the split deletions column.
            if (gutterRow?.dataset.lineType === 'change-deletion') {
              const code = gutterRow.closest('[data-code]');
              if (code != null) {
                this.#beginDeletionGutterSelection(
                  gutterRow,
                  code,
                  e.pointerType === 'mouse'
                );
              }
              return;
            }

            // Editable gutter drag-selection is mouse-only: the global pointerup
            // that clears #isGutterMouseDown and disposes the mousemove listener
            // bails for non-mouse pointers, so reacting to a touch/pen tap here
            // would strand that state and leak the listener. Mirror the content
            // pointerdown guard.
            if (e.pointerType !== 'mouse') {
              return;
            }

            const textDocument = this.#textDocument;
            const lineIndex = resolveEditableLine(gutterRow);
            if (lineIndex === undefined || textDocument === undefined) {
              return;
            }

            this.#markerRenderer?.removePopup();
            const selection = this.#spanLineSelection(
              lineIndex,
              lineIndex,
              textDocument
            );
            this.#isGutterMouseDown = true;
            this.#selectionStart = selection;
            this.#updateSelections([selection]);
            // Span the native selection across the clicked line and focus
            // without collapsing it. #focus(position) would drop a collapsed
            // caret at the line end, which a later selectionchange then turns
            // into a bare caret — so a single click on a line number would
            // place a cursor instead of selecting the whole line's text.
            this.#setWindowSelection(selection);
            this.#focus();
            this.#replaceSelectEventListeners([
              addEventListener(
                document,
                'mousemove',
                (e) => {
                  if (!this.#isGutterMouseDown) {
                    return;
                  }
                  const textDocument = this.#textDocument;
                  const lineIndex = resolveEditableLine(
                    resolveGutterTarget(
                      e.composedPath()[0] as HTMLElement | undefined,
                      true
                    )
                  );
                  if (lineIndex === undefined || textDocument === undefined) {
                    return;
                  }

                  // A gutter drag keeps both the clicked line (the anchor) and
                  // the line under the pointer fully selected. Until a drag
                  // outruns its pointerdown the anchor is set; if it somehow is
                  // not, the line under the pointer becomes the anchor.
                  const anchorLine =
                    this.#selectionStart?.start.line ?? lineIndex;
                  const selection = this.#spanLineSelection(
                    anchorLine,
                    lineIndex,
                    textDocument
                  );
                  this.#selectionStart ??= selection;
                  this.#updateSelections([selection]);
                  this.#focus(
                    selection.direction === DirectionBackward
                      ? selection.start
                      : selection.end
                  );
                },
                { passive: true }
              ),
            ]);
          },
          { passive: true }
        )
      );
    }

    this.#markerRenderer?.listenHover(contentEl);

    this.#resizeObserver?.disconnect();
    this.#resizeObserver = new ResizeObserver(this.#handleLayoutResize);
    this.#resizeObserver.observe(contentEl);
    this.#resizeObserver.observe(contentEl.parentElement!);
    this.#computeContentOffset(contentEl);
  }

  #handleCustomPasteEvent = async () => {
    const clipboard = this.#options.clipboard;
    if (clipboard !== undefined) {
      const text = await clipboard.readText();
      this.#replaceSelectionText(text, undefined, true);
    }
  };

  // diff(split) treat the content element as grid item,
  // that breaks the overlay element positioning.
  // this function computes the content offset to fix
  // the overlay element position.
  #computeContentOffset(contentEl: HTMLElement) {
    if (this.#isDiff && this.#diffSyle === 'split' && this.#isWrap) {
      this.#contentOffset = {
        top: contentEl.offsetTop,
        left: contentEl.offsetLeft - this.#getGutterWidth(),
      };
      if (this.#options.__debug === true) {
        console.log('[diffs/editor] content offset:', this.#contentOffset);
      }
    }
  }

  // #computeContentOffset only assigns #contentOffset in a split + wrap diff and
  // never clears it, so after toggling wrap off (or switching to unified) the
  // same editor keeps a stale offset. Read it through this getter, which returns
  // the offset only while the live layout is the one that produced it, so a
  // stale value is never applied to caret, selection, or line-Y positions.
  get #activeContentOffset(): { left: number; top: number } | undefined {
    if (this.#isDiff && this.#diffSyle === 'split' && this.#isWrap) {
      return this.#contentOffset;
    }
    return undefined;
  }

  // TODO(@ije): add command registry
  #runCommand(command: EditorCommand) {
    const textDocument = this.#textDocument;
    if (textDocument === undefined) {
      return;
    }

    switch (command) {
      case 'openSearchPanel':
        this.#openSearchPanel('find');
        break;

      case 'openSearchReplacePanel':
        this.#openSearchPanel('replace');
        break;

      case 'findNextMatch': {
        const selections = this.#selections;
        if (selections === undefined) {
          break;
        }
        const hasCollapsed = selections.some(isCollapsedSelection);
        if (hasCollapsed) {
          const expanded: EditorSelection[] = selections.map((sel) => {
            if (isCollapsedSelection(sel)) {
              return expandCollapsedSelectionToWord(textDocument, sel);
            }
            return sel;
          });
          this.#updateSelections(expanded);
          this.focus();
        } else {
          const nextMatch = findNexMatch(textDocument, selections);
          if (nextMatch !== undefined) {
            this.#updateSelections(nextMatch);
            this.#scrollToPrimaryCaret();
          }
        }
        break;
      }

      case 'indent':
      case 'outdent':
        if (this.#selections !== undefined) {
          const edits: TextEdit[] = [];
          const nextSelections: EditorSelection[] = [];
          // Single-line indent inserts text at each caret. When several carets
          // share a line, indentation inserted by carets to their left shifts
          // them right, so record each one here and offset its resulting
          // position once every edit on the line is known. Without this, later
          // same-line carets land before their own inserted indent.
          const sameLineIndents: Array<{
            line: number;
            startCharacter: number;
            addedLength: number;
            selectionIndex: number;
          }> = [];
          for (const selection of this.#selections) {
            const startLine = selection.start.line;
            const outdent = command === 'outdent';
            if (startLine !== selection.end.line || outdent) {
              const ret = resolveIndentEdits(
                textDocument,
                selection,
                this.#metrics.tabSize,
                outdent
              );
              edits.push(...ret[0]);
              nextSelections.push(ret[1]);
            } else {
              const lineChar0 = textDocument.charAt({
                line: startLine,
                character: 0,
              });
              const text =
                lineChar0 === '\t' ? '\t' : ' '.repeat(this.#metrics.tabSize);
              edits.push({
                range: selection,
                newText: text,
              });
              sameLineIndents.push({
                line: startLine,
                startCharacter: selection.start.character,
                addedLength:
                  text.length -
                  (selection.end.character - selection.start.character),
                selectionIndex: nextSelections.length,
              });
              const nextPosition = {
                line: selection.start.line,
                character: selection.start.character + text.length,
              };
              nextSelections.push({
                start: nextPosition,
                end: nextPosition,
                direction: DirectionNone,
              });
            }
          }
          for (const indent of sameLineIndents) {
            let shift = 0;
            for (const other of sameLineIndents) {
              if (
                other.line === indent.line &&
                other.startCharacter < indent.startCharacter
              ) {
                shift += other.addedLength;
              }
            }
            if (shift !== 0) {
              const current = nextSelections[indent.selectionIndex];
              const position = {
                line: indent.line,
                character: current.start.character + shift,
              };
              nextSelections[indent.selectionIndex] = {
                start: position,
                end: position,
                direction: DirectionNone,
              };
            }
          }
          const change = textDocument.applyEdits(
            edits,
            true,
            this.#selections,
            nextSelections
          );
          if (change !== undefined) {
            this.#applyChange(change, nextSelections);
          }
        }
        break;

      case 'selectAll':
        this.#updateSelections([getDocumentFullSelection(textDocument)]);
        this.focus();
        break;

      case 'moveCursorToDocStart':
      case 'moveCursorToDocEnd':
        {
          const atEnd = command === 'moveCursorToDocEnd';
          this.#updateSelections([
            getDocumentBoundarySelection(textDocument, atEnd),
          ]);
          this.#scrollToPrimaryCaret();
        }
        break;

      case 'expandSelectionDocStart':
      case 'expandSelectionDocEnd':
        {
          const atEnd = command === 'expandSelectionDocEnd';
          const selections = this.#selections;
          if (selections !== undefined) {
            this.#updateSelections(
              extendSelections(
                selections,
                getDocumentBoundarySelection(textDocument, atEnd)
              )
            );
            this.#scrollToPrimaryCaret();
          }
        }
        break;

      case 'undo':
        if (this.#textDocument?.canUndo === true) {
          const undoResult = this.#textDocument.undo();
          if (undoResult !== undefined) {
            this.#applyChange(...undoResult);
          }
        }
        break;

      case 'redo':
        if (this.#textDocument?.canRedo === true) {
          const redoResult = this.#textDocument.redo();
          if (redoResult !== undefined) {
            this.#applyChange(...redoResult);
          }
        }
        break;
    }
  }

  #handleLayoutResize = () => {
    const lineAnnotations = this.#lineAnnotations?.length ?? 0;
    const prevGutterWidth = this.#gutterWidthCache;
    const prevContentWidth = this.#contentWidthCache;
    this.#gutterWidthCache = undefined;
    this.#contentWidthCache = undefined;
    const gutterWidthChanged = this.#getGutterWidth() !== prevGutterWidth;
    const contentWidthChanged = this.#getContentWidth() !== prevContentWidth;
    if (!gutterWidthChanged && !contentWidthChanged) {
      return;
    }

    this.#lastAccessedLineElement = undefined;
    this.#lastAccessedCharX = undefined;
    // A width change means the inherited font/metrics may have changed (e.g. a
    // web font finished loading) while this same content element survived, so
    // discard memoized non-ASCII text widths and let them re-measure.
    this.#metrics.clearTextWidthCache();
    if (contentWidthChanged && (this.#isWrap || lineAnnotations > 0)) {
      this.#lineYCache.clear();
      this.#wrapLineOffsetsCache.clear();
    }
    if (
      this.#selections !== undefined ||
      this.#matches !== undefined ||
      this.#markerRenderer !== undefined
    ) {
      this.#updateSelections(this.#selections ?? []);
      if (this.#selections !== undefined) {
        this.focus();
      }
    }
    this.#markerRenderer?.removePopup();
    this.#computeContentOffset(this.#contentElement!);
  };

  // A custom monospace web font can finish loading after the editor first
  // renders. Until then Metrics measured the '0' width against the fallback
  // font, so the gutter width and every caret/selection x-position (each
  // offset by a whole number of `ch` units) are wrong. Re-measure once fonts
  // settle and, when the width actually changed, drop the cached widths and
  // offsets and repaint the overlays so they line up with the loaded glyphs.
  // FontFaceSet is unavailable in non-browser hosts (e.g. jsdom in tests).
  #remeasureMetricsOnFontLoad(): void {
    if (this.#fontRemeasureScheduled) {
      return;
    }
    const fonts = document.fonts as FontFaceSet | undefined;
    if (fonts === undefined) {
      return;
    }
    this.#fontRemeasureScheduled = true;
    void fonts.ready.then(() => {
      if (
        this.#contentElement === undefined ||
        !this.#metrics.remeasureCharacterWidth()
      ) {
        return;
      }
      this.#gutterWidthCache = undefined;
      this.#contentWidthCache = undefined;
      this.#resetCache();
      if (
        this.#selections !== undefined ||
        this.#matches !== undefined ||
        this.#markerRenderer !== undefined
      ) {
        this.#updateSelections(this.#selections ?? []);
      }
      this.#markerRenderer?.removePopup();
    });
  }

  #rerender(
    change: TextDocumentChange,
    newLineAnnotations?: DiffLineAnnotation<LAnnotation>[],
    renderRange = this.#renderRange,
    shouldUpdateBuffer?: boolean
  ) {
    const tokenizer = this.#tokenizer;
    const fileInstance = this.#fileInstance;
    const textDocument = this.#textDocument;
    const gutterEl = this.#gutterElement;
    const contentEl = this.#contentElement;
    if (
      tokenizer === undefined ||
      fileInstance === undefined ||
      textDocument === undefined ||
      contentEl === undefined
    ) {
      return;
    }

    // cancel existing background tokenzier task
    tokenizer.stopBackgroundTokenize();

    const t = performance.now();
    const dirtyLines = tokenizer.tokenize(change, renderRange);
    const t2 = performance.now();

    if (dirtyLines.size > 0) {
      const children = contentEl.children;
      const dirtyLineIndexes = new Set<number>(dirtyLines.keys());

      // update line elements that have been changed in the document
      const startingLine = renderRange?.startingLine ?? 0;
      for (let i = change.startLine - startingLine; i < children.length; i++) {
        const child = children[i] as HTMLElement | undefined;
        if (child !== undefined) {
          const lineNumber = getLineNumberAttr(child);
          const lineType = child.dataset.lineType;
          if (lineNumber === undefined || lineType === 'change-deletion') {
            continue;
          }
          const lineIndex = lineNumber - 1;
          if (dirtyLines.has(lineIndex)) {
            const tokens = dirtyLines.get(lineIndex)!;
            child.replaceChildren(
              ...renderLineTokens(tokens, tokenizer.themeType)
            );
            dirtyLineIndexes.delete(lineIndex);
            if (dirtyLineIndexes.size === 0) {
              break;
            }
          }
        }
      }

      // create new line elements for the new lines
      if (dirtyLineIndexes.size > 0) {
        for (const lineIndex of dirtyLineIndexes) {
          const tokens = dirtyLines.get(lineIndex)!;
          const lineNumber = String(lineIndex + 1);
          h(
            'div',
            {
              dataset: {
                line: lineNumber,
                lineType: 'context',
                lineIndex: lineIndex.toString(),
              },
              // oxlint-disable-next-line react/no-children-prop
              children: renderLineTokens(tokens, tokenizer.themeType),
            },
            contentEl
          );
          if (gutterEl !== undefined) {
            h(
              'div',
              {
                dataset: {
                  lineType: 'context',
                  columnNumber: lineNumber,
                  lineIndex: lineIndex.toString(),
                },
                // oxlint-disable-next-line react/no-children-prop
                children: [
                  h('span', {
                    dataset: {
                      lineNumberContent: '',
                    },
                    textContent: lineNumber,
                  }),
                ],
              },
              gutterEl
            );
          }
        }
      }
    }

    // remove line elements that have been deleted in the document
    if (change.lineDelta < 0) {
      for (const children of [contentEl.children, gutterEl?.children ?? []]) {
        for (let i = children.length - 1; i >= 0; i--) {
          const child = children[i] as HTMLElement;
          const lineNumber =
            getLineNumberAttr(child) ??
            getLineNumberAttr(child, 'columnNumber');
          const lineType = child.dataset.lineType;
          if (lineNumber === undefined || lineType === 'change-deletion') {
            continue;
          }
          if (lineNumber - 1 < change.lineCount) {
            break;
          }
          child.remove();
        }
      }
    }

    const didLineCountChange = change.lineDelta !== 0;

    // fix grid layout
    if (didLineCountChange) {
      let gridRow = contentEl.children.length;
      for (const child of contentEl.children) {
        const { bufferSize } = (child as HTMLElement).dataset;
        if (bufferSize !== undefined) {
          gridRow += parseInt(bufferSize) - 1;
        }
      }
      contentEl.style.gridRow = 'span ' + gridRow;
      if (gutterEl !== undefined) {
        gutterEl.style.gridRow = 'span ' + gridRow;
      }
    }

    fileInstance.updateRenderCache(
      dirtyLines,
      tokenizer.themeType,
      this.#isDiff && !didLineCountChange,
      // On a line-count change we recompute hunk metadata authoritatively in
      // `applyDocumentChange` below, so skip the redundant recompute here.
      didLineCountChange
    );
    if (didLineCountChange) {
      fileInstance.applyDocumentChange(
        textDocument,
        newLineAnnotations,
        shouldUpdateBuffer
      );
    }

    if (newLineAnnotations !== undefined) {
      this.#lineAnnotations = newLineAnnotations;
      renderLineAnnotations(newLineAnnotations, contentEl, gutterEl);
    }

    if (this.#options.__debug === true) {
      console.log(
        `[diffs/editor] re-render in: ${round(performance.now() - t2)}ms,`,
        `tokenize in: ${round(t2 - t)}ms (${dirtyLines.size} dirty lines)`
      );
    }
  }

  // Whether the rendered editable rows no longer match the editor's document -
  // a row's text drifted, a row's line number is past the document (a stale row
  // left after a deletion), or a row that should exist is missing/shifted (an
  // insertion shows the following line's text). Reads the DOM rather than the
  // diff metadata so it catches rows whose cached highlight is stale even after
  // the underlying text was updated, and it only inspects the rendered rows so
  // it stays correct under virtualization.
  #shouldRenderDivergeFromDocument(
    textDocument: TextDocument<LAnnotation>
  ): boolean {
    const contentEl = this.#contentElement;
    if (contentEl === undefined) {
      return false;
    }
    for (const child of contentEl.children) {
      const el = child as HTMLElement;
      const lineType = el.dataset.lineType;
      const lineNumber = getLineNumberAttr(el);
      if (
        lineNumber === undefined ||
        lineType === undefined ||
        !isLineEditable(lineType)
      ) {
        continue;
      }
      const lineIndex = lineNumber - 1;
      if (
        lineIndex >= textDocument.lineCount ||
        el.textContent !== textDocument.getLineText(lineIndex)
      ) {
        return true;
      }
    }
    return false;
  }

  // input type doc: https://developer.mozilla.org/en-US/docs/Web/API/InputEvent/inputType
  #handleInput(inputType: string, data: string | null) {
    switch (inputType) {
      case 'insertText': {
        const text = data ?? '';
        const textDocument = this.#textDocument;
        const selections = this.#selections;
        const autoSurroundTexts =
          textDocument !== undefined && selections !== undefined
            ? getAutoSurroundReplacementTexts(
                textDocument,
                selections,
                text,
                this.#options.autoSurround
              )
            : undefined;
        this.#replaceSelectionText(autoSurroundTexts ?? text);
        break;
      }
      case 'insertCompositionText':
        break;
      case 'insertLineBreak':
      case 'insertParagraph':
        // TODO(@ije): use document.EOF instead of '\n'
        this.#replaceSelectionText('\n');
        break;
      case 'deleteContentBackward':
        this.#deleteSelectionText();
        break;
      case 'deleteContentForward':
        this.#deleteSelectionText(true);
        break;
      case 'deleteSoftLineBackward':
        this.#deleteSoftLineBackward();
        break;
      case 'deleteHardLineForward':
        // TODO(@ije): Safari and Firefox does not support this input type
        // use command instead
        this.#deleteHardLineForward();
        break;
      case 'deleteWordBackward':
        this.#deleteWordBackward();
        break;
      case 'insertTranspose':
        this.#insertTranspose();
        break;
      default:
        console.warn(`[diffs] Unknown input type: ${inputType}`, data);
        break;
    }
  }

  #focus(position?: Position, preventScroll = true) {
    // Mark focus eagerly: the positional branch defers the real focus() to a
    // rAF, so a same-tick applyEdits would otherwise see the editor as
    // unfocused and skip repositioning while this focus still lands afterward.
    this.#contentHasFocus = true;
    if (position !== undefined) {
      this.#shouldIgnoreSelectionChange = true;
      this.#setWindowSelection({
        start: position,
        end: position,
        direction: DirectionNone,
      });
      // call focus in a request animation frame to prevent conflict with
      // the `setBaseAndExtent` method
      requestAnimationFrame(() => {
        this.#contentElement?.focus({ preventScroll });
        // another request animation frame since the `focus` call
        // may trigger a selectionchange event, which we want to ignore
        requestAnimationFrame(() => {
          this.#shouldIgnoreSelectionChange = false;
        });
      });
    } else {
      this.#contentElement?.focus({ preventScroll });
    }
  }

  // set window native selection to match the selection
  #setWindowSelection(selection: EditorSelection) {
    const winSelection = window.getSelection();
    if (winSelection === null) {
      return;
    }
    let { start, end, direction } = selection;
    if (comparePosition(start, end) > 0) {
      [start, end] = [end, start];
    }
    const startLineElement = this.#getLineElement(start.line);
    const endLineElement = this.#getLineElement(end.line);
    if (startLineElement === undefined || endLineElement === undefined) {
      return;
    }
    let [anchorNode, anchorOffset] = getSelectionAnchor(
      startLineElement,
      start.character
    );
    let [focusNode, focusOffset] = getSelectionAnchor(
      endLineElement,
      end.character
    );
    if (direction === DirectionBackward) {
      [anchorNode, anchorOffset, focusNode, focusOffset] = [
        focusNode,
        focusOffset,
        anchorNode,
        anchorOffset,
      ];
    }
    try {
      winSelection.setBaseAndExtent(
        anchorNode,
        clampDomOffset(anchorNode, anchorOffset),
        focusNode,
        clampDomOffset(focusNode, focusOffset)
      );
    } catch (err) {
      console.error('[diffs/editor] failed to update window selection:', err);
    }
  }

  #scrollToPrimaryCaret(
    noFocus = false,
    scrollPosition: ScrollLogicalPosition = 'nearest'
  ) {
    const primarySelection = this.#selections?.at(-1);
    if (primarySelection === undefined) {
      return;
    }
    const primaryCaretElement = this.#primaryCaretElement;
    if (primaryCaretElement !== undefined) {
      primaryCaretElement.scrollIntoView({
        block: scrollPosition,
        inline: 'nearest',
      });
      if (!noFocus) {
        this.#focus(
          primarySelection.direction === DirectionBackward
            ? primarySelection.end
            : primarySelection.start
        );
      }
    } else {
      const pos = getCaretPosition(primarySelection);
      this.#scrollToLine(pos.line, pos.character, noFocus);
    }
  }

  // add scroll margin to the primary caret element to prevent
  // the caret from being hidden by the gutter
  #getScrollMargin() {
    const componentTop = this.#fileInstance?.top ?? 0;
    const top = this.#searchPanel !== undefined ? 48 : 0;
    const start = this.#getGutterWidth() + this.#metrics.ch;
    const end = this.#metrics.ch;
    return `${componentTop + top}px ${end}px 0 ${start}px`;
  }

  #scrollToLine(line: number, char = 0, noFocus = false) {
    this.__postponeBackgroundTokenizeToNextFrame();

    const virtualCaret = h('div', {
      style: {
        position: 'absolute',
        left: '0',
        width: '2px',
        height: this.#metrics.lineHeight + 'px',
        scrollMargin: this.#getScrollMargin(),
      },
    });
    if (this.#getLineElement(line) !== undefined) {
      const [left, wrapLine] = this.#getCharX(line, char);
      const lineY = this.#getLineY(line) + wrapLine * this.#metrics.lineHeight;
      virtualCaret.style.top = lineY + 'px';
      virtualCaret.style.left = left + 'px';
      this.#overlayElement?.appendChild(virtualCaret);
      virtualCaret.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (!noFocus) {
        this.#focus({ line, character: char });
      }
      this.#scrollingToLine = undefined;
      this.#scrollingToLineChar = undefined;
      this.#scrollingToLineNoFocus = false;
    }
    // if the line is not rendered yet(virtualized), scroll to the approximate
    // line position to trigger the line to be rendered, then recall this function
    // to ensure the line is scrolled into view
    else {
      let yFix = 0;
      if (
        this.#scrollingToLine === line &&
        this.#contentElement !== undefined
      ) {
        for (let i = this.#contentElement.childElementCount - 1; i >= 0; i--) {
          const child = this.#contentElement.children[i] as HTMLElement;
          const lineType = child.dataset.lineType;
          const lineNumber = getLineNumberAttr(child);
          if (
            lineType !== undefined &&
            isLineEditable(lineType) &&
            lineNumber !== undefined
          ) {
            yFix = (line - lineNumber) * this.#metrics.lineHeight;
            break;
          }
        }
      }
      const lineAnnotations = (this.#lineAnnotations ?? []).filter(
        (annotation) => annotation.lineNumber < line
      ).length;
      const approximateLineY =
        (lineAnnotations + line) * this.#metrics.lineHeight + yFix;
      virtualCaret.style.top = approximateLineY + 'px';
      this.#fileContainer?.shadowRoot?.appendChild(virtualCaret);
      virtualCaret.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (this.#scrollingToLine === line && yFix === 0) {
        this.#scrollingToLine = undefined;
        this.#scrollingToLineChar = undefined;
        this.#scrollingToLineNoFocus = false;
      } else {
        this.#scrollingToLine = line;
        this.#scrollingToLineChar = char;
        this.#scrollingToLineNoFocus = noFocus;
      }
    }
    virtualCaret.remove();
  }

  // Build a selection that fully covers every line from the anchor line to the
  // focus line — from the topmost line's start to the bottommost line's end.
  // Dragging above the anchor yields a backward selection so the anchor line
  // stays selected and #focus lands on the line the gesture ended on. A single
  // line (anchor === focus) is a forward whole-line selection.
  #spanLineSelection(
    anchorLine: number,
    focusLine: number,
    textDocument: TextDocument<LAnnotation>
  ): EditorSelection {
    const lineStart = (line: number): Position => ({ line, character: 0 });
    const lineEnd = (line: number): Position => ({
      line,
      character: textDocument.getLineText(line).length,
    });
    if (focusLine < anchorLine) {
      return {
        start: lineStart(focusLine),
        end: lineEnd(anchorLine),
        direction: DirectionBackward,
      };
    }
    return {
      start: lineStart(anchorLine),
      end: lineEnd(focusLine),
      direction: DirectionForward,
    };
  }

  // A pointer gesture targets read-only deleted text when its closest row is a
  // change-deletion. Used to route a click in unified view's deleted text to a
  // native selection instead of the editor's own.
  #isDeletedLineTarget(event: Event): boolean {
    const target = event.composedPath()[0];
    return (
      target instanceof HTMLElement &&
      target.closest('[data-line]')?.getAttribute('data-line-type') ===
        'change-deletion'
    );
  }

  // Select read-only deleted text with the native selection, spanning from the
  // anchor row to the focus row (the same row for a click). Deleted lines are
  // not part of the editor's document, so they cannot be selected as editor
  // text; instead select their DOM text, reveal it via the deleted-text marker,
  // drop the editor's own selection, and highlight the deleted gutter numbers so
  // the result matches a click/drag on an addition line.
  #selectDeletedLines(
    anchorContent: HTMLElement,
    focusContent: HTMLElement,
    deletionsCode: Element
  ): void {
    const rows = [
      ...deletionsCode.querySelectorAll('[data-content] > [data-line]'),
    ];
    const anchorIndex = rows.indexOf(anchorContent);
    const focusIndex = rows.indexOf(focusContent);
    const [topContent, bottomContent] =
      focusIndex < anchorIndex
        ? [focusContent, anchorContent]
        : [anchorContent, focusContent];

    const winSelection = window.getSelection();
    if (winSelection !== null) {
      const range = document.createRange();
      range.setStart(topContent, 0);
      range.setEnd(bottomContent, bottomContent.childNodes.length);
      winSelection.removeAllRanges();
      winSelection.addRange(range);
    }

    this.#setDeletedTextSelectionActive(true);
    this.#updateSelections([]);

    // Highlight only the focus line's gutter number — the line where the click
    // landed or the drag ended. An addition selection highlights just its caret
    // line (getCaretPosition is the focus end), so matching that keeps the two
    // sides consistent. #setDeletedTextSelectionActive cleared the previous
    // selection's number above, so set this one's directly on the gutter row
    // that lines up with the focus content row.
    const gutterRows = [
      ...deletionsCode.querySelectorAll('[data-gutter] > [data-column-number]'),
    ];
    gutterRows[focusIndex]?.setAttribute('data-selected-line', 'single');

    // Record the selected deleted lines' text for the clipboard. Each deleted
    // line is its own read-only host, so window.getSelection().toString() only
    // captures the first line; the copy/cut handlers prefer this value.
    const lo = Math.min(anchorIndex, focusIndex);
    const hi = Math.max(anchorIndex, focusIndex);
    this.#deletedSelectionText =
      lo < 0
        ? ''
        : rows
            .slice(lo, hi + 1)
            .filter(
              (row) => row.getAttribute('data-line-type') === 'change-deletion'
            )
            .map((row) => row.textContent ?? '')
            .join('\n');
  }

  // The content row that lines up with a gutter row: the two columns are
  // parallel, so the gutter row's index is the content row's index.
  #contentRowForGutterRow(
    gutterRow: HTMLElement,
    contentColumn: Element | null | undefined
  ): HTMLElement | undefined {
    const gutterColumn = gutterRow.parentElement;
    if (gutterColumn == null || contentColumn == null) {
      return undefined;
    }
    const index = [...gutterColumn.children].indexOf(gutterRow);
    const row = contentColumn.children[index];
    return row instanceof HTMLElement ? row : undefined;
  }

  // Begin a native selection of read-only deleted lines from a pointerdown on a
  // deletion line number. Selects the clicked line and, for a mouse pointer,
  // tracks a drag across the deletion gutter that extends the selection — the
  // same gesture as a click/drag on an addition line number. `code` is the
  // [data-code] holding the deletion column: the separate deletions column in
  // split view, or the shared column in unified view. Returns false when the
  // gutter row has no matching content row, letting the caller fall back to a
  // plain deleted-text selection.
  #beginDeletionGutterSelection(
    gutterRow: HTMLElement,
    code: Element,
    isMouse: boolean
  ): boolean {
    const contentColumn = code.querySelector('[data-content]');
    const anchorContent = this.#contentRowForGutterRow(
      gutterRow,
      contentColumn
    );
    if (anchorContent === undefined) {
      return false;
    }
    this.#selectDeletedLines(anchorContent, anchorContent, code);
    // The document pointerup disposes this listener; it must not set
    // #isGutterMouseDown, whose pointerup focuses the editor and would collapse
    // the native deletion selection.
    if (isMouse) {
      this.#replaceSelectEventListeners([
        addEventListener(
          document,
          'mousemove',
          (moveEvent) => {
            const moveTarget = moveEvent.composedPath()[0];
            const moveGutter =
              moveTarget instanceof HTMLElement
                ? moveTarget.closest('[data-column-number]')
                : null;
            if (
              moveGutter instanceof HTMLElement &&
              code.contains(moveGutter)
            ) {
              const focusContent = this.#contentRowForGutterRow(
                moveGutter,
                contentColumn
              );
              if (focusContent !== undefined) {
                this.#selectDeletedLines(anchorContent, focusContent, code);
              }
            }
          },
          { passive: true }
        ),
      ]);
    }
    return true;
  }

  // Whether a read-only deleted-text selection is currently active (the marker
  // #setDeletedTextSelectionActive sets). The copy/cut handlers read this to
  // copy the native selection instead of the editor's empty document selection.
  #isDeletedTextSelectionActive(): boolean {
    return (
      this.#fileContainer?.shadowRoot
        ?.querySelector('pre')
        ?.hasAttribute('data-deleted-text-selection') ?? false
    );
  }

  // The clipboard text for a read-only deleted-text selection. A gutter
  // selection records the full multi-line text in #deletedSelectionText; a
  // direct content drag leaves it empty, so fall back to the browser's native
  // selection (which spans only the first deleted line — its separate host).
  #deletedTextForClipboard(): string {
    return this.#deletedSelectionText !== ''
      ? this.#deletedSelectionText
      : (window.getSelection()?.toString() ?? '');
  }

  // Toggle the marker that reveals the native selection inside read-only
  // deleted text (see the gated ::selection rule). It stays on only while the
  // user is actively selecting within deleted lines, so a normal selection of
  // editable code that sweeps across an interleaved deleted line does not
  // highlight it.
  #setDeletedTextSelectionActive(active: boolean): void {
    const pre = this.#fileContainer?.shadowRoot?.querySelector('pre');
    if (pre == null) {
      return;
    }
    if (active) {
      pre.setAttribute('data-deleted-text-selection', '');
      // Drop any line-number highlight left over from a previous selection.
      // #selectDeletedLines marks the deleted gutter numbers directly, and the
      // editor only clears them when its own selection range changes — but
      // deletion selections leave that range null, so a second deletion click
      // would otherwise keep the first selection's numbers highlighted.
      for (const highlighted of pre.querySelectorAll('[data-selected-line]')) {
        highlighted.removeAttribute('data-selected-line');
      }
      // Reset the captured selection text. #selectDeletedLines refills it for a
      // gutter selection; a content drag leaves it empty so the copy/cut
      // handlers fall back to the native selection.
      this.#deletedSelectionText = '';
    } else {
      pre.removeAttribute('data-deleted-text-selection');
      this.#deletedSelectionText = '';
    }
  }

  #setSelectedLinesSafe(
    range: { start: number; end: number } | null,
    lineNumberOnly = false
  ): void {
    try {
      // notify: false renders the active-line highlight without firing the
      // host's onLineSelected callback. A caret or text selection in the editor
      // is not a gutter line selection, so it must not publish one.
      //
      // activeLineSide keeps the highlight on the additions pane, the side the
      // editor edits. Without it a split diff also highlights the matching
      // read-only deletions row on the left.
      //
      // lineNumberOnly marks just the caret line's gutter number while text is
      // selected, so the line keeps its highlighted number but drops the
      // full-line background in favor of the text selection.
      this.#fileInstance?.setSelectedLines(range, {
        notify: false,
        activeLineSide: 'additions',
        lineNumberOnly,
      });
    } catch {
      // InteractionManager.renderSelection can throw while editor DOM is updating.
    }
  }

  #updateSelections(selections: EditorSelection[]) {
    this.__postponeBackgroundTokenizeToNextFrame();

    this.#primaryCaretElement = undefined;
    this.#setSelectedLinesSafe(null);

    if (
      selections.length === 0 &&
      this.#matches === undefined &&
      this.#markerRenderer === undefined
    ) {
      this.#selections = undefined;
      this.#overlayElements?.forEach((el) => el.remove());
      this.#overlayElements?.clear();
      this.#selectionAction?.cleanup();
      this.#selectionAction = undefined;
      return;
    }

    const fragment = document.createDocumentFragment();
    const renderCtx = {
      fragment,
      elements: new Map<string, HTMLElement>(),
    };

    if (selections.length > 0) {
      const normalizedSelections = mergeOverlappingSelections(selections);
      const primarySelection = normalizedSelections.at(-1)!;
      this.#selections = normalizedSelections;
      // The caret line always keeps its highlighted gutter number. With a bare
      // caret it also gets the full-line background; once any selection spans
      // text, the background is dropped (lineNumberOnly) so the text selection
      // is the only line-level highlight.
      const hasNonEmptySelection = normalizedSelections.some(
        (selection) => !isCollapsedSelection(selection)
      );
      const caretLine = getCaretPosition(primarySelection).line + 1;
      this.#setSelectedLinesSafe(
        { start: caretLine, end: caretLine },
        hasNonEmptySelection
      );

      for (const selection of normalizedSelections) {
        if (!isCollapsedSelection(selection)) {
          this.#renderSelection(renderCtx, 'selection', selection);
        }
        this.#renderCaret(renderCtx, selection, selection === primarySelection);
      }
    }

    const textDocument = this.#textDocument;
    if (this.#matches !== undefined && textDocument !== undefined) {
      const primarySelection = this.#selections?.at(-1);
      const primaryStartOffset =
        primarySelection !== undefined
          ? textDocument.offsetAt(primarySelection.start)
          : -1;
      const primaryEndOffset =
        primarySelection !== undefined
          ? textDocument.offsetAt(primarySelection.end)
          : -1;
      for (const [startOffset, endOffset] of this.#matches) {
        const range: Range = {
          start: textDocument.positionAt(startOffset),
          end: textDocument.positionAt(endOffset),
        };
        const isFocused =
          primaryStartOffset === startOffset && primaryEndOffset === endOffset;
        this.#renderSelection(
          renderCtx,
          'match',
          range,
          isFocused ? 'focus' : undefined
        );
      }
    }

    if (this.#markerRenderer !== undefined && textDocument !== undefined) {
      for (const marker of this.#markerRenderer.markers) {
        this.#renderSelection(
          renderCtx,
          'marker',
          marker,
          markerSeverityDatasetKey(marker.severity)
        );
      }
    }

    this.#overlayElement?.appendChild(fragment);
    this.#overlayElements?.forEach((el) => el.remove());
    this.#overlayElements?.clear();
    this.#overlayElements = renderCtx.elements;

    this.#updateSelectionActionPopover();
  }

  #renderSelection(
    renderCtx: {
      fragment: DocumentFragment;
      elements: Map<string, HTMLElement>;
    },
    type: 'selection' | 'match' | 'marker',
    range: Range,
    extraDataset?: string
  ) {
    if (this.#textDocument === undefined) {
      return;
    }

    const { start, end } = range;
    for (let line = start.line; line <= end.line; line++) {
      if (!this.#isLineVisible(line)) {
        continue;
      }

      const isLastLine = line === end.line;
      const lineText = this.#textDocument.getLineText(line);
      const startChar = line === start.line ? start.character : 0;
      const endChar = isLastLine ? end.character : lineText.length;

      if (this.#isWrap) {
        const contentWidth = this.#getContentWidth();
        const textWidth =
          2 * this.#metrics.ch + this.#metrics.measureTextWidth(lineText);
        if (textWidth > contentWidth) {
          this.#renderWrappedSelection(
            renderCtx,
            line,
            lineText,
            startChar,
            endChar,
            isLastLine,
            type,
            extraDataset
          );
          continue;
        }
      }

      let left = 0;
      let width = 0;
      let paddingEnd = 0;
      if (startChar === 0) {
        // gutter width + inline padding (1ch), plus the split-diff content
        // offset so a column-0 selection lines up with the content panel the
        // same way #getCharX (used for startChar > 0 and the caret) does.
        left =
          this.#getGutterWidth() +
          this.#metrics.ch +
          (this.#activeContentOffset?.left ?? 0);
      } else {
        left = this.#getCharX(line, startChar)[0];
      }
      if (!isLastLine && type === 'selection') {
        paddingEnd = this.#metrics.ch;
      }
      if (startChar === endChar) {
        width = paddingEnd;
      } else {
        width = this.#getCharX(line, endChar)[0] - left + paddingEnd;
      }
      this.#renderSelectionBlock(
        renderCtx,
        type,
        line,
        0,
        left,
        width,
        extraDataset
      );
    }
  }

  // Render the selection on a wrapped logical line by splitting it into one
  // selection-range div per visual sub-line. For each wrap segment, we compute
  // the intersection with the line's selection range and render the slice in
  // segment-local coordinates so left/width line up with the visually wrapped
  // text. Zero-width slices that fall on intermediate segment boundaries are
  // skipped to avoid duplicate markers across consecutive visual lines.
  #renderWrappedSelection(
    renderCtx: {
      fragment: DocumentFragment;
      elements: Map<string, HTMLElement>;
    },
    line: number,
    lineText: string,
    startChar: number,
    endChar: number,
    isLastLine: boolean,
    type: 'selection' | 'match' | 'marker',
    extraDataset?: string
  ) {
    const wrapOffsets = this.#wrapLineText(line);
    const segmentCount = wrapOffsets.length - 1;
    // offsetLeft is the x of the content's left edge in overlay coordinates.
    // In a split diff with wrapping the content element is a grid item shifted
    // right of the deletion panel, so the same content offset that #getCharX
    // adds for the caret must be included here too; otherwise every wrapped
    // selection block is pulled left by the panel offset.
    const offsetLeft =
      this.#getGutterWidth() +
      this.#metrics.ch +
      (this.#activeContentOffset?.left ?? 0);

    for (let wrapLine = 0; wrapLine < segmentCount; wrapLine++) {
      const segmentStart = wrapOffsets[wrapLine];
      const segmentEnd = wrapOffsets[wrapLine + 1];
      const wrapStartChar = Math.max(startChar, segmentStart);
      const wrapEndChar = Math.min(endChar, segmentEnd);

      // Selection range doesn't reach this visual segment.
      if (wrapStartChar > wrapEndChar) {
        continue;
      }

      const segmentStartWidth = this.#segmentTextWidth(
        lineText,
        segmentStart,
        wrapStartChar
      );
      const segmentLeft = offsetLeft + segmentStartWidth;
      let paddingEnd = 0;
      if (
        !isLastLine &&
        wrapLine === segmentCount - 1 &&
        type === 'selection'
      ) {
        paddingEnd = this.#metrics.ch;
      }
      // Measure the selection width as the gap between two segment-relative
      // offsets so a tab inside the selection advances from its real column,
      // not from the start of the sliced selection text.
      const segmentWidth =
        wrapStartChar === wrapEndChar
          ? paddingEnd
          : this.#segmentTextWidth(lineText, segmentStart, wrapEndChar) -
            segmentStartWidth +
            paddingEnd;

      this.#renderSelectionBlock(
        renderCtx,
        type,
        line,
        wrapLine,
        segmentLeft,
        segmentWidth,
        extraDataset
      );
    }
  }

  // Pixel width of the text from a wrapped segment's start up to a character,
  // relative to the segment's left edge. Tabs advance from the segment start,
  // which sits on a tab stop, so tab stops line up with the rendered text.
  #segmentTextWidth(
    lineText: string,
    segmentStart: number,
    character: number
  ): number {
    if (character <= segmentStart) {
      return 0;
    }
    const segmentText = lineText.slice(segmentStart, character);
    const asciiColumns = getExpandedAsciiTextColumns(
      segmentText,
      this.#metrics.tabSize
    );
    return asciiColumns !== -1
      ? asciiColumns * this.#metrics.ch
      : this.#metrics.measureTextWidth(segmentText);
  }

  // Render one selection block for a single visual line.
  #renderSelectionBlock(
    renderCtx: {
      fragment: DocumentFragment;
      elements: Map<string, HTMLElement>;
      previousSelectionRange?: {
        element: HTMLElement;
        line: number;
        wrapLine: number;
        left: number;
        width: number;
      };
    },
    type: 'selection' | 'match' | 'marker',
    line: number,
    wrapLine: number,
    left: number,
    width: number,
    extraDataset?: string
  ) {
    if (width === 0) {
      return;
    }

    const { ch, lineHeight } = this.#metrics;
    const y = this.#getLineY(line) + wrapLine * lineHeight;
    const cacheKey = `${type}-${line}/${wrapLine}-${left}-${width} ${extraDataset ?? ''}`;
    const overlayEls = this.#overlayElements;
    const rounded =
      (this.#options.roundedSelection ?? true) && type === 'selection';

    const addRoundedCorner = (
      line: number,
      wrapLine: number,
      left: number,
      radius: 'rtl' | 'rbl' | 'rbr'
    ) => {
      const top = this.#getLineY(line) + wrapLine * lineHeight;
      const css = `width:${ch}px;transform:translateX(${left}px) translateY(${top}px);`;
      const dataset = {
        selectionCorner: '',
        [radius]: '',
      };
      const cacheKeyPrefix = `${type}-block-${line}/${wrapLine}-${left}-1ch`;
      let cacheKey = cacheKeyPrefix + '-' + radius;
      if (radius === 'rbl') {
        const prevCornerKey = cacheKeyPrefix + '-rtl';
        const prevCorner = renderCtx.elements.get(prevCornerKey);
        if (prevCorner !== undefined) {
          prevCorner.remove();
          renderCtx.elements.delete(prevCornerKey);
          cacheKey += '-rtl';
          dataset.rtl = '';
        }
      }
      let cornerEl = renderCtx.elements.get(cacheKey);
      if (cornerEl !== undefined) {
        return;
      }
      if (overlayEls?.has(cacheKey) === true) {
        cornerEl = overlayEls.get(cacheKey)!;
        cornerEl.style.cssText = css;
        overlayEls.delete(cacheKey);
      } else {
        cornerEl = h(
          'div',
          {
            dataset: 'selectionRange',
            style: { cssText: css },
            children: [
              h('div', {
                dataset: dataset,
              }),
            ],
          },
          renderCtx.fragment
        );
      }
      renderCtx.elements.set(cacheKey, cornerEl);
    };
    const addRadiusStyle = (element: HTMLElement) => {
      const end = left + width;
      const dataset = element.dataset;
      const previousSelectionRange = renderCtx.previousSelectionRange;
      if (
        previousSelectionRange === undefined ||
        previousSelectionRange.line !== line ||
        previousSelectionRange.wrapLine !== wrapLine
      ) {
        renderCtx.previousSelectionRange = {
          element,
          line,
          wrapLine,
          left,
          width,
        };
      }
      if (
        previousSelectionRange === undefined ||
        end <= previousSelectionRange.left
      ) {
        ['rtl', 'rtr', 'rbl', 'rbr'].forEach((key) => {
          dataset[key] = '';
        });
      } else {
        const prevLine = previousSelectionRange.line;
        const prevWrapLine = previousSelectionRange.wrapLine;
        const prevLeft = previousSelectionRange.left;
        const prevDataset = previousSelectionRange.element.dataset;
        const prevEnd = prevLeft + previousSelectionRange.width;
        if (prevLeft > left) {
          addRoundedCorner(prevLine, prevWrapLine, prevLeft - ch, 'rbr');
        }
        delete prevDataset.rbl;
        delete dataset.rtl;
        delete dataset.rtr;
        if (end >= prevEnd) {
          delete prevDataset.rbr;
        }
        if (end > prevEnd) {
          addRoundedCorner(prevLine, prevWrapLine, prevEnd, 'rbl');
          dataset.rtr = '';
        }
        if (end < prevEnd) {
          addRoundedCorner(line, wrapLine, end, 'rtl');
        }
        if (left < prevLeft) {
          dataset.rtl = '';
        }
        dataset.rbl = '';
        dataset.rbr = '';
      }
    };

    let rangeEl = renderCtx.elements.get(cacheKey);
    if (rangeEl !== undefined) {
      if (rounded) {
        addRadiusStyle(rangeEl);
      }
      return;
    }

    if (overlayEls?.has(cacheKey) === true) {
      rangeEl = overlayEls.get(cacheKey)!;
      overlayEls.delete(cacheKey);
    } else {
      rangeEl = h(
        'div',
        {
          dataset: extraDataset
            ? [type + 'Range', extraDataset]
            : type + 'Range',
        },
        renderCtx.fragment
      );
    }

    rangeEl.style.width = `${width}px`;
    rangeEl.style.transform = `translateX(${left}px) translateY(${y}px)`;
    if (rounded) {
      addRadiusStyle(rangeEl);
    }
    renderCtx.elements.set(cacheKey, rangeEl);
  }

  #renderCaret(
    renderCtx: {
      fragment: DocumentFragment;
      elements: Map<string, HTMLElement>;
    },
    selection: EditorSelection,
    isPrimary: boolean
  ) {
    const { line, character } = getCaretPosition(selection);
    if (!this.#isLineVisible(line)) {
      return;
    }
    const [left, wrapLine] = this.#getCharX(line, character);
    const cacheKey = 'caret-' + line + '/' + wrapLine + ':' + character;
    if (renderCtx.elements.has(cacheKey)) {
      return;
    }

    const x = left - 1;
    const y = this.#getLineY(line) + wrapLine * this.#metrics.lineHeight;

    let caretEl: HTMLElement;
    if (this.#overlayElements?.has(cacheKey) === true) {
      caretEl = this.#overlayElements.get(cacheKey)!;
      this.#overlayElements.delete(cacheKey);
    } else {
      caretEl = h(
        'div',
        {
          dataset: 'caret',
        },
        renderCtx.fragment
      );
    }
    caretEl.style.transform = `translateX(${x}px) translateY(${y}px)`;
    renderCtx.elements.set(cacheKey, caretEl);
    if (isPrimary) {
      caretEl.style.scrollMargin = this.#getScrollMargin();
      this.#primaryCaretElement = caretEl;
    }
  }

  // Keeps the floating selection-action popover in sync with the current
  // selection. Called at the end of every overlay render so the popover appears
  // as soon as a ranged selection settles, follows it while it stays open, and
  // tears down when the selection collapses, the option is off, or the anchor
  // line scrolls out of view. Creation is suppressed while the mouse is down so
  // the popover doesn't flicker under the cursor mid-drag; the pointerup handler
  // re-runs this once the drag ends.
  #updateSelectionActionPopover(): void {
    const primarySelection = this.#selections?.at(-1);
    const overlayElement = this.#overlayElement;
    const textDocument = this.#textDocument;
    const renderSelectionAction = this.#options.renderSelectionAction;
    if (
      this.#options.enabledSelectionAction !== true ||
      renderSelectionAction === undefined ||
      primarySelection === undefined ||
      isCollapsedSelection(primarySelection) ||
      this.#isContentMouseDown ||
      overlayElement === undefined ||
      textDocument === undefined
    ) {
      this.#selectionAction?.cleanup();
      this.#selectionAction = undefined;
      return;
    }

    const head = getCaretPosition(primarySelection);
    if (!this.#isLineVisible(head.line)) {
      this.#selectionAction?.cleanup();
      this.#selectionAction = undefined;
      return;
    }

    if (this.#selectionAction === undefined) {
      // The popover element is reused while a selection stays open, so its
      // action handlers read the live primary selection rather than the
      // snapshot taken at creation time (extending the selection by keyboard
      // would otherwise leave them acting on the original range). A fresh drag
      // tears the popover down (see #isContentMouseDown above) and pointerup
      // recreates it, so the reuse only spans keyboard-driven selection changes.
      const getActiveSelection = (): EditorSelection =>
        this.#selections?.at(-1) ?? primarySelection;
      const selectionActionElement = renderSelectionAction({
        textDocument,
        // Live getter so consumers reading `selection` always see the current
        // range, matching getSelectionText/replaceSelectionText below.
        get selection(): EditorSelection {
          return getActiveSelection();
        },
        applyEdits: (edits: TextEdit[]) => this.applyEdits(edits, true),
        getSelectionText: () =>
          this.#textDocument?.getText(getActiveSelection()) ?? '',
        replaceSelectionText: (text: string) => {
          this.#replaceSelectionText(text, [getActiveSelection()]);
        },
        close: () => {
          this.#selectionAction?.cleanup();
          this.#selectionAction = undefined;
          this.#scrollToPrimaryCaret();
        },
      });
      this.#selectionAction = new SelectionActionWidget(
        head.line,
        selectionActionElement,
        overlayElement
      );
    }

    // Anchor just below the selection's head line, mirroring the marker hover
    // popover's geometry.
    const [left, wrapLine] = this.#getCharX(head.line, head.character);
    const lineHeight = this.#metrics.lineHeight;
    const top = this.#getLineY(head.line) + wrapLine * lineHeight + lineHeight;
    this.#selectionAction.line = head.line;
    this.#selectionAction.reposition(left, top, this.#getGutterWidth());
  }

  // Opens the search panel in the requested mode. If a panel is already open,
  // it switches that panel's mode in place (preserving the current query)
  // rather than recreating it.
  #openSearchPanel(mode: SearchPanelMode) {
    if (this.#searchPanel !== undefined) {
      this.#searchPanel.setMode(mode);
      return;
    }
    this.#renderSearchPanel(mode);
  }

  // TODO(@ije): render search highlight
  #renderSearchPanel(mode: SearchPanelMode) {
    // cleanup the existing search panel
    this.#searchPanel?.cleanup();

    const textDocument = this.#textDocument;
    const preElement =
      this.#fileContainer?.shadowRoot?.querySelector<HTMLElement>('pre');
    const selections = this.#selections;
    if (textDocument === undefined || preElement == null) {
      return;
    }

    let defaultQuery = '';
    let initialMatch: [number, number] | undefined = undefined;

    if (selections !== undefined && selections.length > 0) {
      let primarySelection = selections.at(-1)!;
      if (isCollapsedSelection(primarySelection)) {
        primarySelection = expandCollapsedSelectionToWord(
          textDocument,
          primarySelection
        );
        this.#updateSelections([...selections.slice(0, -1), primarySelection]);
        const selectionText = textDocument.getText(primarySelection);
        if (selectionText !== '' && !selectionText.includes('\n')) {
          defaultQuery = selectionText;
          initialMatch = [
            textDocument.offsetAt(primarySelection.start),
            textDocument.offsetAt(primarySelection.end),
          ];
        }
      }
    }

    const scrollToMatch = (
      [startOffset, endOffset]: MatchRange,
      retainFocus: boolean
    ) => {
      const nextSelection = createSelectionFromAnchorAndFocusOffsets(
        textDocument,
        startOffset,
        endOffset
      );
      this.#updateSelections([nextSelection]);
      this.#scrollToPrimaryCaret(true); // scroll to the primary caret and don't focus
      this.#retainSearchPanelFocus = retainFocus;
    };

    const searchPanel = new SearchPanelWidget({
      textDocument,
      containerElement: preElement,
      defaultQuery,
      mode,
      initialMatch,
      scrollToMatch,
      applyReplace: (edits: ResolvedTextEdit[]) => {
        if (edits.length === 0) {
          return;
        }
        const change = textDocument.applyEdits(
          edits.map((edit) => ({
            range: {
              start: textDocument.positionAt(edit.start),
              end: textDocument.positionAt(edit.end),
            },
            newText: edit.text,
          })),
          true,
          this.#selections
        );
        if (change !== undefined) {
          this.#applyChange(
            change,
            undefined,
            this.#applyChangeToLineAnnotations(change),
            { skipSearchRefresh: true }
          );
        }
      },
      onUpdate: (
        allMatches: MatchRange[],
        options?: { syncSelection?: boolean }
      ): MatchRange | undefined => {
        if (allMatches.length === 0) {
          this.#matches = undefined;
          this.#updateSelections(this.#selections ?? []);
          return;
        }

        this.#matches = allMatches;
        if (options?.syncSelection === false) {
          this.#updateSelections(this.#selections ?? []);
          const primarySelection = this.#selections?.at(-1);
          if (primarySelection !== undefined) {
            const startOffset = textDocument.offsetAt(primarySelection.start);
            const endOffset = textDocument.offsetAt(primarySelection.end);
            for (const match of allMatches) {
              if (match[0] === startOffset && match[1] === endOffset) {
                return match;
              }
            }
          }
          return undefined;
        }

        const primarySelection = this.#selections?.at(-1);
        let searchOffset = 0;
        let nextMatch: MatchRange | undefined;
        if (primarySelection !== undefined) {
          searchOffset = textDocument.offsetAt(primarySelection.start);
        }
        for (const m of allMatches) {
          if (m[0] >= searchOffset) {
            nextMatch = m;
            break;
          }
        }
        if (nextMatch !== undefined) {
          scrollToMatch(nextMatch, true);
        } else {
          this.#updateSelections(this.#selections ?? []);
        }
        return nextMatch;
      },
      onClose: () => {
        this.#searchPanel = undefined;
        this.#retainSearchPanelFocus = false;
        this.#matches = undefined;
        this.#updateSelections(this.#selections ?? []);
      },
    });

    this.#searchPanel = searchPanel;
    this.#retainSearchPanelFocus = false;
  }

  #getSelectionText() {
    const textDocument = this.#textDocument;
    const selections = this.#selections;
    if (textDocument === undefined || selections === undefined) {
      return '';
    }
    return getSelectionText(textDocument, selections);
  }

  #cutSelectionText(): string {
    const textDocument = this.#textDocument;
    const selections = this.#selections;
    if (
      textDocument === undefined ||
      selections === undefined ||
      selections.length === 0
    ) {
      return '';
    }

    if (selections.some((selection) => isCollapsedSelection(selection))) {
      const cut = resolveSelectionCut(textDocument, selections);
      this.#applySelectionCutEdits(cut.edits, cut.nextSelectionOffsets);
      return cut.text;
    }

    const text = getSelectionText(textDocument, selections);
    this.#replaceSelectionText('', undefined, true);
    return text;
  }

  #applySelectionCutEdits(
    edits: ResolvedTextEdit[],
    nextSelectionOffsets: number[]
  ): void {
    const textDocument = this.#textDocument;
    const selections = this.#selections;
    if (
      textDocument === undefined ||
      selections === undefined ||
      edits.length === 0
    ) {
      return;
    }

    const change = textDocument.applyResolvedEdits(
      edits,
      true,
      selections,
      undefined,
      true
    );
    if (change === undefined) {
      return;
    }

    const nextSelections = nextSelectionOffsets.map<EditorSelection>(
      (offset) => {
        const caret = textDocument.positionAt(offset);
        return {
          start: caret,
          end: caret,
          direction: DirectionNone,
        };
      }
    );
    textDocument.setLastUndoSelectionsAfter(nextSelections);
    this.#applyChange(
      change,
      nextSelections,
      this.#applyChangeToLineAnnotations(change)
    );
  }

  // replace the selection text
  #replaceSelectionText(
    text: string | string[],
    selections = this.#selections,
    undoBoundary = false
  ) {
    if (selections === undefined) {
      return;
    }
    const textDocument = this.#textDocument;
    const primarySelection = selections.at(-1);
    if (textDocument === undefined || primarySelection === undefined) {
      return;
    }
    const { nextSelections, change } =
      Array.isArray(text) && text.length === selections.length
        ? applyTextReplaceToSelections<LAnnotation>(
            textDocument,
            selections,
            text,
            this.#lineAnnotations,
            undoBoundary
          )
        : applyTextChangeToSelections<LAnnotation>(
            textDocument,
            selections,
            {
              start: textDocument.offsetAt(primarySelection.start),
              end: textDocument.offsetAt(primarySelection.end),
              text: Array.isArray(text) ? text.join('\n') : text,
            },
            this.#lineAnnotations,
            undefined,
            undoBoundary
          );

    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change)
      );
    }
  }

  #deleteSelectionText(forward: boolean = false) {
    const selections = this.#selections;
    const textDocument = this.#textDocument;
    if (selections === undefined || textDocument === undefined) {
      return;
    }

    const { nextSelections, change } =
      applyDeleteCharacterToSelections<LAnnotation>(
        textDocument,
        selections,
        forward,
        this.#lineAnnotations,
        this.#metrics.tabSize
      );
    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change)
      );
    }
  }

  #deleteSoftLineBackward() {
    const selections = this.#selections;
    const textDocument = this.#textDocument;
    if (selections === undefined || textDocument === undefined) {
      return;
    }
    const getSoftLineStart = this.#isWrap
      ? (line: number, character: number) => {
          const wrapOffsets = this.#wrapLineText(line);
          for (let w = 0; w + 1 < wrapOffsets.length; w++) {
            const segmentStart = wrapOffsets[w];
            const segmentEnd = wrapOffsets[w + 1];
            if (character >= segmentStart && character <= segmentEnd) {
              return segmentStart;
            }
          }
          return 0;
        }
      : undefined;
    const { nextSelections, change } =
      applyDeleteSoftLineBackwardToSelections<LAnnotation>(
        textDocument,
        selections,
        getSoftLineStart,
        this.#lineAnnotations
      );
    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change)
      );
    }
  }

  #deleteWordBackward() {
    const selections = this.#selections;
    const textDocument = this.#textDocument;
    if (selections === undefined || textDocument === undefined) {
      return;
    }
    const { nextSelections, change } =
      applyDeleteWordBackwardToSelections<LAnnotation>(
        textDocument,
        selections,
        this.#lineAnnotations
      );
    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change)
      );
    }
  }

  #deleteHardLineForward() {
    const selections = this.#selections;
    const textDocument = this.#textDocument;
    if (selections === undefined || textDocument === undefined) {
      return;
    }
    const { nextSelections, change } =
      applyDeleteHardLineForwardToSelections<LAnnotation>(
        textDocument,
        selections,
        this.#lineAnnotations
      );
    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change)
      );
    }
  }

  #insertTranspose() {
    const selections = this.#selections;
    const textDocument = this.#textDocument;
    if (selections === undefined || textDocument === undefined) {
      return;
    }
    const { nextSelections, change } = applyTransposeToSelections<LAnnotation>(
      textDocument,
      selections,
      this.#lineAnnotations
    );
    if (change !== undefined) {
      this.#applyChange(
        change,
        nextSelections,
        this.#applyChangeToLineAnnotations(change)
      );
    }
  }

  #getFileRef(): FileContents | undefined {
    const fileInfo = this.#fileInfo;
    const textDocument = this.#textDocument;
    if (fileInfo === undefined || textDocument === undefined) {
      return undefined;
    }
    const file = { ...fileInfo }; // copy
    Object.defineProperty(file, 'contents', {
      enumerable: true,
      get: () => textDocument.getText(),
    });
    return file as FileContents;
  }

  #applyChange(
    change: TextDocumentChange,
    selections?: EditorSelection[],
    newLineAnnotations?: DiffLineAnnotation<LAnnotation>[],
    options?: { skipSearchRefresh?: boolean; skipFocus?: boolean }
  ) {
    const fileRef = this.#getFileRef();
    const onChange = this.#options.onChange;
    if (fileRef !== undefined && onChange !== undefined) {
      onChange(fileRef, newLineAnnotations ?? this.#lineAnnotations);
    }

    // Invalidate layout caches touched by the edit. Clear cached line Y
    // positions from startLine onward when either:
    // - the line count changed (inserts/deletes renumber every later line), or
    // - wrap is on, where editing a line can add or remove a wrapped row and
    //   shift the Y of every line after it even though the line count is the
    //   same.
    if (change.lineDelta !== 0 || this.#isWrap) {
      for (const line of this.#lineYCache.keys()) {
        if (line >= change.startLine) {
          this.#lineYCache.delete(line);
        }
      }
    }
    if (this.#isWrap) {
      for (const line of this.#wrapLineOffsetsCache.keys()) {
        if (line >= change.startLine) {
          this.#wrapLineOffsetsCache.delete(line);
        }
      }
    }
    this.#lastAccessedCharX = undefined;

    let renderRange = this.#renderRange;
    let shouldUpdateBuffer: boolean | undefined;
    if (
      renderRange !== undefined &&
      selections !== undefined &&
      selections.length > 0
    ) {
      const primarySelection = selections.at(-1)!;
      const renderRangeEndLine =
        renderRange.startingLine + renderRange.totalLines;
      // When an edit moves the caret to or past the last rendered line — typing
      // Enter at the window's bottom edge, or pasting a few lines there — widen
      // the render range so every new line up to the caret gets a row when
      // #rerender runs below. The widened range is also written back to
      // #renderRange: the next edit reads renderRangeEndLine from it, and
      // #renderCaret/#isLineVisible read it to decide whether to draw the caret.
      // Without persisting, the end line stays stale, a following edit is
      // misclassified as "past the window", and its just-typed line is left
      // unrendered until the next scroll re-syncs the range. Only edits that
      // carry a caret reach here (the block is guarded on `selections` above), so
      // a bare programmatic applyEdits with no active selection does not widen.
      //
      // Cap the widening at a multiple of the bounded window the virtualizer
      // last synced. A large insert at the caret — most often a big multi-line
      // paste, or a scripted set-selection-then-edit at scale — can drop the
      // caret far below the window; widening to reach it would make #rerender
      // build a row per inserted line synchronously, defeating virtualization.
      // Past the cap, keep the bounded window and only recompute the buffer
      // spacer — the scroll that follows a focused edit (or the next user scroll
      // when unfocused) renders the far region with a bounded window.
      if (primarySelection.end.line >= renderRangeEndLine) {
        const widenedTotalLines =
          primarySelection.end.line - renderRange.startingLine + 1;
        const maxWidenLines =
          this.#viewportWindowLines === undefined ||
          this.#viewportWindowLines === Infinity
            ? Infinity
            : this.#viewportWindowLines * MAX_EDIT_WIDEN_WINDOW_MULTIPLE;
        // Only widen when the edit actually reaches the rendered window — its
        // dirty lines start at or before the window end. #rerender materializes
        // rows from change.startLine onward, so widening for an edit that starts
        // entirely below the window (e.g. setSelections to an offscreen line
        // then applyEdits before the virtualizer re-syncs) would leave the
        // rows between the window and the edit unbuilt while #isLineVisible
        // reports them visible, mispositioning the new rows and caret until the
        // next scroll.
        if (
          change.startLine <= renderRangeEndLine &&
          widenedTotalLines <= maxWidenLines
        ) {
          if (primarySelection.end.line > renderRangeEndLine) {
            // The line count grew below the window, so the buffer spacer must be
            // recomputed (preserves the prior behavior for this case).
            shouldUpdateBuffer = true;
          }
          renderRange = { ...renderRange, totalLines: widenedTotalLines };
          this.#renderRange = renderRange;
        } else {
          // The edit is past the cap, or starts below the rendered window: keep
          // the bounded window and only recompute the buffer; the scroll that
          // follows a focused edit (or the next user scroll) renders the far
          // region.
          shouldUpdateBuffer = true;
        }
      }
    }
    this.#rerender(change, newLineAnnotations, renderRange, shouldUpdateBuffer);

    if (
      options?.skipSearchRefresh !== true &&
      this.#searchPanel !== undefined &&
      this.#matches !== undefined
    ) {
      this.#searchPanel.updateMatches({ syncSelection: false });
    }

    if (selections !== undefined) {
      // Always re-render the selection range and caret overlay so editor state
      // stays in sync. When skipFocus is set (a programmatic edit on an editor
      // that is not focused) we stop here: focusing or scrolling would pull the
      // caret and viewport toward an editor the user is not interacting with.
      this.#updateSelections(selections);
      if (options?.skipFocus !== true) {
        // focus to update the native window selection, and scroll to the caret
        // to mock the 'contenteditable' behavior
        if (this.#primaryCaretElement !== undefined) {
          this.#primaryCaretElement.scrollIntoView({
            block: 'nearest',
            inline: 'nearest',
          });
        } else if (selections.length > 0) {
          const pos = getCaretPosition(selections.at(-1)!);
          this.#scrollToLine(pos.line, pos.character);
        }
        this.focus({ preventScroll: true });
      }
    }
  }

  #applyChangeToLineAnnotations(
    change: TextDocumentChange
  ): DiffLineAnnotation<LAnnotation>[] | undefined {
    if (this.#lineAnnotations !== undefined) {
      const nextLineAnnotations =
        applyDocumentChangeToLineAnnotations<LAnnotation>(
          change,
          this.#lineAnnotations
        );
      if (nextLineAnnotations !== undefined) {
        this.#textDocument?.setLastUndoLineAnnotations(
          this.#lineAnnotations,
          nextLineAnnotations
        );
        return nextLineAnnotations;
      }
    }
    return undefined;
  }

  #getLineElement(line: number): HTMLElement | undefined {
    const lastAccessed = this.#lastAccessedLineElement;
    if (lastAccessed !== undefined && lastAccessed[0] === line) {
      return lastAccessed[1];
    }

    const contentElement = this.#contentElement;
    if (contentElement === undefined) {
      return undefined;
    }

    let lineElement: HTMLElement | null = null;

    // check if the line is within the render range (fast)
    if (this.#renderRange !== undefined) {
      const { startingLine } = this.#renderRange;
      const { children } = contentElement;
      for (let i = line - startingLine; i <= children.length; i++) {
        const child = children[i] as HTMLElement | undefined;
        if (child === undefined) {
          break;
        }
        const lineNumber = getLineNumberAttr(child);
        const lineType = child.dataset.lineType;
        if (
          lineNumber !== undefined &&
          lineNumber === line + 1 &&
          lineType !== undefined &&
          isLineEditable(lineType)
        ) {
          lineElement = child;
          break;
        }
      }
    }

    // fallback to query selector
    lineElement ??= contentElement.querySelector<HTMLElement>(
      `[data-line="${line + 1}"]` +
        (this.#diffSyle === 'unified'
          ? ':not([data-line-type="change-deletion"])'
          : '')
    );

    if (lineElement !== null) {
      if (lastAccessed !== undefined) {
        lastAccessed[0] = line;
        lastAccessed[1] = lineElement;
      } else {
        this.#lastAccessedLineElement = [line, lineElement];
      }
      return lineElement;
    }
    return undefined;
  }

  #getGutterWidth(): number {
    if (this.#gutterElement === undefined) {
      return 0;
    }

    if (this.#gutterWidthCache === undefined) {
      const diffsColumnNumberWidth =
        this.#contentElement?.parentElement?.style.getPropertyValue(
          '--diffs-column-number-width'
        );
      if (
        diffsColumnNumberWidth !== undefined &&
        diffsColumnNumberWidth.length > 2 &&
        diffsColumnNumberWidth.endsWith('px')
      ) {
        this.#gutterWidthCache = parseInt(
          diffsColumnNumberWidth.slice(0, -2),
          10
        );
      } else {
        this.#gutterWidthCache = this.#gutterElement.offsetWidth;
      }
    }

    return this.#gutterWidthCache;
  }

  #getContentWidth(): number {
    if (this.#contentElement === undefined) {
      return 0;
    }

    if (this.#contentWidthCache === undefined) {
      const diffsColumnContentWidth =
        this.#contentElement.parentElement?.style.getPropertyValue(
          '--diffs-column-content-width'
        );
      if (
        diffsColumnContentWidth !== undefined &&
        diffsColumnContentWidth.length > 2 &&
        diffsColumnContentWidth.endsWith('px')
      ) {
        this.#contentWidthCache = parseFloat(
          diffsColumnContentWidth.slice(0, -2)
        );
      } else {
        this.#contentWidthCache = this.#contentElement.offsetWidth;
      }
    }
    return this.#contentWidthCache;
  }

  // get line top(y-coordinate) position
  #getLineY(line: number) {
    const cachedY = this.#lineYCache.get(line);
    if (cachedY !== undefined) {
      return cachedY;
    }

    const lineElement = this.#getLineElement(line);
    if (lineElement === undefined) {
      return -1;
    }

    // cold(slow) path: measure line top position from DOM (will cause reflow)
    let y = lineElement.offsetTop + this.#metrics.paddingTop;
    y += this.#activeContentOffset?.top ?? 0;
    this.#lineYCache.set(line, y);
    return y;
  }

  // Return the visual position for a character. Wrapped lines include the
  // visual line index so carets can be placed on the correct row.
  #getCharX(line: number, char: number): [x: number, wrapLine: number] {
    if (
      this.#lastAccessedCharX !== undefined &&
      this.#lastAccessedCharX[0] === line &&
      this.#lastAccessedCharX[1] === char
    ) {
      return [this.#lastAccessedCharX[2], this.#lastAccessedCharX[3]];
    }

    const lineText = this.#textDocument?.getLineText(line);
    const offsetLeft = this.#getGutterWidth() + this.#metrics.ch; // gutter width + inline padding (1ch)
    if (lineText === undefined || lineText.length === 0 || char <= 0) {
      return [offsetLeft + (this.#activeContentOffset?.left ?? 0), 0];
    }

    const boundedCharacter = snapTextOffsetToUnicodeBoundary(
      lineText,
      Math.min(char, lineText.length)
    );
    const textBeforeCharacter = lineText.slice(0, boundedCharacter);
    const asciiColumns = getExpandedAsciiTextColumns(
      textBeforeCharacter,
      this.#metrics.tabSize
    );

    let left = 0;
    let wrapLine = 0;
    if (asciiColumns !== -1) {
      left = offsetLeft + asciiColumns * this.#metrics.ch;
    } else {
      left = offsetLeft + this.#metrics.measureTextWidth(textBeforeCharacter);
    }

    if (this.#isWrap) {
      const contentWidth = this.#getContentWidth();
      const textWidth =
        2 * this.#metrics.ch + this.#metrics.measureTextWidth(lineText);
      if (textWidth > contentWidth) {
        const wrapOffsets = this.#wrapLineText(line);
        for (let w = 0; w + 1 < wrapOffsets.length; w++) {
          const segmentStart = wrapOffsets[w];
          const segmentEnd = wrapOffsets[w + 1];
          if (boundedCharacter <= segmentEnd) {
            wrapLine = w;
            const prefixInSegment = lineText.slice(
              segmentStart,
              boundedCharacter
            );
            const segmentAsciiColumns = getExpandedAsciiTextColumns(
              prefixInSegment,
              this.#metrics.tabSize
            );
            if (segmentAsciiColumns !== -1) {
              left = offsetLeft + segmentAsciiColumns * this.#metrics.ch;
            } else {
              left =
                offsetLeft + this.#metrics.measureTextWidth(prefixInSegment);
            }
            break;
          }
        }
      }
      left += this.#activeContentOffset?.left ?? 0;
    }

    if (this.#lastAccessedCharX !== undefined) {
      this.#lastAccessedCharX[0] = line;
      this.#lastAccessedCharX[1] = char;
      this.#lastAccessedCharX[2] = left;
      this.#lastAccessedCharX[3] = wrapLine;
    } else {
      this.#lastAccessedCharX = [line, char, left, wrapLine];
    }

    return [left, wrapLine];
  }

  // Compute how a logical line of text is broken into visual lines when line
  // wrapping is enabled.
  #wrapLineText(line: number): Uint32Array {
    const cachedOffsets = this.#wrapLineOffsetsCache.get(line);
    if (cachedOffsets !== undefined) {
      return cachedOffsets;
    }

    const lineText = this.#textDocument?.getLineText(line);
    if (lineText === undefined || lineText.length === 0) {
      const offsets = new Uint32Array([0]);
      this.#wrapLineOffsetsCache.set(line, offsets);
      return offsets;
    }

    const div = h(
      'div',
      {
        style: {
          position: 'absolute',
          top: '0',
          left: '0',
          width: '100%',
          boxSizing: 'border-box',
          visibility: 'hidden',
          pointerEvents: 'none',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          font: 'inherit',
          paddingInline: '1ch',
          tabSize: this.#metrics.tabSize.toString(),
        },
        textContent: lineText,
      },
      this.#contentElement
    );
    const textNode = div.firstChild as Text;
    const range = document.createRange();
    const starts: number[] = [];

    try {
      const unicodeOffsets = getUnicodeMeasurementOffsets(lineText);
      const wrapLineStartLeft =
        div.getBoundingClientRect().left + this.#metrics.ch;

      let previousOffset = 0;
      let lastTop = Number.NEGATIVE_INFINITY;

      for (let i = 0, offsetIndex = 0; i < lineText.length; ) {
        const nextOffset =
          unicodeOffsets === undefined
            ? i + 1
            : unicodeOffsets[offsetIndex + 1];
        range.setStart(textNode, i);
        range.setEnd(textNode, nextOffset);

        // A new visual line starts whenever the character's top edge moves
        // below the previous character's top edge.
        const { left, top } = range.getBoundingClientRect();
        if (top > lastTop) {
          // Safari can report the first range on a wrapped visual line as
          // starting one character past the visual line start. Use the previous
          // offset so segment-local caret math begins at the actual wrap point.
          const startsPastLineStart =
            isSafari() &&
            starts.length > 0 &&
            left - wrapLineStartLeft > this.#metrics.ch / 2;
          starts.push(startsPastLineStart ? previousOffset : i);
          lastTop = top;
        }
        previousOffset = i;
        i = nextOffset;
        offsetIndex++;
      }

      const offsets = new Uint32Array(starts.length + 1);
      for (let i = 0; i < starts.length; i++) {
        offsets[i] = starts[i]!;
      }
      offsets[starts.length] = lineText.length;
      this.#wrapLineOffsetsCache.set(line, offsets);
      return offsets;
    } finally {
      div.remove();
    }
  }

  // check if the web selection belongs to editor
  #rangeBelongsToEditor({ startContainer, endContainer }: StaticRange) {
    const contentEl = this.#contentElement;
    if (contentEl === undefined) {
      return false;
    }
    return (
      contentEl.contains(startContainer) && contentEl.contains(endContainer)
    );
  }

  // Check whether a line is visible in the currently rendered line window.
  #isLineVisible(line: number): boolean {
    const lineCount = this.#textDocument?.lineCount ?? 0;
    if (line < 0 || line >= lineCount) {
      return false;
    }
    if (this.#renderRange === undefined) {
      return true;
    }
    const { startingLine, totalLines } = this.#renderRange;
    if (line < startingLine) {
      return false;
    }
    if (totalLines === Infinity) {
      return true;
    }
    return line < startingLine + totalLines;
  }
}
