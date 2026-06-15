import {
  differenceCiede2000,
  filterDeficiencyDeuter,
  filterDeficiencyProt,
  filterDeficiencyTrit,
  formatHex,
  wcagContrast,
} from 'culori';

/**
 * Color-science utilities shared by the CVD accessibility gate:
 * simulate a color as a dichromat sees it, measure WCAG contrast and CIEDE2000
 * separation after simulation, and cross-validate our hand-rolled math against
 * culori.
 */
import {
  contrastRatio,
  type CVDType,
  deltaE2000,
  simulateCVD,
} from '../../src/color';

// The two common Machado gamma conventions: linear RGB (our implementation) and
// gamma-encoded sRGB (culori / the `colorspace` R package). The gate checks both.
export type SimulationConvention = 'linear' | 'gamma';

type CuloriColorInput = Parameters<typeof formatHex>[0];

const gammaSim: Record<CVDType, (c: string) => CuloriColorInput> = {
  protan: filterDeficiencyProt(1) as (c: string) => CuloriColorInput,
  deutan: filterDeficiencyDeuter(1) as (c: string) => CuloriColorInput,
  tritan: filterDeficiencyTrit(1) as (c: string) => CuloriColorInput,
};

export function simulateForConvention(
  hex: string,
  cvd: CVDType,
  convention: SimulationConvention
): string {
  if (convention === 'linear') return simulateCVD(hex, cvd);
  const simulated = formatHex(gammaSim[cvd](hex));
  if (simulated === undefined) {
    throw new Error(`culori could not simulate ${hex} for ${cvd}`);
  }
  return simulated;
}

// Worst-case contrast of fg on bg after simulation, across both gamma conventions
// (the same linear + gamma pair the distinguishability check uses).
export function simulatedContrast(
  fg: string,
  bg: string,
  cvd: CVDType
): number {
  let worst = Infinity;
  for (const convention of ['linear', 'gamma'] as const) {
    worst = Math.min(
      worst,
      contrastRatio(
        simulateForConvention(fg, cvd, convention),
        simulateForConvention(bg, cvd, convention)
      )
    );
  }
  return worst;
}

// Worst-case ΔE for a pair across every CVD type a theme targets and both Machado
// gamma conventions; reports which (cvd, convention) produced the minimum.
export function worstDeltaE(aHex: string, bHex: string, cvds: CVDType[]) {
  let worst = Infinity;
  let worstCvd: CVDType = cvds[0];
  let worstConvention: SimulationConvention = 'linear';
  for (const cvd of cvds) {
    for (const convention of ['linear', 'gamma'] as const) {
      const d = deltaE2000(
        simulateForConvention(aHex, cvd, convention),
        simulateForConvention(bHex, cvd, convention)
      );
      if (d < worst) {
        worst = d;
        worstCvd = cvd;
        worstConvention = convention;
      }
    }
  }
  return { worst, worstCvd, worstConvention };
}

// Cross-validate our hand-rolled color math against culori (dev-only oracle). We
// keep our own implementation (its CVD simulation uses the more-correct linear-RGB
// convention), but prove the standardized formulas agree with a vetted library:
// contrast and ΔE must match to floating-point noise, and our simulation must
// collapse the same confusable axes culori's does (it differs only in gamma
// convention, by design — see src/color/cvd.ts).
export function referenceCrossChecks(): {
  name: string;
  ok: boolean;
  detail: string;
}[] {
  const ciede = differenceCiede2000();
  // culori parses hex strings at runtime; its types want parsed Color objects, so
  // we loosen the signatures here (dev-only oracle).
  const samples = [
    '#009fff',
    '#d52c36',
    '#199f43',
    '#ffca00',
    '#1a85d4',
    '#d47628',
    '#a13cee',
    '#00c5d2',
    '#ff5d36',
    '#737373',
    '#ffffff',
    '#0a0a0a',
  ];

  // contrast & ΔE: must match culori to floating-point noise.
  let maxC = 0,
    maxDe = 0;
  for (let i = 0; i < samples.length; i++) {
    for (let j = i + 1; j < samples.length; j++) {
      const a = samples[i],
        b = samples[j];
      maxC = Math.max(maxC, Math.abs(contrastRatio(a, b) - wcagContrast(a, b)));
      maxDe = Math.max(maxDe, Math.abs(deltaE2000(a, b) - ciede(a, b)));
    }
  }

  // simulation: differs from culori only in gamma convention, but must collapse
  // the same axis — verify each maps the confusable pair to a much smaller ΔE.
  const axisOk = (['protan', 'deutan', 'tritan'] as CVDType[]).every((t) => {
    const x = t === 'tritan' ? '#009fff' : '#ff2e3f'; // blue (tritan) / red (protan,deutan)
    const y = '#199f43'; // green
    const before = deltaE2000(x, y);
    const ours = deltaE2000(simulateCVD(x, t), simulateCVD(y, t));
    const lib = ciede(
      simulateForConvention(x, t, 'gamma'),
      simulateForConvention(y, t, 'gamma')
    );
    // Both implementations must collapse the confusable pair to under half its
    // un-simulated separation (exact residual differs by gamma convention).
    return ours < before * 0.5 && lib < before * 0.5;
  });

  return [
    {
      name: 'contrast matches culori',
      ok: maxC < 0.01,
      detail: `max |Δ| ${maxC.toFixed(4)}`,
    },
    {
      name: 'ΔE2000 matches culori',
      ok: maxDe < 0.1,
      detail: `max |Δ| ${maxDe.toFixed(4)}`,
    },
    {
      name: 'simulation collapses same axis',
      ok: axisOk,
      detail: axisOk ? 'ours & culori agree' : 'axis mismatch',
    },
  ];
}
