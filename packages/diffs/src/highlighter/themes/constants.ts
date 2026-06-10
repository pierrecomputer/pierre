// Names of themes that have been loaded into the active highlighter via
// loadThemeSync. This is the highlighter-attachment concern, kept separate from
// the resolved-theme cache in the diffs theme resolver. Cleared by
// cleanUpResolvedThemes when the highlighter is disposed.
export const AttachedThemes: Set<string> = new Set();
