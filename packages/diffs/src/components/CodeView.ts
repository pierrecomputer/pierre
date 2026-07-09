import {
  CORE_CSS_ATTRIBUTE,
  DEFAULT_CODE_VIEW_FILE_METRICS,
  DEFAULT_CODE_VIEW_LAYOUT,
  DEFAULT_COLLAPSED_CONTEXT_THRESHOLD,
  DEFAULT_SMOOTH_SCROLL_SETTINGS,
  DEFAULT_THEMES,
  DIFFS_DEVELOPMENT_BUILD,
  DIFFS_TAG_NAME,
  THEME_CSS_ATTRIBUTE,
  UNSAFE_CSS_ATTRIBUTE,
} from '../constants';
import type { SelectionWriteOptions } from '../managers/InteractionManager';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type {
  CodeViewCreateEditorOptions,
  CodeViewDiffItem,
  CodeViewFileItem,
  CodeViewItem,
  CodeViewItemScrollTarget,
  CodeViewLayout,
  CodeViewLineScrollTarget,
  CodeViewPositionScrollTarget,
  CodeViewRangeScrollTarget,
  CodeViewScrollBehavior,
  CodeViewScrollTarget,
  DiffLineAnnotation,
  DiffsEditorHost,
  FileContents,
  HunkSeparators,
  PendingCodeViewLayoutReset,
  SelectedLineRange,
  SelectionSide,
  SmoothScrollSettings,
  VirtualFileMetrics,
  VirtualWindowSpecs,
} from '../types';
import { areManagedSnapshotsEqual } from '../utils/areManagedSnapshotsEqual';
import { areObjectsEqual } from '../utils/areObjectsEqual';
import { areOptionsEqual } from '../utils/areOptionsEqual';
import { areSelectionsEqual } from '../utils/areSelectionsEqual';
import { areThemesEqual } from '../utils/areThemesEqual';
import { createCodeViewHeaderFooterHostElement } from '../utils/createCodeViewHeaderFooterHostElement';
import { createWindowFromScrollPosition } from '../utils/createWindowFromScrollPosition';
import { isStyleNode } from '../utils/isStyleNode';
import { prefersReducedMotion } from '../utils/prefersReducedMotion';
import { roundToDevicePixel } from '../utils/roundToDevicePixel';
import type { WorkerPoolManager } from '../worker';
import type { FileOptions } from './File';
import type { FileDiffOptions } from './FileDiff';
import { VirtualizedFile } from './VirtualizedFile';
import { VirtualizedFileDiff } from './VirtualizedFileDiff';
import type { VirtualizerConfig } from './Virtualizer';

// When re-rendering content of the virtualizer, it's important that we
// maintain a visual anchor, usually this is the first fully visible element,
// whether it's an Item (a file or diff header), or a specific line.  If the
// rendered content ever ends up shifting things around, we'll need to reset
// the new position back to the viewportOffset, relative to where that element
// currently is
interface ItemAnchor {
  type: 'item';
  id: string;
  viewportOffset: number;
}

interface LineAnchor {
  type: 'line';
  id: string;
  lineNumber: number;
  side: SelectionSide | undefined;
  viewportOffset: number;
}

type ScrollAnchor = ItemAnchor | LineAnchor;

interface LineScrollPosition {
  top: number;
  height: number;
}

interface StickyBounds {
  stickyTop: number;
  stickyBottom: number;
}

// Per-record state for one of the always-rendered header/footer hosts, keeping
// its element, the callback that last populated it, and its measured height in a
// single place instead of parallel fields on the CodeView instance.
interface HeaderFooterHost {
  // The mounted host element, or undefined when the callback is absent.
  element: HTMLDivElement | undefined;
  // The renderCodeView{Header,Footer} callback that last populated `element`, so
  // a swapped reference can be detected and the host re-populated in place.
  render?(): HTMLElement | undefined;
  // Measured height, folded into the scroll-range / item-offset math. Stays 0
  // while the host is absent (a no-op) so the math is always coherent.
  height: number;
}

interface PagedScrollPosition {
  pagedScrollTop: number;
  scrollPageOffset: number;
}

interface AdvancedVirtualizedBaseItem {
  /** Current index of this record in the ordered items array. */
  index: number;
  /** Absolute top offset of this item inside the scroll content. */
  top: number;
  /** Total measured height reserved for this item. */
  height: number;
  /** Root <diffs-container> node currently mounted for this item, only exists
   * when rendered. */
  element: HTMLElement | undefined;
  /** Last controlled version observed for this record. */
  version: number | undefined;
  /** Last CodeView option revision this item rendered with. */
  renderedOptionsRevision: number;
}

interface CodeViewDiffItemContext<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'diff';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewDiffItem<LAnnotation>;
  /** Virtualized diff instance responsible for rendering this item. */
  instance: VirtualizedFileDiff<LAnnotation>;
}

interface CodeViewFileItemContext<
  LAnnotation,
> extends AdvancedVirtualizedBaseItem {
  type: 'file';
  /** Latest item snapshot for this record. Controlled updates can replace it. */
  item: CodeViewFileItem<LAnnotation>;
  /** Virtualized file instance responsible for rendering this item. */
  instance: VirtualizedFile<LAnnotation>;
}

type CodeViewContextItem<LAnnotation> =
  | CodeViewDiffItemContext<LAnnotation>
  | CodeViewFileItemContext<LAnnotation>;

export interface CodeViewRenderedDiffItem<LAnnotation> {
  id: string;
  type: 'diff';
  item: CodeViewDiffItem<LAnnotation>;
  version: number | undefined;
  element: HTMLElement;
  instance: VirtualizedFileDiff<LAnnotation>;
}

export interface CodeViewRenderedFileItem<LAnnotation> {
  id: string;
  type: 'file';
  item: CodeViewFileItem<LAnnotation>;
  version: number | undefined;
  element: HTMLElement;
  instance: VirtualizedFile<LAnnotation>;
}

export type CodeViewRenderedItem<LAnnotation> =
  | CodeViewRenderedDiffItem<LAnnotation>
  | CodeViewRenderedFileItem<LAnnotation>;

// Everything the React layer portals into, published together so a single store
// subscription drives per-item slots AND the global header/footer.
export interface CodeViewSlotSnapshot<LAnnotation> {
  // Rendered items that need React-managed slot content (per-item headers,
  // annotations, gutter utilities), or undefined when none.
  items: CodeViewRenderedItem<LAnnotation>[] | undefined;
  // The always-rendered header/footer host elements React portals into, or
  // undefined when the corresponding renderCodeViewHeader/Footer callback is not
  // set. Because these live in the snapshot, a host mounting/unmounting changes
  // it and triggers a publish — which is how React learns about hosts that are
  // created on a later (worker-ready) render.
  header: HTMLElement | undefined;
  footer: HTMLElement | undefined;
}

export interface CodeViewLineSelection {
  id: string;
  range: SelectedLineRange;
}

export interface CodeViewCoordinator<LAnnotation> {
  hasHeaderRenderers: boolean;
  hasAnnotationRenderer: boolean;
  hasGutterRenderer: boolean;
  onSnapshotChange(
    snapshot: CodeViewSlotSnapshot<LAnnotation> | undefined
  ): void;
}

export type CodeViewScrollListener<LAnnotation> = (
  scrollTop: number,
  viewer: CodeView<LAnnotation>
) => void;

type OverloadCallbackArgs<TCallback> = TCallback extends (
  ...args: infer TArgs
) => unknown
  ? TArgs
  : never;

type CallbackReturn<TCallback> = TCallback extends (
  ...args: never[]
) => infer TReturn
  ? TReturn
  : never;

type OverloadFileCallbackArgs<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation>,
> = OverloadCallbackArgs<NonNullable<FileOptions<LAnnotation>[TKey]>>;

type OverloadDiffCallbackArgs<
  LAnnotation,
  TKey extends keyof FileDiffOptions<LAnnotation>,
> = OverloadCallbackArgs<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;

type CodeViewFileOptionCallback<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation>,
> = (
  ...args: [
    ...OverloadFileCallbackArgs<LAnnotation, TKey>,
    context: CodeViewFileItemContext<LAnnotation>,
  ]
) => CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;

type CodeViewDiffOptionCallback<
  LAnnotation,
  TKey extends keyof FileDiffOptions<LAnnotation>,
> = (
  ...args: [
    ...OverloadDiffCallbackArgs<LAnnotation, TKey>,
    context: CodeViewDiffItemContext<LAnnotation>,
  ]
) => CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;

type CodeViewOptionCallback<
  LAnnotation,
  TKey extends keyof FileOptions<LAnnotation> &
    keyof FileDiffOptions<LAnnotation>,
> = {
  (
    ...args: [
      ...OverloadFileCallbackArgs<LAnnotation, TKey>,
      context: CodeViewFileItemContext<LAnnotation>,
    ]
  ): CallbackReturn<NonNullable<FileOptions<LAnnotation>[TKey]>>;
  (
    ...args: [
      ...OverloadDiffCallbackArgs<LAnnotation, TKey>,
      context: CodeViewDiffItemContext<LAnnotation>,
    ]
  ): CallbackReturn<NonNullable<FileDiffOptions<LAnnotation>[TKey]>>;
};

export const CODE_VIEW_DIFF_OPTION_KEYS = [
  'theme',
  'disableLineNumbers',
  'overflow',
  'themeType',
  'disableFileHeader',
  'disableVirtualizationBuffers',
  'preferredHighlighter',
  'useCSSClasses',
  'useTokenTransformer',
  'tokenizeMaxLineLength',
  'tokenizeMaxLength',
  'unsafeCSS',
  'diffStyle',
  'diffIndicators',
  'disableBackground',
  'expandUnchanged',
  'loadDiffFiles',
  'collapsedContextThreshold',
  'lineDiffType',
  'maxLineDiffLength',
  'expansionLineCount',
  'lineHoverHighlight',
  'enableTokenInteractionsOnWhitespace',
  'enableGutterUtility',
  '__debugPointerEvents',
  'enableLineSelection',
  'controlledSelection',
  'disableErrorHandling',
] as const;

type CodeViewDiffOptionKeys = (typeof CODE_VIEW_DIFF_OPTION_KEYS)[number];

export const CODE_VIEW_FILE_OPTION_KEYS = [
  'theme',
  'disableLineNumbers',
  'overflow',
  'themeType',
  'disableFileHeader',
  'disableVirtualizationBuffers',
  'preferredHighlighter',
  'useCSSClasses',
  'useTokenTransformer',
  'tokenizeMaxLineLength',
  'tokenizeMaxLength',
  'unsafeCSS',
  'lineHoverHighlight',
  'enableTokenInteractionsOnWhitespace',
  'enableGutterUtility',
  '__debugPointerEvents',
  'enableLineSelection',
  'controlledSelection',
  'disableErrorHandling',
] as const;

type CodeViewFileOptionKeys = (typeof CODE_VIEW_FILE_OPTION_KEYS)[number];

// FIXME(amadeus): Ideally we don't ever require this...
// Option values Editor.edit requires before it attaches to an instance. These
// keys are excluded from the plain pass-through loops (defineItemOption
// properties are non-configurable and cannot be redefined) so the prototypes
// can define edit-aware getters that serve the editor-required value while an
// item is in edit mode. Without this, Editor.edit would fall back to
// instance.setOptions, which throws for CodeView-managed instances.
const CODE_VIEW_EDIT_FORCED_OPTION_KEYS: ReadonlySet<string> = new Set([
  'useTokenTransformer',
  'enableGutterUtility',
  'enableLineSelection',
  'lineHoverHighlight',
  'expandUnchanged',
]);

type CodeViewPassThroughOptions<LAnnotation> = Pick<
  FileDiffOptions<LAnnotation>,
  CodeViewDiffOptionKeys
>;

type CodeViewMode = 'file' | 'diff';

type CodeViewModeItemContext<
  LAnnotation,
  TMode extends CodeViewMode,
> = TMode extends 'file'
  ? CodeViewFileItemContext<LAnnotation>
  : CodeViewDiffItemContext<LAnnotation>;

type CodeViewModeOptionCallback<
  LAnnotation,
  TMode extends CodeViewMode,
  TKey extends CodeViewSharedCallbackKeys | CodeViewSelectionCallbackKeys,
> = TMode extends 'file'
  ? CodeViewFileOptionCallback<LAnnotation, TKey>
  : CodeViewDiffOptionCallback<LAnnotation, TKey>;

type CodeViewModeInternalOptionCallback<
  LAnnotation,
  TMode extends CodeViewMode,
  TKey extends CodeViewSharedCallbackKeys | CodeViewSelectionCallbackKeys,
> = (
  ...args: [
    ...OverloadCallbackArgs<
      NonNullable<CodeViewModeOptions<LAnnotation, TMode>[TKey]>
    >,
    CodeViewModeItemContext<LAnnotation, TMode>,
  ]
) => CallbackReturn<NonNullable<CodeViewModeOptions<LAnnotation, TMode>[TKey]>>;

type CodeViewModeOptions<
  LAnnotation,
  TMode extends CodeViewMode,
> = TMode extends 'file'
  ? FileOptions<LAnnotation>
  : FileDiffOptions<LAnnotation>;

const CODE_VIEW_SHARED_CALLBACK_KEYS = [
  'renderCustomHeader',
  'renderHeaderPrefix',
  'renderHeaderFilenameSuffix',
  'renderHeaderMetadata',
  'renderAnnotation',
  'renderGutterUtility',
  'onPostRender',
  'onGutterUtilityClick',
  'onLineClick',
  'onLineNumberClick',
  'onLineEnter',
  'onLineLeave',
  'onTokenClick',
  'onTokenEnter',
  'onTokenLeave',
] as const;

const CODE_VIEW_SELECTION_CALLBACK_KEYS = [
  'onLineSelected',
  'onLineSelectionStart',
  'onLineSelectionChange',
  'onLineSelectionEnd',
] as const;

type CodeViewSharedCallbackKeys =
  (typeof CODE_VIEW_SHARED_CALLBACK_KEYS)[number];

type CodeViewSelectionCallbackKeys =
  (typeof CODE_VIEW_SELECTION_CALLBACK_KEYS)[number];

const CODE_VIEW_ITEM_OPTIONS_STATE = Symbol('CodeView.itemOptionsState');

type CodeViewItemCallbackCache = Partial<
  Record<CodeViewSharedCallbackKeys | CodeViewSelectionCallbackKeys, unknown>
>;

// Each item gets a tiny state record and an options object whose properties
// come from a shared prototype. This avoids retaining dozens of getter closures
// and property descriptors per item while still letting the item instance read
// the latest CodeView options whenever it renders.
interface CodeViewItemOptionsState {
  // Store the id instead of the item object so item -> instance -> options does
  // not form a strong cycle back to the item context. The id also lets
  // updateItemId() keep reused instances pointed at the current record.
  id: string;
  // Callback wrappers are only needed when a renderer/interaction path reads a
  // callback option, so this cache stays absent for plain CodeView items.
  callbackCache?: CodeViewItemCallbackCache;
}

type CodeViewItemOptions<
  LAnnotation,
  TMode extends CodeViewMode,
> = CodeViewModeOptions<LAnnotation, TMode> & {
  [CODE_VIEW_ITEM_OPTIONS_STATE]: CodeViewItemOptionsState;
};

// One document change published by an item's editor, as delivered to the
// onItemEditChange/onItemEditComplete options.
interface CodeViewItemEditChange<LAnnotation> {
  // Item snapshot from the time of the change; used as a fallback when the
  // session ends because the item was removed from the CodeView.
  item: CodeViewItem<LAnnotation>;
  file: FileContents;
  lineAnnotations: DiffLineAnnotation<LAnnotation>[] | undefined;
}

// Mutable per-editor state shared with the CodeView-built onChange closure.
// The closure resolves the owning item through `id` (kept current by
// updateItemId) and caches each document change in `lastChange` so the final
// contents can be published through onItemEditComplete when the session ends
// — even if the editor is detached (scrolled out) at that moment.
interface CodeViewItemEditorState<LAnnotation> {
  id: string;
  lastChange?: CodeViewItemEditChange<LAnnotation>;
}

// Editor bookkeeping for one edit-mode item.
interface CodeViewItemEditorRecord<LAnnotation> {
  editor: DiffsEditorHost<LAnnotation>;
  state: CodeViewItemEditorState<LAnnotation>;
}

function defineOptionsState<LAnnotation, TMode extends CodeViewMode>(
  options: CodeViewModeOptions<LAnnotation, TMode>,
  state: CodeViewItemOptionsState
): void {
  // Keep the state hidden from option enumeration. Renderer option builders
  // should copy known keys explicitly and must not depend on object spread.
  Object.defineProperty(options, CODE_VIEW_ITEM_OPTIONS_STATE, {
    configurable: false,
    enumerable: false,
    value: state,
  });
}

// NOTE(amadeus): It should be noted that there are times when various JS
// tooling will try and enumerate various parts of our code when logging, and
// sometimes this can trigger on the options prototype directly which won't
// have access to an internal state.  This forces us to be defensive later on
// which is important
function getItemOptionsState<LAnnotation, TMode extends CodeViewMode>(
  options: CodeViewModeOptions<LAnnotation, TMode>
): CodeViewItemOptionsState | undefined {
  return (options as CodeViewItemOptions<LAnnotation, TMode>)[
    CODE_VIEW_ITEM_OPTIONS_STATE
  ];
}

