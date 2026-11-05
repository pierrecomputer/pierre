export const STRESS_BASE_CHARACTERS = 8524;
export const STRESS_SCALES = [1, 100, 1000] as const;

export function createStressFixture(scale: number): string {
  if (!STRESS_SCALES.some((value) => value === scale)) {
    throw new RangeError('stress scale must be 1, 100, or 1000');
  }
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
