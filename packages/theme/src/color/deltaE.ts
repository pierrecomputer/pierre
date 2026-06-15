// CIEDE2000 perceptual color difference (ΔE₀₀) — "how far apart do two colors
// look?". The modern CIE standard, tuned to human perception in CIE Lab space.
// Rough reading: <1 imperceptible, ~2–3 just noticeable, > ~10 "clearly
// different / not confused". The CVD gate computes ΔE between the *simulated*
// versions of two roles to prove a dichromat can still tell them apart.
// Pipeline: sRGB → linear → XYZ (D65) → Lab → CIEDE2000.

import { hexToRgb01, srgbToLinear } from './srgb';

function hexToLab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb01(hex).map(srgbToLinear) as [
    number,
    number,
    number,
  ];
  // linear sRGB → CIE XYZ (D65, Y of white = 1).
  const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * b;
  // XYZ → Lab, D65 reference white.
  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn),
    fy = f(y / yn),
    fz = f(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

const deg2rad = (d: number) => (d * Math.PI) / 180;
const rad2deg = (r: number) => (r * 180) / Math.PI;

/** CIEDE2000 color difference (ΔE₀₀) between two sRGB hex colors. */
export function deltaE2000(hexA: string, hexB: string): number {
  const [L1, a1, b1] = hexToLab(hexA);
  const [L2, a2, b2] = hexToLab(hexB);

  const avgL = (L1 + L2) / 2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const avgC = (C1 + C2) / 2;

  const G =
    0.5 *
    (1 - Math.sqrt(Math.pow(avgC, 7) / (Math.pow(avgC, 7) + Math.pow(25, 7))));
  const a1p = a1 * (1 + G);
  const a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const avgCp = (C1p + C2p) / 2;

  const hp = (ap: number, bp: number) => {
    if (ap === 0 && bp === 0) return 0;
    let h = rad2deg(Math.atan2(bp, ap));
    if (h < 0) h += 360;
    return h;
  };
  const h1p = hp(a1p, b1);
  const h2p = hp(a2p, b2);

  let dhp: number;
  if (C1p * C2p === 0) dhp = 0;
  else if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
  else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
  else dhp = h2p - h1p + 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(deg2rad(dhp) / 2);

  let avgHp: number;
  if (C1p * C2p === 0) avgHp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) avgHp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) avgHp = (h1p + h2p + 360) / 2;
  else avgHp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(deg2rad(avgHp - 30)) +
    0.24 * Math.cos(deg2rad(2 * avgHp)) +
    0.32 * Math.cos(deg2rad(3 * avgHp + 6)) -
    0.2 * Math.cos(deg2rad(4 * avgHp - 63));

  const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
  const Rc =
    2 * Math.sqrt(Math.pow(avgCp, 7) / (Math.pow(avgCp, 7) + Math.pow(25, 7)));
  const Sl =
    1 +
    (0.015 * Math.pow(avgL - 50, 2)) / Math.sqrt(20 + Math.pow(avgL - 50, 2));
  const Sc = 1 + 0.045 * avgCp;
  const Sh = 1 + 0.015 * avgCp * T;
  const Rt = -Math.sin(deg2rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh)
  );
}
