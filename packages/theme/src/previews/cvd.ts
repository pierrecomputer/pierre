import { type CVDType, simulateCVD } from '../color';
// src/previews/cvd.ts
// Builds preview/cvd.html (returned as a string; written by scripts/createPreviews.ts) —
// a human-eyeballing companion to the objective gate (test/cvd.test.ts). For each
// CVD (color-vision-deficiency) theme it shows,
// side by side: the colors as defined in the theme, and the same colors pushed
// through the Machado-2009 simulation for that deficiency — i.e. what a person
// with that CVD sees. If the design works, the simulated column still reads as
// "added vs deleted", "pass vs fail", "error vs warning", etc.
//
// The numbers are proven by the gate; this page is for sanity-checking that the
// proof matches intuition. Run with `moonx theme:preview --ignore-ci-checks`.
import {
  protanDeutanDark,
  protanDeutanLight,
  type Roles,
  tritanopiaDark,
  tritanopiaLight,
} from '../roles';

type View = {
  title: string;
  roles: Roles;
  cvd: CVDType;
  type: 'light' | 'dark';
};
// The protan/deutan theme targets two deficiencies, so it gets one row per
// deficiency (protanopia and deuteranopia) — both are gated in tests. The
// "normal vision" column is the same in both rows, which is expected.
const VIEWS: View[] = [
  // Light
  {
    title: 'Pierre Light Protanopia & Deuteranopia',
    roles: protanDeutanLight,
    cvd: 'protan',
    type: 'light',
  },
  {
    title: 'Pierre Light Protanopia & Deuteranopia',
    roles: protanDeutanLight,
    cvd: 'deutan',
    type: 'light',
  },
  {
    title: 'Pierre Light Tritanopia',
    roles: tritanopiaLight,
    cvd: 'tritan',
    type: 'light',
  },
  // Dark
  {
    title: 'Pierre Dark Protanopia & Deuteranopia',
    roles: protanDeutanDark,
    cvd: 'protan',
    type: 'dark',
  },
  {
    title: 'Pierre Dark Protanopia & Deuteranopia',
    roles: protanDeutanDark,
    cvd: 'deutan',
    type: 'dark',
  },
  {
    title: 'Pierre Dark Tritanopia',
    roles: tritanopiaDark,
    cvd: 'tritan',
    type: 'dark',
  },
];

// Simulate every hex in a Roles object → "what the CVD viewer sees".
function simulateRoles(r: Roles, cvd: CVDType): Roles {
  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return /^#[0-9a-fA-F]{6}$/.test(value) ? simulateCVD(value, cvd) : value;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(value)) out[key] = walk(child);
      return out;
    }
    return value;
  };
  return walk(r) as Roles;
}

