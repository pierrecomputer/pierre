/// <reference lib="webworker" />

import { BulkExperimentModel } from '../_lib/bulkExperimentModel';
import type {
  BulkExperimentInitOptions,
  BulkExperimentWorkerMessage,
  BulkExperimentWorkerRequest,
  BulkExperimentWorkerResponse,
} from '../_lib/bulkExperimentProtocol';
import { encodeVisibleRowsTransferPayload } from '../_lib/bulkExperimentVisibleRowsTransfer';

const workerScope = self as unknown as DedicatedWorkerGlobalScope;

let model: BulkExperimentModel | null = null;
let unsubscribe: (() => void) | null = null;

let initOptions: BulkExperimentInitOptions | null = null;

// Read-latency spans the page and the worker, so these timestamps must share
// one absolute clock instead of using context-local performance.now() values.
function absoluteNow(): number {
  return typeof performance === 'undefined'
    ? Date.now()
    : performance.timeOrigin + performance.now();
}

function postMessage(
  message: BulkExperimentWorkerMessage,
  transfer?: Transferable[]
): void {
  if (transfer == null || transfer.length === 0) {
    workerScope.postMessage(message);
    return;
  }

  workerScope.postMessage(message, transfer);
}

function postAck(id: number): void {
  postMessage({ id, type: 'ack' });
}

function postError(id: number, error: unknown): void {
  const message =
    error instanceof Error
      ? error.message
      : `Worker request failed: ${String(error)}`;
  const response: BulkExperimentWorkerResponse = {
    error: message,
    id,
    type: 'error',
  };
  postMessage(response);
}

function replaceModel(nextModel: BulkExperimentModel): void {
  unsubscribe?.();
  model?.destroy();
  model = nextModel;
  unsubscribe = nextModel.subscribe((snapshot) => {
    postMessage({ snapshot, type: 'snapshot' });
  });
}

function requireModel(): BulkExperimentModel {
  if (model == null) {
    throw new Error('Bulk experiment worker has not been initialized yet.');
  }

  return model;
}

workerScope.onmessage = async (
  event: MessageEvent<BulkExperimentWorkerRequest>
): Promise<void> => {
  const message = event.data;

  try {
    switch (message.type) {
      case 'initialize': {
        initOptions = message.options;

        replaceModel(new BulkExperimentModel(message.options));
        postAck(message.id);
        return;
      }
      case 'startIngest': {
        await requireModel().startIngest();
        postAck(message.id);
        return;
      }
      case 'cancelIngest': {
        requireModel().cancelIngest();
        postAck(message.id);
        return;
      }
      case 'expandPath': {
        requireModel().expandPath(message.path);
        postAck(message.id);
        return;
      }
      case 'collapsePath': {
        requireModel().collapsePath(message.path);
        postAck(message.id);
        return;
      }
      case 'getVisibleIndex': {
        const workerStartedAt = absoluteNow();
        const index = requireModel().getVisibleIndex(message.path);
        const workerFinishedAt = absoluteNow();
        postMessage({
          id: message.id,
          index,
          timing: {
            sentAt: message.sentAt,
            workerFinishedAt,
            workerStartedAt,
          },
          type: 'visibleIndex',
        });
        return;
      }
      case 'getVisibleRows': {
        const workerStartedAt = absoluteNow();
        const rows = requireModel().getVisibleRows(message.start, message.end);
        const workerFinishedAt = absoluteNow();
        if (initOptions?.rowTransport === 'transferable') {
          const { payload, transfer } = encodeVisibleRowsTransferPayload(
            message.start,
            rows
          );
          postMessage(
            {
              id: message.id,
              rowTransport: 'transferable',
              timing: {
                sentAt: message.sentAt,
                workerFinishedAt,
                workerStartedAt,
              },
              transferredRows: payload,
              type: 'visibleRows',
            },
            transfer
          );
          return;
        }

        postMessage({
          id: message.id,
          rowTransport: 'clone',
          rows,
          timing: {
            sentAt: message.sentAt,
            workerFinishedAt,
            workerStartedAt,
          },
          type: 'visibleRows',
        });
        return;
      }
      case 'dispose': {
        unsubscribe?.();
        initOptions = null;

        unsubscribe = null;
        model?.destroy();
        model = null;
        postAck(message.id);
        return;
      }
    }
  } catch (error) {
    postError(message.id, error);
  }
};
