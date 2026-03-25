import type { ItemInstance, SetStateFn } from '../../core/types/core';

export interface DndDataRef {
  lastDragCode?: string;
  lastAllowDrop?: boolean;
  lastDragEnter?: number;
  autoExpandTimeout?: ReturnType<typeof setTimeout>;
  windowDragEndListener?: () => void;
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

    /** Defines the size of the area at the top and bottom of an item where, when an item is dropped, the item willö
     * be placed above or below the item within the same parent, as opposed to being placed inside the item.
     * If `canReorder` is `false`, this is ignored. */
    reorderAreaPercentage?: number;
    canReorder?: boolean;

    canDrag?: (items: ItemInstance<T>[]) => boolean;
    canDrop?: (items: ItemInstance<T>[], target: DragTarget<T>) => boolean;

    indent?: number;

    createForeignDragObject?: (items: ItemInstance<T>[]) => {
      format: string;
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
      data: any;
      dropEffect?: DataTransfer['dropEffect'];
      effectAllowed?: DataTransfer['effectAllowed'];
    };
    setDragImage?: (items: ItemInstance<T>[]) => {
      imgElement: Element;
      xOffset?: number;
      yOffset?: number;
    };

    /** Checks if a foreign drag object can be dropped on a target, validating that an actual drop can commence based on
     * the data in the DataTransfer object. */
    canDropForeignDragObject?: (
      dataTransfer: DataTransfer,
      target: DragTarget<T>
    ) => boolean;

    /** Checks if a droppable visualization should be displayed when dragging a foreign object over a target. Since this
     * is executed on a dragover event, `dataTransfer.getData()` is not available, so `dataTransfer.effectAllowed` or
     * `dataTransfer.types` should be used instead. Before actually completing the drag, @{link canDropForeignDragObject}
     * will be called by HT before applying the drop. */
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

    /** When dragging for this many ms on a closed folder, the folder will automatically open. Set to zero to disable. */
    openOnDropDelay?: number;
  };
  treeInstance: {
    getDragTarget: () => DragTarget<T> | null;
    getDragLineData: () => DragLineData | null;

    getDragLineStyle: (
      topOffset?: number,
      leftOffset?: number
      // oxlint-disable-next-line typescript-eslint/no-explicit-any
    ) => Record<string, any>;
  };
  itemInstance: {
    /** Checks if the user is dragging in a way which makes this the new parent of the dragged items, either by dragging on top of
     * this item, or by dragging inbetween children of this item. See @{isUnorderedDragTarget} if the latter is undesirable. */
    isDragTarget: () => boolean;

    /** As opposed to @{isDragTarget}, this will not be true if the target is inbetween children of this item. This returns only true
     * if the user is dragging directly on top of this item. */
    isUnorderedDragTarget: () => boolean;
    isDragTargetAbove: () => boolean;
    isDragTargetBelow: () => boolean;
    isDraggingOver: () => boolean;
  };
  hotkeys: never;
};
