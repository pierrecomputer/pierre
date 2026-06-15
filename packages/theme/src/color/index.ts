// Color science: pure, dependency-free color math shared by the theme build
// (Display-P3 vibrant variants), the previews, and the CVD accessibility gate.
// Each concern is a discrete module; this barrel re-exports the public surface.

export { hexToRgb01, srgbToLinear, linearToSrgb } from './srgb';
export { srgbHexToP3Color, convertRolesToP3 } from './p3';
export { contrastRatio } from './contrast';
export { deltaE2000 } from './deltaE';
export {
  simulateCVD,
  cvdSelfChecks,
  type CVDType,
  type SelfCheckResult,
} from './cvd';
