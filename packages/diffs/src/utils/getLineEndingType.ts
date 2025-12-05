export function getLineEndingType(
  content: string
): 'CRLF' | 'CR' | 'LF' | 'none' {
  // Windows
  if (content.includes('\r\n')) {
    return 'CRLF';
  }
  // Old Mac
  if (content.includes('\r')) {
    return 'CR';
  }
  // Unix/Linux/Modern Mac
  if (content.includes('\n')) {
    return 'LF';
  }
  // No line endings found
  return 'none';
}
