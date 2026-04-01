import { toHtml } from 'hast-util-to-html';

import type {
  AnnotationSide,
  DiffLineEventBaseProps,
  DiffTokenEventBaseProps,
  ExpansionDirections,
  LineEventBaseProps,
  LineTypes,
  MergeConflictResolution,
  SelectionPoint,
  SelectionSide,
  TokenEventBase,
} from '../types';
import { areSelectionPointsEqual } from '../utils/areSelectionPointsEqual';
import { areSelectionsEqual } from '../utils/areSelectionsEqual';
import { createGutterUtilityElement } from '../utils/createGutterUtilityElement';

interface TokenCache {
  tokenElement: HTMLElement;
  lineCharStart: number;
  lineCharEnd: number;
  tokenText: string;
}

interface ExpandCache {
  hunkIndex: number | undefined;
  direction: ExpansionDirections;
}

export type LogTypes = 'click' | 'move' | 'both' | 'none';

export type InteractionManagerMode = 'file' | 'diff';

export interface OnLineClickProps extends LineEventBaseProps {
  event: PointerEvent;
}

export interface OnLineEnterLeaveProps extends LineEventBaseProps {
  event: PointerEvent;
}

export interface OnDiffLineClickProps extends DiffLineEventBaseProps {
  event: PointerEvent;
}

export interface OnDiffLineEnterLeaveProps extends DiffLineEventBaseProps {
  event: PointerEvent;
}

export interface SelectedLineRange {
  start: number;
  side?: SelectionSide;
  end: number;
  endSide?: SelectionSide;
}

export type GetLineIndexUtility = (
  lineNumber: number,
  side?: SelectionSide
) => [number, number] | undefined;

type EventClickProps<TMode extends InteractionManagerMode> =
  TMode extends 'file' ? OnLineClickProps : OnDiffLineClickProps;

type PointerEventEnterLeaveProps<TMode extends InteractionManagerMode> =
  TMode extends 'file' ? OnLineEnterLeaveProps : OnDiffLineEnterLeaveProps;

type EventBaseProps<TMode extends InteractionManagerMode> = TMode extends 'file'
  ? LineEventBaseProps
  : DiffLineEventBaseProps;

export type OnTokenEventProps<TMode extends InteractionManagerMode> =
  TMode extends 'file' ? TokenEventBase : DiffTokenEventBaseProps;

interface ExpandoEventProps {
  type: 'line-info';
  hunkIndex: number;
  direction: ExpansionDirections;
}

export type GetHoveredLineResult<TMode extends InteractionManagerMode> =
  TMode extends 'file'
    ? { lineNumber: number }
    : { lineNumber: number; side: AnnotationSide };

interface SelectionPointerInfo {
  lineNumber: number;
  eventSide: SelectionSide | undefined;
  lineIndex: number;
}

interface ResolvedLineTarget<TMode extends InteractionManagerMode> {
  kind: 'line';
  lineType: LineTypes;
  lineElement: HTMLElement;
  lineNumber: number;
  numberColumn: boolean;
  numberElement: HTMLElement;
  side: TMode extends 'diff' ? AnnotationSide : undefined;
  splitLineIndex: number | undefined;
}

interface ResolvedTokenTarget<TMode extends InteractionManagerMode> {
  kind: 'token';
  lineType: LineTypes;
  lineElement: HTMLElement;
  lineNumber: number;
  numberColumn: boolean;
  numberElement: HTMLElement;
  side: TMode extends 'diff' ? AnnotationSide : undefined;
  splitLineIndex: number | undefined;
  tokenElement: HTMLElement;
  tokenText: string;
  lineCharStart: number;
  lineCharEnd: number;
}

export interface MergeConflictActionTarget {
  kind: 'merge-conflict-action';
  resolution: MergeConflictResolution;
  conflictIndex: number;
}

type ResolvedPointerTarget<TMode extends InteractionManagerMode> =
  | ResolvedLineTarget<TMode>
  | ResolvedTokenTarget<TMode>
  | ExpandoEventProps
  | MergeConflictActionTarget;

type LinePointerTarget<TMode extends InteractionManagerMode> =
  ResolvedLineTarget<TMode>;

type TokenPointerTarget<TMode extends InteractionManagerMode> =
  ResolvedTokenTarget<TMode>;

type HoverableLinePointerTarget<TMode extends InteractionManagerMode> =
  | LinePointerTarget<TMode>
  | TokenPointerTarget<TMode>;

interface SessionIdle {
  mode: 'idle';
}

interface SessionSelecting {
  mode: 'selecting';
  pointerId: number;
}

interface SessionPendingSingleLineUnselect {
  mode: 'pendingSingleLineUnselect';
  pointerId: number;
  anchor: SelectionPoint;
  pending: SelectionPoint;
}

interface SessionGutterSelecting {
  mode: 'gutterSelecting';
  pointerId: number;
  anchor: SelectionPoint;
  current: SelectionPoint;
}

type PointerSession =
  | SessionIdle
  | SessionSelecting
  | SessionPendingSingleLineUnselect
  | SessionGutterSelecting;

export interface InteractionManagerBaseOptions<
  TMode extends InteractionManagerMode,
> {
  lineHoverHighlight?: 'disabled' | 'both' | 'number' | 'line';
  enableTokenInteractionsOnWhitespace?: boolean;
  enableGutterUtility?: boolean;
  onGutterUtilityClick?(range: SelectedLineRange): unknown;
  onLineClick?(props: EventClickProps<TMode>): unknown;
  onLineNumberClick?(props: EventClickProps<TMode>): unknown;
  onLineEnter?(props: PointerEventEnterLeaveProps<TMode>): unknown;
  onLineLeave?(props: PointerEventEnterLeaveProps<TMode>): unknown;
  onTokenClick?(props: OnTokenEventProps<TMode>, event: MouseEvent): unknown;
  onTokenEnter?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  onTokenLeave?(props: OnTokenEventProps<TMode>, event: PointerEvent): unknown;
  __debugPointerEvents?: LogTypes;
  enableLineSelection?: boolean;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  onLineSelectionStart?: (range: SelectedLineRange | null) => void;
  onLineSelectionChange?: (range: SelectedLineRange | null) => void;
  onLineSelectionEnd?: (range: SelectedLineRange | null) => void;
  getLineIndex?: GetLineIndexUtility;
}

export interface InteractionManagerOptions<
  TMode extends InteractionManagerMode,
> extends InteractionManagerBaseOptions<TMode> {
  usesCustomGutterUtility?: boolean;
  onHunkExpand?(
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCountOverride?: number
  ): unknown;
  onMergeConflictActionClick?(target: MergeConflictActionTarget): void;
}

interface HandlePointerEventProps {
  eventType: 'click' | 'move';
  event: PointerEvent | MouseEvent;
}

