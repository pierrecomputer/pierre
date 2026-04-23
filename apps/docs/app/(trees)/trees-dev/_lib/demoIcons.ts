import type { FileTreeIcons } from '@pierre/trees';

export const DEMO_FILE_TREE_ICONS: FileTreeIcons = {
  byFileExtension: {
    ts: 'trees-dev-icon-typescript',
  },
  byFileName: {
    'readme.md': 'trees-dev-icon-readme',
  },
  spriteSheet: `<svg data-icon-sprite aria-hidden="true" width="0" height="0">
  <symbol id="trees-dev-icon-readme" viewBox="0 0 16 16">
    <path fill="currentColor" d="M3 2.5h7l3 3V13a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path fill="white" d="M10 2.5v3h3" />
    <path fill="white" d="M5 8h6v1H5zm0 2h4v1H5z" />
  </symbol>
  <symbol id="trees-dev-icon-typescript" viewBox="0 0 16 16">
    <rect width="16" height="16" rx="3" fill="currentColor" />
    <path fill="white" d="M4 4h8v2H9v6H7V6H4zm8.3 2.5c-.4-.3-.8-.5-1.4-.5-.8 0-1.2.4-1.2 1 0 .7.5 1 1.5 1.3 1.4.5 2.1 1.1 2.1 2.4 0 1.5-1.2 2.4-2.9 2.4-1.2 0-2.2-.4-2.9-1.1l1.1-1.3c.5.4 1.1.7 1.7.7.8 0 1.3-.3 1.3-.9 0-.6-.4-.8-1.5-1.2-1.3-.5-2.1-1.1-2.1-2.5C8.1 5 9.2 4 10.9 4c1 0 1.8.3 2.5.9z" />
  </symbol>
</svg>`,
};
