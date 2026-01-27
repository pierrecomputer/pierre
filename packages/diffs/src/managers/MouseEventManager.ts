import type {
  AnnotationSide,
  DiffLineEventBaseProps,
  ExpansionDirections,
  LineEventBaseProps,
} from '../types';

export type LogTypes = 'click' | 'move' | 'both' | 'none';

export type MouseEventManagerMode = 'file' | 'diff';

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

type HandleMouseEventProps =
  | { eventType: 'click'; event: PointerEvent }
  | { eventType: 'move'; event: PointerEvent };

type EventClickProps<TMode extends MouseEventManagerMode> = TMode extends 'file'
  ? OnLineClickProps
  : OnDiffLineClickProps;

type MouseEventEnterLeaveProps<TMode extends MouseEventManagerMode> =
  TMode extends 'file' ? OnLineEnterLeaveProps : OnDiffLineEnterLeaveProps;

type EventBaseProps<TMode extends MouseEventManagerMode> = TMode extends 'file'
  ? LineEventBaseProps
  : DiffLineEventBaseProps;

interface ExpandoEventProps {
  type: 'line-info';
  hunkIndex: number;
  direction: ExpansionDirections;
}

export type GetHoveredLineResult<TMode extends MouseEventManagerMode> =
  TMode extends 'file'
    ? { lineNumber: number }
    : { lineNumber: number; side: AnnotationSide };

type GetLineDataResult<TMode extends MouseEventManagerMode> =
  TMode extends 'file'
    ? LineEventBaseProps | ExpandoEventProps | undefined
    : DiffLineEventBaseProps | ExpandoEventProps | undefined;

type LineEventData<TMode extends MouseEventManagerMode> = TMode extends 'file'
  ? LineEventBaseProps
  : DiffLineEventBaseProps;

function isLineEventData<TMode extends MouseEventManagerMode>(
  data: GetLineDataResult<TMode>,
  mode: TMode
): data is LineEventData<TMode> {
  if (data == null) return false;
  if (mode === 'file') {
    return data.type === 'line';
  } else {
    return data.type === 'diff-line';
  }
}

function isExpandoEventData(
  data:
    | LineEventBaseProps
    | DiffLineEventBaseProps
    | ExpandoEventProps
    | undefined
): data is ExpandoEventProps {
  return data?.type === 'line-info';
}

export interface MouseEventManagerBaseOptions<
  TMode extends MouseEventManagerMode,
> {
  enableHoverUtility?: boolean;
  onLineClick?(props: EventClickProps<TMode>): unknown;
  onLineNumberClick?(props: EventClickProps<TMode>): unknown;
  onLineEnter?(props: MouseEventEnterLeaveProps<TMode>): unknown;
  onLineLeave?(props: MouseEventEnterLeaveProps<TMode>): unknown;
  __debugMouseEvents?: LogTypes;
}

export interface MouseEventManagerOptions<
  TMode extends MouseEventManagerMode,
> extends MouseEventManagerBaseOptions<TMode> {
  onHunkExpand?(hunkIndex: number, direction: ExpansionDirections): unknown;
}

export class MouseEventManager<TMode extends MouseEventManagerMode> {
  private hoveredLine: EventBaseProps<TMode> | undefined;
  private pre: HTMLPreElement | undefined;
  private hoverSlot: HTMLDivElement | undefined;

  constructor(
    private mode: TMode,
    private options: MouseEventManagerOptions<TMode>
  ) {}

  setOptions(options: MouseEventManagerOptions<TMode>): void {
    this.options = options;
  }

  cleanUp(): void {
    this.pre?.removeEventListener('click', this.handleMouseClick);
    this.pre?.removeEventListener('pointermove', this.handleMouseMove);
    this.pre?.removeEventListener('pointerout', this.handleMouseLeave);
    delete this.pre?.dataset.interactiveLines;
    delete this.pre?.dataset.interactiveLineNumbers;
    this.pre = undefined;
  }