type CodeViewSharedCallbackOptions<LAnnotation> = {
  [TKey in CodeViewSharedCallbackKeys]?: CodeViewOptionCallback<
    LAnnotation,
    TKey
  >;
};

type CodeViewSelectionCallbackOptions<LAnnotation> = {
  [TKey in CodeViewSelectionCallbackKeys]?: CodeViewOptionCallback<
    LAnnotation,
    TKey
  >;
};

function defineItemOption<TOptions extends object, TKey extends keyof TOptions>(
  target: TOptions,
  key: TKey,
  get: (receiver: TOptions) => TOptions[TKey]
): void {
  // These accessors usually live on the shared prototype. Passing `this` to the
  // getter lets one shared accessor resolve per-item state from the receiving
  // options object instead of closing over an individual item.
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    get() {
      return get(this as TOptions);
    },
  });
}

export interface CodeViewOptions<LAnnotation>
  extends
    CodeViewPassThroughOptions<LAnnotation>,
    CodeViewSharedCallbackOptions<LAnnotation>,
    CodeViewSelectionCallbackOptions<LAnnotation> {
  hunkSeparators?: Exclude<HunkSeparators, 'custom'>;
  itemMetrics?: Partial<VirtualFileMetrics>;
  pointerEventsOnScroll?: boolean;
  smoothScrollSettings?: SmoothScrollSettings;
  stickyHeaders?: boolean;
  controlledSelection?: boolean;
  onSelectedLinesChange?(selection: CodeViewLineSelection | null): void;
  layout?: CodeViewLayout;
  /**
   * Create an editor for an item entering edit mode (`edit: true`). Providing
   * this option is what enables item editing. Pass the given options into the
   * editor constructor — `new Editor(options)` — so CodeView can route
   * document changes to `onItemEditChange`. CodeView owns the returned
   * editor's lifecycle: it attaches when the edited item mounts, re-attaches
   * across virtualization unmounts, and cleans the editor up once the item
   * stops being editable (edit off, collapsed, or removed). Returning
   * undefined declines the attach; CodeView retries on later render passes.
   */
  createEditor?(
    options: CodeViewCreateEditorOptions<LAnnotation>
  ): DiffsEditorHost<LAnnotation> | undefined;
  /**
   * Called when an edited item's document changes, with the owning item
   * resolved by CodeView.
   */
  onItemEditChange?(
    item: CodeViewItem<LAnnotation>,
    file: FileContents,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ): void;
  /**
   * Called once when an item's edit session ends — edit turned off, item
   * removed (including a controlled `setItems([])` that empties the list),
   * item collapsed, or `createEditor` unset — with the final contents from
   * the session's last document change. Not called when the session produced
   * no changes, nor on a direct `reset()`/`cleanUp()` teardown.
   *
   * Committing is user-space: CodeView never writes item data itself. The
   * recommended handler makes one combined item write (`updateItem` with a
   * `version` bump) carrying the new file/fileDiff — with a fresh `cacheKey`,
   * since the delivered contents differ from what the old key cached — along
   * with `edit: false`.
   */
  onItemEditComplete?(
    item: CodeViewItem<LAnnotation>,
    file: FileContents,
    lineAnnotations?: DiffLineAnnotation<LAnnotation>[]
  ): void;

  /** Render a non-virtualized element at the very start of the scroll content,
   * before the first item. It is always rendered and scrolls with the content.
   * Return the same element across calls and mutate it in place to update;
   * height changes are measured automatically. */
  renderCodeViewHeader?(): HTMLElement | undefined;
  /** Render a non-virtualized element at the very end of the scroll content,
   * after the last item. Always rendered; height changes are measured
   * automatically. */
  renderCodeViewFooter?(): HTMLElement | undefined;

  /** Internal dev-only check to ensure your `itemMetrics` are correct.  Its
   * automatically disabled in a production build because it will hurt
   * performance fairly significantly */
  __devOnlyValidateItemHeights?: boolean;
}

const DEFAULT_SCROLL_INTERACTION_RESTORE_DELAY_MS = 120;
const SCROLLING_CODE_OVERFLOW_FIX_VARIABLE = '--diffs-overflow-override';
const SCROLL_REBASE_CONTAINER_HEIGHT = 12_000_000;
const SCROLL_REBASE_TRIGGER_TOP = 1_000_000;
const SCROLL_REBASE_TARGET_TOP = 2_000_000;
const SCROLL_REBASE_TARGET_BOTTOM =
  SCROLL_REBASE_CONTAINER_HEIGHT - SCROLL_REBASE_TARGET_TOP;
const SCROLL_REBASE_THRESHOLD =
  SCROLL_REBASE_CONTAINER_HEIGHT - SCROLL_REBASE_TRIGGER_TOP;
interface ScrollToAnimation {
  position: number;
  velocity: number;
  lastTimestamp: number;
}

interface SpringStepResult {
  position: number;
  velocity: number;
}

// A vibe slopped heuristic to detect mobile safari only
const MOBILE_SAFARI = (() => {
  const { navigator } = globalThis;

  const userAgent = navigator.userAgent;
  const isIOS = /iP(?:hone|ad|od)/.test(userAgent);
  const isIPadOS =
    navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;

  return (
    (isIOS || isIPadOS) &&
    /AppleWebKit/.test(userAgent) &&
    /Safari/.test(userAgent) &&
    !/(CriOS|FxiOS|EdgiOS|OPiOS)/.test(userAgent)
  );
})();

type PendingAlignTypes = Exclude<CodeViewLineScrollTarget['align'], 'nearest'>;

interface PendingLineTarget extends Omit<CodeViewLineScrollTarget, 'align'> {
  align?: PendingAlignTypes;
}

interface PendingRangeTarget extends Omit<CodeViewRangeScrollTarget, 'align'> {
  align?: PendingAlignTypes;
}

interface PendingItemTarget extends Omit<CodeViewItemScrollTarget, 'align'> {
  align?: PendingAlignTypes;
}

type PendingScrollTarget =
  | CodeViewPositionScrollTarget
  | PendingLineTarget
  | PendingRangeTarget
  | PendingItemTarget;

export class CodeView<LAnnotation = undefined> {
  static __STOP = false;
  static __lastScrollPosition = 0;

  public type = 'advanced' as const;
  public readonly config: VirtualizerConfig = {
    overscrollSize: 200,
    intersectionObserverMargin: 0,
    resizeDebugging: false,
  };
  private items: CodeViewContextItem<LAnnotation>[] = [];
  private idToItem: Map<string, CodeViewContextItem<LAnnotation>> = new Map();
  private selectedLines: CodeViewLineSelection | null = null;
  // One editor per edit-mode item, created lazily via options.createEditor.
  // Entries survive virtualization unmounts so a remounted item re-attaches
  // its existing editor; attachedEditors tracks which entries are currently
  // bound to a mounted instance. Each record's `id` is mutable so
  // updateItemId can keep the editor's onChange closure resolving the
  // current item (mirroring updateItemOptionsId for item options state).
  private itemEditors: Map<string, CodeViewItemEditorRecord<LAnnotation>> =
    new Map();
  private attachedEditors: Set<string> = new Set();
  // NOTE(amadeus): We should probably attach an id to instances and use that
  // for lookups, instead of maintaining this map...
  private instanceToItem: Map<
    VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>,
    CodeViewContextItem<LAnnotation>
  > = new Map();
  private layoutDirtyIndex: number | undefined;
  private pendingLayoutReset: PendingCodeViewLayoutReset | undefined;
  private renderOptionsRevision = 0;
  private slotCoordinator: CodeViewCoordinator<LAnnotation> | undefined;
  private slotSnapshot: CodeViewSlotSnapshot<LAnnotation> | undefined;
  private scrollListeners: Set<CodeViewScrollListener<LAnnotation>> = new Set();
  private scrollHeight = 0;
  private containerHeight = -1;
  private scrollTop: number = 0;
  private scrollPageOffset: number = 0;
  private scrollDirty = true;
  private scrollInteractionFixTimer: ReturnType<typeof setTimeout> | undefined;
  private pointerEventsDisabled = false;
  private codeOverflowFix = false;
  private height: number = 0;
  private heightDirty = true;
  private windowSpecs: VirtualWindowSpecs = { top: 0, bottom: 0 };
  private renderState = {
    scrollTop: -1,
    firstIndex: -1,
    lastIndex: -1,
    stickyHeight: 0,
    stickyTop: -1,
    stickyBottom: -1,
  };
  private itemMetricsCache: VirtualFileMetrics = DEFAULT_CODE_VIEW_FILE_METRICS;
  private readonly fileOptionsPrototype: FileOptions<LAnnotation>;
  private readonly diffOptionsPrototype: FileDiffOptions<LAnnotation>;
  // Pending scroll target, either instant or smooth. The next render cycle
  // will attempt to resolve it's position instantly or as part of a dynamic
  // animation.
  //
  // - 'item' / 'line' targets stay here until isPendingTargetSettled returns
  //   true. Their destination top is re-derived from live layout every frame,
  //   absorbing async measurement (annotations, line wrap) that shifts the
  //   target mid-flight.
  // - 'position' targets settle on the first frame that applies their
  //   scrollTop — there is no layout-dependent destination to chase.
  private pendingScrollTarget: PendingScrollTarget | undefined;
  private pendingLayoutAnchor: ScrollAnchor | undefined;
  private shouldFixContainerFocus = false;

  // Active smooth-scroll animation state. Only populated while a scrollTo
  // with `behavior: 'smooth'` is in flight; cleared on settle (position +
  // velocity within epsilon of the destination) or on user-input abort.
  //
  // - position: current interpolated scrollTop, in CSS pixels.
  // - velocity: rate of change, in CSS pixels per millisecond.
  // - lastTimestamp: High Resolution Time (same clock as RAF timestamps)
  //   of the previous integration step.
  private scrollAnimation: ScrollToAnimation | undefined;

  private root: HTMLElement | undefined;
  private resizeObserver: ResizeObserver | undefined;

  private container: HTMLDivElement | undefined = document.createElement('div');
  private stickyContainer = document.createElement('div');
  private stickyOffset = document.createElement('div');
  // Always-rendered, non-virtualized header/footer hosts (element wrapper,
  // last-used render callback, and the measured height). They mount as
  // normal-flow siblings of `container` inside `root` — the header before it
  // and the footer after it.  Created lazily, never virtualized, so no pool
  // elements required
  private header: HeaderFooterHost = {
    element: undefined,
    render: undefined,
    height: 0,
  };
  private footer: HeaderFooterHost = {
    element: undefined,
    render: undefined,
    height: 0,
  };
  private elementPool: HTMLElement[] = [];
  private elementPoolVersion = 0;
  private elementPoolTracker = new WeakMap<HTMLElement, number>();
  // Container-managed elements may still have externally-owned light DOM slot
  // children after release, so hold them here until they are safe to reuse.
  // i.e. the react CodeView component will require a separate react cleanup
  // phase that we don't want to interrupt
  private pendingElementPool: HTMLElement[] = [];
  private options: CodeViewOptions<LAnnotation>;
  private workerManager: WorkerPoolManager | undefined;
  private isReadySubscription: (() => void) | undefined;
  private isContainerManaged: boolean;

  constructor(
    options: CodeViewOptions<LAnnotation> = { theme: DEFAULT_THEMES },
    workerManager?: WorkerPoolManager | undefined,
    isContainerManaged = false
  ) {
    this.options = options;
    this.computeMetricsCache(options.itemMetrics);
    this.fileOptionsPrototype = this.createFileOptionsPrototype();
    this.diffOptionsPrototype = this.createDiffOptionsPrototype();
    this.workerManager = workerManager;
    this.isContainerManaged = isContainerManaged;

    this.stickyOffset.style.contain = 'layout size';
    this.stickyContainer.style.position = 'sticky';
    this.stickyContainer.style.width = '100%';
    this.stickyContainer.style.contain = 'layout style inline-size';
    this.stickyContainer.style.isolation = 'isolate';
    this.stickyContainer.style.display = 'flex';
    this.stickyContainer.style.flexDirection = 'column';
  }

  private getLayout(): CodeViewLayout {
    return this.options.layout ?? DEFAULT_CODE_VIEW_LAYOUT;
  }

  // Absolute offset (in scroll pixels) from the top of the scroll content to the
  // first virtualized item. paddingTop is the container's top margin; the header
  // host height is the always-rendered header that sits before the items and
  // pushes every item down by its measured height. Anchor/scroll-target math adds
  // this to an item's local `top` to get its absolute scroll position.
  private getItemTopOffset(): number {
    return this.getLayout().paddingTop + this.header.height;
  }

  private computeMetricsCache(
    itemMetrics: Partial<VirtualFileMetrics> | undefined
  ): VirtualFileMetrics {
    this.itemMetricsCache = {
      hunkLineCount:
        itemMetrics?.hunkLineCount ??
        DEFAULT_CODE_VIEW_FILE_METRICS.hunkLineCount,
      lineHeight:
        itemMetrics?.lineHeight ?? DEFAULT_CODE_VIEW_FILE_METRICS.lineHeight,
      diffHeaderHeight:
        itemMetrics?.diffHeaderHeight ??
        DEFAULT_CODE_VIEW_FILE_METRICS.diffHeaderHeight,
      hunkSeparatorHeight: itemMetrics?.hunkSeparatorHeight,
      spacing: itemMetrics?.spacing ?? DEFAULT_CODE_VIEW_FILE_METRICS.spacing,
      paddingTop: itemMetrics?.paddingTop,
      paddingBottom: itemMetrics?.paddingBottom,
    };
    return this.itemMetricsCache;
  }

  private getSmoothScrollSettings(): SmoothScrollSettings {
    return this.options.smoothScrollSettings ?? DEFAULT_SMOOTH_SCROLL_SETTINGS;
  }

  private shouldDisablePointerEvents(): boolean {
    return this.options.pointerEventsOnScroll !== true;
  }

  private shouldValidateItemHeights(): boolean {
    return (
      DIFFS_DEVELOPMENT_BUILD &&
      this.options.__devOnlyValidateItemHeights === true
    );
  }

  private validateRenderedItemHeight(
    item: CodeViewContextItem<LAnnotation>
  ): void {
    if (!this.shouldValidateItemHeights() || item.element == null) {
      return;
    }

    const stickySpecs = item.instance.getAdvancedStickySpecs();
    if (stickySpecs == null) {
      return;
    }

    const expectedHeight = stickySpecs.height;
    const actualHeight = item.element.getBoundingClientRect().height;

    if (expectedHeight === actualHeight) {
      return;
    }

    console.error(
      'CodeView: reconciled item height does not match DOM height',
      {
        id: item.item.id,
        type: item.type,
        index: item.index,
        version: item.version,
        expectedHeight,
        actualHeight,
        delta: actualHeight - expectedHeight,
        stickyTopOffset: stickySpecs.topOffset,
        virtualizedHeight: item.instance.getVirtualizedHeight(),
        top: item.top,
        scrollTop: this.getScrollTop(),
        windowSpecs: { ...this.windowSpecs },
        element: item.element,
        instance: item.instance,
      }
    );
  }

  // Dev-only invariant check: the sticky container only holds the currently
  // rendered item content, so its measured block-size must equal the
  // `stickyHeight` we derived from the first/last item sticky specs. Individual
  // item heights can all be correct while this aggregate is still wrong (for
  // example when an edge item reports a logical-bottom offset while it only
  // rendered its header), and that mismatch is what drives the sticky container
  // to position against the wrong bounds.
  private validateStickyContainerHeight(): void {
    if (!this.shouldValidateItemHeights()) {
      return;
    }

    const { firstIndex, lastIndex, stickyHeight, stickyTop, stickyBottom } =
      this.renderState;
    if (firstIndex === -1 || lastIndex === -1) {
      return;
    }

    const actualHeight = this.stickyContainer.getBoundingClientRect().height;
    // Tolerate sub-pixel rounding from summing many flex children; real
    // discrepancies are whole rows (or larger) tall.
    if (Math.abs(actualHeight - stickyHeight) < 1) {
      return;
    }

    console.error(
      'CodeView: sticky container height does not match computed layout',
      {
        computedStickyHeight: stickyHeight,
        actualStickyHeight: actualHeight,
        delta: actualHeight - stickyHeight,
        stickyTop,
        stickyBottom,
        firstIndex,
        lastIndex,
        firstStickySpecs:
          this.items[firstIndex]?.instance.getAdvancedStickySpecs(),
        lastStickySpecs:
          this.items[lastIndex]?.instance.getAdvancedStickySpecs(),
        scrollTop: this.getScrollTop(),
        scrollPageOffset: this.scrollPageOffset,
        windowSpecs: { ...this.windowSpecs },
        stickyContainer: this.stickyContainer,
      }
    );
  }

  private clearScrollInteractionTimer(): void {
    if (this.scrollInteractionFixTimer != null) {
      clearTimeout(this.scrollInteractionFixTimer);
      this.scrollInteractionFixTimer = undefined;
    }
  }

