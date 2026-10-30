// Change this contract between searches, not between candidates in one search.
export const suiteId = 'words-streaming-lifecycle-v1';
export const objectiveCaseIds = Object.freeze([
  'stream-assistant-token',
  'stream-assistant-chunk',
  'stream-paragraph-suffix',
  'stream-fence-suffix',
  'html-assistant-chunk',
]);
export const guardCaseIds = Object.freeze([
  'static-bytes',
  'static-string',
  'static-ansi',
  'stream-review-chunk',
  'stream-definitions-suffix',
]);
export const suiteCaseIds = Object.freeze([
  ...objectiveCaseIds,
  ...guardCaseIds,
]);

// Confirmation is a fresh, longer-warmup experiment, not more quick samples.
export const measurementProfiles = Object.freeze({
  quick: Object.freeze({
    warmupMs: 75,
    warmupDeliveries: 20000,
    warmupOperations: 400,
    warmupMaxMs: 3000,
    sampleMs: 15,
    samples: 5,
    threshold: 0.03,
  }),
  confirm: Object.freeze({
    warmupMs: 1000,
    warmupDeliveries: 60000,
    warmupOperations: 1200,
    warmupMaxMs: 10000,
    sampleMs: 30,
    samples: 9,
    threshold: 0.02,
  }),
});

/** Reduced confirmation settings remain useful diagnostics but cannot authorize keeping a candidate. */
export function confirmationIssues(
  configuration: Record<
    keyof typeof measurementProfiles.confirm | 'rounds',
    number
  >
) {
  const issues = [];
  const required = measurementProfiles.confirm;
  for (const key of [
    'warmupMs',
    'warmupDeliveries',
    'warmupOperations',
    'sampleMs',
    'samples',
  ] as const) {
    if (configuration[key] < required[key])
      issues.push(
        `${key} is below the frozen confirmation minimum (${required[key]})`
      );
  }
  if (configuration.rounds < 8 || configuration.rounds % 2 !== 0)
    issues.push('Confirmation requires at least eight balanced process pairs');
  if (configuration.threshold > required.threshold)
    issues.push('Regression tolerance exceeds the frozen 2% guard');
  return issues;
}
