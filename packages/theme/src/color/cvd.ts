// CVD (Color Vision Deficiency) simulation — "what does this color look like to a
// protan/deutan/tritan viewer?". Consumed by the objective gate (test/cvd.test.ts)
// and the proof-sheet preview (src/previews/cvd.ts).
//
// ─────────────────────────────────────────────────────────────────────────────
// WHAT IS CVD? (the 30-second version for engineers new to this)
// ─────────────────────────────────────────────────────────────────────────────
// "Color vision deficiency" (colloquially "color blindness") means one of the
// three cone types in the retina is missing or shifted, so some hues that look
// distinct to most people collapse into the same perceived color. The three
// dichromacies we target:
//
//   • Protanopia — missing L (long/red) cones.
//   • Deuteranopia — missing M (medium/green) cones.
//     Protanopia and deuteranopia both confuse RED ↔ GREEN; the axis that
//     survives is roughly BLUE ↔ ORANGE/YELLOW.
//   • Tritanopia — missing S (short/blue) cones. Confuses BLUE ↔ GREEN; the
//     axis that survives is roughly RED ↔ CYAN/TEAL.
//
// Design consequence: a CVD-safe theme must carry meaning (added vs deleted,
// pass vs fail, error vs warning) on the axis that *survives* for that
// deficiency, and lean on LUMINANCE (light/dark) as a second channel whenever a
// hue pole has to be reused. We don't guess whether a palette works — we
// *simulate* how each color looks to a dichromat, then measure separations with
// deltaE2000() and legibility with contrastRatio() (sibling color-science
// modules). The objective gate in test/cvd.test.ts ties those together.
//
// Standards / sources (also cited in ACCESSIBILITY.md):
//   • Machado, Oliveira & Fernandes (2009), "A Physiologically-Based Model for
//     Simulation of Color Vision Deficiency", IEEE TVCG — the simulation matrices.

import { deltaE2000 } from './deltaE';
import { hexToRgb01, linearToSrgb, srgbToLinear } from './srgb';

export type CVDType = 'protan' | 'deutan' | 'tritan';

// ─────────────────────────────────────────────────────────────────────────────
// CVD SIMULATION — Machado, Oliveira & Fernandes (2009)
// ─────────────────────────────────────────────────────────────────────────────
// The Machado model reduces "how a dichromat sees a color" to a single 3×3
// matrix multiply. The authors published one matrix per deficiency at 11 severity
// steps (0.0 = normal vision … 1.0 = full dichromacy). We embed all 11 (the same
// values the colorspace R package and culori use) but gate the themes at severity
// 1.0 — the worst case — so anything that survives also works for milder
// anomalous trichromacy.
//
// Each matrix row sums to ~1.0, so neutral grays (R=G=B) map to themselves — a
// useful check that the tables were transcribed correctly.
//
// GAMMA CONVENTION (genuinely debated — read before changing). We apply the
// matrices in LINEAR RGB: linearize the sRGB hex, multiply, re-encode. The
// rationale is consistency with the model's derivation — the RGB↔LMS step it
// approximates lives in linear light. But this is a *theoretical* preference, not
// an empirical one: there is no published study proving linear-applied Machado
// matches real dichromat perception better than the gamma-sRGB application used
// by culori and the `colorspace` R package (which it follows). The two only
// diverge noticeably on saturated colors. We implement linear here and the gate
// in test/cvd.test.ts additionally checks culori's gamma convention for Tier-1
// and Tier-2 distinguishability.

type Matrix3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