  private suspendScrollInteractions(): void {
    this.clearScrollInteractionTimer();

    if (this.shouldDisablePointerEvents() && !this.pointerEventsDisabled) {
      this.stickyContainer.style.pointerEvents = 'none';
      this.pointerEventsDisabled = true;
    }

    // This is a really important fix for mobile safari; under aggressive scroll
    // conditions we'll eventually crash/reload the page. It appears to be
    // caused by the fact that the code wrapper elements are horizontally
    // scrollable, so while aggressively scrolling, we disable scrolling. We
    // don't want to apply this fix to good browsers since in those cases it
    // can fuck with layout in ways that aren't appropriate
    if (MOBILE_SAFARI && !this.codeOverflowFix) {
      this.stickyContainer.style.setProperty(
        SCROLLING_CODE_OVERFLOW_FIX_VARIABLE,
        'hidden'
      );
      this.codeOverflowFix = true;
    }

    this.scrollInteractionFixTimer = setTimeout(
      this.restoreScrollInteractions,
      DEFAULT_SCROLL_INTERACTION_RESTORE_DELAY_MS
    );
  }

  private restoreScrollInteractions = (): void => {
    this.clearScrollInteractionTimer();

    if (this.pointerEventsDisabled) {
      this.stickyContainer.style.removeProperty('pointer-events');
      this.pointerEventsDisabled = false;
    }

    if (this.codeOverflowFix) {
      this.stickyContainer.style.setProperty(
        SCROLLING_CODE_OVERFLOW_FIX_VARIABLE,
        'auto'
      );
      this.codeOverflowFix = false;
    }
  };

  private syncLayout(): void {
    const { gap, paddingBottom, paddingTop } = this.getLayout();
    this.stickyContainer.style.gap = `${gap}px`;
    this.container?.style.setProperty('margin-top', `${paddingTop}px`);
    this.container?.style.setProperty('margin-bottom', `${paddingBottom}px`);
  }

  // Mount/unmount/re-populate the header and footer hosts to match the current
  // renderCodeViewHeader/renderCodeViewFooter options. Runs inside the render
  // cycle (see computeRenderRangeAndEmit), so the first render, later option
  // changes, and content updates all converge on one path. Returns true when a
  // host's content changed (a fresh mount or a swapped callback) so the render
  // cycle takes a synchronous height measurement in the following read phase.
  private reconcileHeaderFooterHosts(): boolean {
    const headerChanged = this.reconcileHost('header');
    const footerChanged = this.reconcileHost('footer');
    return headerChanged || footerChanged;
  }

  // Reconcile a single host record: create + position + populate it when its
  // callback first appears, re-populate it when the callback reference changes,
  // and tear it down when the callback is removed. Otherwise the mounted host is
  // left untouched (its content is owned by the caller, or by React via a portal).
  // Mutates the record in place and returns whether its content changed.
  private reconcileHost(type: 'header' | 'footer'): boolean {
    const { root, container } = this;
    if (root == null || container == null) {
      return false;
    }

    const host = type === 'header' ? this.header : this.footer;
    const render =
      type === 'header'
        ? this.options.renderCodeViewHeader
        : this.options.renderCodeViewFooter;

    // Callback removed → the host should not exist; tear it down and reset height.
    if (render == null) {
      if (host.element == null) {
        return false;
      }
      this.resizeObserver?.unobserve(host.element);
      host.element.remove();
      host.element = undefined;
      host.render = undefined;
      this.setHostHeight(host, 0);
      return false;
    }

    // Same callback on a mounted host → its content is already current (the
    // common per-frame path).
    if (host.element != null && render === host.render) {
      return false;
    }

    // Callback added or swapped → ensure the host exists, then repopulate it from
    // the callback's latest output. A returned element replaces the content; a
    // nullish return empties the host, EXCEPT in container-managed (React) mode
    // where React owns the host's light DOM via a portal, so it is left untouched
    // (mirroring how cleanElement guards item light DOM).
    const element =
      host.element ??
      createCodeViewHeaderFooterHostElement(
        type,
        container,
        this.resizeObserver
      );
    host.element = element;
    const content = render();
    if (content != null) {
      element.replaceChildren(content);
    } else if (!this.isContainerManaged && element.children.length > 0) {
      element.textContent = '';
    }
    host.render = render;
    return true;
  }

  // Store a host's measured height, flagging the scroll state dirty when it
  // actually changed so the surrounding render cycle re-derives the scroll range
  // and re-anchors (the header offset shifts every item's position).
  private setHostHeight(host: HeaderFooterHost, height: number): void {
    if (host.height === height) {
      return;
    }
    host.height = height;
    this.scrollDirty = true;
  }

  // Read the mounted hosts' heights from the DOM. Called only in the render
  // cycle's read phase (right before reconcileRenderedItems) on a change frame, so
  // these getBoundingClientRect reads batch into the same reflow as the item
  // height reads instead of forcing a separate reflow during the write phase.
  private measureMountedHosts(): void {
    if (this.header.element != null) {
      this.setHostHeight(
        this.header,
        this.header.element.getBoundingClientRect().height
      );
    }
    if (this.footer.element != null) {
      this.setHostHeight(
        this.footer,
        this.footer.element.getBoundingClientRect().height
      );
    }
  }

  public setup(root: HTMLElement): void {
    if (this.root != null) {
      throw new Error('CodeView.setup: already setup');
    }
    this.workerManager?.subscribeToThemeChanges(this);
    this.root = root;
    this.root.style.overflowAnchor = 'none';
    if (!this.root.hasAttribute('tabindex')) {
      this.root.tabIndex = -1;
    }
    this.container ??= document.createElement('div');
    // NOTE(amadeus): We can't put `size` in here or it breaks
    // Firefox's sticky headers
    this.container.style.contain = 'layout style';
    this.syncLayout();
    this.container.appendChild(this.stickyOffset);
    this.container.appendChild(this.stickyContainer);
    this.root.appendChild(this.container);
    this.scrollDirty = true;
    this.heightDirty = true;
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.stickyContainer);
    this.root.addEventListener('scroll', this.handleScroll, {
      passive: true,
    });
    // Any user-driven scroll intent cancels an in-flight programmatic scroll.
    // pointerdown catches scrollbar drag (the scrollbar belongs to root);
    // wheel / touchstart cover trackpad + touch scroll; keydown covers arrow
    // keys, PgUp/PgDn, Home/End on a focused scroll container.
    this.root.addEventListener('wheel', this.clearPendingScroll, {
      passive: true,
    });
    this.root.addEventListener('touchstart', this.clearPendingScroll, {
      passive: true,
    });
    this.root.addEventListener('pointerdown', this.clearPendingScroll, {
      passive: true,
    });
    this.root.addEventListener('keydown', this.clearPendingScroll, {
      passive: true,
    });
    this.resizeObserver.observe(this.root);
    this.render(true);

