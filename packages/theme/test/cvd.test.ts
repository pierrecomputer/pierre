/**
 * OBJECTIVE GATE for the CVD (Color Vision Deficiency) themes.
 * This file turns the design rules from src/roles into machine-checked assertions
 * and is run as part of `theme:test` (via Bun's test runner). It fails the build
 * if any Tier-1 or Tier-2 requirement regresses, so the themes cannot silently drift
 * into an ambiguous state.
 *
 * How it works:
 *   1. simulate — recolor each role as a protan/deutan/tritan viewer would see it
 *      (Machado 2009 model), at full dichromacy (severity 1.0).
 *   2. distinguishability — for every pair of roles that co-occurs on screen,
 *      measure the perceptual distance (ΔE₀₀) between the simulated colors. If
 *      two signals (e.g. "added" vs "deleted") still look far apart, then they can
 *      be distinguished. ΔE₀₀ > ~10 ≈ "clearly different".
 *   3. contrast — WCAG legibility of each foreground vs its background, checked
 *      both normally and after simulation (simulation shifts luminance).
 *
 * TIERS
 * Graded by what carries the signal when color fails. Under full dichromacy there
 * are only ~2 usable hue poles + luminance but ~20 chromatic roles, so not every
 * pair can be hue-unique. We gate hardest where color is the only cue, and lean on
 * the editor's built-in non-color cues elsewhere.
 *   • Tier 1 (hard gate, ΔE ≥ 11) — color is the SOLE disambiguator:
 *       diff add/delete backgrounds (success/danger), diff inserted/deleted TEXT
 *       (string/tag), merge-conflict backgrounds (merge/info), terminal pass/fail
 *       (ansi red/green). None of these has a glyph fallback.
 *   • Tier 2 (hard gate, ΔE ≥ 8) — color PLUS a non-color cue:
 *       diagnostics (error/warn/info — distinct icon SHAPES), and the
 *       highest-frequency syntax adjacencies + comment-vs-code.
 *   • Tier 3 (advisory, reported only) — color is tertiary:
 *       the git-tree group (every entry already carries an M/A/D/U/C letter
 *       badge) and extended syntax (bold/italic + position carry it). Reported
 *       via test diagnostics so regressions stay visible without blocking the build.
 */
import { describe, test } from 'bun:test';
import assert from 'node:assert/strict';

import { contrastRatio, cvdSelfChecks, type CVDType } from '../src/color';
import {
  protanDeutanDark,
  protanDeutanLight,
  type Roles,
  tritanopiaDark,
  tritanopiaLight,
} from '../src/roles';
import {
  referenceCrossChecks,
  simulatedContrast,
  worstDeltaE,
} from './helpers/cvd';

// Thresholds (standards-derived, tuned empirically during build-out)
const TIER1_DELTA_E = 11; // co-occurring opposite-meaning signals
const TIER2_DELTA_E = 8; // critical syntax adjacencies
const TEXT_CONTRAST = 4.5; // WCAG 2.1 SC 1.4.3 normal text
const UI_CONTRAST = 3.0; // WCAG 2.1 SC 1.4.11 UI glyphs / SC 1.4.3 large text

// The role-color pairs the gate checks
// A Selector plucks one concrete hex from a resolved Roles object, so a RolePair
// names two roles whose simulated colors we then compare.
type Selector = (r: Roles) => string;
type RolePair = {
  tier: 1 | 2 | 3;
  label: string;
  a: Selector;
  b: Selector;
  group: string;
};

// Named selectors for every role the gate references, so the pair list below can
// say `selectors.success` instead of repeating `(r) => r.states.success`.
const selectors = {
  success: (r: Roles) => r.states.success,
  danger: (r: Roles) => r.states.danger,
  warn: (r: Roles) => r.states.warn,
  info: (r: Roles) => r.states.info,
  merge: (r: Roles) => r.states.merge,
  accent: (r: Roles) => r.accent.primary,
  ansiRed: (r: Roles) => r.ansi.red,
  ansiGreen: (r: Roles) => r.ansi.green,
  comment: (r: Roles) => r.syntax.comment,
  string: (r: Roles) => r.syntax.string,
  keyword: (r: Roles) => r.syntax.keyword,
  variable: (r: Roles) => r.syntax.variable,
  func: (r: Roles) => r.syntax.func,
  type: (r: Roles) => r.syntax.type,
  number: (r: Roles) => r.syntax.number,
  tag: (r: Roles) => r.syntax.tag, // = diff "deleted" text token
};

