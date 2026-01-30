import { z } from 'zod';

export const listFilesResponseSchema = z.object({
  paths: z.array(z.string()),
  ref: z.string(),
});

export const branchInfoSchema = z.object({
  cursor: z.string(),
  name: z.string(),
  head_sha: z.string(),
  created_at: z.string(),
});

export const listBranchesResponseSchema = z.object({
  branches: z.array(branchInfoSchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean(),
});

export const commitInfoRawSchema = z.object({
  sha: z.string(),
  message: z.string(),
  author_name: z.string(),
  author_email: z.string(),
  committer_name: z.string(),
  committer_email: z.string(),
  date: z.string(),
});

export const listCommitsResponseSchema = z.object({
  commits: z.array(commitInfoRawSchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean(),
});

export const repoBaseInfoSchema = z.object({
  provider: z.string(),
  owner: z.string(),
  name: z.string(),
});

export const repoInfoSchema = z.object({
  repo_id: z.string(),
  url: z.string(),
  default_branch: z.string(),
  created_at: z.string(),
  base_repo: repoBaseInfoSchema.optional().nullable(),
});

export const listReposResponseSchema = z.object({
  repos: z.array(repoInfoSchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean(),
});

export const noteReadResponseSchema = z.object({
  sha: z.string(),
  note: z.string(),
  ref_sha: z.string(),
});

export const noteResultSchema = z.object({
  success: z.boolean(),
  status: z.string(),
  message: z.string().optional(),
});

export const noteWriteResponseSchema = z.object({
  sha: z.string(),
  target_ref: z.string(),
  base_commit: z.string().optional(),
  new_ref_sha: z.string(),
  result: noteResultSchema,
});

export const diffStatsSchema = z.object({
  files: z.number(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
});

export const diffFileRawSchema = z.object({
  path: z.string(),
  state: z.string(),
  old_path: z.string().nullable().optional(),
  raw: z.string(),
  bytes: z.number(),
  is_eof: z.boolean(),
});

export const filteredFileRawSchema = z.object({
  path: z.string(),
  state: z.string(),
  old_path: z.string().nullable().optional(),
  bytes: z.number(),
  is_eof: z.boolean(),
});

export const branchDiffResponseSchema = z.object({
  branch: z.string(),
  base: z.string(),
  stats: diffStatsSchema,
  files: z.array(diffFileRawSchema),
  filtered_files: z.array(filteredFileRawSchema),
});

export const commitDiffResponseSchema = z.object({
  sha: z.string(),
  stats: diffStatsSchema,
  files: z.array(diffFileRawSchema),
  filtered_files: z.array(filteredFileRawSchema),
});

export const createBranchResponseSchema = z.object({
  message: z.string(),
  target_branch: z.string(),
  target_is_ephemeral: z.boolean(),
  commit_sha: z.string().nullable().optional(),
});

export const refUpdateResultSchema = z.object({
  branch: z.string(),
  old_sha: z.string(),
  new_sha: z.string(),
  success: z.boolean(),
  status: z.string(),
  message: z.string().optional(),
});

export const commitPackCommitSchema = z.object({
  commit_sha: z.string(),
  tree_sha: z.string(),
  target_branch: z.string(),
  pack_bytes: z.number(),
  blob_count: z.number(),
});

export const restoreCommitCommitSchema = commitPackCommitSchema.omit({
  blob_count: true,
});

export const refUpdateResultWithOptionalsSchema = z.object({
  branch: z.string().optional(),
  old_sha: z.string().optional(),
  new_sha: z.string().optional(),
  success: z.boolean().optional(),
  status: z.string(),
  message: z.string().optional(),
});

export const commitPackAckSchema = z.object({
  commit: commitPackCommitSchema,
  result: refUpdateResultSchema,
});

export const restoreCommitAckSchema = z.object({
  commit: restoreCommitCommitSchema,
  result: refUpdateResultSchema.extend({ success: z.literal(true) }),
});

export const commitPackResponseSchema = z.object({
  commit: commitPackCommitSchema.partial().optional().nullable(),
  result: refUpdateResultWithOptionalsSchema,
});

export const restoreCommitResponseSchema = z.object({
  commit: restoreCommitCommitSchema.partial().optional().nullable(),
  result: refUpdateResultWithOptionalsSchema,
});

export const grepLineSchema = z.object({
  line_number: z.number(),
  text: z.string(),
  type: z.string(),
});

export const grepFileMatchSchema = z.object({
  path: z.string(),
  lines: z.array(grepLineSchema),
});

export const grepResponseSchema = z.object({
  query: z.object({
    pattern: z.string(),
    case_sensitive: z.boolean(),
  }),
  repo: z.object({
    ref: z.string(),
    commit: z.string(),
  }),
  matches: z.array(grepFileMatchSchema),
  next_cursor: z.string().nullable().optional(),
  has_more: z.boolean(),
});

export const errorEnvelopeSchema = z.object({
  error: z.string(),
});

export type ListFilesResponseRaw = z.infer<typeof listFilesResponseSchema>;
export type RawBranchInfo = z.infer<typeof branchInfoSchema>;
export type ListBranchesResponseRaw = z.infer<
  typeof listBranchesResponseSchema
>;
export type RawCommitInfo = z.infer<typeof commitInfoRawSchema>;
export type ListCommitsResponseRaw = z.infer<typeof listCommitsResponseSchema>;
export type RawRepoBaseInfo = z.infer<typeof repoBaseInfoSchema>;
export type RawRepoInfo = z.infer<typeof repoInfoSchema>;
export type ListReposResponseRaw = z.infer<typeof listReposResponseSchema>;
export type NoteReadResponseRaw = z.infer<typeof noteReadResponseSchema>;
export type NoteWriteResponseRaw = z.infer<typeof noteWriteResponseSchema>;
export type RawFileDiff = z.infer<typeof diffFileRawSchema>;
export type RawFilteredFile = z.infer<typeof filteredFileRawSchema>;
export type GetBranchDiffResponseRaw = z.infer<typeof branchDiffResponseSchema>;
export type GetCommitDiffResponseRaw = z.infer<typeof commitDiffResponseSchema>;
export type CreateBranchResponseRaw = z.infer<
  typeof createBranchResponseSchema
>;
export type CommitPackAckRaw = z.infer<typeof commitPackAckSchema>;
export type RestoreCommitAckRaw = z.infer<typeof restoreCommitAckSchema>;
export type GrepResponseRaw = z.infer<typeof grepResponseSchema>;
