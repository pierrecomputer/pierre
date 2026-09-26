import type { HighlighterTypes } from '../../types';
import { createDiffsThemeResolver } from './themeResolver';

/** Clear cached themes while preserving custom registrations for future instances. */
export function cleanUpResolvedThemes(backend?: HighlighterTypes): void {
  for (const name of backend === undefined
    ? (['shiki-js', 'shiki-wasm', 'highlights'] as const)
    : [backend]) {
    createDiffsThemeResolver(name).clearResolvedThemes();
  }
}