// Expand a group whose members must each be distinguishable from every other into
// one RolePair per unordered combination — e.g. [danger, warn, info] becomes
// danger·warn, danger·info, warn·info.
function allPairsWithin(
  group: string,
  tier: 1 | 2 | 3,
  members: [string, Selector][]
): RolePair[] {
  const out: RolePair[] = [];
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      out.push({
        tier,
        group,
        label: `${members[i][0]} vs ${members[j][0]}`,
        a: members[i][1],
        b: members[j][1],
      });
    }
  }
  return out;
}

// Every role-color pair the gate measures, grouped by tier (see the header for
// what each tier means and why).
const DISTINGUISHABILITY_PAIRS: RolePair[] = [
  // ── Tier 1 — color is the only cue (ΔE ≥ 11) ──────────────────────────────
  // Diff gutter / overview ruler: added vs deleted backgrounds (no glyph).
  {
    tier: 1,
    group: 'diff bg',
    label: 'success(added) vs danger(deleted)',
    a: selectors.success,
    b: selectors.danger,
  },
  // Diff TEXT tokens: inserted vs deleted, the semantic core of a review.
  {
    tier: 1,
    group: 'diff text',
    label: 'string(inserted) vs tag(deleted)',
    a: selectors.string,
    b: selectors.tag,
  },
  // Merge conflict view: current(merge) vs incoming(info) tinted backgrounds.
  {
    tier: 1,
    group: 'merge conflict',
    label: 'merge vs info',
    a: selectors.merge,
    b: selectors.info,
  },
  // Terminal pass/fail.
  {
    tier: 1,
    group: 'terminal',
    label: 'ansi.red vs ansi.green',
    a: selectors.ansiRed,
    b: selectors.ansiGreen,
  },

  // ── Tier 2 — color + a non-color cue (ΔE ≥ 8) ─────────────────────────────
  // Diagnostics & notifications: error/warn/info — backed by distinct icon
  // shapes (✕ / △ / ⓘ), so color is the secondary channel.
  ...allPairsWithin('diagnostics', 2, [
    ['danger', selectors.danger],
    ['warn', selectors.warn],
    ['info', selectors.info],
  ]),
  // Comment must never be mistaken for live code, so pair it against each token
  // kind it sits next to (we only care about comment-vs-X, not X-vs-Y here).
  {
    tier: 2,
    group: 'comment vs code',
    label: 'comment vs string',
    a: selectors.comment,
    b: selectors.string,
  },
  {
    tier: 2,
    group: 'comment vs code',
    label: 'comment vs keyword',
    a: selectors.comment,
    b: selectors.keyword,
  },
  {
    tier: 2,
    group: 'comment vs code',
    label: 'comment vs variable',
    a: selectors.comment,
    b: selectors.variable,
  },
  // The three highest-frequency code tokens.
  ...allPairsWithin('core syntax', 2, [
    ['keyword', selectors.keyword],
    ['string', selectors.string],
    ['variable', selectors.variable],
  ]),

  // ── Tier 3 (advisory) ─────────────────────────────────────────────────────
  // Git tree: added/modified/deleted/conflict — every entry has an M/A/D/U/C
  // letter badge, so identical-looking colors are still unambiguous. Reported.
  ...allPairsWithin('git tree', 3, [
    ['success', selectors.success],
    ['danger', selectors.danger],
    ['merge', selectors.merge],
    ['accent.primary', selectors.accent],
  ]),
  ...allPairsWithin('extended syntax', 3, [
    ['func', selectors.func],
    ['type', selectors.type],
    ['number', selectors.number],
    ['keyword', selectors.keyword],
    ['string', selectors.string],
    ['variable', selectors.variable],
  ]),
];

