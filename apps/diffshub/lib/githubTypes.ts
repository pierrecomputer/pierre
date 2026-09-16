import type { SelectedLineRange } from '@pierre/diffs';

/** Public account details; OAuth credentials never reach the browser. */
export interface GitHubUser {
  id: number;
  login: string;
  avatarUrl: string;
}

/** A file comment has no line; line comments retain both sides of a range. */
export type GitHubCommentAnchor =
  | { kind: 'file' }
  | { kind: 'line'; range: SelectedLineRange };

/** A published code comment, with the author's GitHub identity and permalink. */
export interface GitHubCodeComment {
  id: number;
  path: string;
  body: string;
  author: GitHubUser | null;
  url: string;
  anchor: GitHubCommentAnchor;
  canDelete: boolean;
}

/** The revision is checked before posting so comments cannot silently move. */
export interface GitHubComments {
  commitId: string;
  comments: GitHubCodeComment[];
}

/** Only file and line comments are accepted; there is no review-state action. */
export interface CreateGitHubComment {
  path: string;
  commitId: string;
  filePath: string;
  body: string;
  anchor: GitHubCommentAnchor;
}
