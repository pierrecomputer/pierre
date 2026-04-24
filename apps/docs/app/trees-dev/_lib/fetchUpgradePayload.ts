export interface UpgradePayload {
  allExpandedPaths: readonly string[];
  paths: readonly string[];
}

export interface UpgradePayloadTimings {
  fetchMs: number;
  parseMs: number;
}

export interface MeasuredUpgradePayload {
  payload: UpgradePayload;
  timings: UpgradePayloadTimings;
}

// Fetches a gzipped upgrade payload from the CDN, gunzips it in the browser via
// DecompressionStream, and parses it. The measured variant keeps the fetch and
// body-consumption/parse timings separate so experiments can attribute where the
// run spent time without changing the main demo's simpler helper contract.
export async function fetchUpgradePayloadWithTimings(
  url: string,
  signal: AbortSignal
): Promise<MeasuredUpgradePayload> {
  const fetchStartedAt = performance.now();
  const response = await fetch(url, { signal });
  const fetchCompletedAt = performance.now();
  if (!response.ok || response.body == null) {
    throw new Error(
      `Failed to fetch upgrade path list (${String(response.status)})`
    );
  }

  const parseStartedAt = performance.now();
  const decompressedStream = response.body.pipeThrough(
    new DecompressionStream('gzip')
  );
  const decompressedText = await new Response(decompressedStream).text();
  const payload = JSON.parse(decompressedText) as UpgradePayload;
  const parseCompletedAt = performance.now();

  return {
    payload,
    timings: {
      fetchMs: fetchCompletedAt - fetchStartedAt,
      parseMs: parseCompletedAt - parseStartedAt,
    },
  };
}

export async function fetchUpgradePayload(
  url: string,
  signal: AbortSignal
): Promise<UpgradePayload> {
  const { payload } = await fetchUpgradePayloadWithTimings(url, signal);
  return payload;
}