// ── Theme registry ──────────────────────────────────────────────────────────
// Each protan/deutan theme must satisfy the gate under BOTH protan and deutan
// simulation; tritanopia themes under tritan.
type CvdThemeDef = { name: string; roles: Roles; cvds: CVDType[] };
const THEMES: CvdThemeDef[] = [
  {
    name: 'Pierre Light Protanopia & Deuteranopia',
    roles: protanDeutanLight,
    cvds: ['protan', 'deutan'],
  },
  {
    name: 'Pierre Dark Protanopia & Deuteranopia',
    roles: protanDeutanDark,
    cvds: ['protan', 'deutan'],
  },
  { name: 'Pierre Light Tritanopia', roles: tritanopiaLight, cvds: ['tritan'] },
  { name: 'Pierre Dark Tritanopia', roles: tritanopiaDark, cvds: ['tritan'] },
];

// ── Tests ─────────────────────────────────────────────────────────────────────

// Color-science self-checks (prove the simulation/contrast/ΔE math itself).
describe('color-science self-checks (Machado 2009 / WCAG / CIEDE2000)', () => {
  for (const c of cvdSelfChecks()) {
    test(c.name, () => assert.ok(c.ok, c.detail));
  }
});

// Reference cross-validation vs culori (a dev-only oracle; ships nothing).
describe('reference cross-validation vs culori', () => {
  for (const r of referenceCrossChecks()) {
    test(r.name, () => assert.ok(r.ok, `${r.name}: ${r.detail}`));
  }
});

