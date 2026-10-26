export const STRESS_BASE_CHARACTERS = 8524;
/** @type {readonly [1, 100, 1000]} */
export const STRESS_SCALES = [1, 100, 1000];

/** Generate repeated versions of the measured browser fixture on demand.
 * Blank separators preserve independent paragraphs and fences between units.
 * @param {1 | 100 | 1000} scale
 */
export function createStressFixture(scale) {
  if (!STRESS_SCALES.includes(scale))
    throw new RangeError('stress scale must be 1, 100, or 1000');
  const unit =
    Array.from(
      { length: 100 },
      (_, i) =>
        `Paragraph ${i}: **bold words**, *emphasis*, and [a link](/docs/${i}).\n\n`
    ).join('') +
    '```typescript\n' +
    Array.from(
      { length: 40 },
      (_, i) => `const value${i} = { count: ${i}, label: "item" };\n`
    ).join('') +
    '```\n\nDone.';
  return Array.from({ length: scale }, () => unit).join('\n\n');
}
