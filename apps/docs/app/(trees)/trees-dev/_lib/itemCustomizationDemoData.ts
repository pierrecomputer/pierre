import type {
  ContextMenuButtonVisibility,
  ContextMenuTriggerMode,
  FileTreeIcons,
  FileTreeRowDecoration,
  FileTreeRowDecorationRenderer,
  GitStatusEntry,
} from '@pierre/trees';

export type TreesDevGitStatusPresetId =
  | 'direct-file-statuses'
  | 'ignored-and-overrides'
  | 'branch-mix';

export interface TreesDevGitStatusPreset {
  id: TreesDevGitStatusPresetId;
  label: string;
  description: string;
  entries: readonly GitStatusEntry[];
}

export type ItemCustomizationDecorationPresetId =
  | 'none'
  | 'file-extensions'
  | 'path-labels'
  | 'selected-icons'
  | 'mixed';

export interface ItemCustomizationDecorationPreset {
  id: ItemCustomizationDecorationPresetId;
  label: string;
  description: string;
  renderer: FileTreeRowDecorationRenderer | null;
}

export interface ItemCustomizationDemoDefaults {
  buttonVisibility: ContextMenuButtonVisibility;
  contextMenuEnabled: boolean;
  decorationPresetId: ItemCustomizationDecorationPresetId;
  gitStatusEnabled: boolean;
  gitStatusPresetId: TreesDevGitStatusPresetId;
  triggerMode: ContextMenuTriggerMode;
}

export const ITEM_CUSTOMIZATION_DEMO_WORKLOAD_NAME = 'demo-small' as const;

export const ITEM_CUSTOMIZATION_DEMO_DEFAULTS: ItemCustomizationDemoDefaults = {
  buttonVisibility: 'when-needed',
  contextMenuEnabled: true,
  decorationPresetId: 'mixed',
  gitStatusEnabled: true,
  gitStatusPresetId: 'direct-file-statuses',
  triggerMode: 'right-click',
};

export const TREES_DEV_GIT_STATUS_PRESETS: readonly TreesDevGitStatusPreset[] =
  [
    {
      id: 'direct-file-statuses',
      label: 'Set A · Direct file statuses',
      description:
        'Covers A, M, D, U, and R directly on demo-small files so the leaf badges are easy to compare side by side.',
      entries: [
        { path: 'alpha/docs/readme.md', status: 'modified' },
        { path: 'alpha/src/app.ts', status: 'added' },
        { path: 'alpha/src/utils/math.ts', status: 'renamed' },
        { path: 'alpha/todo.txt', status: 'deleted' },
        { path: 'zeta.md', status: 'untracked' },
      ],
    },
    {
      id: 'ignored-and-overrides',
      label: 'Set B · Ignored folders + overrides',
      description:
        'Shows ignored inheritance on beta/, a child override inside that subtree, and descendant dots for a changed file that is not part of the base workload.',
      entries: [
        { path: 'beta/', status: 'ignored' },
        { path: 'beta/archive/notes.txt', status: 'modified' },
        { path: 'gamma/logs/tomorrow.txt', status: 'added' },
      ],
    },
    {
      id: 'branch-mix',
      label: 'Set C · Alternate branch mix',
      description:
        'Spreads statuses across separate branches so folder dots, ignored folders, and direct file badges all move together when the preset changes.',
      entries: [
        { path: 'alpha/docs/readme.md', status: 'modified' },
        { path: 'alpha/src/new-panel.ts', status: 'added' },
        { path: 'beta/keep.txt', status: 'renamed' },
        { path: 'gamma/logs/', status: 'ignored' },
        { path: 'zeta.md', status: 'deleted' },
      ],
    },
  ] as const;

