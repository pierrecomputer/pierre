const FILTERED_OUT_PROPS: Record<string, boolean> = {
  ref: true,
  key: true,
  style: true,
};

export function propsToHtml(props: Record<string, unknown>): string {
  return Object.entries(props)
    .filter(
      ([key, value]) =>
        // TODO: figure out if the empty string thing is safe, or if
        // boolean attributes should be treated as true/false
        value != null &&
        !FILTERED_OUT_PROPS[key] &&
        value !== '' &&
        !key.startsWith('on')
    )
    .map(([key, value]) => `${key}="${String(value)}"`)
    .join(' ');
}
