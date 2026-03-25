'use client';

import { useState } from 'react';

import { GIT_STATUSES_A, GIT_STATUSES_B } from '../demo-data';

export function useGitStatusControls(idSuffix: string) {
  const [enabled, setEnabled] = useState(true);
  const [useSetB, setUseSetB] = useState(false);

  const gitStatus = enabled
    ? useSetB
      ? GIT_STATUSES_B
      : GIT_STATUSES_A
    : undefined;

  const controls = (
    <div className="flex items-center gap-4">
      <label
        htmlFor={`git-status-enabled-${idSuffix}`}
        className="flex cursor-pointer items-center gap-2 select-none"
      >
        <input
          type="checkbox"
          id={`git-status-enabled-${idSuffix}`}
          checked={enabled}
          className="cursor-pointer"
          onChange={() => setEnabled((prev) => !prev)}
        />
        Enable
      </label>
      <button
        type="button"
        className="rounded-sm border px-2 py-1 text-xs"
        style={{ borderColor: 'var(--color-border)' }}
        onClick={() => setUseSetB((prev) => !prev)}
      >
        {useSetB ? 'Use Set A' : 'Use Set B'}
      </button>
    </div>
  );

  return { gitStatus, controls };
}
