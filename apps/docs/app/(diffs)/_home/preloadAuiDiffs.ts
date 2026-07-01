import { preloadFileDiff } from '@pierre/diffs/ssr';

import { AUI_DIFF_OPTIONS, AUI_SESSIONS, getFileDiff } from './mockData';

async function computeAuiPrerenderedDiffs(): Promise<Record<string, string>> {
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

// The agent demo's snapshot is fully static mock data, so the highlighted markup
// is identical on every render. Highlighting five diffs with Shiki on each
// request is the bulk of the /edit/live navigation cost (it blocks the route's
// async render, which the windowed->fullscreen View Transition waits on before
// it can animate). Memoize the work in a module-scoped promise so it runs once
// per server process and every later navigation reuses it.
let cachedPrerenderedDiffs: Promise<Record<string, string>> | null = null;

// Server-renders the agent demo's changed-file diffs once, keyed by path, so
// both the homepage windowed card and the fullscreen /edit/live route can hand
// the matching highlighted markup to each FileDiff. Prerendering avoids a
// first-paint highlight flash and keeps the SSR/client DOM in sync (the editor
// only attaches cleanly when the hydrated markup matches its line model).
export function preloadAuiPrerenderedDiffs(): Promise<Record<string, string>> {
  cachedPrerenderedDiffs ??= computeAuiPrerenderedDiffs();
  return cachedPrerenderedDiffs;
}
