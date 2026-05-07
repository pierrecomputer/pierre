import {
  type CSSProperties,
  defineComponent,
  h,
  type PropType,
  toRaw,
  type VNodeChild,
  type VNodeRef,
} from 'vue';

import {
  CONTEXT_MENU_SLOT_NAME,
  FILE_TREE_TAG_NAME,
  HEADER_SLOT_NAME,
} from '../constants';
import type {
  FileTreeCompositionOptions,
  FileTreeContextMenuItem,
  FileTreeContextMenuOpenContext,
  FileTreeSsrPayload,
} from '../model/publicTypes';
import type { FileTree as FileTreeModel } from '../render/FileTree';

interface ActiveContextMenuState {
  context: FileTreeContextMenuOpenContext;
  item: FileTreeContextMenuItem;
}

export type FileTreePreloadedData = Pick<
  FileTreeSsrPayload,
  'id' | 'shadowHtml'
>;

function hasExistingPreloadedContent(host: HTMLElement): boolean {
  const shadowRoot = host.shadowRoot;
  if (
    shadowRoot?.querySelector('[data-file-tree-id]') instanceof HTMLElement ||
    shadowRoot?.querySelector('[data-file-tree-id]') instanceof SVGElement
  ) {
    return true;
  }

  return (
    host.querySelector('template[shadowrootmode="open"]') instanceof
    HTMLTemplateElement
  );
}

function resolveComposition(
  baselineComposition: FileTreeCompositionOptions | undefined,
  hasHeader: boolean,
  hasContextMenu: boolean,
  onClose: () => void,
  onOpen: (
    item: FileTreeContextMenuItem,
    context: FileTreeContextMenuOpenContext
  ) => void
): FileTreeCompositionOptions | undefined {
  const nextComposition: FileTreeCompositionOptions = {
    ...(baselineComposition ?? {}),
  };

  if (hasHeader) {
    delete nextComposition.header;
  }

  if (hasContextMenu) {
    const baselineContextMenu = baselineComposition?.contextMenu;
    const baselineOnClose = baselineContextMenu?.onClose;
    const baselineOnOpen = baselineContextMenu?.onOpen;

    nextComposition.contextMenu = {
      ...(baselineContextMenu ?? {}),
      enabled: true,
      onClose: () => {
        baselineOnClose?.();
        onClose();
      },
      onOpen: (item, context) => {
        onOpen(item, context);
        baselineOnOpen?.(item, context);
      },
    };
    delete nextComposition.contextMenu.render;
  }

  return nextComposition.header != null || nextComposition.contextMenu != null
    ? nextComposition
    : undefined;
}

export const FileTree = defineComponent({
  name: 'FileTree',
  inheritAttrs: false,
  props: {
    id: {
      required: false,
      type: String,
    },
    model: {
      required: true,
      type: Object as PropType<FileTreeModel>,
    },
    preloadedData: {
      required: false,
      type: Object as PropType<FileTreePreloadedData>,
    },
  },
  data(): {
    activeContextMenu: ActiveContextMenuState | null;
    baselineComposition: FileTreeCompositionOptions | undefined;
    hostElement: HTMLElement | null;
    shouldRenderPreloadedTemplate: boolean;
  } {
    return {
      activeContextMenu: null,
      baselineComposition: toRaw(this.model).getComposition(),
      hostElement: null,
      shouldRenderPreloadedTemplate: this.preloadedData != null,
    };
  },
  computed: {
    hasContextMenuSlot(): boolean {
      return this.$slots['context-menu'] != null;
    },
    hasHeaderSlot(): boolean {
      return this.$slots.header != null;
    },
    resolvedComposition(): FileTreeCompositionOptions | undefined {
      return resolveComposition(
        this.baselineComposition,
        this.hasHeaderSlot,
        this.hasContextMenuSlot,
        this.handleContextMenuClose,
        this.handleContextMenuOpen
      );
    },
    resolvedHostId(): string | undefined {
      return this.id ?? this.preloadedData?.id;
    },
    rawModel(): FileTreeModel {
      return toRaw(this.model);
    },
  },
  watch: {
    model(
      nextModel: FileTreeModel,
      previousModel: FileTreeModel | undefined
    ): void {
      const rawPreviousModel =
        previousModel == null ? undefined : toRaw(previousModel);
      const rawNextModel = toRaw(nextModel);
      rawPreviousModel?.unmount();
      rawPreviousModel?.setComposition(this.baselineComposition);
      this.baselineComposition = rawNextModel.getComposition();
      this.activeContextMenu = null;
      this.syncComposition();
      this.mountModel();
    },
    preloadedData(): void {
      this.mountModel();
    },
    resolvedComposition(): void {
      this.syncComposition();
    },
    hasContextMenuSlot(nextHasContextMenuSlot: boolean): void {
      if (!nextHasContextMenuSlot) {
        this.activeContextMenu = null;
      }
    },
  },
  mounted(): void {
    this.syncComposition();
    this.mountModel();
    this.shouldRenderPreloadedTemplate = false;
  },
  updated(): void {
    this.syncComposition();
  },
  beforeUnmount(): void {
    this.rawModel.unmount();
    this.rawModel.setComposition(this.baselineComposition);
  },
  methods: {
    handleContextMenuClose(): void {
      this.activeContextMenu = null;
    },
    handleContextMenuOpen(
      item: FileTreeContextMenuItem,
      context: FileTreeContextMenuOpenContext
    ): void {
      this.activeContextMenu = { context, item };
    },
    mountModel(): void {
      const hostElement = this.hostElement;
      if (hostElement == null) {
        return;
      }

      if (
        this.preloadedData != null &&
        hasExistingPreloadedContent(hostElement)
      ) {
        this.rawModel.hydrate({ fileTreeContainer: hostElement });
      } else {
        this.rawModel.render({ fileTreeContainer: hostElement });
      }
    },
    setHostElement(node: Element | null): void {
      this.hostElement = node instanceof HTMLElement ? node : null;
    },
    syncComposition(): void {
      this.rawModel.setComposition(this.resolvedComposition);
    },
  },
  render(): VNodeChild {
    const attrs = { ...this.$attrs };
    const callerStyle = attrs.style;
    delete attrs.style;

    const children: VNodeChild[] = [];
    if (this.shouldRenderPreloadedTemplate && this.preloadedData != null) {
      children.push(
        h('template', {
          innerHTML: this.preloadedData.shadowHtml,
          shadowrootmode: 'open',
        })
      );
    }

    const header = this.$slots.header?.();
    if (header != null) {
      children.push(h('div', { slot: HEADER_SLOT_NAME }, header));
    }

    const contextMenu = this.activeContextMenu;
    const contextMenuSlot = this.$slots['context-menu'];
    if (contextMenu != null && contextMenuSlot != null) {
      children.push(
        h(
          'div',
          { slot: CONTEXT_MENU_SLOT_NAME },
          contextMenuSlot({
            context: contextMenu.context,
            item: contextMenu.item,
          })
        )
      );
    }

    const densityStyle: CSSProperties = {
      '--trees-density-override': this.rawModel.getDensityFactor(),
      '--trees-item-height': `${String(this.rawModel.getItemHeight())}px`,
    };

    return h(
      FILE_TREE_TAG_NAME,
      {
        ...attrs,
        'data-allow-mismatch':
          this.preloadedData == null ? undefined : 'children',
        id: this.resolvedHostId,
        ref: this.setHostElement as VNodeRef,
        style: [densityStyle, callerStyle],
      },
      children
    );
  },
});
