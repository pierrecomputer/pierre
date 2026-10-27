Good question — the short answer is that `fetch` does not retry on its own, so you need a small wrapper that decides *which* failures are worth retrying and backs off between attempts. Here's how I'd structure it, followed by the trade-offs.

## What should retry, and what shouldn't

Not every failure deserves a second attempt. A reasonable default policy:

1. **Network errors** (`TypeError: Failed to fetch`, `ECONNRESET`, DNS failures) — retry.
2. **HTTP 5xx** and **429 Too Many Requests** — retry, honoring `Retry-After` when present.
3. **HTTP 4xx** other than 429 — do *not* retry; the request itself is wrong.
4. Requests that are **not idempotent** (`POST` without an idempotency key) — do not retry unless the caller opts in.

> ⚠️ Retrying a non-idempotent request can double-charge a card or create duplicate rows. Make the caller say "yes, this is safe" explicitly.

## A minimal implementation

```typescript
export interface RetryOptions {
  retries?: number;        // default 3
  baseDelayMs?: number;    // default 200
  maxDelayMs?: number;     // default 5_000
  idempotent?: boolean;    // default: GET/HEAD/PUT/DELETE only
  signal?: AbortSignal;
}

const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: RequestInit & RetryOptions = {}
): Promise<Response> {
  const { retries = 3, baseDelayMs = 200, maxDelayMs = 5_000, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const idempotent =
    init.idempotent ?? ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS'].includes(method);

  let attempt = 0;
  for (;;) {
    try {
      const response = await fetch(input, rest);
      if (!RETRYABLE.has(response.status) || attempt >= retries || !idempotent) {
        return response;
      }
      await sleep(retryDelay(response, attempt, baseDelayMs, maxDelayMs), rest.signal);
    } catch (error) {
      if (attempt >= retries || !idempotent || rest.signal?.aborted) throw error;
      await sleep(backoff(attempt, baseDelayMs, maxDelayMs), rest.signal);
    }
    attempt++;
  }
}
```

The two helpers do the actual waiting. Note the *full jitter* — `Math.random() * cap` rather than `cap / 2 + Math.random() * cap / 2` — which spreads retries out more evenly when many clients fail at the same moment:

```typescript
function backoff(attempt: number, base: number, max: number): number {
  const cap = Math.min(max, base * 2 ** attempt);
  return Math.random() * cap;
}

function retryDelay(response: Response, attempt: number, base: number, max: number): number {
  const header = response.headers.get('retry-after');
  if (header !== null) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) return Math.min(max, seconds * 1000);
    const date = Date.parse(header);
    if (!Number.isNaN(date)) return Math.max(0, Math.min(max, date - Date.now()));
  }
  return backoff(attempt, base, max);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });
}
```

## Trying it out

```bash
# Simulate a flaky upstream with a tiny server that fails twice, then succeeds
npx tsx scripts/flaky-server.ts --fail-first=2 --port=8787

# In another terminal
curl -i http://localhost:8787/health
```

You should see two `503` responses in the server log before the third request returns `200 OK`, and the client receives only the final response. If you want to see the delays, set `DEBUG=retry` — the wrapper logs each attempt as structured JSON:

```json
{ "attempt": 1, "status": 503, "delayMs": 143, "url": "http://localhost:8787/health" }
{ "attempt": 2, "status": 503, "delayMs": 381, "url": "http://localhost:8787/health" }
{ "attempt": 3, "status": 200, "delayMs": 0,   "url": "http://localhost:8787/health" }
```

## Choosing the knobs

| Option        | Default | When to change it                                                     |
| :------------ | ------: | :-------------------------------------------------------------------- |
| `retries`     |       3 | Lower for user-facing requests; higher (5–6) for background jobs      |
| `baseDelayMs` |     200 | Raise to 500–1000 ms if the upstream rate-limits aggressively         |
| `maxDelayMs`  |    5000 | Cap it near your request timeout so retries can't outlive the caller |
| `idempotent`  |  method | Set `true` for `POST` only when you send an `Idempotency-Key` header  |

A few things people get wrong here:

- Retrying **inside** a request timeout. If the caller gave you 10 s, three retries with a 5 s cap can take 15 s. Either budget the retries into the timeout or pass the caller's `AbortSignal` through (as above).
- Forgetting that `fetch` resolves on 5xx. The `catch` branch only sees network failures; status handling lives in the `try`.
- Logging the full response body on every retry — it's usually an HTML error page and it fills the logs. Log the status and the `x-request-id` header instead.
  - If the upstream is yours, make it emit `Retry-After` on 503 so clients don't guess.
  - If it isn't, measure the actual recovery time and tune `baseDelayMs` to it.

## Checklist before shipping

- [x] Retry only idempotent requests by default
- [x] Honor `Retry-After` (seconds *and* HTTP-date forms)
- [x] Full jitter, capped
- [ ] Propagate `AbortSignal` from the caller
- [ ] Emit a metric per attempt (`http_client_retry_total{status}`) so you can see retry storms

That's the whole thing — about 60 lines, no dependencies. If you're on Node 18+, `fetch` is global; for Node 16, `undici` exposes the same API and additionally has a built-in [`RetryAgent`](https://undici.nodejs.org/#/docs/api/RetryAgent) you could use instead of hand-rolling this. Either way, keep the policy — *what* to retry — separate from the mechanism, so you can change one without touching the other. ¡Buena suerte! 🚀