export class InteractionManager<TMode extends InteractionManagerMode> {
  private hoveredLine: EventBaseProps<TMode> | undefined;
  private hoveredToken: OnTokenEventProps<TMode> | undefined;
  private pre: HTMLPreElement | undefined;

  private gutterUtilityContainer: HTMLDivElement | undefined;
  private gutterUtilityButton: HTMLButtonElement | undefined;
  private gutterUtilitySlot: HTMLSlotElement | undefined;

  private interactiveLinesAttr = false;
  private interactiveLineNumbersAttr = false;

  private hasPointerListeners = false;
  private hasDocumentPointerListeners = false;

  private selectedRange: SelectedLineRange | null = null;
  private renderedSelectionRange: SelectedLineRange | null | undefined;
  private selectionAnchor: SelectionPoint | undefined;
  private queuedSelectionRender: number | undefined;
  private pointerSession: PointerSession = { mode: 'idle' };

  constructor(
    private mode: TMode,
    private options: InteractionManagerOptions<TMode>
  ) {}

  setOptions(options: InteractionManagerOptions<TMode>): void {
    this.options = options;
  }

  cleanUp(): void {
    this.pre?.removeEventListener('click', this.handlePointerClick);
    this.pre?.removeEventListener('pointerdown', this.handlePointerDown);
    this.pre?.removeEventListener('pointermove', this.handlePointerMove);
    this.pre?.removeEventListener('pointerleave', this.handlePointerLeave);
    this.pre?.removeAttribute('data-interactive-lines');
    this.pre?.removeAttribute('data-interactive-line-numbers');
    this.pre = undefined;
    this.gutterUtilityContainer?.remove();
    this.gutterUtilityContainer = undefined;
    this.gutterUtilityButton = undefined;
    this.gutterUtilitySlot = undefined;
    this.clearHoveredLine();
    this.clearHoveredToken();
    this.detachDocumentPointerListeners();
    this.clearPointerSession();
    if (this.queuedSelectionRender != null) {
      cancelAnimationFrame(this.queuedSelectionRender);
      this.queuedSelectionRender = undefined;
    }
    this.interactiveLinesAttr = false;
    this.interactiveLineNumbersAttr = false;
    this.hasPointerListeners = false;
  }

  setup(pre: HTMLPreElement): void {
    this.setSelectionDirty();
    const { usesCustomGutterUtility = false, enableGutterUtility = false } =
      this.options;

    const newContainer = this.pre !== pre;
    if (newContainer) {
      this.cleanUp();
      this.pre = pre;
    }

    if (enableGutterUtility) {
      this.ensureGutterUtilityNode(usesCustomGutterUtility);
    } else if (this.gutterUtilityContainer != null) {
      this.gutterUtilityContainer.remove();
      this.gutterUtilityContainer = undefined;
      this.gutterUtilityButton = undefined;
      this.gutterUtilitySlot = undefined;
      if (this.pointerSession.mode === 'gutterSelecting') {
        this.clearPointerSession();
        this.detachDocumentPointerListeners();
      }
    }

    this.syncPointerListeners(pre);
    this.updateInteractiveLineAttributes();
    this.renderSelection();
  }

  setSelectionDirty(): void {
    this.renderedSelectionRange = undefined;
  }

  isSelectionDirty(): boolean {
    return this.renderedSelectionRange === null;
  }

  setSelection(range: SelectedLineRange | null): void {
    const isRangeChange = !(
      range === this.selectedRange ||
      areSelectionsEqual(range ?? undefined, this.selectedRange ?? undefined)
    );
    if (!this.isSelectionDirty() && !isRangeChange) {
      return;
    }
    this.selectedRange = range;
    this.renderSelection();
    if (isRangeChange) {
      this.notifySelectionCommitted();
    }
  }

  getSelection(): SelectedLineRange | null {
    return this.selectedRange;
  }

  getHoveredLine = (): GetHoveredLineResult<TMode> | undefined => {
    if (this.hoveredLine != null) {
      if (this.mode === 'diff' && this.hoveredLine.type === 'diff-line') {
        return {
          lineNumber: this.hoveredLine.lineNumber,
          side: this.hoveredLine.annotationSide,
        } as GetHoveredLineResult<TMode>;
      }
      if (this.mode === 'file' && this.hoveredLine.type === 'line') {
        return {
          lineNumber: this.hoveredLine.lineNumber,
        } as GetHoveredLineResult<TMode>;
      }
    }
    return undefined;
  };

  handlePointerClick = (event: MouseEvent): void => {
    const {
      onHunkExpand,
      onLineClick,
      onLineNumberClick,
      onTokenClick,
      onMergeConflictActionClick,
    } = this.options;
    if (
      onHunkExpand == null &&
      onLineClick == null &&
      onLineNumberClick == null &&
      onMergeConflictActionClick == null &&
      onTokenClick == null
    ) {
      return;
    }
    if (
      this.options.onGutterUtilityClick != null &&
      isGutterUtilityPointerPath(event.composedPath())
    ) {
      return;
    }
    debugLogIfEnabled(
      this.options.__debugPointerEvents,
      'click',
      'FileDiff.DEBUG.handlePointerClick:',
      event
    );
    this.handlePointerEvent({ eventType: 'click', event });
  };

  handlePointerMove = (event: PointerEvent): void => {
    const {
      lineHoverHighlight = 'disabled',
      onLineEnter,
      onLineLeave,
      onTokenEnter,
      onTokenLeave,
      enableGutterUtility = false,
    } = this.options;
    if (
      lineHoverHighlight === 'disabled' &&
      !enableGutterUtility &&
      onLineEnter == null &&
      onLineLeave == null &&
      onTokenEnter == null &&
      onTokenLeave == null
    ) {
      return;
    }
    debugLogIfEnabled(
      this.options.__debugPointerEvents,
      'move',
      'FileDiff.DEBUG.handlePointerMove:',
      event
    );
    // should we perhaps throttle this a bit because move can be fast as fuk
    // boiiii
    this.handlePointerEvent({ eventType: 'move', event });
  };

  handlePointerLeave = (event: PointerEvent): void => {
    const { __debugPointerEvents } = this.options;
    debugLogIfEnabled(
      __debugPointerEvents,
      'move',
      'FileDiff.DEBUG.handlePointerLeave: no event'
    );
    if (this.hoveredLine == null && this.hoveredToken == null) {
      debugLogIfEnabled(
        __debugPointerEvents,
        'move',
        'FileDiff.DEBUG.handlePointerLeave: returned early, no hovered line or token'
      );
      return;
    }
    this.gutterUtilityContainer?.remove();
    if (this.hoveredToken != null) {
      this.options.onTokenLeave?.(this.hoveredToken, event);
      this.clearHoveredToken();
    }

    if (this.hoveredLine != null) {
      this.options.onLineLeave?.({
        ...this.hoveredLine,
        event,
      } as PointerEventEnterLeaveProps<TMode>);
      this.clearHoveredLine();
    }
  };

