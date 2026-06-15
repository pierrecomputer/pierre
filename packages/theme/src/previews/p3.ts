// Builds preview/p3.html: a compact comparison of basic and enhanced Display P3
// conversions for representative Pierre palette colors.
import { srgbHexToP3Color } from '../color';

const testColors = [
  { name: 'Blue', srgb: '#008cff' },
  { name: 'Green', srgb: '#0dbe4e' },
  { name: 'Red', srgb: '#ff2e3f' },
  { name: 'Purple', srgb: '#c635e4' },
  { name: 'Pink', srgb: '#fc2b73' },
  { name: 'Orange', srgb: '#fe8c2c' },
  { name: 'Cyan', srgb: '#08c0ef' },
  { name: 'Teal', srgb: '#00c5d2' },
];

function renderP3Html(): string {
  const rows = testColors
    .map(({ name, srgb }) => {
      const basic = srgbHexToP3Color(srgb, false);
      const enhanced = srgbHexToP3Color(srgb, true);
      return `      <tr>
        <th>${name}</th>
        <td><span class="swatch" style="background:${srgb}"></span><code>${srgb}</code></td>
        <td><span class="swatch" style="background:${basic}"></span><code>${basic}</code></td>
        <td><span class="swatch" style="background:${enhanced}"></span><code>${enhanced}</code></td>
      </tr>`;
    })
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Pierre Display P3 Preview</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
        --bg: #fafafa;
        --fg: #171717;
        --muted: #737373;
        --border: #e5e5e5;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0a0a0a;
          --fg: #fafafa;
          --muted: #8a8a8a;
          --border: #262626;
        }
      }

      * { box-sizing: border-box; }
      body { margin: 0; padding: 32px; background: var(--bg); color: var(--fg); }
      main { max-width: 1160px; margin: 0 auto; }
      header { margin-bottom: 24px; }
      h1 {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: var(--muted);
      }
      p { margin: 0; color: var(--muted); font-size: 13px; max-width: 76ch; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th, td { padding: 12px; border-bottom: 1px solid var(--border); text-align: left; vertical-align: top; }
      thead th { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .5px; }
      tbody th { width: 110px; font-weight: 600; }
      td { font-family: ui-monospace, "SF Mono", Menlo, monospace; }
      code { overflow-wrap: anywhere; }
      .swatch {
        display: inline-block;
        width: 48px;
        height: 28px;
        margin-right: 10px;
        border-radius: 6px;
        border: 1px solid rgba(0, 0, 0, .12);
        vertical-align: middle;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>Pierre Display P3 Preview</h1>
        <p>Basic conversion maps sRGB into Display P3. Enhanced conversion applies the
        saturation and luminance boost used by the vibrant theme roles.</p>
      </header>
      <table>
        <thead>
          <tr>
            <th>Color</th>
            <th>sRGB</th>
            <th>Display P3 basic</th>
            <th>Display P3 enhanced</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </main>
  </body>
</html>
`;
}

export const p3 = {
  filename: 'p3.html',
  render: renderP3Html,
};
