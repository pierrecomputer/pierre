export function cleanLastNewline(contents: string): string {
  return contents.replace(/\n$|\r\n$/, '');
}