// CONTRAST POLICY. We hold the CVD themes to WCAG bars, but only the bar that fits
// how each color renders — and we do NOT impose a bar the *standard* Pierre themes
// never met (base Pierre LIGHT runs syntax/signal colors at 2–4.5:1 by design; see
// ACCESSIBILITY.md):
//   • Body text (editor foreground)            → 4.5:1 (SC 1.4.3 normal text)
//   • Syntax tokens & meaningful signal colors → 3.0:1 (SC 1.4.11 UI / large text),
//     checked NORMAL and AFTER simulation (simulation shifts luminance).
//   • Report-only (printed, never fails): intrinsically-bright / brand colors that
//     base Pierre itself keeps bright — their *distinguishability* (ΔE) is gated,
//     not their raw contrast.
describe('CVD theme gate', () => {
  for (const { name, roles, cvds } of THEMES) {
    describe(`${name} [simulated as: ${cvds.join(', ')}]`, () => {
      const bgEditor = roles.bg.editor;
      const bgWindow = roles.bg.window;

      // Contrast (normal + simulated). The simulated check takes the worst case
      // across both gamma conventions; backgrounds are near-neutral so they barely
      // move, but we simulate them under each convention for correctness.
      describe('contrast', () => {
        // Syntax tokens are text-on-editor at the 3:1 bar; `invalid` is a
        // background tint, not a foreground, so it's excluded (all others gated).
        const syntaxForegrounds = Object.entries(roles.syntax).filter(
          ([k]) => k !== 'invalid'
        );
        // Signal colors gated at 3:1 (carry meaning): states except the bright
        // `warn`, plus the terminal pass/fail pair.
        const signalForegrounds: [string, string][] = [
          ['states.success', roles.states.success],
          ['states.danger', roles.states.danger],
          ['states.info', roles.states.info],
          ['states.merge', roles.states.merge],
          ['ansi.red', roles.ansi.red],
          ['ansi.green', roles.ansi.green],
        ];

        for (const cvd of cvds) {
          // Body text — the one role held to the full 4.5:1 text bar.
          test(`fg.base on editor — body text ≥ ${TEXT_CONTRAST}:1 (${cvd})`, () => {
            const normal = contrastRatio(roles.fg.base, bgEditor);
            const sim = simulatedContrast(roles.fg.base, bgEditor, cvd);
            assert.ok(
              normal >= TEXT_CONTRAST && sim >= TEXT_CONTRAST,
              `fg.base on editor — normal ${normal.toFixed(2)}, ${cvd} ${sim.toFixed(2)} (< ${TEXT_CONTRAST})`
            );
          });

          for (const [key, hex] of syntaxForegrounds) {
            test(`syntax.${key} on editor ≥ ${UI_CONTRAST}:1 (${cvd})`, () => {
              const normal = contrastRatio(hex, bgEditor);
              const sim = simulatedContrast(hex, bgEditor, cvd);
              assert.ok(
                normal >= UI_CONTRAST && sim >= UI_CONTRAST,
                `syntax.${key} on editor — normal ${normal.toFixed(2)}, ${cvd} ${sim.toFixed(2)} (< ${UI_CONTRAST})`
              );
            });
          }

          for (const [key, hex] of signalForegrounds) {
            test(`${key} on window ≥ ${UI_CONTRAST}:1 (${cvd})`, () => {
              const normal = contrastRatio(hex, bgWindow);
              const sim = simulatedContrast(hex, bgWindow, cvd);
              assert.ok(
                normal >= UI_CONTRAST && sim >= UI_CONTRAST,
                `${key} on window — normal ${normal.toFixed(2)}, ${cvd} ${sim.toFixed(2)} (< ${UI_CONTRAST})`
              );
            });
          }
        }

        // Report-only: worst contrast seen for the intrinsically-bright / brand
        // colors, surfaced as a diagnostic (never fails the build).
        test('report-only contrast (intrinsically-bright / brand colors)', () => {
          const reportOnlyForegrounds: [string, string][] = [
            ['accent.primary', roles.accent.primary],
            ['states.warn', roles.states.warn],
            ['ansi.yellow', roles.ansi.yellow],
            ['ansi.blue', roles.ansi.blue],
            ['ansi.cyan', roles.ansi.cyan],
            ['ansi.magenta', roles.ansi.magenta],
          ];
          const reportOnlyMin: Record<string, number> = {};
          for (const cvd of cvds) {
            for (const [key, hex] of reportOnlyForegrounds) {
              const c = Math.min(
                contrastRatio(hex, bgWindow),
                simulatedContrast(hex, bgWindow, cvd)
              );
              reportOnlyMin[key] = Math.min(reportOnlyMin[key] ?? Infinity, c);
            }
          }
          console.log(
            Object.entries(reportOnlyMin)
              .map(([k, v]) => `${k} ${v.toFixed(2)}`)
              .join(', ')
          );
        });
      });

      // Distinguishability under simulation.
      describe('distinguishability under simulation', () => {
        for (const tier of [1, 2] as const) {
          const threshold = tier === 1 ? TIER1_DELTA_E : TIER2_DELTA_E;
          describe(`Tier ${tier} (ΔE ≥ ${threshold})`, () => {
            for (const p of DISTINGUISHABILITY_PAIRS.filter(
              (p) => p.tier === tier
            )) {
              test(`[${p.group}] ${p.label}`, () => {
                const { worst, worstCvd, worstConvention } = worstDeltaE(
                  p.a(roles),
                  p.b(roles),
                  cvds
                );
                assert.ok(
                  worst >= threshold,
                  `${p.label} = ΔE ${worst.toFixed(1)} under ${worstCvd}/${worstConvention} (need ≥ ${threshold})`
                );
              });
            }
          });
        }

        // Tier 3 is advisory: reported via diagnostics so regressions stay visible
        // without blocking the build.
        test('Tier 3 (advisory — reported, never fails)', () => {
          for (const p of DISTINGUISHABILITY_PAIRS.filter(
            (p) => p.tier === 3
          )) {
            const { worst, worstCvd, worstConvention } = worstDeltaE(
              p.a(roles),
              p.b(roles),
              cvds
            );
            console.log(
              `[${p.group}] ${p.label} - DeltaE ${worst.toFixed(1)} (${worstCvd}, ${worstConvention})`
            );
          }
        });
      });
    });
  }
});