    // FIXME(amadeus): Remove me before release
    window.__INSTANCE = this;
    // Test code to bring back in if needed
    // window.__CODE_VIEW_SCROLL_BEFORE_REBASE = (pixelsBefore = 1_000) => {
    //   const target = this.clampScrollTop(
    //     this.scrollPageOffset + SCROLL_REBASE_THRESHOLD - pixelsBefore
    //   );
    //   this.scrollTo({
    //     type: 'position',
    //     position: target,
    //     behavior: 'instant',
    //   });
    // };
    window.__TOGGLE = () => {
      if (CodeView.__STOP) {
        CodeView.__STOP = false;
        this.scrollTo({
          type: 'position',
          position: CodeView.__lastScrollPosition,
          behavior: 'instant',
        });
      } else {
        CodeView.__lastScrollPosition = this.getScrollTop();
        CodeView.__STOP = true;
      }
    };
  }

  public reset(): void {
    dequeueRender(this.computeRenderRangeAndEmit);
    this.clearReadySubscription();
    this.restoreScrollInteractions();
    this.cleanAllRenderedItems();
    // Rendered-item cleanup above already detached mounted editors; cleaning
    // an already-detached editor is a no-op, so this covers both cases.
    for (const record of this.itemEditors.values()) {
      record.editor.cleanUp();
    }
    this.itemEditors.clear();
    this.attachedEditors.clear();
    this.selectedLines = null;
    this.items.length = 0;
    this.idToItem.clear();
    this.instanceToItem.clear();
    this.layoutDirtyIndex = undefined;
    this.pendingLayoutReset = undefined;
    this.stickyContainer.textContent = '';
    this.stickyOffset.style.height = '';
    this.container?.style.removeProperty('height');
    this.containerHeight = -1;
    this.windowSpecs = { top: 0, bottom: 0 };
    this.pendingLayoutAnchor = undefined;
    this.shouldFixContainerFocus = false;
    this.height = 0;
    this.scrollTop = 0;
    this.scrollPageOffset = 0;
    this.scrollHeight = 0;
    this.scrollDirty = true;
    this.heightDirty = true;
    this.resetRenderState();
    // NOTE(amadeus): Container managed CodeView controls when flushing
    // occurs. This is mostly to make imperative vanilla js api easier to work
    // with
    if (!this.isContainerManaged) {
      this.flushSlotCoordinator();
    }
  }

  public cleanUp(): void {
    this.reset();
    this.clearElementPool();
    this.restoreScrollInteractions();
    this.workerManager?.unsubscribeToThemeChanges(this);
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    this.root?.removeEventListener('scroll', this.handleScroll);
    this.root?.removeEventListener('wheel', this.clearPendingScroll);
    this.root?.removeEventListener('touchstart', this.clearPendingScroll);
    this.root?.removeEventListener('pointerdown', this.clearPendingScroll);
    this.root?.removeEventListener('keydown', this.clearPendingScroll);
    this.root?.style.removeProperty('overflow-anchor');
    this.container?.remove();
    this.stickyOffset.remove();
    this.stickyContainer.remove();
    this.stickyContainer.textContent = '';
    this.header.element?.remove();
    this.header.element = undefined;
    this.header.render = undefined;
    this.header.height = 0;
    this.footer.element?.remove();
    this.footer.element = undefined;
    this.footer.render = undefined;
    this.footer.height = 0;
    this.root = undefined;
    this.container = undefined;
  }

  private cleanAllRenderedItems() {
    if (this.renderState.firstIndex === -1) {
      return;
    }
    for (
      let index = this.renderState.firstIndex;
      index <= this.renderState.lastIndex;
      index++
    ) {
      const item = this.items[index];
      if (item == null) {
        throw new Error(
          `CodeView.cleanAllRenderedItems: Item does not exist at index: ${index}`
        );
      }
      this.releaseRenderedItem(item);
    }
  }

  private primeScrollTarget(target: PendingScrollTarget): void {
    if (target.type === 'position') return;

    const item = this.idToItem.get(target.id);
    if (item == null) return;

    void item.instance.primeHighlightCache();
  }

  private getElementPoolLimit() {
    const viewportSize = this.getHeight() + this.config.overscrollSize * 2;
    const { diffHeaderHeight } = this.itemMetricsCache;
    // The goal here roughly is to hold an element pool that's maxed out at
    // around the size of all collapsed files, doubled if `isContainerManaged`
    // because we have to wait an additional render tick to actually re-use the
    // elements
    return (
      Math.max(
        8,
        Math.ceil(viewportSize / Math.max(diffHeaderHeight, 10)) + 1
      ) * (this.isContainerManaged ? 2 : 1)
    );
  }

  private acquireElement(): HTMLElement {
    this.promotePendingPooledElements();
    let element = this.elementPool.pop();
    while (element != null && !this.isElementPoolGenerationCurrent(element)) {
      element = this.elementPool.pop();
    }
    element ??= document.createElement(DIFFS_TAG_NAME);
    this.markElementPoolGenerationCurrent(element);
    return element;
  }

  private releaseRenderedItem(item: CodeViewContextItem<LAnnotation>): void {
    const { element } = item;
    if (element != null && this.renderedItemOwnsFocus(element)) {
      this.shouldFixContainerFocus = true;
    }

    item.instance.cleanUp(true);
    // Instance cleanup fully detached any attached editor. The editor itself
    // stays in itemEditors so the item re-attaches it on remount.
    this.attachedEditors.delete(item.item.id);
    item.element = undefined;
    if (element == null) {
      return;
    }

    element.remove();
    this.cleanElement(element);
    this.queueElementForPool(element);
  }

  private renderedItemOwnsFocus(element: HTMLElement): boolean {
    const { activeElement } = document;
    return (
      activeElement === element ||
      element.contains(activeElement) ||
      element.shadowRoot?.activeElement != null
    );
  }

  private fixContainerFocus(): void {
    if (this.shouldFixContainerFocus) {
      this.shouldFixContainerFocus = false;
      this.root?.focus({ preventScroll: true });
    }
  }

  // Strip item-specific DOM while keeping the expensive shared shell assets
  // that are valid for every item in this CodeView until shared options
  // change.
  private cleanElement(element: HTMLElement): void {
    const { shadowRoot } = element;
    if (shadowRoot != null) {
      for (const child of Array.from(shadowRoot.children)) {
        if (!isPooledShadowChild(child)) {
          child.remove();
        }
      }
    }

    if (!this.isContainerManaged) {
      element.replaceChildren();
    }
  }

  private queueElementForPool(element: HTMLElement): void {
    const poolLimit = this.getElementPoolLimit();
    if (
      !this.isElementPoolGenerationCurrent(element) ||
      this.getElementPoolSize() >= poolLimit
    ) {
      return;
    }

    if (this.isElementClean(element)) {
      this.elementPool.push(element);
    } else {
      this.pendingElementPool.push(element);
    }
  }

  private promotePendingPooledElements(): void {
    if (this.pendingElementPool.length === 0) {
      return;
    }

    const { pendingElementPool: pendingElements } = this;
    this.pendingElementPool = [];
    const poolLimit = this.getElementPoolLimit();
    for (const element of pendingElements) {
      if (
        this.isElementPoolGenerationCurrent(element) &&
        this.isElementClean(element) &&
        this.elementPool.length < poolLimit
      ) {
        this.elementPool.push(element);
      } else if (
        this.isElementPoolGenerationCurrent(element) &&
        this.getElementPoolSize() < poolLimit
      ) {
        this.pendingElementPool.push(element);
      }
    }
  }

  private isElementClean(element: HTMLElement): boolean {
    return element.childNodes.length === 0;
  }

  private getElementPoolSize(): number {
    return this.elementPool.length + this.pendingElementPool.length;
  }

  private clearElementPool(): void {
    this.elementPool.length = 0;
    this.pendingElementPool.length = 0;
  }

  private invalidateElementPool(): void {
    this.elementPoolVersion++;
    this.clearElementPool();
  }

  private markElementPoolGenerationCurrent(element: HTMLElement): void {
    this.elementPoolTracker.set(element, this.elementPoolVersion);
  }

  private isElementPoolGenerationCurrent(element: HTMLElement): boolean {
    return this.elementPoolTracker.get(element) === this.elementPoolVersion;
  }

  private resolveEffectiveScrollBehavior(
    target: CodeViewScrollTarget,
    destination: number
  ): Exclude<CodeViewScrollBehavior, 'smooth-auto'> {
    if (prefersReducedMotion()) {
      return 'instant';
    }

    if (target.behavior !== 'smooth-auto') {
      return target.behavior ?? 'instant';
    }

    return Math.abs(destination - this.getScrollTop()) <= this.getHeight() * 10
      ? 'smooth'
      : 'instant';
  }

  public scrollTo(target: CodeViewScrollTarget): void {
    if (this.root == null) {
      return;
    }

    const pendingTarget = this.normalizeScrollTarget(target);
    if (pendingTarget == null) {
      return;
    }

    const destination = this.resolveScrollTargetTop(pendingTarget);
    if (destination == null) {
      return;
    }

    this.primeScrollTarget(pendingTarget);

    const behavior = this.resolveEffectiveScrollBehavior(
      pendingTarget,
      destination
    );
    if (behavior === 'smooth') {
      // Use ??= so if we have an animation in progress it will be smoothly
      // transitioned into the new target and not reset
      this.scrollAnimation ??= {
        position: this.getScrollTop(),
        velocity: 0,
        // Since we kick off a render to requestAnimationFrame, by initializing
        // lastTimestamp as performance.now() it means we can begin animating
        // on the next render call and not wait a frame to get frame time
        lastTimestamp: performance.now(),
      };
    } else {
      this.scrollAnimation = undefined;
    }

    // We'll attempt to scroll to this new target on the next render frame
    this.suspendScrollInteractions();
    this.pendingLayoutAnchor = undefined;
    this.pendingScrollTarget = pendingTarget;
    this.render();
  }

  public setSelectedLines(
    selection: CodeViewLineSelection | null,
    options?: SelectionWriteOptions
  ): void {
    this.applySelectedLines(selection, options);
  }

  public getSelectedLines(): CodeViewLineSelection | null {
    return this.selectedLines;
  }

  public clearSelectedLines(options?: SelectionWriteOptions): void {
    this.applySelectedLines(null, options);
  }

  public getItem(itemId: string): CodeViewItem<LAnnotation> | undefined {
    return this.idToItem.get(itemId)?.item;
  }

  /**
   * Get the live editor for an item currently in edit mode. Use this to drive
   * editor APIs CodeView does not wrap (applyEdits, undo, setMarkers, …).
   * Returns undefined once the item leaves edit mode.
   */
  public getEditor(itemId: string): DiffsEditorHost<LAnnotation> | undefined {
    return this.itemEditors.get(itemId)?.editor;
  }

  public updateItem(input: CodeViewItem<LAnnotation>): boolean {
    const item = this.idToItem.get(input.id);
    if (item == null) {
      console.error(`CodeView.updateItem: unknown item id "${input.id}"`);
      return false;
    }

    if (!this.syncItemRecord(item, input)) {
      return false;
    }

    this.markItemLayoutDirty(item);
    this.scrollDirty = true;
    this.render();
    this.syncSelection();
    this.syncItemEditors();
    return true;
  }

  public updateItemId(oldId: string, newId: string): boolean {
    if (oldId === newId) {
      return true;
    }

    const item = this.idToItem.get(oldId);
    if (item == null) {
      console.error(`CodeView.updateItemId: unknown item id "${oldId}"`);
      return false;
    }

    if (this.idToItem.has(newId)) {
      console.error(`CodeView.updateItemId: duplicate item id "${newId}"`);
      return false;
    }

    this.idToItem.delete(oldId);
    item.item.id = newId;
    this.idToItem.set(newId, item);
    this.updateItemOptionsId(item.instance.options, newId);

    if (this.selectedLines?.id === oldId) {
      this.selectedLines = { ...this.selectedLines, id: newId };
      this.options.onSelectedLinesChange?.(this.selectedLines);
    }
    const editorRecord = this.itemEditors.get(oldId);
    if (editorRecord != null) {
      editorRecord.state.id = newId;
      this.itemEditors.delete(oldId);
      this.itemEditors.set(newId, editorRecord);
      if (this.attachedEditors.delete(oldId)) {
        this.attachedEditors.add(newId);
      }
    }
    this.renamePendingScrollTarget(oldId, newId);
    this.renamePendingLayoutAnchor(oldId, newId);
    this.render();
    return true;
  }

  public addItem(input: CodeViewItem<LAnnotation>): void {
    this.addItems([input]);
  }

  public addItems(inputs: readonly CodeViewItem<LAnnotation>[]): void {
    this.appendItemsInternal(inputs);
    this.syncSelection();
    this.syncItemEditors();
  }

  public setItems(items: readonly CodeViewItem<LAnnotation>[]): void {
    if (items.length === 0) {
      // An empty controlled list removes every item, so end active edit
      // sessions the way reconcile removals do: publish each session's final
      // contents (from its last change) through onItemEditComplete. Direct
      // reset()/cleanUp() calls stay silent — those are teardowns, not item
      // data updates.
      const completions: CodeViewItemEditChange<LAnnotation>[] = [];
      for (const record of this.itemEditors.values()) {
        const { lastChange } = record.state;
        if (lastChange != null) {
          completions.push(lastChange);
        }
      }
      this.reset();
      // Fired after reset so a handler that calls back into setItems/addItems
      // runs against clean state (mirrors syncItemEditors' post-loop firing).
      for (const { item, file, lineAnnotations } of completions) {
        this.options.onItemEditComplete?.(item, file, lineAnnotations);
      }
    } else if (this.items.length === 0) {
      this.appendItemsInternal(items);
    } else if (!this.tryAppendItems(items)) {
      this.reconcileItems(items);
    }
    this.syncSelection();
    this.syncItemEditors();
  }

  /**
   * Append new records to the viewer while preserving existing layout state.
   * This is the shared path for imperative adds and the append-only reconcile
   * fast path, so it measures new items immediately and only triggers render
   * once at the end.
   */
  private appendItemsInternal(
    inputs: readonly CodeViewItem<LAnnotation>[],
    render = true
  ): void {
    if (inputs.length === 0) {
      return;
    }

    const layout = this.getLayout();
    let nextTop = this.items.length === 0 ? 0 : this.scrollHeight + layout.gap;
    const appendedTop = nextTop;
    for (let index = 0; index < inputs.length; index++) {
      const input = inputs[index];
      if (input == null) {
        throw new Error('CodeView.appendItemsInternal: missing input item');
      }
      if (this.idToItem.has(input.id)) {
        throw new Error(`CodeView.addItem: duplicate id "${input.id}"`);
      }

      const item = this.createItem(input, this.items.length, nextTop);
      this.items.push(item);
      this.idToItem.set(item.item.id, item);
      this.instanceToItem.set(item.instance, item);
      item.height = prepareItemInstance(item);
      nextTop += item.height + layout.gap;
    }

    this.scrollHeight = nextTop - layout.gap;
    this.scrollDirty = true;
    if (render) {
      if (this.canSkipRenderForAppend(appendedTop)) {
        this.syncContainerHeight();
      } else {
        this.render();
      }
    }
  }

  private canSkipRenderForAppend(appendedTop: number): boolean {
    return (
      this.container != null &&
      this.renderState.firstIndex !== -1 &&
      this.pendingScrollTarget == null &&
      this.scrollAnimation == null &&
      this.layoutDirtyIndex == null &&
      appendedTop > this.windowSpecs.bottom
    );
  }

  public onThemeChange(): void {
    this.invalidateElementPool();
  }

  public setOptions(options: CodeViewOptions<LAnnotation> | undefined): void {
    if (options == null) {
      return;
    }

    this.capturePendingLayoutAnchor();
    const { options: prevOptions } = this;
    const previousLayout = this.getLayout();
    const { itemMetricsCache: previousItemMetrics } = this;

    if (shouldClearPool(prevOptions, options)) {
      this.invalidateElementPool();
    }

    this.options = options;
    const nextItemMetrics = this.computeMetricsCache(options.itemMetrics);
    const itemMetricsChanged = !areObjectsEqual(
      previousItemMetrics,
      nextItemMetrics
    );
    const layoutChanged = !areObjectsEqual(previousLayout, this.getLayout());
    if (layoutChanged) {
      this.syncLayout();
    }

    const itemLayoutChanged =
      itemMetricsChanged || hasItemLayoutOptionChanged(prevOptions, options);
    if (itemLayoutChanged) {
      const previousReset = this.pendingLayoutReset;
      this.pendingLayoutReset = {
        metrics: itemMetricsChanged ? nextItemMetrics : previousReset?.metrics,
        resetFileLayoutCache: true,
        resetDiffLayoutCache: true,
        includeEstimatedDiffHeights:
          previousReset?.includeEstimatedDiffHeights === true ||
          itemMetricsChanged ||
          hasCodeViewDiffEstimateOptionChanged(prevOptions, options),
      };
    }

    if (layoutChanged || itemLayoutChanged) {
      this.markLayoutDirtyFromIndex(0);
      this.scrollDirty = true;
    }

    if (!areOptionsEqual(prevOptions, options)) {
      this.renderOptionsRevision++;
    }

    this.syncItemEditors();

    // Render when there are items, OR when the header/footer presence changed —
    // an otherwise-empty CodeView still needs a render to mount/unmount its hosts.
    const headerFooterChanged =
      prevOptions.renderCodeViewHeader !== options.renderCodeViewHeader ||
      prevOptions.renderCodeViewFooter !== options.renderCodeViewFooter;
    if (
      !this.isContainerManaged &&
      (this.items.length > 0 || headerFooterChanged)
    ) {
      this.render();
    }
  }

  private capturePendingLayoutAnchor(): void {
    if (
      this.root == null ||
      this.items.length === 0 ||
      this.pendingScrollTarget != null
    ) {
      return;
    }

    this.pendingLayoutAnchor = this.getScrollAnchor(this.getScrollTop());
  }

  public render(immediate = false): void {
    if (CodeView.__STOP) {
      return;
    }
    if (immediate) {
      dequeueRender(this.computeRenderRangeAndEmit);
      this.computeRenderRangeAndEmit();
    } else {
      queueRender(this.computeRenderRangeAndEmit);
    }
  }

  private isReady(): boolean {
    const { workerManager } = this;
    // A failed worker pool never reaches the 'initialized' state (it reverts to
    // 'waiting' with workersFailed: true), so treat failure as ready and let
    // the renderers fall back to synchronous highlighting.
    if (
      workerManager == null ||
      workerManager.isInitialized() ||
      workerManager.getStats().workersFailed
    ) {
      this.clearReadySubscription();
      return true;
    }

    this.isReadySubscription ??= workerManager.subscribeToStatChanges(
      (stats) => {
        if (stats.managerState !== 'initialized' && !stats.workersFailed) {
          return;
        }

        this.clearReadySubscription();
        this.render(true);
      }
    );

    // If the worker is awiting on initialization, we should attempt to
    // initialize
    if (workerManager.getStats().managerState === 'waiting') {
      void workerManager.initialize().catch(() => {});
    }
    return false;
  }

  private clearReadySubscription(): void {
    if (this.isReadySubscription == null) {
      return;
    }
    this.isReadySubscription();
    this.isReadySubscription = undefined;
  }

  public instanceChanged(
    instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>,
    layoutDirty: boolean
  ): void {
    // NOTE(amadeus): This is technically broken at the moment. What we
    // probably SHOULD do to fix is, it push the instance to some sort of
    // instance changed set, then iterate through all items and re-compute
    // everything to get new tops?
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'CodeView.instanceChanged: An instance has changed that is not registered'
      );
    }
    if (layoutDirty) {
      this.markItemLayoutDirty(item);
    }
    this.render();
  }

  public getWindowSpecs(): VirtualWindowSpecs {
    return this.windowSpecs;
  }

  public getContainerElement(): HTMLElement | undefined {
    return this.root;
  }

  // The always-rendered header/footer host elements, or undefined when the
  // corresponding renderCodeViewHeader/renderCodeViewFooter callback is not
  // set. React reads these to portal its header/footer nodes into the
  // vanilla-managed hosts.
  public getHeaderElement(): HTMLElement | undefined {
    return this.header.element;
  }

  public getFooterElement(): HTMLElement | undefined {
    return this.footer.element;
  }

  public getRenderedItems(): CodeViewRenderedItem<LAnnotation>[] {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1 || lastIndex < firstIndex) {
      return [];
    }

    const renderedItems: CodeViewRenderedItem<LAnnotation>[] = [];

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = this.items[index];
      if (item?.element == null) {
        continue;
      }

      if (item.type === 'diff') {
        renderedItems.push({
          id: item.item.id,
          type: 'diff',
          item: item.item,
          version: item.version,
          element: item.element,
          instance: item.instance,
        });
      } else {
        renderedItems.push({
          id: item.item.id,
          type: 'file',
          item: item.item,
          version: item.version,
          element: item.element,
          instance: item.instance,
        });
      }
    }

    return renderedItems;
  }

  public setSlotCoordinator(
    coordinator?: CodeViewCoordinator<LAnnotation>
  ): boolean {
    if (coordinator === this.slotCoordinator) {
      return false;
    }
    this.slotCoordinator = coordinator;
    this.slotSnapshot = undefined;
    return true;
  }

  public getSlotSnapshot(
    coordinator: CodeViewCoordinator<LAnnotation>
  ): CodeViewSlotSnapshot<LAnnotation> | undefined {
    return this.buildSlotSnapshot(coordinator);
  }

  // Combine the per-item slot items with the current header/footer host elements
  // into a single snapshot. Returns undefined only when there is nothing for
  // React to portal.
  private buildSlotSnapshot(
    coordinator: CodeViewCoordinator<LAnnotation>
  ): CodeViewSlotSnapshot<LAnnotation> | undefined {
    const items = getSlotItems(this.getRenderedItems(), coordinator);
    const { element: header } = this.header;
    const { element: footer } = this.footer;
    if (items == null && header == null && footer == null) {
      return undefined;
    }
    return { items, header, footer };
  }

  public subscribeToScroll(
    listener: CodeViewScrollListener<LAnnotation>
  ): () => void {
    this.scrollListeners.add(listener);
    return () => {
      this.scrollListeners.delete(listener);
    };
  }

  public getLocalTopForInstance(
    instance: VirtualizedFile<LAnnotation> | VirtualizedFileDiff<LAnnotation>
  ): number {
    const item = this.instanceToItem.get(instance);
    if (item == null) {
      throw new Error(
        'CodeView.getLocalTopForInstance: unknown virtualized instance'
      );
    }
    return item.top;
  }

  public getTopForItem(id: string): number | undefined {
    const item = this.idToItem.get(id);
    if (item == null) {
      return undefined;
    }
    return item.top + this.getItemTopOffset();
  }

  private createItem(
    input: CodeViewItem<LAnnotation>,
    index: number,
    top: number
  ): CodeViewContextItem<LAnnotation> {
    const { itemMetricsCache: itemMetrics } = this;
    if (input.type === 'diff') {
      const instance = new VirtualizedFileDiff<LAnnotation>(
        this.createDiffOptions(input.id),
        this,
        itemMetrics,
        this.workerManager,
        this.isContainerManaged
      );
      return {
        type: 'diff',
        item: input,
        version: input.version,
        index,
        top,
        height: 0,
        element: undefined,
        renderedOptionsRevision: this.renderOptionsRevision,
        instance,
      } satisfies CodeViewDiffItemContext<LAnnotation>;
    }

    const instance = new VirtualizedFile<LAnnotation>(
      this.createFileOptions(input.id),
      this,
      itemMetrics,
      this.workerManager,
      this.isContainerManaged
    );
    return {
      type: 'file',
      item: input,
      version: input.version,
      index,
      top,
      height: 0,
      element: undefined,
      renderedOptionsRevision: this.renderOptionsRevision,
      instance,
    } satisfies CodeViewFileItemContext<LAnnotation>;
  }

  private applySelectedLines(
    selection: CodeViewLineSelection | null,
    options?: SelectionWriteOptions
  ): void {
    const { selectedLines: prevSelection } = this;
    if (
      (selection == null && prevSelection == null) ||
      (selection != null &&
        prevSelection?.id === selection.id &&
        areSelectionsEqual(prevSelection.range, selection.range))
    ) {
      return;
    }

    // If we are selecting a new element and had a previous selection, null out
    // the current selection, otherwise if it's a selection on the same item
    // the next selection will take care of that for us
    if (prevSelection != null && prevSelection.id !== selection?.id) {
      this.idToItem
        .get(prevSelection.id)
        ?.instance.setSelectedLines(null, { notify: false });
    }

    this.selectedLines = selection;
    this.idToItem
      .get(selection?.id ?? '')
      ?.instance.setSelectedLines(selection?.range ?? null, options);
  }

  private syncSelection(): void {
    if (this.selectedLines == null) {
      return;
    }

    const item = this.idToItem.get(this.selectedLines.id);
    if (item == null) {
      this.selectedLines = null;
      return;
    }

    item.instance.setSelectedLines(this.selectedLines.range, { notify: false });
  }

  // An item is editable only when the app can supply editors and the item is
  // flagged for editing while expanded. Collapsing an edited item suspends
  // editing until it expands again.
  private isItemInEditMode(item: CodeViewContextItem<LAnnotation>): boolean {
    return (
      this.options.createEditor != null &&
      item.item.edit === true &&
      item.item.collapsed !== true
    );
  }

  // True when the receiving item options belong to an item currently in edit
  // mode. The edit-forced option getters use this to serve editor-required
  // values (see CODE_VIEW_EDIT_FORCED_OPTION_KEYS).
  private isReceiverEdited<TMode extends CodeViewMode>(
    receiver: CodeViewModeOptions<LAnnotation, TMode>,
    mode: TMode
  ): boolean {
    const state = getItemOptionsState(receiver);
    if (state == null) {
      return false;
    }
    const item = this.getItemOptions(state, mode);
    return item != null && this.isItemInEditMode(item);
  }

  /**
   * Attach (or lazily create) the editor for a mounted edit-mode item. Called
   * from the render loop so every mounted item passes through it: fresh
   * mounts, remounts after virtualization released the item, and items whose
   * edit flag was just turned on. Editors persist across unmounts, so a
   * remounted item re-attaches its existing editor and resumes the retained
   * document; the renderers keep the host's file/diff data in sync with the
   * session so the remount paints the edited text.
   */
  private attachItemEditor(item: CodeViewContextItem<LAnnotation>): void {
    const { id } = item.item;
    const { createEditor } = this.options;
    if (
      createEditor == null ||
      item.element == null ||
      this.attachedEditors.has(id) ||
      !this.isItemInEditMode(item)
    ) {
      return;
    }

    let record = this.itemEditors.get(id);
    if (record == null) {
      // The onChange closure resolves the owning item through the record
      // state's current id (not the id captured here) so updateItemId
      // renames keep it pointed at the right item. It also reads the change
      // callback off this.options at invocation time so later setOptions
      // swaps aren't stranded on the callback captured at creation.
      const state: CodeViewItemEditorState<LAnnotation> = { id };
      const editor = createEditor({
        onChange: (file, lineAnnotations) => {
          const latest = this.idToItem.get(state.id);
          if (latest == null) {
            return;
          }
          state.lastChange = { item: latest.item, file, lineAnnotations };
          this.options.onItemEditChange?.(latest.item, file, lineAnnotations);
        },
      });
      if (editor == null) {
        return;
      }
      record = { editor, state };
      this.itemEditors.set(id, record);
    }

    // Editing takes over the item's pointer interactions; drop any line
    // selection the item still holds. Silent, matching how syncSelection
    // drops selections whose item disappeared.
    if (this.selectedLines?.id === id) {
      this.applySelectedLines(null, { notify: false });
    }
    record.editor.edit(item.instance);
    this.attachedEditors.add(id);
  }

  /**
   * Drop editors for items that can no longer be edited: removed, edit turned
   * off, collapsed, or the createEditor option was unset. Attachment happens
   * in the render loop via attachItemEditor, so this only reconciles editors
   * CodeView is already holding.
   */
  private syncItemEditors(): void {
    if (this.itemEditors.size === 0) {
      return;
    }

    const completions: CodeViewItemEditChange<LAnnotation>[] = [];
    for (const [id, record] of this.itemEditors) {
      const item = this.idToItem.get(id);
      if (item != null && this.isItemInEditMode(item)) {
        continue;
      }
      // cleanUp is idempotent, so editors already detached by their released
      // instance are safe to clean again.
      record.editor.cleanUp();
      this.itemEditors.delete(id);
      this.attachedEditors.delete(id);
      const { lastChange } = record.state;
      if (lastChange != null) {
        // Prefer the current item record (it carries the update that ended
        // the session, e.g. edit: false); the snapshot from the last change
        // covers sessions ended by removing the item.
        completions.push(
          item == null ? lastChange : { ...lastChange, item: item.item }
        );
      }
    }

    // Fired after the reconcile loop so an onItemEditComplete handler that
    // calls back into updateItem/setItems doesn't re-enter the iteration.
    for (const { item, file, lineAnnotations } of completions) {
      this.options.onItemEditComplete?.(item, file, lineAnnotations);
    }
  }

  private renamePendingScrollTarget(oldId: string, newId: string): void {
    const { pendingScrollTarget } = this;
    if (
      pendingScrollTarget == null ||
      pendingScrollTarget.type === 'position' ||
      pendingScrollTarget.id !== oldId
    ) {
      return;
    }

    this.pendingScrollTarget = { ...pendingScrollTarget, id: newId };
  }

  private renamePendingLayoutAnchor(oldId: string, newId: string): void {
    if (this.pendingLayoutAnchor?.id === oldId) {
      this.pendingLayoutAnchor.id = newId;
    }
  }

  // CodeView owns advanced option invalidation. These item option facades only
  // answer current option reads for the item instance that keeps them for its
  // lifetime. The accessors live on per-CodeView prototypes so large viewers do
  // not allocate the full option surface for every file or diff item.
  private createFileOptionsPrototype(): FileOptions<LAnnotation> {
    const prototype = {} as FileOptions<LAnnotation>;

    for (const key of CODE_VIEW_FILE_OPTION_KEYS) {
      if (CODE_VIEW_EDIT_FORCED_OPTION_KEYS.has(key)) {
        continue;
      }
      defineItemOption<FileOptions<LAnnotation>, CodeViewFileOptionKeys>(
        prototype,
        key,
        () => this.options[key]
      );
    }

    // Edit-forced options: while the item is in edit mode these serve the
    // values Editor.edit requires so it never falls back to
    // instance.setOptions (which throws for CodeView-managed instances).
    defineItemOption(prototype, 'useTokenTransformer', (receiver) =>
      this.isReceiverEdited(receiver, 'file')
        ? true
        : this.options.useTokenTransformer
    );
    defineItemOption(prototype, 'enableGutterUtility', (receiver) =>
      this.isReceiverEdited(receiver, 'file')
        ? false
        : this.options.enableGutterUtility
    );
    defineItemOption(prototype, 'enableLineSelection', (receiver) =>
      this.isReceiverEdited(receiver, 'file')
        ? false
        : this.options.enableLineSelection
    );
    defineItemOption(prototype, 'lineHoverHighlight', (receiver) =>
      this.isReceiverEdited(receiver, 'file')
        ? 'disabled'
        : this.options.lineHoverHighlight
    );

    defineItemOption(
      prototype,
      'stickyHeader',
      () => this.options.stickyHeaders
    );
    defineItemOption(prototype, 'collapsed', (receiver) => {
      const state = getItemOptionsState(receiver);
      if (state == null) {
        return undefined;
      }
      return this.getItemOptions(state, 'file')?.item.collapsed;
    });

    for (const key of CODE_VIEW_SHARED_CALLBACK_KEYS) {
      this.defineItemSharedCallback(prototype, 'file', key);
    }
    for (const key of CODE_VIEW_SELECTION_CALLBACK_KEYS) {
      this.defineItemSelectionCallback(prototype, 'file', key);
    }

    return prototype;
  }

  private createDiffOptionsPrototype(): FileDiffOptions<LAnnotation> {
    const prototype = {} as FileDiffOptions<LAnnotation>;

    for (const key of CODE_VIEW_DIFF_OPTION_KEYS) {
      if (CODE_VIEW_EDIT_FORCED_OPTION_KEYS.has(key)) {
        continue;
      }
      defineItemOption<FileDiffOptions<LAnnotation>, CodeViewDiffOptionKeys>(
        prototype,
        key,
        () => this.options[key]
      );
    }

    // Edit-forced options: while the item is in edit mode these serve the
    // values Editor.edit requires so it never falls back to
    // instance.setOptions (which throws for CodeView-managed instances).
    // Diffs additionally require expandUnchanged so every editable line of
    // the new file is renderable.
    defineItemOption(prototype, 'useTokenTransformer', (receiver) =>
      this.isReceiverEdited(receiver, 'diff')
        ? true
        : this.options.useTokenTransformer
    );
    defineItemOption(prototype, 'enableGutterUtility', (receiver) =>
      this.isReceiverEdited(receiver, 'diff')
        ? false
        : this.options.enableGutterUtility
    );
    defineItemOption(prototype, 'enableLineSelection', (receiver) =>
      this.isReceiverEdited(receiver, 'diff')
        ? false
        : this.options.enableLineSelection
    );
    defineItemOption(prototype, 'lineHoverHighlight', (receiver) =>
      this.isReceiverEdited(receiver, 'diff')
        ? 'disabled'
        : this.options.lineHoverHighlight
    );
    defineItemOption(prototype, 'expandUnchanged', (receiver) =>
      this.isReceiverEdited(receiver, 'diff')
        ? true
        : this.options.expandUnchanged
    );

    defineItemOption(
      prototype,
      'stickyHeader',
      () => this.options.stickyHeaders
    );
    defineItemOption(
      prototype,
      'hunkSeparators',
      () => this.options.hunkSeparators
    );
    defineItemOption(prototype, 'collapsed', (receiver) => {
      const state = getItemOptionsState(receiver);
      if (state == null) {
        return undefined;
      }
      return this.getItemOptions(state, 'diff')?.item.collapsed;
    });

    for (const key of CODE_VIEW_SHARED_CALLBACK_KEYS) {
      this.defineItemSharedCallback(prototype, 'diff', key);
    }
    for (const key of CODE_VIEW_SELECTION_CALLBACK_KEYS) {
      this.defineItemSelectionCallback(prototype, 'diff', key);
    }

    return prototype;
  }

  private createFileOptions(id: string): FileOptions<LAnnotation> {
    // The per-item options object intentionally owns only hidden state. All
    // public option reads fall through to the shared prototype above.
    const options = Object.create(
      this.fileOptionsPrototype
    ) as FileOptions<LAnnotation>;
    const state: CodeViewItemOptionsState = {
      id,
    };
    defineOptionsState(options, state);
    return options;
  }

  private createDiffOptions(id: string): FileDiffOptions<LAnnotation> {
    // The per-item options object intentionally owns only hidden state. All
    // public option reads fall through to the shared prototype above.
    const options = Object.create(
      this.diffOptionsPrototype
    ) as FileDiffOptions<LAnnotation>;
    const state: CodeViewItemOptionsState = {
      id,
    };
    defineOptionsState(options, state);
    return options;
  }

  private updateItemOptionsId(
    options: FileOptions<LAnnotation> | FileDiffOptions<LAnnotation>,
    id: string
  ): void {
    const state = getItemOptionsState(options);
    if (state == null) {
      throw new Error(`CodeView.updateItemOptionsId: No valid state`);
    }
    state.id = id;
  }

  private getItemOptions<TMode extends CodeViewMode>(
    state: CodeViewItemOptionsState,
    mode: TMode
  ): CodeViewModeItemContext<LAnnotation, TMode> | undefined {
    const item = this.idToItem.get(state.id);
    if (item == null || item.type !== mode) {
      return undefined;
    }
    return item as CodeViewModeItemContext<LAnnotation, TMode>;
  }

  private defineItemSharedCallback<
    TMode extends CodeViewMode,
    TKey extends CodeViewSharedCallbackKeys,
  >(
    options: CodeViewModeOptions<LAnnotation, TMode>,
    mode: TMode,
    key: TKey
  ): void {
    defineItemOption(
      options as Record<
        TKey,
        CodeViewModeOptions<LAnnotation, TMode>[TKey] | undefined
      >,
      key,
      (receiver) => {
        const current = this.options[key] as
          | CodeViewModeOptionCallback<LAnnotation, TMode, TKey>
          | undefined;
        if (current == null) {
          return undefined;
        }

        const state = getItemOptionsState(
          receiver as CodeViewModeOptions<LAnnotation, TMode>
        );
        if (state == null) {
          return undefined;
        }
        // Allocate wrapper storage only once a callback option is actually
        // observed. Most large CodeViews never read these callback properties.
        const callbackCache = (state.callbackCache ??= {});
        let wrapped = callbackCache[key] as
          | CodeViewModeOptions<LAnnotation, TMode>[TKey]
          | undefined;
        if (wrapped == null) {
          wrapped = ((...args: unknown[]) => {
            const latest = this.getItemOptions(state, mode);
            if (latest == null) {
              return undefined;
            }
            const callback = this.options[key] as
              | CodeViewModeInternalOptionCallback<LAnnotation, TMode, TKey>
              | undefined;
            return (
              callback as ((...callbackArgs: unknown[]) => unknown) | undefined
            )?.(...args, latest);
          }) as CodeViewModeOptions<LAnnotation, TMode>[TKey];

          callbackCache[key] = wrapped;
        }

        return wrapped;
      }
    );
  }

  private defineItemSelectionCallback<
    TMode extends CodeViewMode,
    TKey extends CodeViewSelectionCallbackKeys,
  >(
    options: CodeViewModeOptions<LAnnotation, TMode>,
    mode: TMode,
    key: TKey
  ): void {
    defineItemOption(
      options as Record<
        TKey,
        CodeViewModeOptions<LAnnotation, TMode>[TKey] | undefined
      >,
      key,
      (receiver) => {
        if (this.options.enableLineSelection !== true) {
          return undefined;
        }

        const state = getItemOptionsState(
          receiver as CodeViewModeOptions<LAnnotation, TMode>
        );
        if (state == null) {
          return undefined;
        }
        // Edit mode disables line selection for the item, so its selection
        // callbacks must resolve to undefined as well.
        const item = this.getItemOptions(state, mode);
        if (item != null && this.isItemInEditMode(item)) {
          return undefined;
        }
        // Selection callbacks also use the per-item lazy cache. The wrapper
        // owns CodeView selection synchronization and then delegates to the
        // latest user callback, if one exists.
        const callbackCache = (state.callbackCache ??= {});
        let wrapped = callbackCache[key] as
          | CodeViewModeOptions<LAnnotation, TMode>[TKey]
          | undefined;
        if (wrapped == null) {
          wrapped = ((range: SelectedLineRange | null) => {
            const latest = this.getItemOptions(state, mode);
            if (latest == null) {
              return undefined;
            }

            const selection =
              range == null ? null : { id: latest.item.id, range };
            if (this.options.controlledSelection !== true) {
              if (range != null || this.selectedLines?.id === latest.item.id) {
                this.applySelectedLines(selection, { notify: false });
              }
            }

            this.options.onSelectedLinesChange?.(selection);

            const callback = this.options[key] as
              | ((
                  nextRange: SelectedLineRange | null,
                  context: CodeViewModeItemContext<LAnnotation, TMode>
                ) => unknown)
              | undefined;
            return callback?.(range, latest);
          }) as CodeViewModeOptions<LAnnotation, TMode>[TKey];

          callbackCache[key] = wrapped;
        }

        return wrapped;
      }
    );
  }

  /**
   * Track the earliest index whose measured layout may now be stale. Later
   * render passes relayout from this point forward so we do not have to rebuild
   * positions for the whole list after every change.
   */
  private markLayoutDirtyFromIndex(index: number): void {
    this.layoutDirtyIndex = Math.min(this.layoutDirtyIndex ?? index, index);
  }

  /**
   * Mark the earliest affected item as layout-dirty after an imperative change.
   * Each record carries its current array index so this stays O(1) even when
   * the viewer holds a very large number of items.
   */
  private markItemLayoutDirty(item: CodeViewContextItem<LAnnotation>): void {
    if (this.items[item.index] !== item) {
      throw new Error(
        `CodeView.markItemLayoutDirty: unknown item id "${item.item.id}"`
      );
    }

    this.markLayoutDirtyFromIndex(item.index);
  }

  /**
   * Detect the common controlled-update case where the new list simply extends
   * the existing ordered prefix. When that happens we can reuse every current
   * record in place, sync any versioned payload changes, and append only the new
   * tail instead of rebuilding the whole list.
   */
  private tryAppendItems(items: readonly CodeViewItem<LAnnotation>[]): boolean {
    if (items.length <= this.items.length) {
      return false;
    }

    for (let index = 0; index < this.items.length; index++) {
      const existingItem = this.items[index];
      if (existingItem == null) {
        throw new Error('CodeView.tryAppendItems: missing existing item');
      }
      const nextItem = items[index];
      if (
        nextItem == null ||
        existingItem.item.id !== nextItem.id ||
        existingItem.type !== nextItem.type
      ) {
        return false;
      }
    }

    for (let index = 0; index < this.items.length; index++) {
      const existingItem = this.items[index];
      if (existingItem == null) {
        throw new Error('CodeView.tryAppendItems: missing existing item');
      }
      const nextItem = items[index];
      if (nextItem == null) {
        throw new Error(
          'CodeView.tryAppendItems: append candidate missing prefix item'
        );
      }
      if (this.syncItemRecord(existingItem, nextItem)) {
        this.markLayoutDirtyFromIndex(index);
      }
    }

    this.appendItemsInternal(items.slice(this.items.length), false);
    this.scrollDirty = true;
    this.render();
    return true;
  }

  /**
   * Reconcile a new controlled item list against the existing records by id.
   * This reuses records and instances when type matches, cleans up removed
   * records, rebuilds the lookup maps, and marks layout dirty whenever order,
   * membership, or versioned item data changes.
   */
  private reconcileItems(items: readonly CodeViewItem<LAnnotation>[]): void {
    const { items: previousItems, idToItem: previousById } = this;
    const removedItems = new Set(previousItems);
    const nextItems: CodeViewContextItem<LAnnotation>[] = [];
    const nextIdToItem: Map<
      string,
      CodeViewContextItem<LAnnotation>
    > = new Map();
    const nextInstanceToItem: Map<
      VirtualizedFileDiff<LAnnotation> | VirtualizedFile<LAnnotation>,
      CodeViewContextItem<LAnnotation>
    > = new Map();
    let firstDirtyIndex: number | undefined;

    for (let index = 0; index < items.length; index++) {
      const input = items[index];
      if (input == null) {
        throw new Error('CodeView.reconcileItems: missing input item');
      }
      if (nextIdToItem.has(input.id)) {
        throw new Error(`CodeView.setItems: duplicate id "${input.id}"`);
      }

      const previousItem = previousById.get(input.id);
      const item =
        previousItem != null && previousItem.type === input.type
          ? previousItem
          : this.createItem(input, index, 0);

      item.index = index;

      if (previousItem != null && previousItem.type === input.type) {
        removedItems.delete(previousItem);
        if (this.syncItemRecord(item, input)) {
          firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
        }
      } else {
        firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
      }

      if (previousItems[index] !== item) {
        firstDirtyIndex = Math.min(firstDirtyIndex ?? index, index);
      }

      nextItems.push(item);
      nextIdToItem.set(input.id, item);
      nextInstanceToItem.set(item.instance, item);
    }

    for (let index = 0; index < previousItems.length; index++) {
      const removedItem = previousItems[index];
      if (removedItem == null || !removedItems.has(removedItem)) {
        continue;
      }
      this.releaseRenderedItem(removedItem);
      const dirtyIndex = Math.max(nextItems.length - 1, 0);
      firstDirtyIndex = Math.min(firstDirtyIndex ?? dirtyIndex, dirtyIndex);
    }

    if (firstDirtyIndex == null) {
      return;
    }

    this.items = nextItems;
    this.idToItem = nextIdToItem;
    this.instanceToItem = nextInstanceToItem;

    if (this.renderState.firstIndex >= nextItems.length) {
      this.resetRenderState();
    } else if (this.renderState.lastIndex >= nextItems.length) {
      this.renderState.lastIndex = nextItems.length - 1;
    }

    this.markLayoutDirtyFromIndex(firstDirtyIndex);
    this.scrollDirty = true;
    this.render();
  }

  /**
   * Update a reused record from the latest controlled item only when its item
   * version changes. Matching versions mean CodeView keeps the current record
   * snapshot, which lets imperative updates remain in place until the caller
   * intentionally publishes a newer version.
   */
  private syncItemRecord(
    item: CodeViewContextItem<LAnnotation>,
    nextItem: CodeViewItem<LAnnotation>
  ): boolean {
    if (item.type !== nextItem.type) {
      throw new Error(
        `CodeView.syncItemRecord: type mismatch for id "${nextItem.id}"`
      );
    }

    if (item.version === nextItem.version) {
      return false;
    }

    item.item = nextItem;
    item.version = nextItem.version;
    item.renderedOptionsRevision = -1;
    return true;
  }

  private getMaxScrollTopForHeight(scrollHeight: number): number {
    const { paddingBottom, paddingTop } = this.getLayout();
    // The header/footer hosts live in `root` outside `container`, so they add to
    // the real scrollable range on top of the items + padding.
    return Math.max(
      paddingTop +
        this.header.height +
        scrollHeight +
        this.footer.height +
        paddingBottom -
        this.getHeight(),
      0
    );
  }

  private getMaxScrollTop(): number {
    return this.getMaxScrollTopForHeight(this.getScrollHeight());
  }

  private shouldRebaseScroll(): boolean {
    return this.getMaxScrollTop() > SCROLL_REBASE_THRESHOLD;
  }

  private getPagedScrollHeight(): number {
    return this.shouldRebaseScroll()
      ? Math.min(this.getScrollHeight(), SCROLL_REBASE_CONTAINER_HEIGHT)
      : this.getScrollHeight();
  }

  private getMaxPagedScrollTop(): number {
    return this.getMaxScrollTopForHeight(this.getPagedScrollHeight());
  }

  private clampPagedScrollTop(value: number): number {
    const maxScroll = this.getMaxPagedScrollTop();
    return Math.max(0, Math.min(value, maxScroll));
  }

  /**
   * Clamps a logical scroll position to the min/max allowable scroll range
   * based on the full computed content height.
   */
  private clampScrollTop(value: number): number {
    const maxScroll = this.getMaxScrollTop();
    return Math.max(0, Math.min(value, maxScroll));
  }

  private getMaxScrollPageOffset(): number {
    return Math.max(this.getMaxScrollTop() - this.getMaxPagedScrollTop(), 0);
  }

  private clampScrollPageOffset(value: number): number {
    const maxOffset = this.getMaxScrollPageOffset();
    return Math.max(0, Math.min(value, maxOffset));
  }

  private resolveScrollPageWindow(
    scrollTop: number,
    preferredPagedScrollTop: number
  ): { pagedScrollTop: number; scrollPageOffset: number } {
    let pagedScrollTop = roundToDevicePixel(
      this.clampPagedScrollTop(preferredPagedScrollTop)
    );
    let scrollPageOffset = this.clampScrollPageOffset(
      scrollTop - pagedScrollTop
    );

    pagedScrollTop = roundToDevicePixel(
      this.clampPagedScrollTop(scrollTop - scrollPageOffset)
    );
    scrollPageOffset = this.clampScrollPageOffset(scrollTop - pagedScrollTop);
    return { pagedScrollTop, scrollPageOffset };
  }

  /**
   * Resolve how a logical scrollTop maps onto the reusable paged scroll window
   * without mutating the current page offset.
   */
  private resolvePagedScrollPosition(
    logicalScrollTop: number
  ): PagedScrollPosition {
    if (!this.shouldRebaseScroll()) {
      return {
        pagedScrollTop: this.clampPagedScrollTop(logicalScrollTop),
        scrollPageOffset: 0,
      };
    }

    const currentPageOffset = this.clampScrollPageOffset(this.scrollPageOffset);

    const pagedScrollTop = logicalScrollTop - currentPageOffset;
    const pagedMaxScrollTop = this.getMaxPagedScrollTop();
    const maxRebaseOffset = this.getMaxScrollPageOffset();
    const shouldMoveDown =
      pagedScrollTop > SCROLL_REBASE_THRESHOLD &&
      currentPageOffset < maxRebaseOffset;
    const shouldMoveUp =
      pagedScrollTop < SCROLL_REBASE_TRIGGER_TOP && currentPageOffset > 0;

    if (
      pagedScrollTop < 0 ||
      pagedScrollTop > pagedMaxScrollTop ||
      shouldMoveDown ||
      shouldMoveUp
    ) {
      const nextWindow = this.resolveScrollPageWindow(
        logicalScrollTop,
        shouldMoveUp
          ? Math.min(SCROLL_REBASE_TARGET_BOTTOM, pagedMaxScrollTop)
          : SCROLL_REBASE_TARGET_TOP
      );
      return nextWindow;
    }

    return {
      pagedScrollTop: roundToDevicePixel(
        this.clampPagedScrollTop(pagedScrollTop)
      ),
      scrollPageOffset: currentPageOffset,
    };
  }

  private needsScrollPageUpdate(logicalScrollTop: number): boolean {
    const roundedScrollTop = roundToDevicePixel(
      this.clampScrollTop(logicalScrollTop)
    );
    const { scrollPageOffset } =
      this.resolvePagedScrollPosition(roundedScrollTop);
    return scrollPageOffset !== this.scrollPageOffset;
  }

  private getPagedLayoutTop(logicalTop: number): number {
    if (!this.shouldRebaseScroll()) {
      return logicalTop;
    }
    return Math.max(logicalTop - this.scrollPageOffset, 0);
  }

  private getStickyHeaderOffset(): number {
    return this.options.stickyHeaders === true &&
      this.options.disableFileHeader !== true
      ? this.itemMetricsCache.diffHeaderHeight
      : 0;
  }

  private getScrollTargetRect(
    target:
      | CodeViewItemScrollTarget
      | CodeViewLineScrollTarget
      | CodeViewRangeScrollTarget
  ): { top: number; height: number } | undefined {
    const item = this.idToItem.get(target.id);
    if (item == null) {
      console.warn(`CodeView.scrollTo: unknown item id "${target.id}"`);
      return undefined;
    }

    if (target.type === 'item') {
      return { top: item.top, height: item.height };
    }

    if (target.type === 'range') {
      const rangePosition = this.getRangeScrollPosition(item, target);
      if (rangePosition == null) {
        console.warn(
          `CodeView.scrollTo: unable to resolve range ${formatSelectedLineRange(target.range)} for item "${target.id}"`
        );
        return undefined;
      }

      return {
        top: item.top + rangePosition.top,
        height: rangePosition.height,
      };
    }

    const linePosition = this.getLineScrollPosition(item, target);
    if (linePosition == null) {
      console.warn(
        `CodeView.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`
      );
      return undefined;
    }

    return {
      top: item.top + linePosition.top,
      height: linePosition.height,
    };
  }

  private normalizeScrollTarget(
    target: CodeViewScrollTarget
  ): PendingScrollTarget | undefined {
    if (target.type === 'position' || target.align !== 'nearest') {
      return target as PendingScrollTarget;
    }

    const rect = this.getScrollTargetRect(target);
    if (rect == null) {
      return undefined;
    }

    // Determine a stable scrollTo target for `nearest` alignment. This is to
    // ensure that we don't experience any scroll bouncing
    const offset = target.offset ?? 0;
    const targetTop = this.getItemTopOffset() + rect.top;
    const targetBottom = targetTop + rect.height;
    const currentTop = this.getScrollTop();
    const visibleTop =
      currentTop +
      (target.type === 'line' || target.type === 'range'
        ? this.getStickyHeaderOffset()
        : 0);
    const visibleBottom = currentTop + this.getHeight();

    // If the item is spanning beyond the full viewport,
    // do nothing as it's already in view
    if (
      targetTop - offset <= visibleTop &&
      targetBottom + offset >= visibleBottom
    ) {
      return undefined;
    }

    // Let's use the top as the target
    if (targetTop - offset < visibleTop) {
      return { ...target, align: 'start' };
    }

    // Let's use the top as the target
    if (targetBottom + offset > visibleBottom) {
      return { ...target, align: 'end' };
    }

    // The element is already in view, nothing to do.
    return undefined;
  }

  /**
   * Resolve a target's scroll position

   * Returns `undefined` when we can't resolve a target for whatever reason
   */
  private resolveScrollTargetTop(
    target: PendingScrollTarget
  ): number | undefined {
    if (target.type === 'position') {
      const clampedPosition = this.clampScrollTop(target.position);
      return clampedPosition !== target.position
        ? // If our position was clamped, we we shouldn't apply the sticky offset
          clampedPosition
        : this.clampScrollTop(target.position - this.getStickyHeaderOffset());
    }

    const item = this.idToItem.get(target.id);
    if (item == null) {
      console.warn(`CodeView.scrollTo: unknown item id "${target.id}"`);
      return undefined;
    }

    if (target.type === 'item') {
      return this.clampScrollTop(
        this.resolveAlignedScrollPosition(
          item.top,
          item.height,
          target.align,
          target.offset
        )
      );
    }

    if (target.type === 'range') {
      const rangePosition = this.getRangeScrollPosition(item, target);
      if (rangePosition == null) {
        console.warn(
          `CodeView.scrollTo: unable to resolve range ${formatSelectedLineRange(target.range)} for item "${target.id}"`
        );
        return undefined;
      }

      return this.clampScrollTop(
        this.resolveAlignedScrollPosition(
          item.top + rangePosition.top,
          rangePosition.height,
          target.align,
          target.offset,
          this.getStickyHeaderOffset()
        )
      );
    }

    const linePosition = this.getLineScrollPosition(item, target);
    if (linePosition == null) {
      console.warn(
        `CodeView.scrollTo: unable to resolve line ${target.lineNumber} for item "${target.id}"`
      );
      return undefined;
    }

    return this.clampScrollTop(
      this.resolveAlignedScrollPosition(
        item.top + linePosition.top,
        linePosition.height,
        target.align,
        target.offset,
        this.getStickyHeaderOffset()
      )
    );
  }

  /**
   * Given an existing scroll target (scroll top and height), figure out the
   * correct scroll position to target based on the desired alignment, offset
   * and stickyOffset if necessary
   */
  private resolveAlignedScrollPosition(
    // REVIEW: lets turn this into a named interface object, essentially named
    // arguments that can't be confused/reversed
    targetTop: number,
    targetHeight: number,
    align: PendingAlignTypes,
    offset = 0,
    stickyOffset = 0
  ): number {
    // targetTop is item-space (0 = first item's top); shift it into absolute
    // scroll coordinates. getItemTopOffset includes the header height, so
    // scrolling to an item/line lands correctly when a header is present.
    targetTop += this.getItemTopOffset();
    const viewportHeight = this.getHeight();
    // If the item + offset is bigger than the viewport, we'll fall back to
    // 'start'
    if (align === 'center' && targetHeight + offset < viewportHeight) {
      return targetTop - (viewportHeight - targetHeight) / 2 + offset;
    }
    if (align === 'end') {
      return targetTop - (viewportHeight - targetHeight) + offset;
    }
    // 'start', the default
    return targetTop - stickyOffset - offset;
  }

  private getLineScrollPosition(
    item: CodeViewContextItem<LAnnotation>,
    target: CodeViewLineScrollTarget
  ): LineScrollPosition | undefined {
    if (item.type === 'diff') {
      return item.instance.getLinePosition(target.lineNumber, target.side);
    }

    return item.instance.getLinePosition(target.lineNumber);
  }

  private getRangeScrollPosition(
    item: CodeViewContextItem<LAnnotation>,
    target: CodeViewRangeScrollTarget
  ): LineScrollPosition | undefined {
    const { range } = target;
    const startPosition = this.getLineScrollPosition(item, {
      type: 'line',
      id: target.id,
      lineNumber: range.start,
      side: range.side,
    });
    const endPosition = this.getLineScrollPosition(item, {
      type: 'line',
      id: target.id,
      lineNumber: range.end,
      side: range.endSide ?? range.side,
    });
    if (startPosition == null || endPosition == null) {
      return undefined;
    }

    const startTop = startPosition.top;
    const startBottom = startTop + startPosition.height;
    const endTop = endPosition.top;
    const endBottom = endTop + endPosition.height;
    const top = Math.min(startTop, endTop);
    const bottom = Math.max(startBottom, endBottom);
    return { top, height: bottom - top };
  }

  /**
   * Determine target scroll position for current frame.
   *
   * If there's no pendingScrollTarget then we just return the current scroll
   * position
   *
   * If there's a pendingScrollTarget then we depend on whether there's a
   * smooth scroll animation or not. If not just return the destination, or
   * compute next position given the smooth scroll spring physics
   */
  private computeTargetScrollTopForFrame(
    scrollTop: number,
    frameTimestamp: number
  ): number {
    if (this.pendingScrollTarget == null) {
      return scrollTop;
    }
    const destination = this.resolveScrollTargetTop(this.pendingScrollTarget);
    if (destination == null) {
      return scrollTop;
    }
    const { scrollAnimation } = this;
    if (scrollAnimation == null) {
      return destination;
    }
    return this.computeSpringStep(scrollAnimation, destination, frameTimestamp)
      .position;
  }

  /**
   * Closed-form critical-damped ODE step.
   *
   * Stable at any dt (Euler would blow up once ω·dt ≳ 1), so this survives
   * big RAF gaps (tab-wake, offscreen frames) and resize-driven ticks that
   * fire outside the normal RAF cadence.
   */
  private computeSpringStep(
    animation: ScrollToAnimation,
    destination: number,
    frameTimestamp: number
  ): SpringStepResult {
    const dt = Math.max(0, frameTimestamp - animation.lastTimestamp);
    const { omega } = this.getSmoothScrollSettings();
    const decay = Math.exp(-omega * dt);
    const displacement = animation.position - destination;
    const springCoeff = animation.velocity + omega * displacement;
    const position = destination + (displacement + springCoeff * dt) * decay;
    const velocity =
      (springCoeff * (1 - omega * dt) - omega * displacement) * decay;
    return { position, velocity };
  }

  /**
   * For any given pendingScrollTarget, updates any in flight smooth scroll
   * animations and returns the target scrollTop to move towards
   *
   * Resolves the animation based on frame time and adopts any necessary scroll
   * anchoring corrections if necessary
   */
  private advanceScrollAnimation(
    frameTimestamp: number,
    anchorDelta: number
  ): number | undefined {
    if (this.pendingScrollTarget == null) {
      return undefined;
    }
    const destination = this.resolveScrollTargetTop(this.pendingScrollTarget);
    if (destination == null) {
      this.pendingScrollTarget = undefined;
      this.scrollAnimation = undefined;
      return undefined;
    }
    const animation = this.scrollAnimation;
    if (animation == null) {
      return destination;
    }

    animation.position += anchorDelta;

    const { position, velocity } = this.computeSpringStep(
      animation,
      destination,
      frameTimestamp
    );
    animation.lastTimestamp = frameTimestamp;
    animation.position = position;
    animation.velocity = velocity;

    const { positionEpsilon, velocityEpsilon } = this.getSmoothScrollSettings();
    if (
      Math.abs(destination - position) <= positionEpsilon &&
      Math.abs(velocity) <= velocityEpsilon
    ) {
      animation.position = destination;
      animation.velocity = 0;
      this.scrollAnimation = undefined;
      return destination;
    }

    return animation.position;
  }

  private computeRenderRangeAndEmit = (
    timestamp: number = performance.now()
  ): void => {
    if (CodeView.__STOP || this.container == null) {
      return;
    }
    if (!this.isReady()) {
      return;
    }

    // Read the current viewport and logical scroll position before making DOM
    // mutations, then capture an anchor that can survive layout recalculation.
    const viewportHeight = this.getHeight();
    const initialScrollTop = this.getScrollTop();
    let scrollTopAfterLayout = initialScrollTop;
    // Typically a pendingLayoutAnchor will be created from a setOptions call,
    // that will force us to attempt to fit to a new scroll position to not
    // allow the viewport to jump around on us. This can also be triggered
    // later on if a particular item marks itself as dirty
    let computeScrollCorrection = this.pendingLayoutAnchor != null;
    // We need to grab the anchor before we re-compute any layout updates, or
    // else we'll get invalid anchor reference data.  If we have a
    // pendingLayoutAnchor it will just grab that for us instead of attempting
    // to compute one
    let scrollAnchor = this.getScrollAnchor(scrollTopAfterLayout);

    // If any item marked itself as difty, we should re-compute everything
    // after it and then force a new scroll top correction if we aren't already
    if (this.layoutDirtyIndex != null) {
      this.recomputeLayout(this.layoutDirtyIndex, this.pendingLayoutReset);
      this.layoutDirtyIndex = undefined;
      this.pendingLayoutReset = undefined;
      computeScrollCorrection = true;
    }

    // If layout shifted, resolve the logical scrollTop that keeps the captured
    // anchor in the same viewport position.
    if (computeScrollCorrection && scrollAnchor != null) {
      const anchoredScrollTopAfterLayout =
        this.resolveAnchoredScrollTop(scrollAnchor);
      if (anchoredScrollTopAfterLayout != null) {
        const layoutAnchorDelta =
          anchoredScrollTopAfterLayout - scrollTopAfterLayout;
        scrollTopAfterLayout = anchoredScrollTopAfterLayout;
        if (this.scrollAnimation != null) {
          // If we have a delta measurement adjustment, we have to pass that
          // change onto the scroll animation to ensure the animation remains
          // stable, later on
          this.scrollAnimation.position += layoutAnchorDelta;
        }
      }
    }
    // Recomputing layout can shrink the scroll range, for example when items
    // collapse, so clamp current scroll position and update DOM so scroll
    // changes are valid before deriving the render window for this frame.
    if (computeScrollCorrection) {
      scrollTopAfterLayout = this.clampScrollTop(scrollTopAfterLayout);
      this.syncContainerHeight();
    }

    // Resolve the logical scrollTop this render frame should target. The paged
    // root scrollTop is derived later only if the scaffold needs to move.
    const targetScrollTop = this.computeTargetScrollTopForFrame(
      scrollTopAfterLayout,
      timestamp
    );

    // When performing very large scroll jumps, we should attempt to render the
    // bare minimum to ensure we can paint quickly. We'll queue up another
    // render at the end to fill things out on the next tick. If we had to
    // correct layout-adjusted scroll state then we should not fitPerfectly
    // because there's a good chance we'll be re-rendering the same elements
    // again
    const fitPerfectly =
      !computeScrollCorrection &&
      (this.renderState.scrollTop === -1 ||
        Math.abs(targetScrollTop - this.renderState.scrollTop) >
          viewportHeight + this.config.overscrollSize * 2);

    // If we are doing a `fitPerfectly` render it means we are rendering
    // completely new content which means no need to scroll fix anything
    if (fitPerfectly) {
      scrollAnchor = undefined;
    }

    // Compute the projected logical window, then synchronize the paged scroll
    // scaffold before mutating rendered items.
    this.windowSpecs = createWindowFromScrollPosition({
      // The window is in item-space (0 = first item's top); subtract the header so
      // a tall header can't desync which items fall inside the render window.
      scrollTop: targetScrollTop - this.header.height,
      height: viewportHeight,
      scrollHeight: this.getScrollHeight(),
      fitPerfectly,
      fitPerfectlyOverscroll: this.getFitPerfectlyOverscroll(),
      overscrollSize: this.config.overscrollSize,
    });
    let syncedScrollTop = initialScrollTop;
    if (
      (this.pendingScrollTarget != null &&
        targetScrollTop !== syncedScrollTop) ||
      this.needsScrollPageUpdate(targetScrollTop)
    ) {
      // Apply programmatic scrolls and user-driven page rebases before DOM
      // mutations so the browser reconciles the render against the right
      // paged scroll position.
      this.applyScrollFix(targetScrollTop, syncedScrollTop, this.windowSpecs);
      syncedScrollTop = targetScrollTop;
    }

    // Reconcile the currently mounted DOM against the new projected render
    // window, cleaning up any elements that are no longer visible.
    const { top, bottom } = this.windowSpecs;
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex >= 0) {
      for (let index = firstIndex; index <= lastIndex; index++) {
        const item = this.items[index];
        if (item == null) {
          throw new Error(
            `CodeView.computeRenderRangeAndEmit: No item at index: ${index}`
          );
        }
        const isVisible = item.top > top - item.height && item.top <= bottom;
        // If not visible, we should unmount it and clean it up
        if (!isVisible) {
          this.releaseRenderedItem(item);
        }
      }
    }

    // Mount/unmount/re-populate the header/footer hosts in the same DOM-mutation
    // window as the items, after the scroll anchor was captured above and before
    // the post-render anchor resolve below.
    const hostsChanged = this.reconcileHeaderFooterHosts();

    let prevElement: HTMLElement | undefined;
    const updatedItems = new Set<CodeViewContextItem<LAnnotation>>();
    const startingIndex = this.findFirstVisibleIndex(top);
    const lastRenderedIndex = this.findLastVisibleIndex(bottom);

    for (
      let itemIndex = startingIndex;
      itemIndex <= lastRenderedIndex;
      itemIndex++
    ) {
      const item = this.items[itemIndex];
      if (item == null) {
        throw new Error(`CodeView.computeRenderRangeAndEmit: missing item`);
      }
      const { instance } = item;
      // If the item isn't rendered yet, we need to create a wrapper element
      // for it and render it
      if (item.element == null) {
        item.element = this.acquireElement();
        syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
        instance.virtualizedSetup();
        if (renderItem(item, item.element)) {
          item.renderedOptionsRevision = this.renderOptionsRevision;
          updatedItems.add(item);
        }
        prevElement = item.element;
      }
      // Otherwise kick off a render as necessary
      else {
        syncRenderedItemOrder(this.stickyContainer, item.element, prevElement);
        const forceRender =
          item.renderedOptionsRevision !== this.renderOptionsRevision;
        if (renderItem(item, undefined, forceRender)) {
          item.renderedOptionsRevision = this.renderOptionsRevision;
          updatedItems.add(item);
        }
        prevElement = item.element;
      }
      // Bind editors after the item render kicked off; attachItemEditor
      // no-ops unless the item is in edit mode and not already attached.
      if (item.item.edit === true) {
        this.attachItemEditor(item);
      }
    }

    this.renderState.firstIndex =
      startingIndex <= lastRenderedIndex ? startingIndex : -1;
    this.renderState.lastIndex = lastRenderedIndex;

    this.flushSlotCoordinator();
    this.flushManagers(updatedItems);
    // Read phase: measure a freshly mounted or re-populated host now so its
    // getBoundingClientRect batches into the same reflow as the item height reads.
    if (hostsChanged) {
      this.measureMountedHosts();
    }
    this.reconcileRenderedItems(updatedItems);
    this.syncContainerHeight();
    this.updateStickyPositioning();

    // Now that the dom has been flushed and we've computed our updated
    // item/line metrics, we should attempt to resolve any scroll anchors and
    // scroll animation data.  We have already applied the desired scroll
    // position before rendering, so the only scroll changes should be to
    // scrollFix from lines that did not match their computed state.
    //
    // - No pending scrollTo target → Only attempt to scrollFix if there's a
    //   mismatch
    // - Instant pending scrollTo target → Resolve target anchor position and
    //   apply any necessary scroll fixes
    // - Smooth pending scrollTo target → Apply necessary scrollFix if
    //   necessary and rebase/update the outstanding spring animation values.
    const anchoredScrollTopAfterRender =
      scrollAnchor != null
        ? this.resolveAnchoredScrollTop(scrollAnchor)
        : undefined;
    if (scrollAnchor === this.pendingLayoutAnchor) {
      this.pendingLayoutAnchor = undefined;
    }
    // The amount of computed layout shift from the render
    const postRenderAnchorDelta =
      anchoredScrollTopAfterRender != null
        ? anchoredScrollTopAfterRender - scrollTopAfterLayout
        : 0;

    let postRenderScrollTop = targetScrollTop;
    let shouldCheckPendingTargetSettled = false;
    if (this.pendingScrollTarget != null) {
      const pendingTargetScrollTop = this.advanceScrollAnimation(
        timestamp,
        postRenderAnchorDelta
      );
      if (pendingTargetScrollTop != null) {
        postRenderScrollTop = pendingTargetScrollTop;
        shouldCheckPendingTargetSettled = true;
      }
      // If something bad happened with our pending scroll target, then we'd
      // fall back here. Unlikely to happen in practice, but we need to reset
      // the scrollTop if so
      else {
        postRenderScrollTop = scrollTopAfterLayout;
      }
    } else {
      postRenderScrollTop = anchoredScrollTopAfterRender ?? targetScrollTop;
    }
    // If the new intended scroll position has changed, we should apply that
    // now to bring everything in line
    if (postRenderScrollTop !== syncedScrollTop) {
      this.applyScrollFix(
        postRenderScrollTop,
        syncedScrollTop,
        this.windowSpecs
      );
      syncedScrollTop = postRenderScrollTop;
    }
    if (
      shouldCheckPendingTargetSettled &&
      this.pendingScrollTarget != null &&
      this.isPendingTargetSettled(this.pendingScrollTarget)
    ) {
      this.pendingScrollTarget = undefined;
      this.scrollAnimation = undefined;
    }
    this.renderState.scrollTop = roundToDevicePixel(syncedScrollTop);

    // The post-render scroll-correction block above can call applyScrollFix ->
    // syncPagedScrollScaffolding -> applyStickyPositioning, which recomputes
    // renderState.stickyHeight from getStickyBounds(windowSpecs) for the
    // corrected scroll position. The rendered DOM slice was committed earlier in
    // this frame for the pre-correction window and is not re-rendered here, so
    // that windowSpecs-based value can diverge from the committed slice by the
    // scroll-correction delta. Recompute sticky positioning from the committed
    // renderRange (no-arg path) so renderState.stickyHeight matches the slice
    // actually in the DOM before we validate it.
    this.updateStickyPositioning();

    this.validateStickyContainerHeight();
    this.fixContainerFocus();

    // If we are hitting a fitPerfectly heuristic, we should queue up another
    // render to fill out content. If we are performing a scroll animation we'll
    // need another render to continue.
    if (fitPerfectly || this.scrollAnimation != null) {
      this.render();
    }
  };

  private flushManagers(
    updatedItems: Set<CodeViewContextItem<LAnnotation>>
  ): void {
    for (const item of updatedItems) {
      item.instance.flushManagers();
    }
  }

  private syncContainerHeight(): void {
    const pagedScrollHeight = this.getPagedScrollHeight();
    if (this.container == null || this.containerHeight === pagedScrollHeight) {
      return;
    }

    this.container.style.height = `${pagedScrollHeight}px`;
    this.containerHeight = pagedScrollHeight;
  }

  private getStickyBounds(
    windowSpecs?: VirtualWindowSpecs
  ): StickyBounds | undefined {
    const { firstIndex, lastIndex } =
      windowSpecs != null
        ? {
            firstIndex: this.findFirstVisibleIndex(windowSpecs.top),
            lastIndex: this.findLastVisibleIndex(windowSpecs.bottom),
          }
        : this.renderState;

    if (firstIndex === -1 || lastIndex === -1 || firstIndex > lastIndex) {
      return undefined;
    }
    const firstStickySpecs =
      this.items[firstIndex]?.instance.getAdvancedStickySpecs(windowSpecs);
    const lastStickySpecs =
      this.items[lastIndex]?.instance.getAdvancedStickySpecs(windowSpecs);

    if (firstStickySpecs == null || lastStickySpecs == null) {
      return undefined;
    }

    return {
      stickyTop: this.getPagedLayoutTop(
        Math.max(firstStickySpecs.topOffset, 0)
      ),
      stickyBottom: this.getPagedLayoutTop(
        lastStickySpecs.topOffset + lastStickySpecs.height
      ),
    };
  }

  private applyStickyPositioning({
    stickyTop,
    stickyBottom,
  }: StickyBounds): void {
    const height = this.getHeight();
    const { itemMetricsCache: itemMetrics } = this;
    const stickyContainerHeight = stickyBottom - stickyTop;

    this.renderState.stickyHeight = stickyContainerHeight;
    this.renderState.stickyTop = stickyTop;
    this.renderState.stickyBottom = stickyBottom;

    this.stickyOffset.style.height = `${stickyTop}px`;
    // NOTE(amadeus): Wee polish lad -- when dragging the scrollbar up or
    // down quickly, this prevents the laggy scroll view from lining up with
    // the numbers exactly
    const randomOffset = ((Math.random() * itemMetrics.lineHeight) >> 0) * -1;
    const stickyJitter =
      -Math.max(stickyContainerHeight + randomOffset, 0) + height;
    this.stickyContainer.style.top = `${stickyJitter}px`;
    this.stickyContainer.style.bottom = `${stickyJitter + itemMetrics.diffHeaderHeight}px`;
  }

  private syncPagedScrollScaffolding(windowSpecs: VirtualWindowSpecs): void {
    this.syncContainerHeight();
    const stickyBounds = this.getStickyBounds(windowSpecs);
    if (stickyBounds == null) {
      return;
    }
    this.applyStickyPositioning(stickyBounds);
  }

  private reconcileRenderedItems(
    updatedItems?: Set<CodeViewContextItem<LAnnotation>>
  ): void {
    const { firstIndex, lastIndex } = this.renderState;
    if (firstIndex === -1) {
      return;
    }

    let currentTop = -1;
    let heightChanged = false;
    // Iterate through the rendered items to reconcile height. If a height
    // has changed, we'll have to iterate all the way till the end to update
    // all appropriate heights
    for (let index = firstIndex; index < this.items.length; index++) {
      // If we've incurred no height changes and ended, we can abort
      if (!heightChanged && index > lastIndex) {
        break;
      }
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeView.reconcileRenderedItems: Invalid item');
      }
      if (currentTop === -1) {
        currentTop = item.top;
      } else if (item.top !== currentTop) {
        item.top = currentTop;
        item.instance.syncVirtualizedTop();
        heightChanged = true;
      }
      // If updatedInstances provided, only reconcile those. If not provided
      // (resize path), reconcile all rendered items.
      if (updatedItems == null ? index <= lastIndex : updatedItems.has(item)) {
        if (item.instance.reconcileHeights()) {
          heightChanged = true;
          item.height = item.instance.getVirtualizedHeight();
        }
        this.validateRenderedItemHeight(item);
      }
      currentTop += item.instance.getVirtualizedHeight();
      if (index < this.items.length - 1) {
        currentTop += this.getLayout().gap;
      }
    }

    if (heightChanged && currentTop != null) {
      this.scrollDirty = true;
      this.scrollHeight = currentTop;
    }
  }

  private updateStickyPositioning(): void {
    const stickyBounds = this.getStickyBounds();
    if (stickyBounds == null) {
      return;
    }
    const { stickyTop, stickyBottom } = stickyBounds;
    const stickyContainerHeight = stickyBottom - stickyTop;

    if (
      stickyContainerHeight === this.renderState.stickyHeight &&
      stickyTop === this.renderState.stickyTop &&
      stickyBottom === this.renderState.stickyBottom
    ) {
      return;
    }

    this.applyStickyPositioning(stickyBounds);
  }

  private handleScroll = (): void => {
    if (CodeView.__STOP) {
      return;
    }
    this.suspendScrollInteractions();
    this.scrollDirty = true;
    this.notifyScroll();
    this.render();
  };

  // Abort any in-flight programmatic scroll when the user takes over.
  // Attached to root as a passive listener for wheel / touchstart /
  // pointerdown / keydown; we never mutate the event, just drop our state.
  private clearPendingScroll = (): void => {
    this.pendingScrollTarget = undefined;
    this.pendingLayoutAnchor = undefined;
    this.scrollAnimation = undefined;
  };

  private handleResize = (entries: ResizeObserverEntry[]) => {
    for (const entry of entries) {
      // If the sticky container resizes (could be from a render, which it will
      // probably ignore) or if an annotation or line wrap triggers a resize
      if (entry.target === this.stickyContainer) {
        const blockSize = entry.borderBoxSize[0].blockSize;
        // If the height of the sticky container was already known, there's
        // nothing for us to do
        if (blockSize !== this.renderState.stickyHeight) {
          // If content resizes above the viewport, we want to be sure that it
          // doesn't cause things to jump within the viewport
          const currentScrollTop = this.getScrollTop();
          const anchor = this.getScrollAnchor(currentScrollTop);

          this.reconcileRenderedItems();
          this.updateStickyPositioning();

          const anchoredScrollTop =
            anchor != null ? this.resolveAnchoredScrollTop(anchor) : undefined;
          if (anchoredScrollTop != null) {
            const resizeAnchorDelta = anchoredScrollTop - currentScrollTop;
            this.applyScrollFix(
              anchoredScrollTop,
              currentScrollTop,
              this.windowSpecs
            );
            if (this.scrollAnimation != null) {
              // if we had to apply a scroll fix then we should make sure to
              // match the scroll fix delta to the scrollAnimation position to
              // ensure the animation continues smoothly as if the scroll fix
              // never happened
              this.scrollAnimation.position += resizeAnchorDelta;
            }
          }
          if (
            this.pendingScrollTarget != null &&
            this.isPendingTargetSettled(this.pendingScrollTarget)
          ) {
            this.pendingScrollTarget = undefined;
            this.scrollAnimation = undefined;
          }
        }
      }
      // A header/footer host resized after mount (async content, fonts, a React
      // portal filling in). Re-measure and, for a header — which lives above the
      // items — re-anchor so the content under the user's eyes doesn't jump,
      // mirroring the stickyContainer branch above. Items are untouched by a host
      // resize, so we skip reconcileRenderedItems/updateStickyPositioning; the
      // trailing render() reconciles the range and render window.
      else if (
        entry.target === this.header.element ||
        entry.target === this.footer.element
      ) {
        const host =
          entry.target === this.header.element ? this.header : this.footer;
        const blockSize = entry.borderBoxSize[0].blockSize;
        if (blockSize !== host.height) {
          // Capture the anchor with the OLD offset, apply the new height, then
          // resolve with the NEW offset so the delta cancels the layout shift. A
          // footer only changes the scroll range, so its anchor resolves to no
          // change (or a clamp when it shrinks below the current scroll).
          const currentScrollTop = this.getScrollTop();
          const anchor = this.getScrollAnchor(currentScrollTop);
          this.setHostHeight(host, blockSize);
          const anchoredScrollTop =
            anchor != null ? this.resolveAnchoredScrollTop(anchor) : undefined;
          if (anchoredScrollTop != null) {
            const resizeAnchorDelta = anchoredScrollTop - currentScrollTop;
            this.applyScrollFix(
              anchoredScrollTop,
              currentScrollTop,
              this.windowSpecs
            );
            if (this.scrollAnimation != null) {
              this.scrollAnimation.position += resizeAnchorDelta;
            }
          }
          if (
            this.pendingScrollTarget != null &&
            this.isPendingTargetSettled(this.pendingScrollTarget)
          ) {
            this.pendingScrollTarget = undefined;
            this.scrollAnimation = undefined;
          }
          this.render();
        }
      }
      // Root element resize (element-mode only)
      else {
        this.scrollDirty = true;
        this.heightDirty = true;
        this.render();
      }
    }
  };

  /**
   * Figure out scrollTop accounting for sticky header if enabled and
   * necessary
   */
  private getScrollAnchorViewportTop(
    absoluteItemTop: number,
    scrollTop: number
  ): number {
    return absoluteItemTop < scrollTop
      ? scrollTop + this.getStickyHeaderOffset()
      : scrollTop;
  }

  /**
   * Attempt to find a scroll anchor based on build in metrics of the existing
   * rendered files/diff.
   *
   * A scroll anchor represents the first fully visible element (in other
   * words, the first file or first line who's top is fully in the viewport).
   */
  private getScrollAnchor(scrollTop: number): ScrollAnchor | undefined {
    // If we already have a pendingLayoutAnchor, let's use that.
    if (this.pendingLayoutAnchor != null) {
      return this.pendingLayoutAnchor;
    }

    // We shouldn't scroll anchor when at the top, this way if a custom header
    // gets asynchronously added it won't be hidden when added.  Also like,
    // logically it doesn't make sense to anchor at the top of the document,
    // you probably want to see stuff added at the top...
    if (scrollTop <= 0) {
      return undefined;
    }

    const { firstIndex, lastIndex, stickyTop, stickyBottom } = this.renderState;
    if (firstIndex === -1 || lastIndex === -1) {
      return undefined;
    }

    const viewportHeight = this.getHeight();
    // If we have no previoius frame, we shouldn't scroll anchor
    if (stickyTop === -1 || stickyBottom === -1) {
      return undefined;
    }

    for (let index = firstIndex; index <= lastIndex; index++) {
      const item = this.items[index];
      if (item == null) {
        continue;
      }

      const absoluteItemTop = this.getItemTopOffset() + item.top;
      const absoluteItemBottom = absoluteItemTop + item.height;
      // Skip items entirely above the viewport since we can't see it
      if (absoluteItemBottom <= scrollTop) {
        continue;
      }
      // If the item starts below the viewport bottom we are done searching.
      if (absoluteItemTop >= scrollTop + viewportHeight) {
        break;
      }

      if (absoluteItemTop >= scrollTop) {
        return {
          type: 'item',
          id: item.item.id,
          viewportOffset: absoluteItemTop - scrollTop,
        };
      }

      // First attempt to grab a the first fully visible line
      const anchorViewportTop = this.getScrollAnchorViewportTop(
        absoluteItemTop,
        scrollTop
      );
      const localViewportTop = anchorViewportTop - absoluteItemTop;
      const lineAnchor = item.instance.getNumericScrollAnchor(localViewportTop);
      if (lineAnchor != null) {
        const absoluteLineTop = absoluteItemTop + lineAnchor.top;
        return {
          type: 'line',
          id: item.item.id,
          lineNumber: lineAnchor.lineNumber,
          side: lineAnchor.side,
          viewportOffset: absoluteLineTop - scrollTop,
        };
      }
    }

    // I don't think we'll ever make it this far...
    return undefined;
  }

  /**
   * Given a scroll anchor, attempt to resolve a newly updated (and clamped)
   * scroll position to keep the anchored element in place.
   *
   * If we can't resolve a position for whatever reason, we'll return
   * undefined.
   */
  private resolveAnchoredScrollTop(anchor: ScrollAnchor): number | undefined {
    const item = this.idToItem.get(anchor.id);
    if (item == null) {
      return undefined;
    }

    const itemTopOffset = this.getItemTopOffset();
    if (anchor.type === 'item') {
      const absoluteItemTop = itemTopOffset + item.top;
      return this.clampScrollTop(absoluteItemTop - anchor.viewportOffset);
    }

    const linePosition =
      item.type === 'diff'
        ? item.instance.getLinePosition(anchor.lineNumber, anchor.side)
        : item.instance.getLinePosition(anchor.lineNumber);
    if (linePosition == null) {
      return undefined;
    }
    const absoluteLineTop = itemTopOffset + item.top + linePosition.top;
    return this.clampScrollTop(absoluteLineTop - anchor.viewportOffset);
  }

  /**
   * Apply a device-pixel-rounded scroll position if it differs from the last
   * logical scrollTop synchronized into the paged scroll scaffold.
   */
  private applyScrollFix(
    targetScrollTop: number,
    syncedScrollTop: number,
    windowSpecs: VirtualWindowSpecs
  ): void {
    if (this.root == null) {
      return;
    }
    const roundedTargetScrollTop = roundToDevicePixel(
      this.clampScrollTop(targetScrollTop)
    );
    const roundedSyncedScrollTop = roundToDevicePixel(syncedScrollTop);

    const { scrollPageOffset: previousPageOffset } = this;
    const syncedPagedScrollTop = roundToDevicePixel(
      this.clampPagedScrollTop(roundedSyncedScrollTop - previousPageOffset)
    );
    const { pagedScrollTop, scrollPageOffset } =
      this.resolvePagedScrollPosition(roundedTargetScrollTop);
    const targetPagedScrollTop = pagedScrollTop;

    const rebaseChanged = previousPageOffset !== scrollPageOffset;
    if (
      roundedTargetScrollTop === this.renderState.scrollTop &&
      roundedTargetScrollTop === roundedSyncedScrollTop &&
      targetPagedScrollTop === syncedPagedScrollTop &&
      !rebaseChanged
    ) {
      return;
    }
    this.suspendScrollInteractions();
    if (targetPagedScrollTop !== syncedPagedScrollTop || rebaseChanged) {
      this.scrollPageOffset = scrollPageOffset;
      this.syncPagedScrollScaffolding(windowSpecs);
    }
    if (targetPagedScrollTop !== syncedPagedScrollTop) {
      this.root.scrollTo({ top: targetPagedScrollTop, behavior: 'instant' });
    }
    // Keep cached scroll state in sync with writes we performed ourselves, so
    // later reads do not need to touch layout just to discover the same value.
    this.renderState.scrollTop = roundedTargetScrollTop;
    this.scrollTop = roundedTargetScrollTop;
    this.scrollDirty = false;
  }

  /**
   * Decide whether a pending programmatic scroll has reached its
   * destination and should be cleared.
   */
  private isPendingTargetSettled(target: PendingScrollTarget): boolean {
    const top = this.resolveScrollTargetTop(target);
    if (top == null) {
      return true;
    }
    return roundToDevicePixel(this.getScrollTop()) === roundToDevicePixel(top);
  }

  public getScrollTop(): number {
    if (!this.scrollDirty) {
      return this.scrollTop;
    }
    this.scrollDirty = false;
    const rootScrollTop = this.root?.scrollTop ?? 0;
    this.scrollTop = this.clampScrollTop(rootScrollTop + this.scrollPageOffset);
    return this.scrollTop;
  }

  public getHeight(): number {
    if (!this.heightDirty) {
      return this.height;
    }
    this.heightDirty = false;
    this.height = this.root?.getBoundingClientRect().height ?? 0;
    return this.height;
  }

  public getScrollHeight(): number {
    return this.scrollHeight;
  }

  private flushSlotCoordinator(): void {
    if (this.slotCoordinator == null) {
      return;
    }

    const slotSnapshot = this.buildSlotSnapshot(this.slotCoordinator);
    if (areManagedSnapshotsEqual(this.slotSnapshot, slotSnapshot)) {
      return;
    }

    this.slotSnapshot = slotSnapshot;
    this.slotCoordinator.onSnapshotChange(slotSnapshot);
  }

  private notifyScroll(): void {
    // Avoid DOM thrash of checking scroll position if we don't need it
    if (this.scrollListeners.size === 0) {
      return;
    }
    const scrollTop = this.getScrollTop();
    for (const listener of this.scrollListeners) {
      listener(scrollTop, this);
    }
  }

  /**
   * Find the first item whose bottom edge crosses into the viewport window.
   * This lets scroll-time rendering jump directly near the visible range instead
   * of linearly scanning from the start of very large item lists.
   */
  private findFirstVisibleIndex(top: number): number {
    let low = 0;
    let high = this.items.length - 1;
    let result = this.items.length;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = this.items[mid];
      if (item == null) {
        throw new Error('CodeView.findFirstVisibleIndex: invalid item index');
      }

      if (item.top + item.height > top) {
        result = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }

    return result;
  }

  /**
   * Find the last item whose top edge is still within the viewport window.
   * Paired with findFirstVisibleIndex, this bounds the render loop to only the
   * slice of items that can actually intersect the current scroll range.
   */
  private findLastVisibleIndex(bottom: number): number {
    let low = 0;
    let high = this.items.length - 1;
    let result = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const item = this.items[mid];
      if (item == null) {
        throw new Error('CodeView.findLastVisibleIndex: invalid item index');
      }

      if (item.top <= bottom) {
        result = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return result;
  }

  /**
   * Recompute measured tops and heights starting from the earliest dirty item.
   * Earlier items keep their existing layout, while everything from startIndex
   * onward is remeasured so downstream positions and total scroll height stay
   * consistent after inserts, removals, or versioned item updates.
   */
  private recomputeLayout(
    startIndex = 0,
    reset: PendingCodeViewLayoutReset | undefined
  ): void {
    if (this.items.length === 0) {
      this.scrollHeight = 0;
      return;
    }

    const layout = this.getLayout();
    let runningTop = 0;
    if (startIndex > 0) {
      const previousItem = this.items[startIndex - 1];
      if (previousItem == null) {
        throw new Error('CodeView.recomputeLayout: invalid dirty index');
      }
      runningTop = previousItem.top + previousItem.height + layout.gap;
    }

    for (let index = startIndex; index < this.items.length; index++) {
      const item = this.items[index];
      if (item == null) {
        throw new Error('CodeView.recomputeLayout: invalid item index');
      }
      item.top = runningTop;
      if (item.type === 'diff') {
        const fileDiff = item.instance.consumeCodeViewLayoutChanges(
          item.item.fileDiff
        );
        if (fileDiff != null) {
          item.item.fileDiff = fileDiff;
        }
        item.height = item.instance.prepareCodeViewItem(
          item.item.fileDiff,
          runningTop,
          reset,
          item.item.annotations ?? []
        );
      } else {
        item.height = item.instance.prepareCodeViewItem(
          item.item.file,
          runningTop,
          reset,
          item.item.annotations ?? []
        );
      }
      runningTop += item.height;
      if (index < this.items.length - 1) {
        runningTop += layout.gap;
      }
    }

    if (runningTop !== this.scrollHeight) {
      this.scrollDirty = true;
    }
    this.scrollHeight = runningTop;
  }

  private resetRenderState() {
    this.renderState.scrollTop = -1;
    this.renderState.firstIndex = -1;
    this.renderState.lastIndex = -1;
    this.renderState.stickyHeight = 0;
    this.renderState.stickyTop = -1;
    this.renderState.stickyBottom = -1;
  }

  // We actually need a bit of overscroll even when attempting to fit perfectly
  // because we rounde to the nearest container and we may need to render the
  // gaps before and after a perfectly fit element to include the spacing
  // between.  We do this by adding the the gap and header height above and
  // below the viewport
  private getFitPerfectlyOverscroll() {
    return this.getLayout().gap + this.itemMetricsCache.diffHeaderHeight;
  }
}

