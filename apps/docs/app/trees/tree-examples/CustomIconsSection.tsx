import { IconBrush, IconFileTreeFill, IconFire } from '@pierre/icons';
import { FileTree } from '@pierre/trees/react';
import { preloadFileTree } from '@pierre/trees/ssr';
import type { CSSProperties } from 'react';

import { PierreIconsFootnote } from '../../components/PierreIconsFootnote';
import { TreeExampleHeading } from '../../components/TreeExampleHeading';
import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import {
  baseTreeOptions,
  DEFAULT_FILE_TREE_PANEL_CLASS,
  DEFAULT_FILE_TREE_PANEL_STYLE,
} from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';

const panelStyle = {
  ...DEFAULT_FILE_TREE_PANEL_STYLE,
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const minimalPrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'built-in-icons-minimal',
    lockedPaths: ['package.json'],
    icons: 'minimal',
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

const defaultPrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'built-in-icons-default',
    lockedPaths: ['package.json'],
    icons: 'standard',
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

const completePrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'built-in-icons-complete',
    lockedPaths: ['package.json'],
    icons: 'complete',
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
        title="Built-in icon sets"
        description={
          <>
            Choose between the shipped <code>minimal</code>,{' '}
            <code>standard</code>, and <code>complete</code> icon tiers. Each
            tier is cumulative. Override the built-in palette with CSS variables
            like <code>--trees-file-icon-color-javascript</code>, or fall back
            to a fully custom sprite. See the{' '}
            <a href="/preview/trees/docs#custom-icons" className="inline-link">
              FileTreeIconConfig docs
            </a>{' '}
            for the full API.
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div>
          <TreeExampleHeading
            icon={<IconFileTreeFill />}
            description={
              <>Generic file, folder, and image icons with no file types.</>
            }
          >
            Minimal
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={minimalPrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'built-in-icons-minimal',
              lockedPaths: ['package.json'],
              icons: 'minimal',
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
        <div>
          <TreeExampleHeading
            icon={<IconFire />}
            description={<>Icons for common languages and file types.</>}
          >
            Standard
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={defaultPrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'built-in-icons-default',
              lockedPaths: ['package.json'],
              icons: 'standard',
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
        <div>
          <TreeExampleHeading
            icon={<IconBrush />}
            description={<>Full, colored suite with brands and frameworks.</>}
          >
            Complete
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={completePrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'built-in-icons-complete',
              lockedPaths: ['package.json'],
              icons: 'complete',
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
      </div>
      <PierreIconsFootnote />
    </TreeExampleSection>
  );
}
