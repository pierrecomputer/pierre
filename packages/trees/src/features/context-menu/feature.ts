import type { FeatureImplementation } from '../../core/types/core';
import type { ContextMenuFeatureConfig } from './types';

export type { ContextMenuRequest } from './types';

export const contextMenuFeature: FeatureImplementation = {
  key: 'context-menu',

  itemInstance: {
    getProps: ({ tree, item, prev }) => {
      const baseProps = prev?.() ?? {};
      const config = tree.getConfig() as ContextMenuFeatureConfig;

      if (
        config.contextMenuEnabled !== true ||
        config.onContextMenuRequest == null
      ) {
        return baseProps;
      }

      return {
        ...baseProps,
        'aria-haspopup': 'menu',
        onKeyDown: (e: KeyboardEvent) => {
          (baseProps.onKeyDown as ((e: KeyboardEvent) => void) | undefined)?.(
            e
          );

          if (e.defaultPrevented) {
            return;
          }

          if (!(e.shiftKey && e.key === 'F10')) {
            return;
          }

          e.preventDefault();
          e.stopPropagation();

          config.onContextMenuRequest?.({
            itemId: item.getId(),
            anchorEl:
              e.currentTarget instanceof HTMLElement ? e.currentTarget : null,
          });
        },
      };
    },
  },
};
