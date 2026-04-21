'use client';

import { IconFolders, IconTableRowHeader } from '@pierre/icons';
import {
  FileTree,
  type FileTreePreloadedData,
  useFileTree,
} from '@pierre/trees/react';
import { type CSSProperties, useState } from 'react';

import { FeatureHeader } from '../diff-examples/FeatureHeader';
import { sampleFileList } from './demo-data';
import { TREE_NEW_VIEWPORT_HEIGHTS } from './dimensions';
import { getDefaultFileTreePanelClass } from './tree-examples/demo-data';
import { TreeExampleSection } from './tree-examples/TreeExampleSection';
import { ButtonGroup, ButtonGroupItem } from '@/components/ui/button-group';

const a11yStyle: CSSProperties = {
  colorScheme: 'dark',
  height: TREE_NEW_VIEWPORT_HEIGHTS.a11y,
};
const PRESELECTED_PATH = 'package.json';

type KeyboardShortcut = {
  description: string;
} & ({ key: string; keys?: never } | { key?: never; keys: readonly string[] });

const KEYBOARD_SHORTCUTS: readonly KeyboardShortcut[] = [
  { keys: ['↑', '↓'], description: 'Move focus between items' },
  { key: '→', description: 'Expand folder or move to first child' },
  { key: '←', description: 'Collapse folder or move to parent' },
  {
    keys: ['Enter', 'Space'],
    description: 'Select focused item; toggle folder',
  },
  {
    keys: ['⌘/Ctrl', 'Space'],
    description: 'Add or remove focused item from selection',
  },
  { key: 'a–z', description: 'Type-ahead to jump by name' },
  { key: 'Tab', description: 'Focus in/out of tree, between search and tree' },
];

interface DemoA11yClientProps {
  preloadedData: FileTreePreloadedData;
}

export function DemoA11yClient({ preloadedData }: DemoA11yClientProps) {
  const [mobileView, setMobileView] = useState<'tree' | 'shortcuts'>('tree');
  const { model } = useFileTree({
    flattenEmptyDirectories: true,
    id: 'file-tree-a11y-demo',
    initialExpandedPaths: ['src', 'src/components'],
    initialSelectedPaths: [PRESELECTED_PATH],
    paths: sampleFileList,
    search: true,
    initialVisibleRowCount: TREE_NEW_VIEWPORT_HEIGHTS.a11y / 30,
  });

  return (
    <TreeExampleSection>
      <FeatureHeader
        id="a11y"
        title="Accessible from the jump"
        description="With built-in keyboard navigation, focus management, and ARIA roles (tree, treeitem) plus aria-level, aria-posinset, and aria-setsize attributes, Trees are immediately accessible to all users. We've designed Trees to align with WCAG 2.1 guidance."
      />
      <ButtonGroup
        className="md:hidden"
        value={mobileView}
        onValueChange={(value) => setMobileView(value as 'tree' | 'shortcuts')}
      >
        <ButtonGroupItem value="tree">
          <IconFolders /> Tree
        </ButtonGroupItem>
        <ButtonGroupItem value="shortcuts">
          <IconTableRowHeader /> Shortcuts
        </ButtonGroupItem>
      </ButtonGroup>
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <div className={mobileView === 'tree' ? undefined : 'hidden md:block'}>
          <FileTree
            className={getDefaultFileTreePanelClass()}
            model={model}
            preloadedData={preloadedData}
            style={a11yStyle}
          />
        </div>
        <div
          className={
            mobileView === 'shortcuts'
              ? 'overflow-hidden rounded-lg border border-[var(--color-border)]'
              : 'hidden overflow-hidden rounded-lg border border-[var(--color-border)] md:block'
          }
        >
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-[var(--color-border)]">
                <th className="px-4 py-2.5 text-left font-medium">Key</th>
                <th className="px-4 py-2.5 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {KEYBOARD_SHORTCUTS.map(({ key, keys, description }) => {
                const shortcutKeys = keys ?? [key];
                return (
                  <tr
                    key={shortcutKeys.join('+')}
                    className="border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <td className="px-4 py-2">
                      <span className="inline-flex flex-wrap gap-1">
                        {shortcutKeys.map((k) => (
                          <kbd
                            key={k}
                            className="bg-muted rounded-sm border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs shadow-[0_1px_0_var(--color-border)]"
                          >
                            {k}
                          </kbd>
                        ))}
                      </span>
                    </td>
                    <td className="text-muted-foreground px-4 py-2">
                      {description}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </TreeExampleSection>
  );
}
