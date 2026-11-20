import { SITE_NAME } from './site';

export const DIFF_TITLE_HEADER = 'X-Diffshub-Title';

/**
 * Read the change title (e.g. a GitHub PR title) that `/api/diff` sends back in
 * the `X-Diffshub-Title` header, and turn it into a browser tab title such as
 * "Fix the thing — DiffsHub". The server percent-encodes the value because HTTP
 * header values must be ASCII.
 *
 * Returns undefined when the header is absent, empty, or not valid encoding, so
 * the caller can leave the existing tab title alone.
 */
export function readDiffTitleHeader(headers: Headers): string | undefined {
  const raw = headers.get(DIFF_TITLE_HEADER);
  if (raw == null) {
    return undefined;
  }

  let title: string;
  try {
    title = decodeURIComponent(raw).trim();
  } catch {
    return undefined;
  }
  return title === '' ? undefined : `${title} — ${SITE_NAME}`;
}
