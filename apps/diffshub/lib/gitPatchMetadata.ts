import { COMMIT_HASH_METADATA_PATTERN } from '@pierre/diffs';

const commitPrefixEncoder = new TextEncoder();
const commitPrefixDecoder = new TextDecoder();

export function getPatchTreePathPrefix(
  patchMetadata: string | undefined,
  patchIndex: number
): string {
  const commitHash = patchMetadata?.match(COMMIT_HASH_METADATA_PATTERN)?.[1];
  return commitHash != null
    ? detachCommitPrefix(commitHash.slice(0, 5))
    : `Commit ${patchIndex + 1}`;
}

function detachCommitPrefix(value: string): string {
  return commitPrefixDecoder.decode(commitPrefixEncoder.encode(value));
}
