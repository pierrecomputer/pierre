import type { ItemInstance, SetStateFn } from '../../core/types/core';

export interface DndDataRef {
  lastDragCode?: string;
  lastAllowDrop?: boolean;
  lastDragEnter?: number;
  autoExpandTimeout?: ReturnType<typeof setTimeout>;
  windowDragEndListener?: () => void;
}

export interface TouchDndDataRef extends DndDataRef {
  touchDragActive?: boolean;
  touchStartX?: number;
  touchStartY?: number;
  touchLongPressTimer?: ReturnType<typeof setTimeout>;
  touchMoveHandler?: (e: TouchEvent) => void;
  touchEndHandler?: (e: TouchEvent) => void;
  touchCancelHandler?: (e: TouchEvent) => void;
  selectStartHandler?: (e: Event) => void;
  touchDragElement?: HTMLElement;
  touchGhostElement?: HTMLElement;
  touchGhostOffsetX?: number;
  touchGhostOffsetY?: number;
}

export interface DndState<T> {
  draggedItems?: ItemInstance<T>[];
  draggingOverItem?: ItemInstance<T>;
  dragTarget?: DragTarget<T>;
}

export interface DragLineData {
  indent: number;
  top: number;
  left: number;
  width: number;
}

export type DragTarget<T> =
  | {
      item: ItemInstance<T>;
      childIndex: number;
      insertionIndex: number;
      dragLineIndex: number;
      dragLineLevel: number;
    }
  | {
      item: ItemInstance<T>;
    };

export enum DragTargetPosition {
  Top = 'top',
  Bottom = 'bottom',
  Item = 'item',
}

export type DragAndDropFeatureDef<T> = {
  state: {
    dnd?: DndState<T> | null;
  };
  config: {
    setDndState?: SetStateFn<DndState<T> | undefined | null>;
    reorderAreaPercentage?: number;
    canReorder?: boolean;
    canDrag?: (items: ItemInstance<T>[]) => boolean;
    canDrop?: (items: ItemInstance<T>[], target: DragTarget<T>) => boolean;
    indent?: number;
    createForeignDragObject?: (items: ItemInstance<T>[]) => {
      format: string;
      data: unknown;
      dropEffect?: DataTransfer['dropEffect'];
      effectAllowed?: DataTransfer['effectAllowed'];
    };
    setDragImage?: (items: ItemInstance<T>[]) => {
      imgElement: Element;
      xOffset?: number;
      yOffset?: number;
    };
    canDropForeignDragObject?: (
      dataTransfer: DataTransfer,
      target: DragTarget<T>
    ) => boolean;
    canDragForeignDragObjectOver?: (
      dataTransfer: DataTransfer,
      target: DragTarget<T>
    ) => boolean;
    onDrop?: (
      items: ItemInstance<T>[],
      target: DragTarget<T>
    ) => void | Promise<void>;
    onDropForeignDragObject?: (
      dataTransfer: DataTransfer,
      target: DragTarget<T>
    ) => void | Promise<void>;
    onCompleteForeignDrop?: (items: ItemInstance<T>[]) => void;
    openOnDropDelay?: number;
    _onTouchDragMove?: (clientX: number, clientY: number) => void;
    _onTouchDragEnd?: () => void;
  };
  treeInstance: {
    getDragTarget: () => DragTarget<T> | null;
    getDragLineData: () => DragLineData | null;
    getDragLineStyle: (
      topOffset?: number,
      leftOffset?: number
    ) => Record<string, unknown>;
  };
  itemInstance: {
    isDragTarget: () => boolean;
    isUnorderedDragTarget: () => boolean;
    isDragTargetAbove: () => boolean;
    isDragTargetBelow: () => boolean;
    isDraggingOver: () => boolean;
  };
  hotkeys: never;
};
