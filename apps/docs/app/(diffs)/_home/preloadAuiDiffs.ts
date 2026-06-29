import { preloadFileDiff } from '@pierre/diffs/ssr';

import { AUI_DIFF_OPTIONS, AUI_SESSIONS, getFileDiff } from './mockData';

// Server-renders the agent demo's changed-file diffs once, keyed by path, so
// both the homepage windowed card and the fullscreen /edit/live route can hand
// the matching highlighted markup to each FileDiff. Prerendering avoids a
// first-paint highlight flash and keeps the SSR/client DOM in sync (the editor
// only attaches cleanly when the hydrated markup matches its line model).
export async function preloadAuiPrerenderedDiffs(): Promise<
  Record<string, string>
> {
  const session = AUI_SESSIONS[0];
  const entries = await Promise.all(
    session.changedFiles.map(async (file) => {
      const result = await preloadFileDiff({
        fileDiff: getFileDiff(file),
        options: AUI_DIFF_OPTIONS,
      });
      return [file.path, result.prerenderedHTML] as const;
    })
  );
  return Object.fromEntries(entries);
}