function prepareItemInstance<LAnnotation>(
  item: CodeViewContextItem<LAnnotation>
): number {
  item.instance.cleanUp(true);
  if (item.type === 'diff') {
    return item.instance.prepareCodeViewItem(
      item.item.fileDiff,
      item.top,
      undefined,
      item.item.annotations ?? []
    );
  } else {
    return item.instance.prepareCodeViewItem(
      item.item.file,
      item.top,
      undefined,
      item.item.annotations ?? []
    );
  }
}

function shouldClearPool<LAnnotation>(
  previousOptions: CodeViewOptions<LAnnotation>,
  nextOptions: CodeViewOptions<LAnnotation>
): boolean {
  return (
    !areThemesEqual(
      previousOptions.theme ?? DEFAULT_THEMES,
      nextOptions.theme ?? DEFAULT_THEMES
    ) ||
    (previousOptions.themeType ?? 'system') !==
      (nextOptions.themeType ?? 'system') ||
    previousOptions.unsafeCSS !== nextOptions.unsafeCSS
  );
}

function hasItemLayoutOptionChanged<LAnnotation>(
  previousOptions: CodeViewOptions<LAnnotation>,
  nextOptions: CodeViewOptions<LAnnotation>
): boolean {
  return (
    (previousOptions.overflow ?? 'scroll') !==
      (nextOptions.overflow ?? 'scroll') ||
    (previousOptions.disableLineNumbers ?? false) !==
      (nextOptions.disableLineNumbers ?? false) ||
    (previousOptions.disableFileHeader ?? false) !==
      (nextOptions.disableFileHeader ?? false) ||
    previousOptions.unsafeCSS !== nextOptions.unsafeCSS ||
    (previousOptions.diffStyle ?? 'split') !==
      (nextOptions.diffStyle ?? 'split') ||
    (previousOptions.diffIndicators ?? 'bars') !==
      (nextOptions.diffIndicators ?? 'bars') ||
    (previousOptions.hunkSeparators ?? 'line-info') !==
      (nextOptions.hunkSeparators ?? 'line-info') ||
    (previousOptions.expandUnchanged ?? false) !==
      (nextOptions.expandUnchanged ?? false) ||
    (previousOptions.collapsedContextThreshold ??
      DEFAULT_COLLAPSED_CONTEXT_THRESHOLD) !==
      (nextOptions.collapsedContextThreshold ??
        DEFAULT_COLLAPSED_CONTEXT_THRESHOLD)
  );
}

