/** Escape text for use in HTML. */
export function escapeHtml(value: string): string {
  let result = '';
  let from = 0;
  for (let at = 0; at < value.length; at++) {
    let entity: string;
    switch (value.charCodeAt(at)) {
      case 34:
        entity = '&quot;';
        break;
      case 38:
        entity = '&amp;';
        break;
      case 39:
        entity = '&#39;';
        break;
      case 60:
        entity = '&lt;';
        break;
      case 62:
        entity = '&gt;';
        break;
      default:
        continue;
    }
    result += value.slice(from, at) + entity;
    from = at + 1;
  }
  return from === 0 ? value : result + value.slice(from);
}

/** Decode only the entities that Wasm writes. The result is text, not HTML. */
export function decodeHtml(value: string): string {
  let result = '';
  let from = 0;
  for (
    let at = value.indexOf('&');
    at !== -1;
    at = value.indexOf('&', at + 1)
  ) {
    let character: string;
    // The `;` of these entities is three to five characters after the `&`.
    let end = at + 3;
    while (end < at + 6 && value.charCodeAt(end) !== 59) end++;
    switch (value.slice(at + 1, end)) {
      case 'amp':
        character = '&';
        break;
      case 'lt':
        character = '<';
        break;
      case 'gt':
        character = '>';
        break;
      case 'quot':
        character = '"';
        break;
      case '#39':
      case '#x27':
        character = "'";
        break;
      default:
        continue;
    }
    result += value.slice(from, at) + character;
    from = end + 1;
  }
  return from === 0 ? value : result + value.slice(from);
}

/**
 * Return `url` if it is relative or uses http, https, mailto, tel, or a scheme
 * the parser autolinks (ftp, xmpp). Reject network paths.
 */
export function defaultUrlTransform(url: string): string | undefined {
  // Browsers ignore spaces and control characters in URLs.
  let normalized = '';
  let from = 0;
  for (let at = 0; at < url.length; at++) {
    const code = url.charCodeAt(at);
    if (code <= 32 || (code >= 127 && code <= 159)) {
      normalized += url.slice(from, at);
      from = at + 1;
    }
  }
  normalized = from === 0 ? url : normalized + url.slice(from);
  // Browsers read `\` as `/`, so `/\host` and `\\host` are network paths too.
  const second = normalized.charCodeAt(1);
  if (
    normalized.charCodeAt(0) === 92 ||
    (normalized.charCodeAt(0) === 47 && (second === 47 || second === 92))
  )
    return undefined;
  // The scheme ends at the last `:` before the path, query, or fragment.
  let colon = -1;
  scheme: for (let at = 0; at < normalized.length; at++)
    switch (normalized.charCodeAt(at)) {
      case 35:
      case 47:
      case 63:
        break scheme;
      case 58:
        colon = at;
    }
  if (colon >= 0)
    switch (normalized.slice(0, colon).toLowerCase()) {
      case 'http':
      case 'https':
      case 'ftp':
      case 'mailto':
      case 'tel':
      case 'xmpp':
        break;
      default:
        return undefined;
    }
  return url;
}

/** Whether a character code continues a tag name, as `\w` does. */
export const isNameCode = (code: number): boolean =>
  (code >= 48 && code <= 57) ||
  (code >= 65 && code <= 90) ||
  code === 95 ||
  (code >= 97 && code <= 122);

/** Find the first changed byte range with native string comparisons before checking its short tail. */
export function unchangedEnd(
  a: string,
  b: string,
  start: number,
  end: number
): number {
  let step = end - start;
  while (step > 32) {
    if (a.slice(start, start + step) === b.slice(start, start + step)) {
      start += step;
      step = end - start;
    } else step = Math.floor(step / 2);
  }
  while (start < end && a.charCodeAt(start) === b.charCodeAt(start)) start++;
  return start;
}
