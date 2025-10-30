import type { AnnotationSide, DiffLineEventBaseProps } from './types';

export interface OnDiffLineClickProps extends DiffLineEventBaseProps {
  event: PointerEvent;
}

export interface OnDiffLineEnterProps extends DiffLineEventBaseProps {
  event: MouseEvent;
}

export interface OnDiffLineLeaveProps extends DiffLineEventBaseProps {
  event: MouseEvent;
}

type HandleMouseEventProps =
  | { eventType: 'click'; event: PointerEvent }
  | { eventType: 'move'; event: MouseEvent };

export type LogTypes = 'click' | 'move' | 'both' | 'none';

interface ExpandoEventProps {
  type: 'line-info';
  hunkIndex: number;
}

export interface MouseEventManagerBaseOptions {
  onLineClick?(props: OnDiffLineClickProps): unknown;
  onLineNumberClick?(props: OnDiffLineClickProps): unknown;
  onLineEnter?(props: DiffLineEventBaseProps): unknown;
  onLineLeave?(props: DiffLineEventBaseProps): unknown;
  __debugMouseEvents?: LogTypes;
}

export interface MouseEventManagerOptions extends MouseEventManagerBaseOptions {
  onHunkExpand?(hunkIndex: number): unknown;
}

export class MouseEventManager {
  hoveredRow: DiffLineEventBaseProps | undefined;
  private pre: HTMLPreElement | undefined;

  constructor(private options: MouseEventManagerOptions) {}

  setOptions(options: MouseEventManagerOptions): void {
    this.options = options;
  }

  cleanUp(): void {
    this.pre?.removeEventListener('click', this.handleMouseClick);
    this.pre?.removeEventListener('mousemove', this.handleMouseMove);
    this.pre?.removeEventListener('mouseout', this.handleMouseLeave);
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
    } = this.options;

    this.cleanUp();
    this.pre = pre;

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
    if (onLineEnter != null || onLineLeave != null) {
      pre.addEventListener('mousemove', this.handleMouseMove);
      debugLogIfEnabled(
        __debugMouseEvents,
        'move',
        'FileDiff.DEBUG.attachEventListeners: Attaching mouse move event'
      );
      if (onLineLeave != null) {
        pre.addEventListener('mouseleave', this.handleMouseLeave);
        debugLogIfEnabled(
          __debugMouseEvents,
          'move',
          'FileDiff.DEBUG.attachEventListeners: Attaching mouse leave event'
        );
      }
    }
  }

  handleMouseClick = (event: PointerEvent): void => {
    debugLogIfEnabled(
      this.options.__debugMouseEvents,
      'click',
      'FileDiff.DEBUG.handleMouseClick:',
      event
    );
    this.handleMouseEvent({ eventType: 'click', event });
  };

  handleMouseMove = (event: MouseEvent): void => {
    debugLogIfEnabled(
      this.options.__debugMouseEvents,
      'move',
      'FileDiff.DEBUG.handleMouseMove:',
      event
    );
    this.handleMouseEvent({ eventType: 'move', event });
  };

  handleMouseLeave = (): void => {
    const { __debugMouseEvents } = this.options;
    debugLogIfEnabled(
      __debugMouseEvents,
      'move',
      'FileDiff.DEBUG.handleMouseLeave: no event'
    );
    if (this.hoveredRow == null) {
      debugLogIfEnabled(
        __debugMouseEvents,
        'move',
        'FileDiff.DEBUG.handleMouseLeave: returned early, no .hoveredRow'
      );
      return;
    }
    this.options.onLineLeave?.(this.hoveredRow);
    this.hoveredRow = undefined;
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
          data?.type === 'line' &&
          this.hoveredRow?.lineElement === data.lineElement
        ) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'move',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'move', returned early because same line"
          );
          break;
        }
        if (this.hoveredRow != null) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'move',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'move', clearing an existing hovered row and firing onLineLeave"
          );
          onLineLeave?.(this.hoveredRow);
          this.hoveredRow = undefined;
        }
        if (data?.type === 'line') {
          debugLogIfEnabled(
            __debugMouseEvents,
            'move',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'move', setting up a new hoveredRow and firing onLineEnter"
          );
          this.hoveredRow = data;
          onLineEnter?.(this.hoveredRow);
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
        if (data.type === 'line-info' && onHunkExpand != null) {
          debugLogIfEnabled(
            __debugMouseEvents,
            'click',
            "FileDiff.DEBUG.handleMouseEvent: switch, 'click', expanding a hunk"
          );
          onHunkExpand(data.hunkIndex);
          break;
        }
        if (data.type === 'line') {
          if (onLineNumberClick != null && data.numberColumn) {
            debugLogIfEnabled(
              __debugMouseEvents,
              'click',
              "FileDiff.DEBUG.handleMouseEvent: switch, 'click', firing 'onLineNumberClick'"
            );
            onLineNumberClick({ ...data, event });
          } else if (onLineClick != null) {
            debugLogIfEnabled(
              __debugMouseEvents,
              'click',
              "FileDiff.DEBUG.handleMouseEvent: switch, 'click', firing 'onLineClick'"
            );
            onLineClick({ ...data, event });
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
    path: EventTarget[]
  ): DiffLineEventBaseProps | ExpandoEventProps | undefined {
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
      return {
        type: 'line-info',
        hunkIndex,
      };
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
      type: 'line',
      annotationSide,
      lineType,
      lineElement,
      lineNumber,
      numberColumn,
    };
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

export function getMouseEventOptions(
  options: MouseEventManagerBaseOptions,
  onHunkExpand?: (hunkIndex: number) => unknown
): MouseEventManagerOptions {
  return {
    onLineClick: options.onLineClick,
    onLineNumberClick: options.onLineNumberClick,
    onLineEnter: options.onLineEnter,
    onLineLeave: options.onLineLeave,
    __debugMouseEvents: options.__debugMouseEvents,
    onHunkExpand,
  };
}