function hasCodeViewDiffEstimateOptionChanged<LAnnotation>(
  previousOptions: CodeViewOptions<LAnnotation>,
  nextOptions: CodeViewOptions<LAnnotation>
): boolean {
  return (
    (previousOptions.disableFileHeader ?? false) !==
      (nextOptions.disableFileHeader ?? false) ||
    (previousOptions.hunkSeparators ?? 'line-info') !==
      (nextOptions.hunkSeparators ?? 'line-info') ||
    (previousOptions.expandUnchanged ?? false) !==
      (nextOptions.expandUnchanged ?? false) ||
    (previousOptions.collapsedContextThreshold ??
      DEFAULT_COLLAPSED_CONTEXT_THRESHOLD) !==
      (nextOptions.collapsedContextThreshold ??
        DEFAULT_COLLAPSED_CONTEXT_THRESHOLD)
  );
}

function isPooledShadowChild(child: Element): boolean {
  if (child instanceof SVGElement) {
    return true;
  }
  return (
    isStyleNode(child) &&
    (child.hasAttribute(CORE_CSS_ATTRIBUTE) ||
      child.hasAttribute(THEME_CSS_ATTRIBUTE) ||
      child.hasAttribute(UNSAFE_CSS_ATTRIBUTE))
  );
}

function formatSelectedLineRange(range: SelectedLineRange): string {
  const start = formatSelectedLinePoint(range.start, range.side);
  const end = formatSelectedLinePoint(range.end, range.endSide ?? range.side);
  return start === end ? start : `${start}-${end}`;
}

