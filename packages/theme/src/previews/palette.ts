// Builds the palette swatch sheet (every scale in palettes.ts) and returns it as
// HTML. Writing to disk is done by scripts/createPreviews.ts.
import { palettes } from '../palettes';

/** Render the palette swatch sheet as a standalone HTML document. */
function renderPaletteHtml(): string {
  const sections = Object.entries(palettes)
    .map(([name, scale]) => {
      // JS reorders integer-indexed keys ahead of string keys, which would move
      // "020" / "040" / "060" / "080" after "100". Sort numerically to restore
      // the intended light-to-dark order.
      const stops = Object.entries(scale).sort(
        ([a], [b]) => Number(a) - Number(b)
      );
      const swatches = stops
        .map(
          ([stop, hex]) =>
            `          <div class="swatch" style="background:${hex};color:contrast-color(${hex})">` +
            `<span class="stop">${stop}</span>` +
            `<span class="hex">${hex}</span>` +
            `</div>`
        )
        .join('\n');
      return `      <section class="palette">
        <div class="palette-name">
          ${name}
          <span class="palette-count">${stops.length} stops</span>
        </div>
        <div class="swatches">
${swatches}
        </div>
      </section>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>Pierre Palette</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
        --bg: #fafafa;
        --fg: #171717;
        --muted: #737373;
      }

      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0a0a0a;
          --fg: #fafafa;
          --muted: #8a8a8a;
        }
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        padding: 32px 32px 64px;
        background: var(--bg);
        color: var(--fg);
      }

      header,
      main {
        max-width: 1400px;
        margin: 0 auto;
      }

      header {
        margin-bottom: 32px;
      }

      main {
        display: flex;
        flex-direction: column;
        gap: 20px;
      }

      h1 {
        margin: 0;
        font-size: 12px;
        font-weight: 600;
        letter-spacing: 1px;
        text-transform: uppercase;
        color: var(--muted);
      }

      .palette-name {
        display: flex;
        align-items: baseline;
        gap: 12px;
        margin: 0 0 8px;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 13px;
        font-weight: 600;
      }

      .palette-count {
        font-size: 11px;
        font-weight: 400;
        color: var(--muted);
      }

      .swatches {
        display: flex;
        gap: 4px;
      }

      .swatch {
        flex: 1 1 0;
        min-width: 0;
        height: 88px;
        padding: 10px 12px;
        border-radius: 8px;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        font-family: ui-monospace, "SF Mono", Menlo, monospace;
        font-size: 11px;
        line-height: 1.3;
      }

      .stop {
        font-weight: 600;
      }

      .hex {
        opacity: 0.75;
        letter-spacing: 0.5px;
      }
    </style>
  </head>
  <body>
    <header>
      <h1>Pierre Palette</h1>
    </header>
    <main>
${sections}
    </main>
  </body>
</html>
`;

  return html;
}

export const palette = {
  filename: 'palette.html',
  render: renderPaletteHtml,
};