  private handlePointerEvent({ eventType, event }: HandlePointerEventProps) {
    const { __debugPointerEvents } = this.options;
    const composedPath = event.composedPath();
    debugLogIfEnabled(
      __debugPointerEvents,
      eventType,
      'FileDiff.DEBUG.handlePointerEvent:',
      { eventType, composedPath }
    );
    const target = this.resolvePointerTarget(composedPath);
    debugLogIfEnabled(
      __debugPointerEvents,
      eventType,
      'FileDiff.DEBUG.handlePointerEvent: resolvePointerTarget result:',
      target
    );

    const {
      onLineClick,
      onLineNumberClick,
      onLineEnter,
      onLineLeave,
      onTokenClick,
      onTokenEnter,
      onTokenLeave,
      onHunkExpand,
      onMergeConflictActionClick,
    } = this.options;

    switch (eventType) {
      case 'move': {
        const sameLine =
          isHoverableLinePointerTarget(target) &&
          this.hoveredLine?.lineElement === target.lineElement;
        const sameToken =
          isTokenPointerTarget(target) &&
          this.hoveredToken?.tokenElement === target.tokenElement;

        // Handle token transitions
        if (!sameToken) {
          if (this.hoveredToken != null) {
            onTokenLeave?.(this.hoveredToken, event as PointerEvent);
            this.clearHoveredToken();
          }
          if (isTokenPointerTarget(target)) {
            this.setHoveredToken(this.toTokenEventBaseProps(target));
            onTokenEnter?.(
              this.hoveredToken as OnTokenEventProps<TMode>,
              event as PointerEvent
            );
          }
        }

        // Handle line transitions
        if (!sameLine) {
          if (this.hoveredLine != null) {
            this.gutterUtilityContainer?.remove();
            onLineLeave?.({
              ...this.hoveredLine,
              event: event as PointerEvent,
            } as PointerEventEnterLeaveProps<TMode>);
            this.clearHoveredLine();
          }
          if (isHoverableLinePointerTarget(target)) {
            this.setHoveredLine(this.toEventBaseProps(target));
            if (this.gutterUtilityContainer != null) {
              target.numberElement.appendChild(this.gutterUtilityContainer);
            }
            onLineEnter?.({
              ...this.hoveredLine,
              event: event as PointerEvent,
            } as PointerEventEnterLeaveProps<TMode>);
          }
        }
        break;
      }
      case 'click': {
        if (target == null) {
          break;
        }
        if (
          isMergeConflictActionPointerTarget(target) &&
          onMergeConflictActionClick != null
        ) {
          onMergeConflictActionClick(target);
          break;
        }
        if (isExpandoPointerTarget(target) && onHunkExpand != null) {
          onHunkExpand(
            target.hunkIndex,
            event.shiftKey ? 'both' : target.direction,
            event.shiftKey ? Number.POSITIVE_INFINITY : undefined
          );
          break;
        }

        if (!isHoverableLinePointerTarget(target)) {
          break;
        }

        if (isTokenPointerTarget(target) && onTokenClick != null) {
          onTokenClick(this.toTokenEventBaseProps(target), event as MouseEvent);
        }

        const eventBase = this.toEventBaseProps(target);
        if (onLineNumberClick != null && target.numberColumn) {
          onLineNumberClick({
            ...eventBase,
            event: event as PointerEvent,
          } as EventClickProps<TMode>);
        } else if (onLineClick != null) {
          onLineClick({
            ...eventBase,
            event: event as PointerEvent,
          } as EventClickProps<TMode>);
        }
        break;
      }
    }
  }

  private syncPointerListeners(pre: HTMLPreElement): void {
    const {
      __debugPointerEvents,
      lineHoverHighlight = 'disabled',
      onLineClick,
      onLineNumberClick,
      onLineEnter,
      onLineLeave,
      onTokenClick,
      onTokenEnter,
      onTokenLeave,
      onHunkExpand,
      onMergeConflictActionClick,
      enableGutterUtility = false,
      enableLineSelection = false,
      onGutterUtilityClick,
    } = this.options;
    const enableGutterSelection = onGutterUtilityClick != null;
    const shouldAttachPointerListeners =
      lineHoverHighlight !== 'disabled' ||
      onLineClick != null ||
      onLineNumberClick != null ||
      onLineEnter != null ||
      onLineLeave != null ||
      onTokenClick != null ||
      onTokenEnter != null ||
      onTokenLeave != null ||
      onHunkExpand != null ||
      onMergeConflictActionClick != null ||
      enableGutterUtility ||
      enableLineSelection ||
      enableGutterSelection;

    if (shouldAttachPointerListeners && !this.hasPointerListeners) {
      pre.addEventListener('click', this.handlePointerClick);
      pre.addEventListener('pointerdown', this.handlePointerDown);
      pre.addEventListener('pointermove', this.handlePointerMove);
      pre.addEventListener('pointerleave', this.handlePointerLeave);
      this.hasPointerListeners = true;

      debugLogIfEnabled(
        __debugPointerEvents,
        'click',
        'FileDiff.DEBUG.attachEventListeners: Attaching click events for:',
        (() => {
          const reasons: string[] = [];
          if (
            __debugPointerEvents === 'both' ||
            __debugPointerEvents === 'click'
          ) {
            if (onLineClick != null) {
              reasons.push('onLineClick');
            }
            if (onLineNumberClick != null) {
              reasons.push('onLineNumberClick');
            }
            if (onHunkExpand != null) {
              reasons.push('expandable hunk separators');
            }
            if (onMergeConflictActionClick != null) {
              reasons.push('merge conflict actions');
            }
          }
          return reasons;
        })()
      );
      debugLogIfEnabled(
        __debugPointerEvents,
        'move',
        'FileDiff.DEBUG.attachEventListeners: Attaching pointer move event'
      );
      debugLogIfEnabled(
        __debugPointerEvents,
        'move',
        'FileDiff.DEBUG.attachEventListeners: Attaching pointer leave event'
      );
    } else if (!shouldAttachPointerListeners && this.hasPointerListeners) {
      pre.removeEventListener('click', this.handlePointerClick);
      pre.removeEventListener('pointerdown', this.handlePointerDown);
      pre.removeEventListener('pointermove', this.handlePointerMove);
      pre.removeEventListener('pointerleave', this.handlePointerLeave);
      this.hasPointerListeners = false;
    }

    const hasActiveLineSelectionSession =
      this.pointerSession.mode === 'selecting' ||
      this.pointerSession.mode === 'pendingSingleLineUnselect';
    const hasActiveGutterSelectionSession =
      this.pointerSession.mode === 'gutterSelecting';
    if (
      (!enableLineSelection && hasActiveLineSelectionSession) ||
      (!enableGutterSelection && hasActiveGutterSelectionSession)
    ) {
      this.clearPointerSession();
      this.detachDocumentPointerListeners();
      this.selectionAnchor = undefined;
      this.clearPendingSingleLineState();
    }
  }

