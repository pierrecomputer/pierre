import type { CodeOptions, MermaidPlugin } from './types';

/** The part of Pele's API the plugin uses: `import { render } from 'pele'`. */
export interface MermaidRenderer<Options> {
  render(source: string, options?: Options): { svg: string };
}

/**
 * Render closed `mermaid` code blocks as SVG with Pele. An open fence, or a
 * diagram that does not parse, shows as a code block.
 */
export function createMermaidPlugin<Options>(
  pele: MermaidRenderer<Options>,
  options?: Options
): MermaidPlugin {
  // Pending output formats the same closed block again on each update.
  let lastCode: string | undefined;
  let lastHtml: string | null = null;
  return {
    render({ code, isIncomplete }: CodeOptions): string | null {
      if (isIncomplete) return null;
      if (code === lastCode) return lastHtml;
      let html: string | null;
      try {
        html = `<div data-markdown="mermaid">${pele.render(code, options).svg}</div>`;
      } catch {
        html = null;
      }
      lastCode = code;
      return (lastHtml = html);
    },
  };
}
