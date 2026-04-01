import type { LookupPath, PreparedPath } from './internal-types';

function splitCanonicalPath(inputPath: string): {
  hasTrailingSlash: boolean;
  segments: readonly string[];
} {
  const hasTrailingSlash =
    inputPath.length > 0 && inputPath.charCodeAt(inputPath.length - 1) === 47;
  const withoutTrailingSlash = hasTrailingSlash
    ? inputPath.slice(0, -1)
    : inputPath;
  const segments = withoutTrailingSlash.split('/');

  return {
    hasTrailingSlash,
    segments,
  };
}

export function parseInputPath(inputPath: string): PreparedPath {
  const { hasTrailingSlash, segments } = splitCanonicalPath(inputPath);
  const basename = segments[segments.length - 1] ?? '';

  return {
    basename,
    isDirectory: hasTrailingSlash,
    path: inputPath,
    segments,
  };
}

export function parseLookupPath(inputPath: string): LookupPath {
  if (inputPath.length === 0) {
    return {
      requiresDirectory: false,
      segments: [],
    };
  }

  const { hasTrailingSlash, segments } = splitCanonicalPath(inputPath);
  return {
    requiresDirectory: hasTrailingSlash,
    segments,
  };
}