  private updateInteractiveLineAttributes(): void {
    if (this.pre == null) {
      return;
    }

    const {
      onLineClick,
      onLineNumberClick,
      enableLineSelection = false,
    } = this.options;

    const shouldHaveInteractiveLines = onLineClick != null;
    const shouldHaveInteractiveLineNumbers =
      onLineNumberClick != null || enableLineSelection;

    if (shouldHaveInteractiveLines && !this.interactiveLinesAttr) {
      this.pre.setAttribute('data-interactive-lines', '');
      this.interactiveLinesAttr = true;
    } else if (!shouldHaveInteractiveLines && this.interactiveLinesAttr) {
      this.pre.removeAttribute('data-interactive-lines');
      this.interactiveLinesAttr = false;
    }

    if (shouldHaveInteractiveLineNumbers && !this.interactiveLineNumbersAttr) {
      this.pre.setAttribute('data-interactive-line-numbers', '');
      this.interactiveLineNumbersAttr = true;
    } else if (
      !shouldHaveInteractiveLineNumbers &&
      this.interactiveLineNumbersAttr
    ) {
      this.pre.removeAttribute('data-interactive-line-numbers');
      this.interactiveLineNumbersAttr = false;
    }
  }

  private handlePointerDown = (event: PointerEvent): void => {
    if (
      (event.pointerType === 'mouse' && event.button !== 0) ||
      this.pre == null ||
      this.pointerSession.mode !== 'idle'
    ) {
      return;
    }

    const path = event.composedPath();
    if (
      isGutterUtilityPointerPath(path) &&
      this.options.onGutterUtilityClick != null
    ) {
      this.startGutterSelectionFromPointerDown(event, path);
    } else {
      this.startLineSelectionFromPointerDown(event, path);
    }
  };

  private startLineSelectionFromPointerDown(
    event: PointerEvent,
    path: (EventTarget | undefined)[]
  ): void {
    const { enableLineSelection = false } = this.options;
    if (!enableLineSelection) {
      return;
    }

    const pointerInfo = this.getSelectionPointerInfo(path, true);
    if (pointerInfo == null) {
      return;
    }

    const { pre } = this;
    if (pre == null) {
      return;
    }

    event.preventDefault();
    const { lineNumber, eventSide, lineIndex } = pointerInfo;

    if (event.shiftKey && this.selectedRange != null) {
      const rowRange = this.getIndexesFromSelection(
        this.selectedRange,
        pre.getAttribute('data-diff-type') === 'split'
      );
      if (rowRange == null) {
        return;
      }
      const useStart =
        rowRange.start <= rowRange.end
          ? lineIndex >= rowRange.start
          : lineIndex <= rowRange.end;
      this.selectionAnchor = {
        lineNumber: useStart
          ? this.selectedRange.start
          : this.selectedRange.end,
        side: useStart
          ? this.selectedRange.side
          : (this.selectedRange.endSide ?? this.selectedRange.side),
      };
      this.updateSelection(lineNumber, eventSide, false);
      this.notifySelectionStart(this.selectedRange);
      this.pointerSession = { mode: 'selecting', pointerId: event.pointerId };
      this.attachDocumentPointerListeners();
      return;
    }

    if (
      this.selectedRange?.start === lineNumber &&
      this.selectedRange?.end === lineNumber
    ) {
      const point = { lineNumber, side: eventSide };
      this.selectionAnchor = point;
      this.pointerSession = {
        mode: 'pendingSingleLineUnselect',
        pointerId: event.pointerId,
        anchor: point,
        pending: point,
      };
      this.attachDocumentPointerListeners();
      return;
    }

    this.selectedRange = null;
    this.selectionAnchor = { lineNumber, side: eventSide };
    this.updateSelection(lineNumber, eventSide, false);
    this.notifySelectionStart(this.selectedRange);
    this.pointerSession = { mode: 'selecting', pointerId: event.pointerId };
    this.attachDocumentPointerListeners();
  }

  private startGutterSelectionFromPointerDown(
    event: PointerEvent,
    path: (EventTarget | undefined)[]
  ): void {
    const { enableLineSelection = false, onGutterUtilityClick } = this.options;
    if (onGutterUtilityClick == null) {
      return;
    }
    const point = this.getSelectionPointFromPath(path);
    if (point == null) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    this.pointerSession = {
      mode: 'gutterSelecting',
      pointerId: event.pointerId,
      anchor: point,
      current: point,
    };
    if (enableLineSelection) {
      this.selectionAnchor = {
        lineNumber: point.lineNumber,
        side: point.side,
      };
      this.updateSelection(point.lineNumber, point.side, false);
      this.notifySelectionStart(this.selectedRange);
    }
    this.attachDocumentPointerListeners();
  }

  private handleDocumentPointerMove = (event: PointerEvent): void => {
    const { enableLineSelection = false } = this.options;
    switch (this.pointerSession.mode) {
      case 'idle':
        return;
      case 'gutterSelecting': {
        if (event.pointerId !== this.pointerSession.pointerId) {
          return;
        }
        const point = this.getSelectionPointFromPath(event.composedPath());
        if (point == null) {
          return;
        }
        this.pointerSession.current = point;
        if (enableLineSelection === true) {
          this.updateSelection(point.lineNumber, point.side);
        }
        return;
      }
      case 'selecting': {
        if (event.pointerId !== this.pointerSession.pointerId) {
          return;
        }
        const pointerInfo = this.getSelectionPointerInfo(
          event.composedPath(),
          false
        );
        if (pointerInfo == null || this.selectionAnchor == null) {
          return;
        }
        this.updateSelection(pointerInfo.lineNumber, pointerInfo.eventSide);
        return;
      }
      case 'pendingSingleLineUnselect': {
        if (event.pointerId !== this.pointerSession.pointerId) {
          return;
        }
        const pointerInfo = this.getSelectionPointerInfo(
          event.composedPath(),
          false
        );
        if (pointerInfo == null || this.selectionAnchor == null) {
          return;
        }
        const point = {
          lineNumber: pointerInfo.lineNumber,
          side: pointerInfo.eventSide,
        };
        if (areSelectionPointsEqual(this.pointerSession.pending, point)) {
          return;
        }
        this.updateSelection(
          pointerInfo.lineNumber,
          pointerInfo.eventSide,
          false
        );
        this.notifySelectionStart(this.selectedRange);
        this.notifySelectionChangeDelta();
        this.pointerSession = {
          mode: 'selecting',
          pointerId: event.pointerId,
        };
        return;
      }
    }
  };