// Severity 0.0 → 1.0 in 0.1 steps. Index 10 (severity 1.0) is the dichromacy.
const MACHADO: Record<CVDType, readonly Matrix3[]> = {
  protan: [
    [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
    [
      0.856167, 0.182038, -0.038205, 0.029342, 0.955115, 0.015544, -0.00288,
      -0.001563, 1.004443,
    ],
    [
      0.734766, 0.334872, -0.069637, 0.05184, 0.919198, 0.028963, -0.004928,
      -0.004209, 1.009137,
    ],
    [
      0.630323, 0.465641, -0.095964, 0.069181, 0.890046, 0.040773, -0.006308,
      -0.007724, 1.014032,
    ],
    [
      0.539009, 0.579343, -0.118352, 0.082546, 0.866121, 0.051332, -0.007136,
      -0.011959, 1.019095,
    ],
    [
      0.458064, 0.679578, -0.137642, 0.092785, 0.846313, 0.060902, -0.007494,
      -0.016807, 1.024301,
    ],
    [
      0.38545, 0.769005, -0.154455, 0.100526, 0.829802, 0.069673, -0.007442,
      -0.02219, 1.029632,
    ],
    [
      0.319627, 0.849633, -0.169261, 0.106241, 0.815969, 0.07779, -0.007025,
      -0.028051, 1.035076,
    ],
    [
      0.259411, 0.923008, -0.18242, 0.110296, 0.80434, 0.085364, -0.006276,
      -0.034346, 1.040622,
    ],
    [
      0.203876, 0.990338, -0.194214, 0.112975, 0.794542, 0.092483, -0.005222,
      -0.041043, 1.046265,
    ],
    [
      0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882,
      -0.048116, 1.051998,
    ],
  ],
  deutan: [
    [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
    [
      0.866435, 0.177704, -0.044139, 0.049567, 0.939063, 0.01137, -0.003453,
      0.007233, 0.99622,
    ],
    [
      0.760729, 0.319078, -0.079807, 0.090568, 0.889315, 0.020117, -0.006027,
      0.013325, 0.992702,
    ],
    [
      0.675425, 0.43385, -0.109275, 0.125303, 0.847755, 0.026942, -0.00795,
      0.018572, 0.989378,
    ],
    [
      0.605511, 0.52856, -0.134071, 0.155318, 0.812366, 0.032316, -0.009376,
      0.023176, 0.9862,
    ],
    [
      0.547494, 0.607765, -0.155259, 0.181692, 0.781742, 0.036566, -0.01041,
      0.027275, 0.983136,
    ],
    [
      0.498864, 0.674741, -0.173604, 0.205199, 0.754872, 0.039929, -0.011131,
      0.030969, 0.980162,
    ],
    [
      0.457771, 0.731899, -0.18967, 0.226409, 0.731012, 0.042579, -0.011595,
      0.034333, 0.977261,
    ],
    [
      0.422823, 0.781057, -0.203881, 0.245752, 0.709602, 0.044646, -0.011843,
      0.037423, 0.974421,
    ],
    [
      0.392952, 0.82361, -0.216562, 0.263559, 0.69021, 0.046232, -0.01191,
      0.040281, 0.97163,
    ],
    [
      0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182,
      0.04294, 0.968881,
    ],
  ],
  tritan: [
    [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
    [
      0.92667, 0.092514, -0.019184, 0.021191, 0.964503, 0.014306, 0.008437,
      0.054813, 0.93675,
    ],
    [
      0.89572, 0.13333, -0.02905, 0.029997, 0.9454, 0.024603, 0.013027,
      0.104707, 0.882266,
    ],
    [
      0.905871, 0.127791, -0.033662, 0.026856, 0.941251, 0.031893, 0.01341,
      0.148296, 0.838294,
    ],
    [
      0.948035, 0.08949, -0.037526, 0.014364, 0.946792, 0.038844, 0.010853,
      0.193991, 0.795156,
    ],
    [
      1.017277, 0.027029, -0.044306, -0.006113, 0.958479, 0.047634, 0.006379,
      0.248708, 0.744913,
    ],
    [
      1.104996, -0.046633, -0.058363, -0.032137, 0.971635, 0.060503, 0.001336,
      0.317922, 0.680742,
    ],
    [
      1.193214, -0.109812, -0.083402, -0.058496, 0.97941, 0.079086, -0.002346,
      0.403492, 0.598854,
    ],
    [
      1.257728, -0.139648, -0.118081, -0.078003, 0.975409, 0.102594, -0.003316,
      0.501214, 0.502102,
    ],
    [
      1.278864, -0.125333, -0.153531, -0.084748, 0.957674, 0.127074, -0.000989,
      0.601151, 0.399838,
    ],
    [
      1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733,
      0.691367, 0.3039,
    ],
  ],
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function channelToHex(v01: number): string {
  return Math.round(clamp01(v01) * 255)
    .toString(16)
    .padStart(2, '0');
}

/**
 * Simulate how `hex` appears to someone with the given dichromacy.
 *
 * @param hex      sRGB hex color, e.g. "#1a85d4".
 * @param type     "protan" | "deutan" | "tritan".
 * @param severity 0.0 (normal) … 1.0 (full dichromacy). Defaults to 1.0 — the
 *                 worst case the themes are gated against. Snapped to the nearest
 *                 published 0.1 step.
 * @returns        a new sRGB hex string of the simulated appearance.
 */
export function simulateCVD(
  hex: string,
  type: CVDType,
  severity = 1.0
): string {
  if (!/^#?[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`simulateCVD expects a 6-digit hex color, got: ${hex}`);
  }
  const step = Math.round(clamp01(severity) * 10); // 0..10
  const m = MACHADO[type][step];

  // sRGB hex → linear RGB (the matrix lives in linear light, see GAMMA note).
  const [r, g, b] = hexToRgb01(hex).map(srgbToLinear) as [
    number,
    number,
    number,
  ];

  const lr = m[0] * r + m[1] * g + m[2] * b;
  const lg = m[3] * r + m[4] * g + m[5] * b;
  const lb = m[6] * r + m[7] * g + m[8] * b;

  // linear RGB → sRGB hex.
  const R = channelToHex(linearToSrgb(clamp01(lr)));
  const G = channelToHex(linearToSrgb(clamp01(lg)));
  const B = channelToHex(linearToSrgb(clamp01(lb)));
  return `#${R}${G}${B}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SELF-CHECKS — prove the simulation is wired up correctly
// ─────────────────────────────────────────────────────────────────────────────
// Provable invariants of the model: severity-0 is the identity, neutral grays are
// preserved (every Machado row sums to ~1), and the expected confusable axis
// actually collapses. (contrast/ΔE are additionally cross-checked against culori
// in test/cvd.test.ts.) These run from cvd.test.ts.

export type SelfCheckResult = { name: string; ok: boolean; detail: string };

export function cvdSelfChecks(): SelfCheckResult[] {
  const results: SelfCheckResult[] = [];
  const near = (a: string, b: string, tol = 2) => {
    const [r1, g1, b1] = hexToRgb01(a).map((x) => x * 255);
    const [r2, g2, b2] = hexToRgb01(b).map((x) => x * 255);
    return (
      Math.abs(r1 - r2) <= tol &&
      Math.abs(g1 - g2) <= tol &&
      Math.abs(b1 - b2) <= tol
    );
  };

  // (a) Severity 0 is the identity transform for every type.
  for (const t of ['protan', 'deutan', 'tritan'] as CVDType[]) {
    const samples = ['#1a85d4', '#d52c36', '#199f43', '#ffca00'];
    const ok = samples.every((h) => near(simulateCVD(h, t, 0), h, 1));
    results.push({
      name: `severity-0 identity (${t})`,
      ok,
      detail: ok ? 'input preserved' : 'drifted',
    });
  }

  // (b) Neutral axis is preserved: gray/white/black map to themselves.
  for (const t of ['protan', 'deutan', 'tritan'] as CVDType[]) {
    const grays = ['#000000', '#808080', '#bcbcbc', '#ffffff'];
    const ok = grays.every((h) => near(simulateCVD(h, t, 1), h, 3));
    results.push({
      name: `neutral axis preserved (${t})`,
      ok,
      detail: ok ? 'grays stable' : 'grays shifted',
    });
  }

  // (c) Behavioral: the simulation actually *removes* the confusable axis.
  //     RED↔GREEN collapses under protan/deutan; BLUE↔GREEN under tritan.
  //     (Tritanopia is loosely "blue-yellow", but blue & yellow differ in
  //     luminance — which tritanopes keep — so blue↔green is the real collapse.)
  const red = '#ff2e3f',
    green = '#199f43',
    blue = '#009fff';
  const collapses = (name: string, t: CVDType, x: string, y: string) => {
    const before = deltaE2000(x, y);
    const after = deltaE2000(simulateCVD(x, t, 1), simulateCVD(y, t, 1));
    const ok = after < before * 0.5; // confusable axis loses at least half its separation
    results.push({
      name,
      ok,
      detail: `ΔE ${before.toFixed(1)} → ${after.toFixed(1)} under ${t}`,
    });
  };
  collapses('protan collapses red↔green', 'protan', red, green);
  collapses('deutan collapses red↔green', 'deutan', red, green);
  collapses('tritan collapses blue↔green', 'tritan', blue, green);

  return results;
}
