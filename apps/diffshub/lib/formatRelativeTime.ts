// Formats an ISO timestamp as a short relative label ("2h ago", "3d ago"),
// falling back to a plain date for anything older than a month. Returns
// undefined for missing or unparseable input so callers can just omit the
// label.
export function formatRelativeTime(
  isoDate: string | undefined,
  now: number = Date.now()
): string | undefined {
  if (isoDate == null) {
    return undefined;
  }
  const timestamp = Date.parse(isoDate);
  if (Number.isNaN(timestamp)) {
    return undefined;
  }
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) {
    return 'just now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  const days = Math.floor(hours / 24);
  if (days < 31) {
    return `${days}d ago`;
  }
  return new Date(timestamp).toLocaleDateString();
}