  private handleDocumentPointerUp = (event: PointerEvent): void => {
    const { enableLineSelection = false, onGutterUtilityClick } = this.options;
    switch (this.pointerSession.mode) {
      case 'idle':
        return;
      case 'gutterSelecting': {
        if (event.pointerId !== this.pointerSession.pointerId) {
          return;
        }
        const point = this.getSelectionPointFromPath(event.composedPath());
        if (point != null) {
          this.pointerSession.current = point;
          if (enableLineSelection) {
            this.updateSelection(point.lineNumber, point.side);
          }
        }
        onGutterUtilityClick?.(
          this.buildSelectedLineRange(
            this.pointerSession.anchor,
            this.pointerSession.current
          )
        );
        this.selectionAnchor = undefined;
        if (enableLineSelection) {
          this.notifySelectionEnd(this.selectedRange);
          this.notifySelectionCommitted();
        }
        this.clearPointerSession();
        this.detachDocumentPointerListeners();
        return;
      }
      case 'pendingSingleLineUnselect': {
        if (event.pointerId !== this.pointerSession.pointerId) {
          return;
        }
        this.updateSelection(null, undefined, false);
        this.selectionAnchor = undefined;
        this.clearPendingSingleLineState();
        this.detachDocumentPointerListeners();
        this.notifySelectionEnd(this.selectedRange);
        this.notifySelectionCommitted();
        return;
      }
      case 'selecting': {
        if (event.pointerId !== this.pointerSession.pointerId) {
          return;
        }
        this.selectionAnchor = undefined;
        this.detachDocumentPointerListeners();
        this.clearPointerSession();
        this.notifySelectionEnd(this.selectedRange);
        this.notifySelectionCommitted();
      }
    }
  };

  private handleDocumentPointerCancel = (event: PointerEvent): void => {
    switch (this.pointerSession.mode) {
      case 'idle':
        return;
      case 'gutterSelecting':
      case 'selecting':
      case 'pendingSingleLineUnselect': {
        if ('pointerId' in this.pointerSession) {
          if (event.pointerId !== this.pointerSession.pointerId) {
            return;
          }
        }
        this.selectionAnchor = undefined;
        this.clearPendingSingleLineState();
        this.clearPointerSession();
        this.detachDocumentPointerListeners();
      }
    }
  };

  private clearHoveredLine() {
    if (this.hoveredLine == null) {
      return;
    }
    this.hoveredLine.lineElement.removeAttribute('data-hovered');
    this.hoveredLine.numberElement.removeAttribute('data-hovered');
    this.hoveredLine = undefined;
  }

  private setHoveredLine(hoveredLine: EventBaseProps<TMode>) {
    const { lineHoverHighlight = 'disabled' } = this.options;
    if (this.hoveredLine != null) {
      this.clearHoveredLine();
    }
    this.hoveredLine = hoveredLine;
    if (lineHoverHighlight !== 'disabled') {
      if (lineHoverHighlight === 'both' || lineHoverHighlight === 'line') {
        this.hoveredLine.lineElement.setAttribute('data-hovered', '');
      }
      if (lineHoverHighlight === 'both' || lineHoverHighlight === 'number') {
        this.hoveredLine.numberElement.setAttribute('data-hovered', '');
      }
    }
  }

  private clearHoveredToken() {
    if (this.hoveredToken == null) {
      return;
    }
    this.hoveredToken = undefined;
  }

  private setHoveredToken(hoveredToken: OnTokenEventProps<TMode>) {
    if (this.hoveredToken != null) {
      this.clearHoveredToken();
    }
    this.hoveredToken = hoveredToken;
  }

  private ensureGutterUtilityNode(useCustomGutterUtility: boolean): void {
    if (this.gutterUtilityContainer == null) {
      this.gutterUtilityContainer = document.createElement('div');
      this.gutterUtilityContainer.setAttribute('data-gutter-utility-slot', '');
    }
    if (useCustomGutterUtility) {
      if (this.gutterUtilityButton != null) {
        this.gutterUtilityButton.remove();
        this.gutterUtilityButton = undefined;
      }
      if (this.gutterUtilitySlot == null) {
        this.gutterUtilitySlot = document.createElement('slot');
        this.gutterUtilitySlot.name = 'gutter-utility-slot';
      }
      if (this.gutterUtilitySlot.parentNode !== this.gutterUtilityContainer) {
        this.gutterUtilityContainer.replaceChildren(this.gutterUtilitySlot);
      }
    } else {
      this.gutterUtilitySlot?.remove();
      this.gutterUtilitySlot = undefined;
      if (this.gutterUtilityButton == null) {
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = toHtml(createGutterUtilityElement());
        const utilityButton = tempDiv.firstElementChild;
        if (!(utilityButton instanceof HTMLButtonElement)) {
          throw new Error(
            'InteractionManager.ensureGutterUtilityNode: Node element should be a button'
          );
        }
        utilityButton.remove();
        this.gutterUtilityButton = utilityButton;
      }
      if (this.gutterUtilityButton.parentNode !== this.gutterUtilityContainer) {
        this.gutterUtilityContainer.replaceChildren(this.gutterUtilityButton);
      }
    }
  }

  private attachDocumentPointerListeners(): void {
    if (this.hasDocumentPointerListeners) {
      return;
    }
    document.addEventListener('pointermove', this.handleDocumentPointerMove);
    document.addEventListener('pointerup', this.handleDocumentPointerUp);
    document.addEventListener(
      'pointercancel',
      this.handleDocumentPointerCancel
    );
    this.hasDocumentPointerListeners = true;
  }

  private detachDocumentPointerListeners(): void {
    if (!this.hasDocumentPointerListeners) {
      return;
    }
    document.removeEventListener('pointermove', this.handleDocumentPointerMove);
    document.removeEventListener('pointerup', this.handleDocumentPointerUp);
    document.removeEventListener(
      'pointercancel',
      this.handleDocumentPointerCancel
    );
    this.hasDocumentPointerListeners = false;
  }

  private clearPointerSession(): void {
    this.pointerSession = { mode: 'idle' };
  }

  private clearPendingSingleLineState(): void {
    if (this.pointerSession.mode === 'pendingSingleLineUnselect') {
      this.pointerSession = { mode: 'idle' };
    }
  }

  private getSelectionPointerInfo(
    path: (EventTarget | undefined)[],
    requireNumberColumn: boolean
  ): SelectionPointerInfo | undefined {
    const target = this.resolvePointerTarget(path);
    if (!isLinePointerTarget(target)) {
      return undefined;
    }
    if (requireNumberColumn && !target.numberColumn) {
      return undefined;
    }
    if (target.splitLineIndex == null) {
      return undefined;
    }

    return {
      lineIndex: target.splitLineIndex,
      lineNumber: target.lineNumber,
      eventSide: this.mode === 'diff' ? target.side : undefined,
    };
  }

  private getSelectionPointFromPath(
    path: (EventTarget | undefined)[]
  ): SelectionPoint | undefined {
    const target = this.resolvePointerTarget(path);
    if (!isLinePointerTarget(target)) {
      return undefined;
    }
    return {
      lineNumber: target.lineNumber,
      side: this.mode === 'diff' ? target.side : undefined,
    };
  }

