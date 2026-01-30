import type { RefUpdate, RefUpdateReason } from './types';

export interface RefUpdateErrorOptions {
  status: string;
  message?: string;
  refUpdate?: Partial<RefUpdate>;
  reason?: RefUpdateReason;
}

export class RefUpdateError extends Error {
  public readonly status: string;
  public readonly reason: RefUpdateReason;
  public readonly refUpdate?: Partial<RefUpdate>;

  constructor(message: string, options: RefUpdateErrorOptions) {
    super(message);
    this.name = 'RefUpdateError';
    this.status = options.status;
    this.reason = options.reason ?? inferRefUpdateReason(options.status);
    this.refUpdate = options.refUpdate;
  }
}

const REF_REASON_MAP: Record<string, RefUpdateReason> = {
  precondition_failed: 'precondition_failed',
  conflict: 'conflict',
  not_found: 'not_found',
  invalid: 'invalid',
  timeout: 'timeout',
  unauthorized: 'unauthorized',
  forbidden: 'forbidden',
  unavailable: 'unavailable',
  internal: 'internal',
  failed: 'failed',
  ok: 'unknown',
};

export function inferRefUpdateReason(status?: string): RefUpdateReason {
  if (!status) {
    return 'unknown';
  }

  const trimmed = status.trim();
  if (trimmed === '') {
    return 'unknown';
  }

  const label = trimmed.toLowerCase();
  return REF_REASON_MAP[label] ?? 'unknown';
}
