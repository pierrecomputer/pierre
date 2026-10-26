import type { EncodedHastLines } from './hastLinesTransport';
import type {
  InitializeWorkerRequest,
  RenderDiffSuccessResponse,
  RenderFileSuccessResponse,
  WorkerRequest,
  WorkerResponse,
} from './types';

export interface InitializeWorkerWireRequest extends InitializeWorkerRequest {
  resultFormat?: 'hast-ops-v1';
}

export type WorkerWireRequest =
  | Exclude<WorkerRequest, InitializeWorkerRequest>
  | InitializeWorkerWireRequest;

export interface EncodedFileSuccessResponse extends Omit<
  RenderFileSuccessResponse,
  'result'
> {
  result: Omit<RenderFileSuccessResponse['result'], 'code'> & {
    code: EncodedHastLines;
  };
}

export interface EncodedDiffSuccessResponse extends Omit<
  RenderDiffSuccessResponse,
  'result'
> {
  result: Omit<RenderDiffSuccessResponse['result'], 'code'> & {
    code: {
      deletionLines: EncodedHastLines;
      additionLines: EncodedHastLines;
    };
  };
}

export type WorkerWireResponse =
  | WorkerResponse
  | EncodedFileSuccessResponse
  | EncodedDiffSuccessResponse;
