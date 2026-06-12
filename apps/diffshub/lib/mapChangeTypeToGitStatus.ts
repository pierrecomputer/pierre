import type { ChangeTypes } from '@pierre/diffs';
import type { GitStatus } from '@pierre/trees';

// Translates the diff-level change type surfaced by @pierre/diffs into the
// git-status vocabulary the file tree understands. Both rename variants fold
// into 'renamed' so the tree shows a consistent rename badge regardless of
// whether content also changed.
export function mapChangeTypeToGitStatus(type: ChangeTypes): GitStatus {
  switch (type) {
    case 'new':
      return 'added';
    case 'deleted':
      return 'deleted';
    case 'rename-pure':
    case 'rename-changed':
      return 'renamed';
    case 'change':
      return 'modified';
  }
}