  setup(pre: HTMLPreElement): void {
    const {
      __debugMouseEvents,
      onLineClick,
      onLineNumberClick,
      onLineEnter,
      onLineLeave,
      onHunkExpand,
      enableHoverUtility = false,
    } = this.options;

    this.cleanUp();
    this.pre = pre;

    if (enableHoverUtility && this.hoverSlot == null) {
      this.hoverSlot = document.createElement('div');
      this.hoverSlot.dataset.hoverSlot = '';
      const slotElement = document.createElement('slot');
      slotElement.name = 'hover-slot';
      this.hoverSlot.appendChild(slotElement);
    } else if (!enableHoverUtility && this.hoverSlot != null) {
      this.hoverSlot.parentNode?.removeChild(this.hoverSlot);
      this.hoverSlot = undefined;
    }

    if (
      onLineClick != null ||
      onLineNumberClick != null ||
      onHunkExpand != null
    ) {
      pre.addEventListener('click', this.handleMouseClick);
      if (onLineClick != null) {
        pre.dataset.interactiveLines = '';
      } else if (onLineNumberClick != null) {
        pre.dataset.interactiveLineNumbers = '';
      }
      debugLogIfEnabled(
        __debugMouseEvents,
        'click',
        'FileDiff.DEBUG.attachEventListeners: Attaching click events for:',
        (() => {
          const reasons: string[] = [];
          if (__debugMouseEvents === 'both' || __debugMouseEvents === 'click') {
            if (onLineClick != null) {
              reasons.push('onLineClick');
            }
            if (onLineNumberClick != null) {
              reasons.push('onLineNumberClick');
            }
            if (onHunkExpand != null) {
              reasons.push('expandable hunk separators');
            }
          }
          return reasons;
        })()
      );
    }
    if (onLineEnter != null || onLineLeave != null || enableHoverUtility) {
      pre.addEventListener('pointermove', this.handleMouseMove);
      debugLogIfEnabled(
        __debugMouseEvents,
        'move',
        'FileDiff.DEBUG.attachEventListeners: Attaching pointer move event'
      );
      pre.addEventListener('pointerleave', this.handleMouseLeave);
      debugLogIfEnabled(
        __debugMouseEvents,
        'move',
        'FileDiff.DEBUG.attachEventListeners: Attaching pointer leave event'
      );
    }
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

  handleMouseClick = (event: PointerEvent): void => {
    debugLogIfEnabled(
      this.options.__debugMouseEvents,
      'click',
      'FileDiff.DEBUG.handleMouseClick:',
      event
    );
    this.handleMouseEvent({ eventType: 'click', event });
  };

  handleMouseMove = (event: PointerEvent): void => {
    debugLogIfEnabled(
      this.options.__debugMouseEvents,
      'move',
      'FileDiff.DEBUG.handleMouseMove:',
      event
    );
    this.handleMouseEvent({ eventType: 'move', event });
  };

  handleMouseLeave = (event: PointerEvent): void => {
    const { __debugMouseEvents } = this.options;
    debugLogIfEnabled(
      __debugMouseEvents,
      'move',
      'FileDiff.DEBUG.handleMouseLeave: no event'
    );
    if (this.hoveredLine == null) {
      debugLogIfEnabled(
        __debugMouseEvents,
        'move',
        'FileDiff.DEBUG.handleMouseLeave: returned early, no .hoveredLine'
      );
      return;
    }
    this.hoverSlot?.parentElement?.removeChild(this.hoverSlot);
    this.options.onLineLeave?.({
      ...this.hoveredLine,
      event,
    } as MouseEventEnterLeaveProps<TMode>);
    this.hoveredLine = undefined;
  };

  private handleMouseEvent({ eventType, event }: HandleMouseEventProps) {
    const { __debugMouseEvents } = this.options;
    const composedPath = event.composedPath();
    debugLogIfEnabled(
      __debugMouseEvents,
      eventType,
      'FileDiff.DEBUG.handleMouseEvent:',
      { eventType, composedPath }
    );
    const data = this.getLineData(composedPath);
    debugLogIfEnabled(
      __debugMouseEvents,
      eventType,
      'FileDiff.DEBUG.handleMouseEvent: getLineData result:',
      data
    );
    const {
      onLineClick,
      onLineNumberClick,
      onLineEnter,
      onLineLeave,
      onHunkExpand,
    } = this.options;
    switch (eventType) {
      case 'move': {
        if (
          isLineEventData(data, this.mode) &&
          this.hoveredLine?.lineElement === data.lineElement
        ) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'move',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'move', returned early because same line"
          );
          break;
        }
        if (this.hoveredLine != null) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'move',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'move', clearing an existing hovered line and firing onLineLeave"
          );
          this.hoverSlot?.parentElement?.removeChild(this.hoverSlot);
          onLineLeave?.({
            ...this.hoveredLine,
            event,
          } as MouseEventEnterLeaveProps<TMode>);
          this.hoveredLine = undefined;
        }
        if (isLineEventData(data, this.mode)) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'move',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'move', setting up a new hoveredLine and firing onLineEnter"
          );
          this.hoveredLine = data;
          if (this.hoverSlot != null) {
            data.numberElement?.appendChild(this.hoverSlot);
          }
          onLineEnter?.({
            ...this.hoveredLine,
            event,
          } as MouseEventEnterLeaveProps<TMode>);
        }
        break;
      }
      case 'click':
        debugLogIfEnabled(
          __debugMouseEvents,
          'click',
          "FileDiff.DEBUG.handleMouseEvent: switch, 'click', with data:",
          data
        );
        if (data == null) break;
        if (isExpandoEventData(data) && onHunkExpand != null) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'click',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'click', expanding a hunk"
          );
          onHunkExpand(data.hunkIndex, data.direction);
          break;
        }
        if (isLineEventData(data, this.mode)) {
          if (onLineNumberClick != null && data.numberColumn) {
            debugLogIfEnabled(
              __debugMouseEvents,
              'click',
              "FileDiff.DEBUG.handleMouseEvent: switch, 'click', firing 'onLineNumberClick'"
            );
            onLineNumberClick({ ...data, event } as EventClickProps<TMode>);
          } else if (onLineClick != null) {
            debugLogIfEnabled(
              __debugMouseEvents,
              'click',
              "FileDiff.DEBUG.handleMouseEvent: switch, 'click', firing 'onLineClick'"
            );
            onLineClick({ ...data, event } as EventClickProps<TMode>);
          } else {
            debugLogIfEnabled(
              __debugMouseEvents,
              'click',
              "FileDiff.DEBUG.handleMouseEvent: switch, 'click', fell through, no event to fire"
            );
          }
        }
        break;
    }
  }

  private getLineData(
    path: (EventTarget | undefined)[]
  ): GetLineDataResult<TMode> {
    let numberColumn = false;
    const lineElement = path.find((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }
      numberColumn = numberColumn || 'columnNumber' in element.dataset;
      return 'line' in element.dataset || 'expandIndex' in element.dataset;
    });
    if (!(lineElement instanceof HTMLElement)) return undefined;
    if (lineElement.dataset.expandIndex != null) {
      const hunkIndex = parseInt(lineElement.dataset.expandIndex);
      if (isNaN(hunkIndex)) {
        return undefined;
      }
      let direction: ExpansionDirections | undefined;
      for (const element of path) {
        if (element === lineElement) break;
        if (element instanceof HTMLElement) {
          direction =
            direction ??
            ('expandUp' in element.dataset ? 'up' : undefined) ??
            ('expandDown' in element.dataset ? 'down' : undefined) ??
            ('expandBoth' in element.dataset ? 'both' : undefined);
          if (direction != null) {
            break;
          }
        }
      }
      return direction != null
        ? { type: 'line-info', hunkIndex, direction }
        : undefined;
    }
    const lineNumber = parseInt(lineElement.dataset.line ?? '');
    if (isNaN(lineNumber)) return;
    const lineType = lineElement.dataset.lineType;
    if (
      lineType !== 'context' &&
      lineType !== 'context-expanded' &&
      lineType !== 'change-deletion' &&
      lineType !== 'change-addition'
    ) {
      return undefined;
    }

    const numberElement = (() => {
      const numberElement = lineElement.children[0];
      return numberElement instanceof HTMLElement &&
        numberElement.dataset.columnNumber != null
        ? numberElement
        : undefined;
    })();

    if (this.mode === 'file') {
      return {
        type: 'line',
        lineElement,
        lineNumber,
        numberElement,
        numberColumn,
      } as GetLineDataResult<TMode>;
    }

    const annotationSide: AnnotationSide = (() => {
      if (lineType === 'change-deletion') {
        return 'deletions';
      }
      if (lineType === 'change-addition') {
        return 'additions';
      }
      const parent = lineElement.closest('[data-code]');
      if (!(parent instanceof HTMLElement)) {
        return 'additions';
      }
      return 'deletions' in parent.dataset ? 'deletions' : 'additions';
    })();

    return {
      type: 'diff-line',
      annotationSide,
      lineType,
      lineElement,
      numberElement,
      lineNumber,
      numberColumn,
    } as GetLineDataResult<TMode>;
  }
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

export function pluckMouseEventOptions<TMode extends MouseEventManagerMode>(
  {
    onLineClick,
    onLineNumberClick,
    onLineEnter,
    onLineLeave,
    enableHoverUtility,
    __debugMouseEvents,
  }: MouseEventManagerBaseOptions<TMode>,
  onHunkExpand?: (hunkIndex: number, direction: ExpansionDirections) => unknown
): MouseEventManagerOptions<TMode> {
  return {
    onLineClick,
    onLineNumberClick,
    onLineEnter,
    onLineLeave,
    enableHoverUtility,
    __debugMouseEvents,
    onHunkExpand,
  };
}
