export interface NormalizedInputPath {
  isDirectory: boolean;
  path: string;
}

/**
 * Normalizes user-provided tree paths.
 * Trailing slashes explicitly mark directories; empty slash segments are ignored.
 */
export function normalizeInputPath(
  inputPath: string
): NormalizedInputPath | null {
  const isDirectory = inputPath.endsWith('/');
  let normalizedPath = '';
  let segmentStart = -1;

  for (let i = 0; i <= inputPath.length; i += 1) {
    const char = inputPath[i];
    const isSeparator = char === '/' || i === inputPath.length;

    if (!isSeparator) {
      if (segmentStart === -1) {
        segmentStart = i;
      }
      continue;
    }

    if (segmentStart === -1) {
      continue;
    }

    if (normalizedPath !== '') {
      normalizedPath += '/';
    }
    normalizedPath += inputPath.slice(segmentStart, i);
    segmentStart = -1;
  }

  if (normalizedPath === '') {
    return null;
  }

  return {
    isDirectory,
    path: normalizedPath,
  };
}

export function forEachFolderInNormalizedPath(
  path: string,
  isDirectory: boolean,
  visit: (folderPath: string) => void
): void {
  const lastSlashIndex = path.lastIndexOf('/');
  if (lastSlashIndex === -1) {
    if (isDirectory) {
      visit(path);
    }
    return;
  }

  const limit = isDirectory ? path.length : lastSlashIndex;
  let slashIndex = path.indexOf('/');

  while (slashIndex !== -1 && slashIndex <= limit) {
    visit(path.slice(0, slashIndex));
    slashIndex = path.indexOf('/', slashIndex + 1);
  }

  if (isDirectory) {
    visit(path);
  }
}
