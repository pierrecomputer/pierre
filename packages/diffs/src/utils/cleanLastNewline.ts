export function cleanLastNewline(contents: string): string {
  let end = contents.length;
  if (contents.charCodeAt(end - 1) === /* \n */ 10) {
    end--;
    if (contents.charCodeAt(end - 1) === /* \r */ 13) {
      end--;
    }
  }
  return contents.slice(0, end);
}