  private getLineIndex(
    lineNumber: number,
    side?: SelectionSide
  ): [number, number] | undefined {
    const { getLineIndex } = this.options;
    return getLineIndex != null
      ? getLineIndex(lineNumber, side)
      : [lineNumber - 1, lineNumber - 1];
  }

  private updateSelection(
    currentLine: number | null,
    side?: SelectionSide,
    emitChange = true
  ): void {
    const { selectedRange: previousRange } = this;
    let nextRange: SelectedLineRange | null;
    if (currentLine == null) {
      nextRange = null;
    } else {
      const anchorSide = this.selectionAnchor?.side ?? side;
      const anchorLine = this.selectionAnchor?.lineNumber ?? currentLine;
      nextRange = this.buildSelectionRange(
        anchorLine,
        currentLine,
        anchorSide,
        side
      );
    }
    if (
      areSelectionsEqual(previousRange ?? undefined, nextRange ?? undefined)
    ) {
      return;
    }
    this.selectedRange = nextRange;
    if (emitChange) {
      this.notifySelectionChangeDelta();
    }
    this.queuedSelectionRender ??= requestAnimationFrame(this.renderSelection);
  }

  private getIndexesFromSelection(
    selectedRange: SelectedLineRange,
    split: boolean
  ): { start: number; end: number } | undefined {
    if (this.pre == null) {
      return undefined;
    }
    const startIndexes = this.getLineIndex(
      selectedRange.start,
      selectedRange.side
    );
    const finalIndexes = this.getLineIndex(
      selectedRange.end,
      selectedRange.endSide ?? selectedRange.side
    );

    return startIndexes != null && finalIndexes != null
      ? {
          start: split ? startIndexes[1] : startIndexes[0],
          end: split ? finalIndexes[1] : finalIndexes[0],
        }
      : undefined;
  }

  private renderSelection = (): void => {
    if (this.queuedSelectionRender != null) {
      cancelAnimationFrame(this.queuedSelectionRender);
      this.queuedSelectionRender = undefined;
    }
    if (
      this.pre == null ||
      this.renderedSelectionRange === this.selectedRange
    ) {
      return;
    }

    const allSelected = this.pre.querySelectorAll('[data-selected-line]');
    for (const element of allSelected) {
      element.removeAttribute('data-selected-line');
    }

    this.renderedSelectionRange = this.selectedRange;
    if (this.selectedRange == null) {
      return;
    }

    const { children: codeElements } = this.pre;
    if (codeElements.length === 0) {
      return;
    }
    if (codeElements.length > 2) {
      console.error(codeElements);
      throw new Error(
        'InteractionManager.renderSelection: Somehow there are more than 2 code elements...'
      );
    }
    const split = this.pre.getAttribute('data-diff-type') === 'split';
    const rowRange = this.getIndexesFromSelection(this.selectedRange, split);
    if (rowRange == null) {
      console.error({ rowRange, selectedRange: this.selectedRange });
      throw new Error('InteractionManager.renderSelection: No valid rowRange');
    }
    const isSingle = rowRange.start === rowRange.end;
    const first = Math.min(rowRange.start, rowRange.end);
    const last = Math.max(rowRange.start, rowRange.end);
    for (const code of codeElements) {
      const [gutter, content] = code.children;
      const len = content.children.length;
      if (len !== gutter.children.length) {
        throw new Error(
          'InteractionManager.renderSelection: gutter and content children dont match, something is wrong'
        );
      }
      for (let i = 0; i < len; i++) {
        const contentElement = content.children[i];
        const gutterElement = gutter.children[i];
        if (
          !(contentElement instanceof HTMLElement) ||
          !(gutterElement instanceof HTMLElement)
        ) {
          continue;
        }

        const lineIndex = this.parseLineIndex(contentElement, split);
        if ((lineIndex ?? 0) > last) {
          break;
        }
        if (lineIndex == null || lineIndex < first) {
          continue;
        }
        let attributeValue = isSingle
          ? 'single'
          : lineIndex === first
            ? 'first'
            : lineIndex === last
              ? 'last'
              : '';
        contentElement.setAttribute('data-selected-line', attributeValue);
        gutterElement.setAttribute('data-selected-line', attributeValue);
        if (
          gutterElement.nextSibling instanceof HTMLElement &&
          contentElement.nextSibling instanceof HTMLElement &&
          (contentElement.nextSibling.hasAttribute('data-line-annotation') ||
            contentElement.nextSibling.hasAttribute(
              'data-merge-conflict-actions'
            ))
        ) {
          if (isSingle) {
            attributeValue = 'last';
            contentElement.setAttribute('data-selected-line', 'first');
          } else if (lineIndex === first) {
            attributeValue = '';
          } else if (lineIndex === last) {
            contentElement.setAttribute('data-selected-line', '');
          }
          contentElement.nextSibling.setAttribute(
            'data-selected-line',
            attributeValue
          );
          gutterElement.nextSibling.setAttribute(
            'data-selected-line',
            attributeValue
          );
        }
      }
    }
  };

  private notifySelectionCommitted(): void {
    this.options.onLineSelected?.(this.selectedRange ?? null);
  }

  private notifySelectionChangeDelta(): void {
    this.options.onLineSelectionChange?.(this.selectedRange ?? null);
  }

  private notifySelectionStart(range: SelectedLineRange | null): void {
    this.options.onLineSelectionStart?.(range);
  }

  private notifySelectionEnd(range: SelectedLineRange | null): void {
    this.options.onLineSelectionEnd?.(range);
  }

  private toEventBaseProps(
    target: HoverableLinePointerTarget<TMode>
  ): EventBaseProps<TMode> {
    if (this.mode === 'file') {
      return {
        type: 'line',
        lineElement: target.lineElement,
        lineNumber: target.lineNumber,
        numberColumn: target.numberColumn,
        numberElement: target.numberElement,
      } as EventBaseProps<TMode>;
    }

    return {
      type: 'diff-line',
      annotationSide: target.side as AnnotationSide,
      lineType: target.lineType,
      lineElement: target.lineElement,
      numberElement: target.numberElement,
      lineNumber: target.lineNumber,
      numberColumn: target.numberColumn,
    } as EventBaseProps<TMode>;
  }

  private toTokenEventBaseProps({
    lineCharEnd,
    lineCharStart,
    lineNumber,
    side,
    tokenElement,
    tokenText,
  }: TokenPointerTarget<TMode>): OnTokenEventProps<TMode> {
    if (this.mode === 'file') {
      return {
        type: 'token',
        lineCharEnd,
        lineCharStart,
        lineNumber,
        tokenElement,
        tokenText,
      } as OnTokenEventProps<TMode>;
    }

    return {
      type: 'token',
      lineCharEnd,
      lineCharStart,
      lineNumber,
      side,
      tokenElement,
      tokenText,
    } as OnTokenEventProps<TMode>;
  }

