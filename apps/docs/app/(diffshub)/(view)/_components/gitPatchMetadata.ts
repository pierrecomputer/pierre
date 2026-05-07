export const COMMIT_HASH_METADATA_PATTERN = /^From\s+([a-f0-9]+)\s/im;

export function getPatchTreePathPrefix(
  patchMetadata: string | undefined,
  patchIndex: number
): string {
  const commitHash = patchMetadata?.match(COMMIT_HASH_METADATA_PATTERN)?.[1];
  return commitHash != null
    ? commitHash.slice(0, 5)
    : `Commit ${patchIndex + 1}`;
}
