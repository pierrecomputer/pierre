export interface PathStoreCapabilityMatrixRow {
  currentDemo: string;
  notes: string;
  targetPhases: readonly number[];
}

export const pathStoreCapabilityMatrix: readonly PathStoreCapabilityMatrixRow[] =
  [
    {
      currentDemo: 'Rendering',
      notes:
        'An initial SSR-safe smoke path lands in Phase 0; real render/scroll arrives in Phase 1 and SSR grows again in Phase 12.',
      targetPhases: [0, 1, 12],
    },
    {
      currentDemo: 'State',
      notes:
        'Stateful interaction returns across expansion, focus, selection, and mutation phases.',
      targetPhases: [2, 3, 4, 6],
    },
    {
      currentDemo: 'Dynamic Files',
      notes:
        'Phase 6 restores a mutation-first add/remove/move/batch/reset boundary rather than the legacy controlled-files model.',
      targetPhases: [6],
    },
    {
      currentDemo: 'Search Modes',
      notes:
        'Phase 7 restores the baseline built-in search modes, input/session UX, and hotkeys on the dedicated path-store search route, with quick search instrumentation also surfaced on the main path-store-powered demo.',
      targetPhases: [7],
    },
    {
      currentDemo: 'Drag and Drop',
      notes:
        'Drag/drop is rebuilt later on top of the new identity and mutation model.',
      targetPhases: [10],
    },
    {
      currentDemo: 'Git Status',
      notes:
        'Phase 9 restores git decorations and path-keyed runtime updates on the dedicated path-store git-status route.',
      targetPhases: [9],
    },
    {
      currentDemo: 'Custom Icons',
      notes:
        'Custom icon hooks return with the composition/decorator workstreams.',
      targetPhases: [5, 9],
    },
    {
      currentDemo: 'Icon Tiers',
      notes:
        'Icon tiering is tracked with the same composition/decorator phases as custom icons.',
      targetPhases: [5, 9],
    },
    {
      currentDemo: 'Header Slot',
      notes:
        'Composition surfaces return before the richer interaction feature phases.',
      targetPhases: [5],
    },
    {
      currentDemo: 'Context Menu',
      notes:
        'The Phase 5 shell returns first, then later interaction phases reuse it for delete and inline rename entry.',
      targetPhases: [5, 6, 8],
    },
    {
      currentDemo: 'Renaming',
      notes:
        'Phase 8 restores inline rename entry, draft, commit/cancel, and search-aware handoff on the path-store lane.',
      targetPhases: [8],
    },
    {
      currentDemo: 'Virtualization',
      notes:
        'The new lane treats virtualization as always on, with the actual implementation starting in Phase 1.',
      targetPhases: [1],
    },
  ] as const;