  private buildSelectedLineRange(
    anchor: SelectionPoint,
    current: SelectionPoint
  ): SelectedLineRange {
    return this.buildSelectionRange(
      anchor.lineNumber,
      current.lineNumber,
      anchor.side,
      current.side
    );
  }

  private buildSelectionRange(
    start: number,
    end: number,
    side?: SelectionSide,
    endSide?: SelectionSide
  ): SelectedLineRange {
    return {
      start,
      end,
      ...(side != null ? { side } : {}),
      ...(side !== endSide && endSide != null ? { endSide } : {}),
    };
  }

  private resolvePointerTarget(
    path: (EventTarget | undefined)[]
  ): ResolvedPointerTarget<TMode> | undefined {
    let numberColumn = false;
    let lineType: LineTypes | undefined;
    let codeElement: HTMLElement | undefined;
    let lineElement: HTMLElement | undefined;
    let lineIndexValue: string | undefined;
    let numberElement: HTMLElement | undefined;
    let tokenElement: HTMLElement | undefined;
    let tokenInfo: TokenCache | undefined;
    let expandInfo: ExpandCache | undefined;
    let lineNumber: number | undefined;
    let mergeConflictActionTarget: MergeConflictActionTarget | undefined;

    for (const element of path) {
      if (!(element instanceof HTMLElement)) {
        continue;
      }

      if (
        mergeConflictActionTarget == null &&
        element.hasAttribute('data-merge-conflict-action')
      ) {
        const resolutionValue =
          element.getAttribute('data-merge-conflict-action') ?? undefined;
        const conflictIndexValue =
          element.getAttribute('data-merge-conflict-conflict-index') ??
          undefined;
        const conflictIndex =
          conflictIndexValue != null
            ? Number.parseInt(conflictIndexValue, 10)
            : Number.NaN;
        if (
          isMergeConflictResolution(resolutionValue) &&
          Number.isFinite(conflictIndex)
        ) {
          mergeConflictActionTarget = {
            kind: 'merge-conflict-action',
            resolution: resolutionValue,
            conflictIndex,
          };
        }
      }

      if (tokenElement == null && element.hasAttribute('data-char')) {
        tokenElement = element;
        const startAttr = element.getAttribute('data-char');

        if (startAttr != null) {
          const lineCharStart = Number.parseInt(startAttr, 10);
          if (!Number.isNaN(lineCharStart)) {
            const tokenText = element.textContent ?? '';
            const lineCharEnd = lineCharStart + tokenText.length;
            if (
              tokenText.trim() !== '' ||
              this.options.enableTokenInteractionsOnWhitespace === true
            ) {
              tokenInfo = {
                tokenElement,
                lineCharStart,
                lineCharEnd,
                tokenText,
              };
            }
            continue;
          }
        }
      }

      const columnNumber =
        numberElement == null
          ? (element.getAttribute('data-column-number') ?? undefined)
          : undefined;
      if (columnNumber != null) {
        numberElement = element;
        lineNumber = Number.parseInt(columnNumber, 10);
        numberColumn = true;
        lineType = getLineTypeFromElement(element);
        lineIndexValue = element.getAttribute('data-line-index') ?? undefined;
        continue;
      }

      const lineAttr =
        lineElement == null
          ? (element.getAttribute('data-line') ?? undefined)
          : undefined;
      if (lineAttr != null) {
        lineElement = element;
        lineNumber = Number.parseInt(lineAttr, 10);
        lineType = getLineTypeFromElement(element);
        lineIndexValue = element.getAttribute('data-line-index') ?? undefined;
        continue;
      }

      if (expandInfo == null && element.hasAttribute('data-expand-button')) {
        expandInfo = {
          hunkIndex: undefined,
          direction: (() => {
            if (element.hasAttribute('data-expand-up')) {
              return 'up';
            }
            if (element.hasAttribute('data-expand-down')) {
              return 'down';
            }
            return 'both';
          })(),
        };
        continue;
      }

      const expandIndexValue =
        expandInfo != null
          ? (element.getAttribute('data-expand-index') ?? undefined)
          : undefined;
      if (expandInfo != null && expandIndexValue != null) {
        const expandIndex = Number.parseInt(expandIndexValue, 10);
        if (!Number.isNaN(expandIndex)) {
          expandInfo.hunkIndex = expandIndex;
        }
        continue;
      }

      if (codeElement == null && element.hasAttribute('data-code')) {
        codeElement = element;
        break;
      }
    }

    if (mergeConflictActionTarget != null) {
      return mergeConflictActionTarget as ResolvedPointerTarget<TMode>;
    }

    if (expandInfo?.hunkIndex != null) {
      return {
        type: 'line-info',
        hunkIndex: expandInfo.hunkIndex,
        direction: expandInfo.direction,
      } as ResolvedPointerTarget<TMode>;
    }

    lineElement ??=
      lineIndexValue != null
        ? queryHTMLElement(
            codeElement,
            `[data-line][data-line-index="${lineIndexValue}"]`
          )
        : undefined;
    numberElement ??=
      lineIndexValue != null
        ? queryHTMLElement(
            codeElement,
            `[data-column-number][data-line-index="${lineIndexValue}"]`
          )
        : undefined;

    if (
      codeElement == null ||
      lineElement == null ||
      numberElement == null ||
      lineType == null ||
      lineNumber == null ||
      Number.isNaN(lineNumber)
    ) {
      return undefined;
    }

    const splitLineIndex = this.parseLineIndex(lineElement, this.isSplitDiff());

    if (tokenInfo != null) {
      if (this.mode === 'file') {
        return {
          kind: 'token',
          lineType,
          lineElement,
          lineNumber,
          numberColumn,
          numberElement,
          side: undefined,
          splitLineIndex,
          ...tokenInfo,
        } as ResolvedPointerTarget<TMode>;
      }

      return {
        kind: 'token',
        lineType,
        lineElement,
        lineNumber,
        numberColumn,
        numberElement,
        side: getAnnotationSide(lineType, codeElement),
        splitLineIndex,
        ...tokenInfo,
      } as ResolvedPointerTarget<TMode>;
    }

    // Otherwise return line target
    if (this.mode === 'file') {
      return {
        kind: 'line',
        lineType,
        lineElement,
        lineNumber,
        numberColumn,
        numberElement,
        side: undefined,
        splitLineIndex,
      } as ResolvedPointerTarget<TMode>;
    }

    return {
      kind: 'line',
      lineType,
      lineElement,
      lineNumber,
      numberColumn,
      numberElement,
      side: getAnnotationSide(lineType, codeElement),
      splitLineIndex,
    } as ResolvedPointerTarget<TMode>;
  }

  private isSplitDiff(): boolean {
    return this.pre?.getAttribute('data-diff-type') === 'split';
  }

  private parseLineIndex(
    element: HTMLElement,
    split: boolean
  ): number | undefined {
    const lineIndexes = (element.getAttribute('data-line-index') ?? '')
      .split(',')
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => !Number.isNaN(value));