// Blend a foreground color over a background at the given alpha (for diff tints).
function mix(fg: string, bg: string, a: number): string {
  const h = (c: string) =>
    [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const [r1, g1, b1] = h(fg),
    [r2, g2, b2] = h(bg);
  const m = (x: number, y: number) => Math.round(x * a + y * (1 - a));
  return `#${[m(r1, r2), m(g1, g2), m(b1, b2)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

const swatch = (label: string, hex: string) =>
  `<div class="sw" style="background:${hex}"><span>${label}</span><code>${hex}</code></div>`;

// A mini code-review / editor mock built only from a theme's roles.
function mock(r: Roles): string {
  const ed = r.bg.editor,
    win = r.bg.window;
  const addBg = mix(r.states.success, ed, 0.18);
  const delBg = mix(r.states.danger, ed, 0.18);
  const dot = (c: string, letter: string) =>
    `<span class="badge" style="color:${c}">${letter}</span>`;
  return `
  <div class="mock" style="background:${win};color:${r.fg.base};border-color:${r.border.window}">
    <div class="mock-title" style="color:${r.fg.fg2}">git</div>
    <div class="tree">
      <div>${dot(r.states.success, 'A')}<span style="color:${r.states.success}">added.ts</span></div>
      <div>${dot(r.accent.primary, 'M')}<span style="color:${r.accent.primary}">changed.ts</span></div>
      <div>${dot(r.states.danger, 'D')}<span style="color:${r.states.danger}">removed.ts</span></div>
      <div>${dot(r.states.merge, 'C')}<span style="color:${r.states.merge}">conflict.ts</span></div>
    </div>
    <div class="diff" style="background:${ed}">
      <div style="background:${addBg}"><span style="color:${r.states.success}">+</span> <span style="color:${r.syntax.string}">"inserted line"</span></div>
      <div style="background:${delBg}"><span style="color:${r.states.danger}">-</span> <span style="color:${r.syntax.tag}">"deleted line"</span></div>
    </div>
    <div class="code" style="background:${ed}">
      <span style="color:${r.syntax.keyword}">const</span>
      <span style="color:${r.syntax.variable}">total</span> =
      <span style="color:${r.syntax.func}">sum</span>(<span style="color:${r.syntax.number}">42</span>);
      <span style="color:${r.syntax.comment}">// note</span>
    </div>
    <div class="term" style="background:${win}">
      <span style="color:${r.ansi.green}">✓ 12 passed</span>
      <span style="color:${r.ansi.red}">✗ 3 failed</span>
      <span style="color:${r.states.warn}">⚠ 1 warning</span>
    </div>
  </div>`;
}

const CVD_LABEL: Record<CVDType, string> = {
  protan: 'protanopia',
  deutan: 'deuteranopia',
  tritan: 'tritanopia',
};

function section(v: View): string {
  const sim = simulateRoles(v.roles, v.cvd);
  const roleList: [string, (r: Roles) => string][] = [
    ['success (added)', (r) => r.states.success],
    ['danger (deleted)', (r) => r.states.danger],
    ['warn', (r) => r.states.warn],
    ['info', (r) => r.states.info],
    ['merge', (r) => r.states.merge],
    ['accent', (r) => r.accent.primary],
    ['ansi.red', (r) => r.ansi.red],
    ['ansi.green', (r) => r.ansi.green],
    ['string', (r) => r.syntax.string],
    ['keyword', (r) => r.syntax.keyword],
    ['variable', (r) => r.syntax.variable],
    ['func', (r) => r.syntax.func],
  ];
  const swatches = (r: Roles) =>
    roleList.map(([n, sel]) => swatch(n, sel(r))).join('');
  return `
  <section>
    <h2>${v.title} <span class="tag">${v.type} · simulated as ${CVD_LABEL[v.cvd]}</span></h2>
    <div class="cols">
      <div class="col">
        <h3>Colors as defined</h3>
        <div class="swatches">${swatches(v.roles)}</div>
        ${mock(v.roles)}
      </div>
      <div class="col">
        <h3>Simulated (${CVD_LABEL[v.cvd]})</h3>
        <div class="swatches">${swatches(sim)}</div>
        ${mock(sim)}
      </div>
    </div>
  </section>`;
}

/** Render the CVD normal-vs-simulated proof sheet as a standalone HTML document. */
function renderCvdHtml(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Pierre CVD Themes</title>
<style>
  :root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
    --bg:#fafafa; --fg:#171717; --muted:#737373; }
  @media (prefers-color-scheme: dark){ :root{ --bg:#0a0a0a; --fg:#fafafa; --muted:#8a8a8a; } }
  *{box-sizing:border-box} body{margin:0;padding:32px;background:var(--bg);color:var(--fg)}
  header{max-width:1200px;margin:0 auto 24px}
  h1{margin: 0 0 8px;font-size: 12px;font-weight: 600;letter-spacing: 1px;text-transform: uppercase;color:var(--muted)}
  header p{margin:0;color:var(--muted);font-size:13px;max-width:76ch}
  main{max-width:1200px;margin:0 auto;display:flex;flex-direction:column;gap:40px}
  section h2{font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:13px;font-weight:600;margin:0 0 12px;display:flex;align-items:baseline;gap:10px}
  .tag{font-size:11px;font-weight:400;color:var(--muted)}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .col h3{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);margin:0 0 8px}
  .swatches{display:grid;grid-template-columns:repeat(4,1fr);gap:4px;margin-bottom:10px}
  .sw{height:54px;border-radius:6px;padding:6px 8px;display:flex;flex-direction:column;justify-content:space-between;
    font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:11px;line-height:1.3;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.45);overflow:hidden}
  .sw code{opacity:.85}
  .mock{border:1px solid;border-radius:8px;padding:10px;font-family:ui-monospace,"SF Mono",Menlo,monospace;font-size:12px;display:flex;flex-direction:column;gap:8px}
  .mock-title{font-size:9px;text-transform:uppercase;letter-spacing:1px}
  .tree div,.diff div,.term{display:flex;gap:8px;align-items:center}
  .tree{display:flex;flex-direction:column;gap:2px}
  .badge{font-weight:700;width:14px;display:inline-block;text-align:center}
  .diff{border-radius:6px;overflow:hidden;display:flex;flex-direction:column}
  .diff div{padding:2px 8px}
  .code{border-radius:6px;padding:8px}
  .term{border-radius:6px;padding:8px;gap:16px;flex-wrap:wrap}
</style></head>
<body>
  <header>
    <h1>Pierre CVD Themes — proof sheet</h1>
    <p>Left = the colors as defined in the theme. Right = the same colors pushed through
    the Machado-2009 simulation for that deficiency. If the design holds, the right column
    still reads as added-vs-deleted, pass-vs-fail, and error-vs-warning.
    Objective ΔE/contrast checks live in <code>test/cvd.test.ts</code> (run via <code>moonx theme:test</code>).</p>
  </header>
  <main>
    ${VIEWS.map(section).join('\n')}
  </main>
</body></html>
`;
}

export const cvd = {
  filename: 'cvd.html',
  render: renderCvdHtml,
};
