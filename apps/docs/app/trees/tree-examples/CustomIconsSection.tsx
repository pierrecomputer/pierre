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
import { setiFullIconOverrides } from './seti-full.generated';
import { TreeExampleSection } from './TreeExampleSection';

const panelStyle = {
  ...DEFAULT_FILE_TREE_PANEL_STYLE,
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const iconOverrides = setiFullIconOverrides;

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

const overridePrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'custom-icons-overrides',
    lockedPaths: ['package.json'],
    icons: iconOverrides,
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
                Pass a <code>spriteSheet</code>, <code>remap</code>,{' '}
                <code>byFileExtension</code>, <code>byFileName</code>, and{' '}
                <code>byFileNameContains</code>.
              </>
            }
          >
            Overrides
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={overridePrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'custom-icons-overrides',
              lockedPaths: ['package.json'],
              icons: iconOverrides,
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
      </div>
    </TreeExampleSection>
  );
}
