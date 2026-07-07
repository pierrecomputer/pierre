// Editor token text omits line endings; renderer line caches (diff
// `additionLines`, FileRenderer's split-line cache) keep the suffix from
// parsing. Re-apply the previous line's ending so edited text can be written
// back into those caches without corrupting reconstructed file contents.
export function applyLineTextWithNewline(
  line: string,
  lineText: string
): string {
  if (line.endsWith('\r\n')) {
    return lineText + '\r\n';
  }
  if (line.endsWith('\r')) {
    return lineText + '\r';
  }
  if (line.endsWith('\n')) {
    return lineText + '\n';
  }
  return lineText;
}
