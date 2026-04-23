import { IconArrowDownRight } from '@pierre/icons';

import { IconFootnote } from './IconFootnote';

export function PierreIconsFootnote() {
  return (
    <IconFootnote icon={<IconArrowDownRight />}>
      Want matching file icons in your editor?{' '}
      <a
        href="https://marketplace.visualstudio.com/items?itemName=pierrecomputer.pierre-vscode-icons"
        className="inline-link"
        target="_blank"
        rel="noopener noreferrer"
      >
        Install Pierre Icons for VS Code
      </a>{' '}
      to bring the same icon set into your sidebar.
    </IconFootnote>
  );
}
