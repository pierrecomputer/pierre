import type { CodeOptions, MermaidPlugin } from './types';

/** The part of Pele's API the plugin uses: `import { render } from 'pele'`. */
export interface MermaidRenderer<Options> {
  render(source: string, options?: Options): { svg: string };
}

/**
 * Render `mermaid` code blocks as SVG with Pele. An open fence draws its
 * complete lines and keeps the last diagram that parsed; with no diagram yet it
 * shows nothing. A closed diagram that does not parse shows as a code block.
 */
export function createMermaidPlugin<Options>(
  pele: MermaidRenderer<Options>,
  options?: Options
): MermaidPlugin {
  // Complete lines of the open fence and their last diagram that parsed.
  let source = '';
  let last = '';
  return {
    render({ code, isIncomplete }: CodeOptions): string | null {
      if (isIncomplete) {
        // Open code ends with an added LF. Its partial last line rarely parses.
        code = code.slice(0, code.lastIndexOf('\n', code.length - 2) + 1);
        if (code === source) return last;
        // Another fence must not show the previous diagram.
        if (!code.startsWith(source)) last = '';
        source = code;
        if (code.trim() === '') return '';
      }
      try {
        const html = `<div data-markdown="mermaid">${pele.render(code, options).svg}</div>`;
        if (isIncomplete) last = html;
        return html;
      } catch {
        return isIncomplete ? last : null;
      }
    },
  };
}
