'use client';

import { Editor } from '@pierre/diffs/editor';
import { EditProvider, File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import { useMemo } from 'react';

import { EDITOR_SHORTCUT_GROUPS, type EditorShortcutGroup } from './constants';
import { ShortcutKeys } from '@/components/Shortcut';

interface EditShortcutsProps {
  // Server-preloaded, highlighted File holding the serialized shortcut data—the
  // "code that built the table" shown beside the rendered table.
  prerenderedFile: PreloadedFileResult<undefined>;
}

// The keyboard-shortcut reference: a live editor showing the data that drives
// the table (left) next to the table itself (right). Both read from
// EDITOR_SHORTCUT_GROUPS, so the snippet and the rendered keys stay in lockstep.
// The platform modifier (Cmd on macOS/iOS, Ctrl elsewhere) is resolved
// client-side by `ShortcutKeys`.
export function EditShortcuts({ prerenderedFile }: EditShortcutsProps) {
  const editor = useMemo(() => new Editor({}), []);

  return (
    <div className="grid grid-cols-1 items-start gap-8 md:grid-cols-5">
      <div className="not-prose md:col-span-3">
        <EditProvider editor={editor}>
          <File
            {...prerenderedFile}
            className="diff-container"
            contentEditable
          />
        </EditProvider>
      </div>

      <div className="not-prose overflow-hidden rounded-lg border md:col-span-2">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-muted/50 border-b">
              <th className="w-2/5 px-4 py-2.5 text-left font-medium">Key</th>
              <th className="px-4 py-2.5 text-left font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {EDITOR_SHORTCUT_GROUPS.map((group) => (
              <GroupRows key={group.label} group={group} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GroupRows({ group }: { group: EditorShortcutGroup }) {
  return (
    <>
      <tr className="bg-muted/30 border-b">
        <th
          colSpan={2}
          className="text-muted-foreground px-4 py-1.5 text-left text-xs font-medium tracking-wide uppercase"
        >
          {group.label}
        </th>
      </tr>
      {group.shortcuts.map((shortcut, index) => (
        <tr key={index} className="border-b last:border-b-0">
          <td className="px-4 py-2 align-top">
            <ShortcutKeys
              keys={shortcut.keys}
              modifiers={shortcut.modifiers}
              mod={shortcut.mod}
            />
          </td>
          <td className="text-muted-foreground px-4 py-2">{shortcut.action}</td>
        </tr>
      ))}
    </>
  );
}