    if (split && lineIndexes.length === 2) {
      return lineIndexes[1];
    }
    if (!split) {
      return lineIndexes[0];
    }
    return undefined;
  }
}

type InteractionPluckOptions<TMode extends InteractionManagerMode> =
  InteractionManagerBaseOptions<TMode> & {
    enableHoverUtility?: boolean;
    renderGutterUtility?(
      getHoveredRow: () => GetHoveredLineResult<TMode> | undefined
    ): HTMLElement | null | undefined;
    renderHoverUtility?(
      getHoveredRow: () => GetHoveredLineResult<TMode> | undefined
    ): HTMLElement | null | undefined;
  };

export function pluckInteractionOptions<TMode extends InteractionManagerMode>(
  {
    enableTokenInteractionsOnWhitespace,
    enableGutterUtility,
    enableHoverUtility,
    lineHoverHighlight,
    onGutterUtilityClick,
    onLineClick,
    onLineEnter,
    onLineLeave,
    onLineNumberClick,
    onTokenClick,
    onTokenEnter,
    onTokenLeave,
    renderGutterUtility,
    renderHoverUtility,
    __debugPointerEvents,
    enableLineSelection,
    onLineSelected,
    onLineSelectionStart,
    onLineSelectionChange,
    onLineSelectionEnd,
  }: InteractionPluckOptions<TMode>,
  onHunkExpand?: (
    hunkIndex: number,
    direction: ExpansionDirections,
    expansionLineCount?: number
  ) => unknown,
  getLineIndex?: GetLineIndexUtility,
  onMergeConflictActionClick?: (target: MergeConflictActionTarget) => void
): InteractionManagerOptions<TMode> {
  return {
    enableTokenInteractionsOnWhitespace,
    enableGutterUtility: resolveEnableGutterUtilityOption({
      enableGutterUtility,
      enableHoverUtility,
      renderGutterUtility,
      renderHoverUtility,
      onGutterUtilityClick,
    }),
    usesCustomGutterUtility:
      renderGutterUtility != null || renderHoverUtility != null,
    lineHoverHighlight,

    onGutterUtilityClick,
    onHunkExpand,
    onMergeConflictActionClick,
    onLineClick,
    onLineEnter,
    onLineLeave,
    onLineNumberClick,
    onTokenClick,
    onTokenEnter,
    onTokenLeave,
    __debugPointerEvents,

    enableLineSelection,
    onLineSelected,
    onLineSelectionStart,
    onLineSelectionChange,
    onLineSelectionEnd,

    getLineIndex,
  };
}

function resolveEnableGutterUtilityOption<
  TMode extends InteractionManagerMode,
>({
  enableGutterUtility,
  enableHoverUtility,
  renderGutterUtility,
  renderHoverUtility,
  onGutterUtilityClick,
}: Pick<
  InteractionPluckOptions<TMode>,
  | 'enableGutterUtility'
  | 'enableHoverUtility'
  | 'renderGutterUtility'
  | 'renderHoverUtility'
  | 'onGutterUtilityClick'
>): boolean {
  if (enableGutterUtility !== undefined && enableHoverUtility !== undefined) {
    throw new Error(
      "Cannot use both 'enableGutterUtility' and deprecated 'enableHoverUtility'. Use only 'enableGutterUtility'."
    );
  }
  if (renderGutterUtility != null && renderHoverUtility != null) {
    throw new Error(
      "Cannot use both 'renderGutterUtility' and deprecated 'renderHoverUtility'. Use only 'renderGutterUtility'."
    );
  }
  if (
    onGutterUtilityClick != null &&
    (renderGutterUtility != null || renderHoverUtility != null)
  ) {
    throw new Error(
      "Cannot use both 'onGutterUtilityClick' and render utility callbacks ('renderGutterUtility'/'renderHoverUtility'). Use only one gutter utility API."
    );
  }
  return enableGutterUtility ?? enableHoverUtility ?? false;
}

function isLinePointerTarget<TMode extends InteractionManagerMode>(
  target: ResolvedPointerTarget<TMode> | undefined
): target is LinePointerTarget<TMode> {
  return target != null && 'kind' in target && target.kind === 'line';
}

function isTokenPointerTarget<TMode extends InteractionManagerMode>(
  target: ResolvedPointerTarget<TMode> | undefined
): target is TokenPointerTarget<TMode> {
  return target != null && 'kind' in target && target.kind === 'token';
}

function isHoverableLinePointerTarget<TMode extends InteractionManagerMode>(
  target: ResolvedPointerTarget<TMode> | undefined
): target is HoverableLinePointerTarget<TMode> {
  return isLinePointerTarget(target) || isTokenPointerTarget(target);
}

function isExpandoPointerTarget<TMode extends InteractionManagerMode>(
  target: ResolvedPointerTarget<TMode>
): target is ExpandoEventProps {
  return 'type' in target && target.type === 'line-info';
}

function isMergeConflictActionPointerTarget<
  TMode extends InteractionManagerMode,
>(target: ResolvedPointerTarget<TMode>): target is MergeConflictActionTarget {
  return 'kind' in target && target.kind === 'merge-conflict-action';
}

function isMergeConflictResolution(
  value: string | undefined
): value is MergeConflictResolution {
  return value === 'current' || value === 'incoming' || value === 'both';
}

function queryHTMLElement(
  parent: HTMLElement | undefined,
  query: string
): HTMLElement | undefined {
  const element = parent?.querySelector(query);
  return element instanceof HTMLElement ? element : undefined;
}

function getAnnotationSide(
  lineType: LineTypes,
  codeElement: HTMLElement
): AnnotationSide {
  switch (lineType) {
    case 'change-deletion':
      return 'deletions';
    case 'change-addition':
      return 'additions';
    default:
      return codeElement.hasAttribute('data-deletions')
        ? 'deletions'
        : 'additions';
  }
}

function getLineTypeFromElement(element: HTMLElement): LineTypes | undefined {
  const lineType = element.getAttribute('data-line-type');
  if (lineType == null) {
    return undefined;
  }
  switch (lineType) {
    case 'change-deletion':
    case 'change-addition':
    case 'context':
    case 'context-expanded':
      return lineType;
    default:
      return undefined;
  }
}

function isGutterUtilityPointerPath(
  path: (EventTarget | undefined)[]
): boolean {
  for (const element of path) {
    if (
      element instanceof HTMLElement &&
      element.hasAttribute('data-utility-button')
    ) {
      return true;
    }
  }
  return false;
}

function debugLogIfEnabled(
  debugLogType: LogTypes | undefined = 'none',
  logIfType: 'move' | 'click',
  ...args: unknown[]
) {
  switch (debugLogType) {
    case 'none':
      return;
    case 'both':
      break;
    case 'click':
      if (logIfType !== 'click') {
        return;
      }
      break;
    case 'move':
      if (logIfType !== 'move') {
        return;
      }
      break;
  }
  console.log(...args);
}
