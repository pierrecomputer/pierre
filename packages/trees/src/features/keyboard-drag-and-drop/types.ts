import type { ItemInstance, SetStateFn } from '../../core/types/core';

export interface KDndDataRef {
  kDndDataTransfer: DataTransfer | undefined;
}

export enum AssistiveDndState {
  None,
  Started,
  Dragging,
  Completed,
  Aborted,
}

export type KeyboardDragAndDropFeatureDef<T> = {
  state: {
    assistiveDndState?: AssistiveDndState | null;
  };
  config: {
    setAssistiveDndState?: SetStateFn<AssistiveDndState | undefined | null>;
    onStartKeyboardDrag?: (items: ItemInstance<T>[]) => void;
  };
  treeInstance: {
    startKeyboardDrag: (items: ItemInstance<T>[]) => void;
    startKeyboardDragOnForeignObject: (dataTransfer: DataTransfer) => void;
    stopKeyboardDrag: () => void;
  };
  itemInstance: {};
  hotkeys: 'startDrag' | 'cancelDrag' | 'completeDrag' | 'dragUp' | 'dragDown';
};