function formatSelectedLinePoint(
  lineNumber: number,
  side: SelectionSide | undefined
): string {
  if (side == null) {
    return `${lineNumber}`;
  }

  return `${side === 'deletions' ? 'D' : 'A'}${lineNumber}`;
}

function renderItem<LAnnotation>(
  item: CodeViewContextItem<LAnnotation>,
  fileContainer?: HTMLElement,
  forceRender = false
): boolean {
  if (item.type === 'diff') {
    return item.instance.render({
      deferManagers: true,
      fileContainer,
      fileDiff: item.item.fileDiff,
      forceRender,
      lineAnnotations: item.item.annotations ?? [],
    });
  } else {
    return item.instance.render({
      deferManagers: true,
      fileContainer,
      file: item.item.file,
      forceRender,
      lineAnnotations: item.item.annotations ?? [],
    });
  }
}

/**
 * Keep the rendered DOM order aligned with the current record order even when
 * we reuse existing elements. Reused items may already be mounted elsewhere in
 * the sticky container, so this moves them into the correct sibling position
 * before rendering updates.
 */
function syncRenderedItemOrder(
  container: HTMLElement,
  element: HTMLElement,
  prevElement: HTMLElement | undefined
): void {
  if (prevElement == null) {
    if (container.firstChild !== element) {
      container.prepend(element);
    }
    return;
  }

  if (prevElement.nextSibling !== element) {
    prevElement.after(element);
  }
}

function hasAnnotations<LAnnotation>(item: CodeViewItem<LAnnotation>): boolean {
  return (item.annotations?.length ?? 0) > 0;
}

function getSlotItems<LAnnotation>(
  renderedItems: CodeViewRenderedItem<LAnnotation>[],
  {
    hasHeaderRenderers,
    hasAnnotationRenderer,
    hasGutterRenderer,
  }: CodeViewCoordinator<LAnnotation>
): CodeViewRenderedItem<LAnnotation>[] | undefined {
  if (renderedItems.length === 0) {
    return undefined;
  }

  if (hasHeaderRenderers || hasGutterRenderer) {
    return renderedItems;
  }

  if (!hasAnnotationRenderer) {
    return undefined;
  }

  const slotSnapshot: CodeViewRenderedItem<LAnnotation>[] = [];

  for (const renderedItem of renderedItems) {
    if (hasAnnotations(renderedItem.item)) {
      slotSnapshot.push(renderedItem);
    }
  }

  return slotSnapshot.length > 0 ? slotSnapshot : undefined;
}
