import { RefUpdateError, inferRefUpdateReason } from './errors';
import type { CommitPackAckRaw } from './schemas';
import { commitPackResponseSchema, errorEnvelopeSchema } from './schemas';
import type { CommitResult, RefUpdate } from './types';

export type CommitPackAck = CommitPackAckRaw;

export function buildCommitResult(ack: CommitPackAckRaw): CommitResult {
  const refUpdate = toRefUpdate(ack.result);
  if (!ack.result.success) {
    throw new RefUpdateError(
      ack.result.message ?? `Commit failed with status ${ack.result.status}`,
      {
        status: ack.result.status,
        message: ack.result.message,
        refUpdate,
      }
    );
  }
  return {
    commitSha: ack.commit.commit_sha,
    treeSha: ack.commit.tree_sha,
    targetBranch: ack.commit.target_branch,
    packBytes: ack.commit.pack_bytes,
    blobCount: ack.commit.blob_count,
    refUpdate,
  };
}

export function toRefUpdate(result: CommitPackAckRaw['result']): RefUpdate {
  return {
    branch: result.branch,
    oldSha: result.old_sha,
    newSha: result.new_sha,
  };
}

export async function parseCommitPackError(
  response: Response,
  fallbackMessage: string
): Promise<{
  statusMessage: string;
  statusLabel: string;
  refUpdate?: Partial<RefUpdate>;
}> {
  const cloned = response.clone();
  let jsonBody: unknown;
  try {
    jsonBody = await cloned.json();
  } catch {
    jsonBody = undefined;
  }

  let textBody: string | undefined;
  if (jsonBody === undefined) {
    try {
      textBody = await response.text();
    } catch {
      textBody = undefined;
    }
  }

  const defaultStatus = (() => {
    const inferred = inferRefUpdateReason(String(response.status));
    return inferred === 'unknown' ? 'failed' : inferred;
  })();
  let statusLabel = defaultStatus;
  let refUpdate: Partial<RefUpdate> | undefined;
  let message: string | undefined;

  if (jsonBody !== undefined) {
    const parsedResponse = commitPackResponseSchema.safeParse(jsonBody);
    if (parsedResponse.success) {
      const result = parsedResponse.data.result;
      if (typeof result.status === 'string' && result.status.trim() !== '') {
        statusLabel = result.status.trim() as typeof statusLabel;
      }
      refUpdate = toPartialRefUpdateFields(
        result.branch,
        result.old_sha,
        result.new_sha
      );
      if (typeof result.message === 'string' && result.message.trim() !== '') {
        message = result.message.trim();
      }
    }

    if (!message) {
      const parsedError = errorEnvelopeSchema.safeParse(jsonBody);
      if (parsedError.success) {
        const trimmed = parsedError.data.error.trim();
        if (trimmed) {
          message = trimmed;
        }
      }
    }
  }

  if (!message && typeof jsonBody === 'string' && jsonBody.trim() !== '') {
    message = jsonBody.trim();
  }

  if (!message && textBody && textBody.trim() !== '') {
    message = textBody.trim();
  }

  return {
    statusMessage: message ?? fallbackMessage,
    statusLabel,
    refUpdate,
  };
}

function toPartialRefUpdateFields(
  branch?: string | null,
  oldSha?: string | null,
  newSha?: string | null
): Partial<RefUpdate> | undefined {
  const refUpdate: Partial<RefUpdate> = {};

  if (typeof branch === 'string' && branch.trim() !== '') {
    refUpdate.branch = branch.trim();
  }
  if (typeof oldSha === 'string' && oldSha.trim() !== '') {
    refUpdate.oldSha = oldSha.trim();
  }
  if (typeof newSha === 'string' && newSha.trim() !== '') {
    refUpdate.newSha = newSha.trim();
  }

  return Object.keys(refUpdate).length > 0 ? refUpdate : undefined;
}
