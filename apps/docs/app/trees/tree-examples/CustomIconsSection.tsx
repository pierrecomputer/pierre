import { IconBrush, IconFire } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import { preloadFileTree } from '@pierre/trees/ssr';
import type { CSSProperties } from 'react';

import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  baseTreeOptions,
  DEFAULT_FILE_TREE_PANEL_CLASS,
  DEFAULT_FILE_TREE_PANEL_STYLE,
} from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const customSpriteSheet = `
<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="custom-file-icon" viewBox="0 0 16 16" fill="none">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M10.75 0C10.9489 0 11.1396 0.0790743 11.2803 0.219727L14.7803 3.71973C14.9209 3.86038 15 4.05109 15 4.25V13.25C15 14.7688 13.7688 16 12.25 16H3.75C2.23122 16 1 14.7688 1 13.25V2.75C1 1.23122 2.23122 0 3.75 0H10.75ZM7.24805 6.18945C6.93846 5.91438 6.4646 5.94241 6.18945 6.25195L4.18945 8.50195C3.937 8.78608 3.93701 9.21392 4.18945 9.49805L6.18945 11.748C6.46461 12.0576 6.93846 12.0856 7.24805 11.8105C7.55759 11.5354 7.58562 11.0615 7.31055 10.752L5.75391 9L7.31055 7.24805C7.58562 6.93846 7.55759 6.4646 7.24805 6.18945ZM9.81055 6.25195C9.53539 5.94241 9.06154 5.91438 8.75195 6.18945C8.44241 6.4646 8.41438 6.93846 8.68945 7.24805L10.2461 9L8.68945 10.752C8.41438 11.0615 8.44241 11.5354 8.75195 11.8105C9.06154 12.0856 9.53539 12.0576 9.81055 11.748L11.8105 9.49805C12.063 9.21392 12.063 8.78608 11.8105 8.50195L9.81055 6.25195Z" fill="currentcolor"/>
  </symbol>
  <symbol id="custom-folder-icon" viewBox="0 0 16 16" fill="none">
    <path d="M12.5 5a.5.5 0 0 1 .372.835l-4.5 5a.5.5 0 0 1-.744 0l-4.5-5A.501.501 0 0 1 3.5 5z" fill="currentcolor"/>
  </symbol>
  <symbol id="custom-lock-icon" viewBox="0 0 16 16" fill="none">
    <path fill-rule="evenodd" clip-rule="evenodd" d="M4.5 4C6.0606 4 7.43269 4.79591 8.23926 6H14.25L14.335 6.00488C14.5307 6.02719 14.7114 6.12564 14.8359 6.28125L15.8359 7.53125C16.0349 7.77995 16.0545 8.12738 15.8857 8.39746L14.6357 10.3975C14.4309 10.7252 14.0108 10.8435 13.665 10.6709L12.6035 10.1396L11.4805 11.0762C11.2023 11.308 10.7977 11.308 10.5195 11.0762L9.22852 10H8.74316C8.12526 11.7476 6.45979 13 4.5 13C2.01472 13 0 10.9853 0 8.5C0 6.01472 2.01472 4 4.5 4ZM3.5 7.5C2.94772 7.5 2.5 7.94772 2.5 8.5C2.5 9.05228 2.94772 9.5 3.5 9.5C4.05228 9.5 4.5 9.05228 4.5 8.5C4.5 7.94772 4.05228 7.5 3.5 7.5Z" fill="#ffca00" />
  </symbol>
</svg>
`;

const panelStyle = {
  ...DEFAULT_FILE_TREE_PANEL_STYLE,
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const defaultPrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'custom-icons-default',
    lockedPaths: ['package.json'],
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

const remappedPrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'custom-icons-remapped',
    lockedPaths: ['package.json'],
    icons: {
      spriteSheet: customSpriteSheet,
      remap: {
        'file-tree-icon-file': {
          name: 'custom-file-icon',
          width: 12,
          height: 12,
        },
        'file-tree-icon-chevron': {
          name: 'custom-folder-icon',
          width: 12,
          height: 12,
        },
        'file-tree-icon-lock': {
          name: 'custom-lock-icon',
          width: 12,
          height: 12,
        },
      },
    },
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

export function CustomIconsSection() {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="custom-icons"
        title="Custom icons"
        description={
          <>
            Swap out our default icons by using a custom SVG sprite that remaps
            the built-in icon names to your custom symbols. See the{' '}
            <a href="/preview/trees/docs#custom-icons" className="inline-link">
              FileTreeIconConfig docs
            </a>{' '}
            for the full API.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <TreeExampleHeading
            icon={<IconBrush />}
            description={
              <>
                The default icons used when no <code>icons</code> option is set.
              </>
            }
          >
            Default
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={defaultPrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'custom-icons-default',
              lockedPaths: ['package.json'],
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
        <div>
          <TreeExampleHeading
            icon={<IconFire />}
            description={
              <>
                Pass a <code>spriteSheet</code> and <code>remap</code> via the{' '}
                <code>icons</code> option.
              </>
            }
          >
            Remapped
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={remappedPrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'custom-icons-remapped',
              lockedPaths: ['package.json'],
              icons: {
                spriteSheet: customSpriteSheet,
                remap: {
                  'file-tree-icon-file': {
                    name: 'custom-file-icon',
                    width: 12,
                    height: 12,
                  },
                  'file-tree-icon-chevron': {
                    name: 'custom-folder-icon',
                    width: 12,
                    height: 12,
                  },
                  'file-tree-icon-lock': {
                    name: 'custom-lock-icon',
                    width: 12,
                    height: 12,
                  },
                },
              },
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
