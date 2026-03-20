import type {
  ConflictResolverTypes,
  DiffAcceptRejectHunkConfig,
  DiffAcceptRejectHunkType,
} from '../types';

// Normalize shorthand and config-object inputs into one internal resolution
// mode so the rest of the helper only handles the three concrete diff states.
export function normalizeDiffResolution(
  options:
    | DiffAcceptRejectHunkType
    | ConflictResolverTypes
    | DiffAcceptRejectHunkConfig
): 'deletions' | 'additions' | 'both' {
  const type = (() => {
    return typeof options === 'string' ? options : options.type;
  })();

  return type === 'accept' || type === 'incoming'
    ? 'additions'
    : type === 'reject' || type === 'current'
      ? 'deletions'
      : 'both';
}
