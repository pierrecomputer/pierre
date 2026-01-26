import { SPLIT_WITH_NEWLINES } from '../constants';

/**
 * Splits file contents into lines using the same logic as diff parsing.
 * - Preserves trailing newlines on each line
 *
 * @param contents - The raw file contents string
 * @returns Array of lines with newlines preserved
 */
export function splitFileContents(contents: string): string[] {
  return contents !== '' ? contents.split(SPLIT_WITH_NEWLINES) : [];
}
