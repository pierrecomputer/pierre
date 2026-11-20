import type { JSX } from 'react';

import { binaryTree, naryTree, type TreeModel } from '../src';

/** The tree model of a store, to compare how the separators of each behave. */
export function ModelSelect({
  value,
  onChange,
}: {
  value: TreeModel;
  onChange: (value: TreeModel) => void;
}): JSX.Element {
  return (
    <select
      aria-label="Tree model"
      value={value.name}
      onChange={(event) =>
        onChange(event.target.value === naryTree.name ? naryTree : binaryTree)
      }
    >
      <option value={binaryTree.name}>binary</option>
      <option value={naryTree.name}>n-ary</option>
    </select>
  );
}
