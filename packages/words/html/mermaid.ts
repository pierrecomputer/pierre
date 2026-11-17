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
  return {
    render({ code, isIncomplete }: CodeOptions): string | null {
      if (isIncomplete) return null;
      try {
        return `<div data-markdown="mermaid">${pele.render(code, options).svg}</div>`;
      } catch {
        return null;
      }
    },
  };
}
