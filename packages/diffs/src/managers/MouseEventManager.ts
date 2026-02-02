import type {
  AnnotationSide,
  DiffLineEventBaseProps,
  ExpansionDirections,
  LineEventBaseProps,
  LineTypes,
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
  | { eventType: 'click'; event: PointerEvent | MouseEvent }
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
  private interactiveLinesAttr = false;
  private interactiveLineNumbersAttr = false;
  private hasEventListeners = false;

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
    this.pre?.removeEventListener('pointerleave', this.handleMouseLeave);
    delete this.pre?.dataset.interactiveLines;
    delete this.pre?.dataset.interactiveLineNumbers;
    this.interactiveLinesAttr = false;
    this.interactiveLineNumbersAttr = false;
    this.hasEventListeners = false;
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

    const newContainer = this.pre !== pre;
    if (newContainer) {
      this.cleanUp();
      this.pre = pre;
      this.hasEventListeners = false;
    }

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

    const requiresEventListeners =
      onLineClick != null ||
      onLineNumberClick != null ||
      onHunkExpand != null ||
      onLineEnter != null ||
      onLineLeave != null ||
      enableHoverUtility;

    if ((newContainer || !this.hasEventListeners) && requiresEventListeners) {
      this.hasEventListeners = true;
      pre.addEventListener('click', this.handleMouseClick);
      if (onLineClick != null) {
        pre.dataset.interactiveLines = '';
        this.interactiveLinesAttr = true;
        this.interactiveLineNumbersAttr = false;
      } else if (onLineNumberClick != null) {
        pre.dataset.interactiveLineNumbers = '';
        this.interactiveLinesAttr = false;
        this.interactiveLineNumbersAttr = true;
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
    } else if (!requiresEventListeners && this.hasEventListeners) {
      this.pre?.removeEventListener('click', this.handleMouseClick);
      this.pre?.removeEventListener('pointermove', this.handleMouseMove);
      this.pre?.removeEventListener('pointerleave', this.handleMouseLeave);
      this.hasEventListeners = false;
    }

    if (!newContainer) {
      if (onLineClick != null) {
        if (this.interactiveLineNumbersAttr) {
          delete pre.dataset.interactiveLineNumbers;
          this.interactiveLineNumbersAttr = false;
        }
        if (!this.interactiveLinesAttr) {
          pre.dataset.interactiveLines = '';
          this.interactiveLinesAttr = true;
        }
      } else if (onLineNumberClick != null) {
        if (this.interactiveLinesAttr) {
          delete pre.dataset.interactiveLines;
          this.interactiveLinesAttr = false;
        }
        if (!this.interactiveLineNumbersAttr) {
          pre.dataset.interactiveLineNumbers = '';
          this.interactiveLineNumbersAttr = true;
        }
      } else {
        if (this.interactiveLinesAttr) {
          delete pre.dataset.interactiveLines;
          this.interactiveLinesAttr = false;
        }
        if (this.interactiveLineNumbersAttr) {
          delete pre.dataset.interactiveLineNumbers;
          this.interactiveLineNumbersAttr = false;
        }
      }
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

  handleMouseClick = (event: MouseEvent): void => {
    const { onLineClick, onLineNumberClick, onHunkExpand } = this.options;
    if (
      onLineClick == null &&
      onLineNumberClick == null &&
      onHunkExpand == null
    ) {
      return;
    }
    debugLogIfEnabled(
      this.options.__debugMouseEvents,
      'click',
      'FileDiff.DEBUG.handleMouseClick:',
      event
    );
    this.handleMouseEvent({ eventType: 'click', event });
  };

  handleMouseMove = (event: PointerEvent): void => {
    const {
      onLineEnter,
      onLineLeave,
      enableHoverUtility = false,
    } = this.options;
    if (!enableHoverUtility && onLineEnter == null && onLineLeave == null) {
      return;
    }
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
    let lineType: LineTypes | undefined;
    let codeElement: HTMLElement | undefined;
    let lineElement: HTMLElement | undefined;
    let numberElement: HTMLElement | undefined;
    let expandInfo:
      | {
          hunkIndex: number | undefined;
          direction: 'up' | 'down' | 'both';
        }
      | undefined;
    let lineNumber: number | undefined;

    for (const element of path) {
      if (!(element instanceof HTMLElement)) continue;
      // If we've click on a number column line, lets grab the relevant
      // line info
      if (numberElement == null && 'columnNumber' in element.dataset) {
        numberElement = element;
        lineNumber = Number.parseInt(element.dataset.columnNumber ?? '', 10);
        numberColumn = true;
        lineType = getLineTypeFromElement(element);
        continue;
      }
      // If we've clicked on a code column line, lets grab the relevant
      // line info
      if (lineElement == null && 'line' in element.dataset) {
        lineElement = element;
        lineNumber = Number.parseInt(element.dataset.line ?? '', 10);
        lineType = getLineTypeFromElement(element);
        continue;
      }
      // If we've clicked on an expand button, lets grab the relevant info
      if (expandInfo == null && 'expandButton' in element.dataset) {
        expandInfo = {
          hunkIndex: undefined,
          direction: (() => {
            if ('expandUp' in element.dataset) {
              return 'up';
            }
            if ('expandDown' in element.dataset) {
              return 'down';
            }
            return 'both';
          })(),
        };
        continue;
      }
      // If we've clicked on an expand container, lets grab the index off of it
      // FIXME(amadeus): Might be worth stuffing the expand index into the
      // buttons themselves?  Requires a small HTML change tho...
      if (expandInfo != null && 'expandIndex' in element.dataset) {
        const expandIndex = Number.parseInt(
          element.dataset.expandIndex ?? '',
          10
        );
        if (!Number.isNaN(expandIndex)) {
          expandInfo.hunkIndex = expandIndex;
        }
        continue;
      }
      // And finally, if we managed to get to the code element, then we either
      // have the necessary info, or we don't, so we can stop iterating through
      // the path
      if (codeElement == null && 'code' in element.dataset) {
        codeElement = element;
        // Once we've found the code parent, there's no more travesial necessary
        break;
      }
    }

    // If we are handling expansion, lets do that
    if (expandInfo?.hunkIndex != null) {
      const { hunkIndex, direction } = expandInfo;
      return { type: 'line-info', hunkIndex, direction };
    }

    lineElement ??= queryHTMLElement(
      codeElement,
      `[data-line="${lineNumber}"]`
    );
    numberElement ??= queryHTMLElement(
      codeElement,
      `[data-column-number="${lineNumber}"]`
    );

    // If we were unable to find the necessary elements, we out.
    if (
      codeElement == null ||
      lineElement == null ||
      numberElement == null ||
      lineType == null
    ) {
      return undefined;
    }

    if (this.mode === 'file') {
      return {
        type: 'line',
        lineElement,
        lineNumber,
        numberElement,
        numberColumn,
      } as GetLineDataResult<TMode>;
    }

    return {
      type: 'diff-line',
      annotationSide: (() => {
        switch (lineType) {
          case 'change-deletion':
            return 'deletions';
          case 'change-addition':
            return 'additions';
          default:
            return 'deletions' in codeElement.dataset
              ? 'deletions'
              : 'additions';
        }
      })(),
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

function queryHTMLElement(
  parent: HTMLElement | undefined,
  query: string
): HTMLElement | undefined {
  const element = parent?.querySelector(query);
  return element instanceof HTMLElement ? element : undefined;
}

function getLineTypeFromElement(element: HTMLElement): LineTypes | undefined {
  const { lineType } = element.dataset;
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
