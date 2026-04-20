import { describe, expect, test } from 'bun:test';

import {
  computeFileTreeRowClickPlan,
  type FileTreeRowClickPlanInput,
} from '../src/render/fileTreeRowClickPlan';

const baseInput: FileTreeRowClickPlanInput = {
  event: { ctrlKey: false, metaKey: false, shiftKey: false },
  isDirectory: false,
  isSearchOpen: false,
  mode: 'flow',
};

describe('computeFileTreeRowClickPlan', () => {
  test('plain click on a file selects only that path and does not toggle', () => {
    expect(computeFileTreeRowClickPlan(baseInput)).toEqual({
      closeSearch: false,
      revealCanonical: false,
      selection: { kind: 'single' },
      toggleDirectory: false,
    });
  });

  test('plain click on a directory selects and toggles expansion', () => {
    expect(
      computeFileTreeRowClickPlan({ ...baseInput, isDirectory: true })
    ).toEqual({
      closeSearch: false,
      revealCanonical: false,
      selection: { kind: 'single' },
      toggleDirectory: true,
    });
  });

  test('shift-click produces a range selection without toggling', () => {
    expect(
      computeFileTreeRowClickPlan({
        ...baseInput,
        event: { ctrlKey: false, metaKey: false, shiftKey: true },
        isDirectory: true,
      })
    ).toEqual({
      closeSearch: false,
      revealCanonical: false,
      selection: { additive: false, kind: 'range' },
      toggleDirectory: false,
    });
  });

  test('shift + ctrl adds the range on top of existing selection', () => {
    expect(
      computeFileTreeRowClickPlan({
        ...baseInput,
        event: { ctrlKey: true, metaKey: false, shiftKey: true },
      })
    ).toEqual({
      closeSearch: false,
      revealCanonical: false,
      selection: { additive: true, kind: 'range' },
      toggleDirectory: false,
    });
  });

  test('shift + meta also produces an additive range (Mac)', () => {
    const plan = computeFileTreeRowClickPlan({
      ...baseInput,
      event: { ctrlKey: false, metaKey: true, shiftKey: true },
    });
    expect(plan.selection).toEqual({ additive: true, kind: 'range' });
    expect(plan.toggleDirectory).toBe(false);
  });

  test('ctrl-click toggles the single path in the selection', () => {
    expect(
      computeFileTreeRowClickPlan({
        ...baseInput,
        event: { ctrlKey: true, metaKey: false, shiftKey: false },
        isDirectory: true,
      })
    ).toEqual({
      closeSearch: false,
      revealCanonical: false,
      selection: { kind: 'toggle' },
      toggleDirectory: false,
    });
  });

  test('meta-click also toggles the single path (Mac)', () => {
    const plan = computeFileTreeRowClickPlan({
      ...baseInput,
      event: { ctrlKey: false, metaKey: true, shiftKey: false },
    });
    expect(plan.selection).toEqual({ kind: 'toggle' });
    expect(plan.toggleDirectory).toBe(false);
  });

  test('an open search closes on every click', () => {
    const plain = computeFileTreeRowClickPlan({
      ...baseInput,
      isSearchOpen: true,
    });
    const shift = computeFileTreeRowClickPlan({
      ...baseInput,
      event: { ctrlKey: false, metaKey: false, shiftKey: true },
      isSearchOpen: true,
    });
    expect(plain.closeSearch).toBe(true);
    expect(shift.closeSearch).toBe(true);
  });

  test('sticky mode clicks ask the caller to reveal the canonical row', () => {
    const plan = computeFileTreeRowClickPlan({
      ...baseInput,
      isDirectory: true,
      mode: 'sticky',
    });
    expect(plan.revealCanonical).toBe(true);
    expect(plan.toggleDirectory).toBe(true);
    expect(plan.selection).toEqual({ kind: 'single' });
  });

  test('flow mode clicks never request a sticky reveal', () => {
    expect(
      computeFileTreeRowClickPlan({ ...baseInput, mode: 'flow' })
        .revealCanonical
    ).toBe(false);
  });

  test('toggleDirectory is false whenever any modifier is held, even on a directory', () => {
    const modifiers: Array<FileTreeRowClickPlanInput['event']> = [
      { ctrlKey: true, metaKey: false, shiftKey: false },
      { ctrlKey: false, metaKey: true, shiftKey: false },
      { ctrlKey: false, metaKey: false, shiftKey: true },
      { ctrlKey: true, metaKey: false, shiftKey: true },
      { ctrlKey: false, metaKey: true, shiftKey: true },
    ];
    for (const event of modifiers) {
      expect(
        computeFileTreeRowClickPlan({
          ...baseInput,
          event,
          isDirectory: true,
        }).toggleDirectory
      ).toBe(false);
    }
  });
});
