import type { LookupPath, PreparedPath } from './types';

function validateSegment(segment: string, path: string): void {
  if (segment.length === 0) {
    throw new Error(`Path contains an empty segment: "${path}"`);
  }

  if (segment === '.' || segment === '..') {
    throw new Error(`Path segments "." and ".." are not allowed: "${path}"`);
  }
}

function splitCanonicalPath(
  inputPath: string,
  context: 'input' | 'lookup'
): { hasTrailingSlash: boolean; segments: readonly string[] } {
  if (inputPath.length === 0) {
    if (context === 'lookup') {
      return { hasTrailingSlash: false, segments: [] };
    }

    throw new Error('Paths must not be empty');
  }

  if (inputPath.startsWith('/')) {
    throw new Error(`Absolute paths are not supported: "${inputPath}"`);
  }

  if (inputPath.includes('\\')) {
    throw new Error(`Backslashes are not supported: "${inputPath}"`);
  }

  const hasTrailingSlash = inputPath.endsWith('/');
  const withoutTrailingSlash = hasTrailingSlash
    ? inputPath.slice(0, -1)
    : inputPath;

  if (withoutTrailingSlash.length === 0) {
    throw new Error(`Root paths are not supported: "${inputPath}"`);
  }

  const segments = withoutTrailingSlash.split('/');
  for (const segment of segments) {
    validateSegment(segment, inputPath);
  }

  return {
    hasTrailingSlash,
    segments,
  };
}

export function parseInputPath(inputPath: string): PreparedPath {
  const { hasTrailingSlash, segments } = splitCanonicalPath(inputPath, 'input');
  const basename = segments[segments.length - 1];
  if (basename === undefined) {
    throw new Error(`Unable to parse path: "${inputPath}"`);
  }

  return {
    basename,
    isDirectory: hasTrailingSlash,
    path: inputPath,
    segments,
  };
}

export function parseLookupPath(inputPath: string): LookupPath {
  const { hasTrailingSlash, segments } = splitCanonicalPath(
    inputPath,
    'lookup'
  );
  return {
    rawPath: inputPath,
    requiresDirectory: hasTrailingSlash,
    segments,
  };
}
