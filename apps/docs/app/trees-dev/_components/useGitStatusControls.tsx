'use client';

import type { GitStatusEntry } from '@pierre/trees';
import { useMemo, useState } from 'react';

export interface GitStatusControlPreset<Id extends string = string> {
  id: Id;
  label: string;
  description: string;
  entries: readonly GitStatusEntry[];
}

export function useGitStatusControls<Id extends string>({
  defaultPresetId,
  idSuffix,
  presets,
}: {
  defaultPresetId: Id;
  idSuffix: string;
  presets: readonly GitStatusControlPreset<Id>[];
}) {
  const [enabled, setEnabled] = useState(true);
  const [presetId, setPresetId] = useState<Id>(defaultPresetId);

  const activePreset = useMemo(
    () => presets.find((preset) => preset.id === presetId) ?? presets[0],
    [presetId, presets]
  );
  const gitStatus = enabled ? activePreset.entries : undefined;

  const controls = (
    <div className="flex flex-wrap items-center gap-4 text-xs">
      <label
        htmlFor={`git-status-enabled-${idSuffix}`}
        className="flex cursor-pointer items-center gap-2 select-none"
      >
        <input
          data-test-git-status-enabled="true"
          type="checkbox"
          id={`git-status-enabled-${idSuffix}`}
          checked={enabled}
          className="cursor-pointer"
          onChange={() => setEnabled((prev) => !prev)}
        />
        Enable git status
      </label>
      <label
        htmlFor={`git-status-preset-${idSuffix}`}
        className="flex items-center gap-2"
      >
        <span className="text-muted-foreground">Preset</span>
        <select
          data-test-git-status-preset="true"
          id={`git-status-preset-${idSuffix}`}
          className="h-8 rounded-md border border-[var(--color-border)] bg-transparent px-2 text-xs disabled:cursor-not-allowed disabled:opacity-50"
          value={presetId}
          disabled={!enabled}
          onChange={(event) => {
            setPresetId(event.currentTarget.value as Id);
          }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );

  return {
    activePreset,
    controls,
    enabled,
    gitStatus,
    presetId,
    setEnabled,
    setPresetId,
  };
}