// These symbols back the custom row-decoration presets used by the docs-only
// item-customization demo. They intentionally stay outside the trees package.
export const ITEM_CUSTOMIZATION_DECORATION_ICONS: FileTreeIcons = {
  set: 'complete',
  spriteSheet: `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="trees-dev-item-docs" viewBox="0 0 16 16">
    <path fill="currentColor" d="M3 2.5A1.5 1.5 0 0 1 4.5 1H12a1 1 0 0 1 1 1v11.5a1.5 1.5 0 0 1-1.5 1.5H5a2 2 0 0 0-2 2z" opacity="0.2"/>
    <path fill="currentColor" d="M4.5 1h7A1.5 1.5 0 0 1 13 2.5V14h-8A1.5 1.5 0 0 0 3.5 15H3V2.5A1.5 1.5 0 0 1 4.5 1M5 4h6v1H5zm0 2.5h6v1H5zm0 2.5h4v1H5z"/>
  </symbol>
  <symbol id="trees-dev-item-app" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3" fill="currentColor" opacity="0.16"/>
    <path fill="currentColor" d="M4 4.5h3V6H5.5v1.5H7v1.5H5.5V12H4zm5 0h1.4l2.1 7.5H11l-.4-1.5H8.8L8.4 12H7zm.2 4.7h1.1l-.55-2.1z"/>
  </symbol>
  <symbol id="trees-dev-item-math" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3" fill="currentColor" opacity="0.16"/>
    <path fill="currentColor" d="M4.5 5.25 6.25 7 4.5 8.75l.75.75L7 7.75 8.75 9.5l.75-.75L7.75 7 9.5 5.25l-.75-.75L7 6.25 5.25 4.5zm6 0h1v6h-1zm1.5 0h1v6h-1z"/>
  </symbol>
  <symbol id="trees-dev-item-note" viewBox="0 0 16 16">
    <path fill="currentColor" d="M4.5 1h5.8L13 3.7V13a2 2 0 0 1-2 2h-6A2 2 0 0 1 3 13V2.5A1.5 1.5 0 0 1 4.5 1" opacity="0.18"/>
    <path fill="currentColor" d="M4.5 1h5.2L13 4.3V13a2 2 0 0 1-2 2h-6A2 2 0 0 1 3 13V2.5A1.5 1.5 0 0 1 4.5 1m5 .75V4h2.25zM5 6h6v1H5zm0 2.5h6v1H5zm0 2.5h4v1H5z"/>
  </symbol>
  <symbol id="trees-dev-item-selected" viewBox="0 0 16 16">
    <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.16"/>
    <path fill="currentColor" d="m6.8 10.9-2.2-2.2.9-.9 1.3 1.3 3.7-3.7.9.9z"/>
  </symbol>
</svg>`,
};

// Formats leaf-file extensions into short badges so the decoration lane shows
// content on every file without needing path-specific logic.
function getExtensionBadge(path: string): string | null {
  const basename = path.split('/').at(-1);
  if (basename == null || basename.endsWith('/')) {
    return null;
  }

  const lastDotIndex = basename.lastIndexOf('.');
  if (lastDotIndex <= 0 || lastDotIndex === basename.length - 1) {
    return null;
  }

  return basename
    .slice(lastDotIndex + 1)
    .slice(0, 4)
    .toUpperCase();
}

// Adds human-readable path role labels so the decoration lane can highlight how
// category text sits beside git status and the action affordance.
function getPathRoleLabel(path: string): string | null {
  if (path === 'alpha/docs/' || path.startsWith('alpha/docs/')) {
    return 'Docs';
  }
  if (path === 'alpha/src/' || path === 'alpha/src/app.ts') {
    return 'App';
  }
  if (path === 'alpha/src/utils/' || path === 'alpha/src/utils/math.ts') {
    return 'Utils';
  }
  if (path === 'beta/archive/' || path === 'beta/archive/notes.txt') {
    return 'Archive';
  }
  if (path === 'gamma/logs/' || path === 'gamma/logs/today.txt') {
    return 'Logs';
  }
  if (path === 'zeta.md') {
    return 'Root';
  }
  return null;
}

// Selected-file presets need stable docs-owned icons so clicking around the demo
// makes the decoration lane react without changing the underlying file icons.
function getItemCustomizationSelectedFileDecoration(
  path: string
): FileTreeRowDecoration | null {
  if (path === 'alpha/docs/readme.md') {
    return {
      icon: { name: 'trees-dev-item-docs', width: 14, height: 14 },
      title: 'Selected docs file',
    };
  }
  if (path === 'alpha/src/app.ts') {
    return {
      icon: { name: 'trees-dev-item-app', width: 14, height: 14 },
      title: 'Selected app entry file',
    };
  }
  if (path === 'alpha/src/utils/math.ts') {
    return {
      icon: { name: 'trees-dev-item-math', width: 14, height: 14 },
      title: 'Selected utility file',
    };
  }
  if (path.endsWith('.txt')) {
    return {
      icon: { name: 'trees-dev-item-note', width: 14, height: 14 },
      title: 'Selected notes file',
    };
  }
  return {
    icon: { name: 'trees-dev-item-selected', width: 14, height: 14 },
    title: 'Selected file',
  };
}

