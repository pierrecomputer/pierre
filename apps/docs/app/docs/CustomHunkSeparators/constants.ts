import type { PreloadFileOptions } from '@pierre/diffs/ssr';

import { CUSTOM_HUNK_SEPARATORS_EXAMPLE } from '../../diff-examples/CustomHunkSeparators/constants';
import { CustomScrollbarCSS } from '@/components/CustomScrollbarCSS';

export { CUSTOM_HUNK_SEPARATORS_EXAMPLE };

const fileOptions = {
  theme: { dark: 'pierre-dark', light: 'pierre-light' },
  unsafeCSS: CustomScrollbarCSS,
} as const;

export const CUSTOM_HUNK_SEPARATORS_SWITCHER: PreloadFileOptions<undefined> = {
  file: {
    name: 'custom_hunk_separators.tsx',
    contents: `import type { ExpansionDirections, HunkData } from '@pierre/diffs';
import { FileDiff } from '@pierre/diffs';
import { MultiFileDiff } from '@pierre/diffs/react';
import { useState } from 'react';

type SeparatorOption =
  | 'line-info'
  | 'line-info-basic'
  | 'metadata'
  | 'simple'
  | 'custom';

const classes = {
  wrapper: 'relative',
  root: "absolute top-0 left-0 flex items-center gap-2 pl-[22px] text-[0.75rem] [font-family:var(--diffs-header-font-family,var(--diffs-header-font-fallback))]",
  controls: 'inline-flex gap-1',
  button:
    'relative m-0 inline-flex cursor-pointer appearance-none items-center border-0 bg-transparent p-0 text-inherit',
  icon: '[font-family:var(--diffs-font-family,var(--diffs-font-fallback))] text-base leading-none',
  label:
    'ml-3 whitespace-nowrap text-[color:var(--diffs-fg-number)] [font-family:var(--diffs-header-font-family,var(--diffs-header-font-fallback))] hover:underline',
  separatorDot: 'text-[color:var(--diffs-fg-number)]',
  expandChunk:
    'm-0 inline-flex cursor-pointer appearance-none items-center whitespace-nowrap border-0 bg-transparent p-0 text-[0.75rem] text-[color:var(--diffs-fg-number)] [font-family:var(--diffs-header-font-family,var(--diffs-header-font-fallback))] hover:underline',
} as const;

function renderCustomSeparator(
  hunkData: HunkData,
  instance: FileDiff<undefined>
) {
  const wrapper = document.createElement('div');
  wrapper.className = classes.wrapper;

  const root = document.createElement('div');
  root.className = classes.root;

  const controls = document.createElement('div');
  controls.className = classes.controls;

  if (hunkData.type === 'additions') {
    const spacer = document.createElement('span');
    spacer.textContent = ' ';
    wrapper.append(spacer, root);
    return wrapper;
  }

  const lineLabel = hunkData.lines === 1 ? 'line' : 'lines';
  const labelText = \`\${hunkData.lines} unmodified \${lineLabel}\`;

  function createControl(direction: ExpansionDirections) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = classes.button;
    const icon = document.createElement('span');
    icon.className = classes.icon;
    icon.textContent =
      direction === 'up' ? '↓' : direction === 'down' ? '↑' : '↕';
    const label = document.createElement('span');
    label.className = classes.label;
    label.textContent = labelText;
    button.append(icon, label);
    button.onclick = () => instance.expandHunk(hunkData.hunkIndex, direction);
    return button;
  }

  if (hunkData.expandable?.up && hunkData.expandable?.down) {
    controls.append(createControl('both'));
  } else if (hunkData.expandable?.up) {
    controls.append(createControl('up'));
  } else if (hunkData.expandable?.down) {
    controls.append(createControl('down'));
  }

  if (hunkData.expandable?.chunked) {
    const separatorDot = document.createElement('span');
    separatorDot.className = classes.separatorDot;
    separatorDot.textContent = '·';
    const expandChunk = document.createElement('button');
    expandChunk.type = 'button';
    expandChunk.className = classes.expandChunk;
    expandChunk.textContent = 'Expand entire hunk';
    expandChunk.onclick = () =>
      instance.expandHunk(
        hunkData.hunkIndex,
        'both',
        Number.POSITIVE_INFINITY
      );
    root.append(controls, separatorDot, expandChunk);
  } else {
    root.append(controls);
  }

  const spacer = document.createElement('span');
  spacer.textContent = ' ';
  wrapper.append(spacer, root);
  return wrapper;
}

function HunkSeparatorDemo({ oldFile, newFile }) {
  const [separator, setSeparator] = useState<SeparatorOption>('line-info');

  if (separator === 'custom') {
    const instance = new FileDiff({
      expansionLineCount: 5,
      hunkSeparators: (hunkData, fileDiffInstance) =>
        renderCustomSeparator(hunkData, fileDiffInstance),
    });
    instance.render({ oldFile, newFile, containerWrapper: document.body });
    return null;
  }

  return (
    <MultiFileDiff
      oldFile={oldFile}
      newFile={newFile}
      options={{ expansionLineCount: 5, hunkSeparators: separator }}
    />
  );
}`,
  },
  options: fileOptions,
};
