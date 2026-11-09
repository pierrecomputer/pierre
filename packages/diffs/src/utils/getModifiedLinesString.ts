// Use the platform's English plural rules to pick "line" vs "lines" so a
// count of 0 reads as "0 unmodified lines". en-US returns "one" only for 1.
const EN_PLURAL_RULES = new Intl.PluralRules('en-US');

/**
 * The hunk separator label for a run of `lines` unchanged lines. A fold whose
 * `lines` also include changes (only snippet boundary folds can) reads
 * "N lines, includes changes" instead ("1 line, includes changes"), so it
 * never calls changed lines unmodified nor reads as if all N changed; the
 * snippet adds "-D" / "+A" pills beside it.
 */
export function getModifiedLinesString(
  lines: number,
  containsChanges: boolean = false
): string {
  const suffix = EN_PLURAL_RULES.select(lines) === 'one' ? '' : 's';
  return containsChanges
    ? `${lines} line${suffix}, includes changes`
    : `${lines} unmodified line${suffix}`;
}
