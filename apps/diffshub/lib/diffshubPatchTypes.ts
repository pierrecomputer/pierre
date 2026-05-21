export interface InitialDiffshubPatchResponse {
  body: ReadableStream<string> | null;
  bodyText: string | null;
  ok: boolean;
  status: number;
  statusText: string;
}
