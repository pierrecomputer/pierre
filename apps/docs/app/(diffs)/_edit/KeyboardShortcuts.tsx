'use client';

import type {
  EditorCommand,
  EditorKeymap,
  EditorShortcut,
} from '@pierre/diffs/edit';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { IconBraces, IconListUnordered, IconSearch } from '@pierre/icons';
import { useMemo, useState } from 'react';

import { DEFAULT_EDITOR_KEYMAP, EDITOR_COMMAND_LABELS } from './constants';
import { ShortcutKeys } from '@/components/Shortcut';
import { Button } from '@/components/ui/button';
import { InputWithIcon } from '@/components/ui/input-group';

interface KeyboardShortcutsProps {
  prerenderedFile: PreloadedFileResult<undefined>;
}

type EditorPlatform = NonNullable<EditorKeymap[number]['platform']>;
type ShortcutModifier<T> = T extends `${infer Modifier}+${string}`
  ? Modifier
  : never;
type KeyboardModifier = ShortcutModifier<EditorShortcut>;

interface ShortcutRow {
  shortcut: EditorShortcut;
  keys: readonly string[];
  modifiers: readonly string[];
  command: EditorCommand;
  action: string;
  searchText: string;
}

interface ShortcutGroup {
  platform: EditorPlatform | undefined;
  label: string;
  rows: readonly ShortcutRow[];
}

const PLATFORM_LABELS: Record<EditorPlatform, string> = {
  mac: 'macOS',
  linux: 'Linux',
  windows: 'Windows',
};

const MODIFIER_LABELS: Record<KeyboardModifier, string> = {
  cmdOrCtrl: 'Cmd/Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  ctrl: 'Ctrl',
  cmd: 'Cmd',
};

const KEY_LABELS: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
  Space: 'Space',
};

const SHORTCUT_GROUPS: readonly ShortcutGroup[] = DEFAULT_EDITOR_KEYMAP.map(
  (group) => {
    const label =
      group.platform === undefined
        ? 'All platforms'
        : PLATFORM_LABELS[group.platform];
    const rows: ShortcutRow[] = [];

    for (const shortcut in group.bindings) {
      const command = group.bindings[shortcut as EditorShortcut];
      if (command === undefined) {
        continue;
      }

      const parts = shortcut.split('+');
      const key = parts.pop() as string;
      const modifiers = parts.map(
        (modifier) => MODIFIER_LABELS[modifier as KeyboardModifier]
      );
      const displayKey =
        KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key);
      const action = EDITOR_COMMAND_LABELS[command];
      const cmdShortcut = shortcut.replace('cmdOrCtrl', 'cmd');
      const ctrlShortcut = shortcut.replace('cmdOrCtrl', 'ctrl');
      const shortcutSearch = shortcut.includes('cmdOrCtrl')
        ? `${shortcut} ${cmdShortcut} ${ctrlShortcut} ${cmdShortcut.replaceAll('+', ' ')} ${ctrlShortcut.replaceAll('+', ' ')}`
        : shortcut;

      const platformSearch =
        group.platform === undefined
          ? 'all platforms mac macos windows linux'
          : label;

      rows.push({
        shortcut: shortcut as EditorShortcut,
        keys: [displayKey],
        modifiers,
        command,
        action,
        searchText:
          `${shortcutSearch} ${modifiers.join(' ')} ${displayKey} ${command} ${action} ${platformSearch}`.toLowerCase(),
      });
    }

    return { platform: group.platform, label, rows };
  }
);

const SHORTCUT_COUNT = SHORTCUT_GROUPS.reduce(
  (count, group) => count + group.rows.length,
  0
);

export function KeyboardShortcuts({ prerenderedFile }: KeyboardShortcutsProps) {
  const [query, setQuery] = useState('');
  const [showJson, setShowJson] = useState(false);
  const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const filtered = useMemo(() => {
    if (normalizedQuery.length === 0) {
      return { groups: SHORTCUT_GROUPS, count: SHORTCUT_COUNT };
    }

    const groups: ShortcutGroup[] = [];
    let count = 0;
    for (const group of SHORTCUT_GROUPS) {
      const rows = group.rows.filter((row) =>
        row.searchText.includes(normalizedQuery)
      );
      if (rows.length > 0) {
        groups.push({ ...group, rows });
        count += rows.length;
      }
    }
    return { groups, count };
  }, [normalizedQuery]);

  return (
    <div className="not-prose bg-card overflow-hidden rounded-lg border">
      <div className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:items-center">
        {showJson ? (
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Default keymap</p>
            <p className="text-muted-foreground text-xs">
              Edit the JSON below to explore the keymap format.
            </p>
          </div>
        ) : (
          <>
            <div className="w-full flex-1 sm:max-w-md">
              <InputWithIcon
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                icon={<IconSearch className="size-4" />}
                placeholder="Search shortcuts…"
                aria-label="Search keyboard shortcuts"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
            <span
              className="text-muted-foreground text-xs tabular-nums sm:mr-auto"
              aria-live="polite"
            >
              {filtered.count} of {SHORTCUT_COUNT} bindings
            </span>
          </>
        )}

        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto"
          onClick={() => setShowJson((visible) => !visible)}
        >
          {showJson ? <IconListUnordered /> : <IconBraces />}
          {showJson ? 'View shortcuts' : 'Edit in JSON'}
        </Button>
      </div>

      {showJson ? (
        <div role="region" aria-label="Default keymap JSON editor">
          <File
            {...prerenderedFile}
            className="max-h-[560px] overflow-auto rounded-none border-0"
            edit
          />
        </div>
      ) : (
        <div className="max-h-[560px] overflow-auto">
          <table className="[&_th]:border-border! w-full min-w-[640px] text-sm">
            <caption className="sr-only">
              Default editor keyboard shortcuts
            </caption>
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="w-[32%] px-4 py-2.5 text-left font-medium">
                  Shortcut
                </th>
                <th className="px-4 py-2.5 text-left font-medium">Command</th>
                <th className="w-[43%] px-4 py-2.5 text-left font-medium">
                  Action
                </th>
              </tr>
            </thead>
            {filtered.groups.map((group) => (
              <tbody key={group.platform ?? 'all'}>
                <tr className="bg-muted/30 border-b">
                  <th
                    colSpan={3}
                    scope="rowgroup"
                    className="text-muted-foreground px-4 py-1.5 text-left text-xs font-medium tracking-wide uppercase"
                  >
                    {group.label}{' '}
                    <span className="font-normal tracking-normal normal-case opacity-70">
                      · {group.rows.length}{' '}
                      {group.rows.length === 1 ? 'binding' : 'bindings'}
                    </span>
                  </th>
                </tr>
                {group.rows.map((row) => (
                  <tr
                    key={row.shortcut}
                    className="hover:bg-muted/20 border-b transition-colors last:border-b-0"
                  >
                    <td className="px-4 py-2.5 align-top">
                      <ShortcutKeys keys={row.keys} modifiers={row.modifiers} />
                    </td>
                    <td className="text-muted-foreground px-4 py-2.5 font-mono text-xs">
                      {row.command}
                    </td>
                    <td className="px-4 py-2.5">{row.action}</td>
                  </tr>
                ))}
              </tbody>
            ))}
            {filtered.count === 0 ? (
              <tbody>
                <tr>
                  <td
                    colSpan={3}
                    className="text-muted-foreground px-4 py-12 text-center"
                  >
                    No shortcuts match “{query}”.
                  </td>
                </tr>
              </tbody>
            ) : null}
          </table>
        </div>
      )}
    </div>
  );
}
