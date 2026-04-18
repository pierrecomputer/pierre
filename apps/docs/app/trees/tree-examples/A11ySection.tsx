import type { CSSProperties } from 'react';

import { FeatureHeader } from '../../diff-examples/FeatureHeader';
import { baseTreeOptions, DEFAULT_FILE_TREE_PANEL_CLASS } from './demo-data';
import { TreeExampleSection } from './TreeExampleSection';
import { preloadFileTree } from '@/lib/treesCompat';
import { FileTree } from '@/lib/treesCompatClient';

const a11yStyle: CSSProperties = {
  colorScheme: 'dark',
};

const a11yPrerenderedHTML = preloadFileTree(
  { ...baseTreeOptions, id: 'a11y-demo' },
  {
    initialSelectedItems: ['package.json'],
    initialExpandedItems: ['src', 'src/components'],
  }
).shadowHtml;

const KEYBOARD_SHORTCUTS: { key: string; description: string }[] = [
  { key: '↑ ↓', description: 'Move focus between items' },
  { key: '→', description: 'Expand folder or move to first child' },
  { key: '←', description: 'Collapse folder or move to parent' },
  { key: 'Enter', description: 'Open file or toggle folder' },
  { key: 'Space', description: 'Select the focused item' },
  { key: 'a–z', description: 'Type-ahead to jump by name' },
  {
    key: 'Tab',
    description: 'Focus in/out of tree, between search and tree',
  },
];

export function A11ySection() {
  return (
    <TreeExampleSection>
      <FeatureHeader
        id="a11y"
        title="Accessible from the jump"
        description="With built-in keyboard navigation, focus management, and ARIA roles (tree, treeitem, group), Trees are immediately accessible to all users. We've designed Trees to meet WCAG 2.1 expectations."
      />
      <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-2">
        <FileTree
          className={DEFAULT_FILE_TREE_PANEL_CLASS}
          prerenderedHTML={a11yPrerenderedHTML}
          options={{ ...baseTreeOptions, id: 'a11y-demo' }}
          initialSelectedItems={['package.json']}
          initialExpandedItems={['src', 'src/components']}
          style={a11yStyle}
        />
        <div className="order-first overflow-hidden rounded-lg border border-[var(--color-border)] md:order-last">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-[var(--color-border)]">
                <th className="px-4 py-2.5 text-left font-medium">Key</th>
                <th className="px-4 py-2.5 text-left font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {KEYBOARD_SHORTCUTS.map(({ key, description }) => (
                <tr
                  key={key}
                  className="border-b border-[var(--color-border)] last:border-b-0"
                >
                  <td className="px-4 py-2">
                    <kbd className="bg-muted rounded-sm border border-[var(--color-border)] px-1.5 py-0.5 font-mono text-xs">
                      {key}
                    </kbd>
                  </td>
                  <td className="text-muted-foreground px-4 py-2">
                    {description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </TreeExampleSection>
  );
}
