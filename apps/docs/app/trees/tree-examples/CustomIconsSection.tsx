import { IconBrush, IconFileTreeFill, IconFire } from '@pierre/icons';
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

const panelStyle = {
  ...DEFAULT_FILE_TREE_PANEL_STYLE,
  '--trees-search-bg-override': 'light-dark(#fff, oklch(14.5% 0 0))',
} as CSSProperties;

const simplePrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'built-in-icons-simple',
    lockedPaths: ['package.json'],
    icons: 'simple',
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

const fileTypePrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'built-in-icons-file-type',
    lockedPaths: ['package.json'],
    icons: {
      set: 'file-type',
      colored: false,
    },
  },
  {
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

const duoTonePrerenderedHTML = preloadFileTree(
  {
    ...baseTreeOptions,
    id: 'built-in-icons-duo-tone',
    lockedPaths: ['package.json'],
    icons: {
      set: 'duo-tone',
      colored: true,
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
        title="Built-in icon sets"
        description={
          <>
            Choose between the shipped <code>simple</code>,{' '}
            <code>file-type</code>, and <code>duo-tone</code> icon sets. You can
            also enable <code>colored: true</code>, override the built-in
            palette with CSS variables like{' '}
            <code>--trees-file-icon-color-javascript</code>, or fall back to a
            fully custom sprite. See the{' '}
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
              <>
                Generic built-ins with a single file glyph and no file-type map.
              </>
            }
          >
            Simple
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={simplePrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'built-in-icons-simple',
              lockedPaths: ['package.json'],
              icons: 'simple',
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
        <div>
          <TreeExampleHeading
            icon={<IconFire />}
            description={
              <>Semantic file-type icons without any extra configuration.</>
            }
          >
            File-type
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={fileTypePrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'built-in-icons-file-type',
              lockedPaths: ['package.json'],
              icons: {
                set: 'file-type',
                colored: false,
              },
            }}
            initialExpandedItems={['src', 'src/components']}
            style={panelStyle}
          />
        </div>
        <div>
          <TreeExampleHeading
            icon={<IconBrush />}
            description={
              <>
                With built-in semantic colors enabled via{' '}
                <code>colored: true</code>.
              </>
            }
          >
            Duo-tone
          </TreeExampleHeading>
          <FileTree
            className={DEFAULT_FILE_TREE_PANEL_CLASS}
            prerenderedHTML={duoTonePrerenderedHTML}
            options={{
              ...baseTreeOptions,
              id: 'built-in-icons-duo-tone',
              lockedPaths: ['package.json'],
              icons: {
                set: 'duo-tone',
                colored: true,
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
