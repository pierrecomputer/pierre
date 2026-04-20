export type FileTreeRowClickMode = 'flow' | 'sticky';

// A pure representation of what a mouse click on a file-tree row means. The
// input is the raw event modifiers plus a few static flags; the output is the
// set of logical operations the click should perform. Lives separately so the
// modifier-interaction table can be unit-tested without a controller or DOM.
export type FileTreeRowClickPlan = {
  selection:
    | { kind: 'range'; additive: boolean }
    | { kind: 'toggle' }
    | { kind: 'single' };
  toggleDirectory: boolean;
  closeSearch: boolean;
  revealCanonical: boolean;
};

export type FileTreeRowClickPlanInput = {
  event: {
    shiftKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  };
  mode: FileTreeRowClickMode;
  isSearchOpen: boolean;
  isDirectory: boolean;
};

export function computeFileTreeRowClickPlan(
  input: FileTreeRowClickPlanInput
): FileTreeRowClickPlan {
  const { event, mode, isSearchOpen, isDirectory } = input;
  const additive = event.ctrlKey || event.metaKey;
  const hasModifier = event.shiftKey || additive;

  const selection: FileTreeRowClickPlan['selection'] = event.shiftKey
    ? { additive, kind: 'range' }
    : additive
      ? { kind: 'toggle' }
      : { kind: 'single' };

  return {
    closeSearch: isSearchOpen,
    revealCanonical: mode === 'sticky',
    selection,
    toggleDirectory: !hasModifier && isDirectory,
  };
}