function getItemCustomizationMixedStaticDecoration(
  path: string
): FileTreeRowDecoration | null {
  if (path === 'alpha/docs/' || path === 'alpha/docs/readme.md') {
    return { text: 'Docs', title: 'Documentation branch' };
  }
  if (path === 'alpha/src/' || path === 'alpha/src/app.ts') {
    return { text: 'App', title: 'Application entry branch' };
  }
  if (path === 'alpha/src/utils/math.ts') {
    return {
      icon: { name: 'trees-dev-item-math', width: 14, height: 14 },
      title: 'Math utility icon',
    };
  }
  if (path.endsWith('.txt')) {
    return { text: 'TXT', title: 'Plain-text note' };
  }
  if (path === 'zeta.md') {
    return {
      icon: { name: 'trees-dev-item-docs', width: 14, height: 14 },
      title: 'Root markdown file',
    };
  }
  return null;
}

const extensionBadgeRenderer: FileTreeRowDecorationRenderer = ({ item }) => {
  if (item.kind !== 'file') {
    return null;
  }

  const badge = getExtensionBadge(item.path);
  return badge == null ? null : { text: badge, title: `${badge} file badge` };
};

const pathRoleRenderer: FileTreeRowDecorationRenderer = ({ item }) => {
  const label = getPathRoleLabel(item.path);
  return label == null ? null : { text: label, title: `${label} path label` };
};

const selectedIconRenderer: FileTreeRowDecorationRenderer = ({ item, row }) => {
  if (item.kind !== 'file' || row.isSelected !== true) {
    return null;
  }

  return getItemCustomizationSelectedFileDecoration(item.path);
};

const mixedDecorationRenderer: FileTreeRowDecorationRenderer = ({
  item,
  row,
}) => {
  if (item.kind === 'file' && row.isSelected) {
    return getItemCustomizationSelectedFileDecoration(item.path);
  }

  return getItemCustomizationMixedStaticDecoration(item.path);
};

export const ITEM_CUSTOMIZATION_DECORATION_PRESETS: readonly ItemCustomizationDecorationPreset[] =
  [
    {
      id: 'none',
      label: 'None',
      description:
        'Leaves the custom decoration lane empty so only git status and context-menu affordances remain.',
      renderer: null,
    },
    {
      id: 'file-extensions',
      label: 'File extensions',
      description:
        'Shows short badges on leaf files so every extension competes for the same lane width.',
      renderer: extensionBadgeRenderer,
    },
    {
      id: 'path-labels',
      label: 'Path labels',
      description:
        'Highlights representative branches like Docs, App, Utils, Archive, Logs, and Root.',
      renderer: pathRoleRenderer,
    },
    {
      id: 'selected-icons',
      label: 'Custom icons on selected files',
      description:
        'Click files to swap in docs-owned icons without changing the base file icon set.',
      renderer: selectedIconRenderer,
    },
    {
      id: 'mixed',
      label: 'Mixed',
      description:
        'Combines text labels, selected-file icons, and file-type badges to stress the full lane composition.',
      renderer: mixedDecorationRenderer,
    },
  ] as const;

export function getTreesDevGitStatusPreset(
  id: TreesDevGitStatusPresetId
): TreesDevGitStatusPreset {
  return (
    TREES_DEV_GIT_STATUS_PRESETS.find((preset) => preset.id === id) ??
    TREES_DEV_GIT_STATUS_PRESETS[0]
  );
}

export function getItemCustomizationDecorationPreset(
  id: ItemCustomizationDecorationPresetId
): ItemCustomizationDecorationPreset {
  return (
    ITEM_CUSTOMIZATION_DECORATION_PRESETS.find((preset) => preset.id === id) ??
    ITEM_CUSTOMIZATION_DECORATION_PRESETS[0]
  );
}
