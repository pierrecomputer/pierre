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
  // The output of each open fence, by its complete lines. One plugin often
  // serves many documents, so several fences can stream at once.
  const open = new Map<string, string>();
  const draw = (code: string): string =>
    `<div data-markdown="mermaid">${pele.render(code, options).svg}</div>`;
  return {
    render({ code, isIncomplete }: CodeOptions): string | null {
      if (!isIncomplete) {
        try {
          return draw(code);
        } catch {
          return null;
        }
      }
      // A partial last line, with no LF yet, rarely parses.
      code = code.slice(0, code.lastIndexOf('\n') + 1);
      let html = open.get(code);
      if (html !== undefined) return html;
      // The longest earlier state of this fence holds its last diagram.
      let previous: string | undefined;
      html = '';
      for (const [key, value] of open)
        if (code.startsWith(key) && key.length >= (previous?.length ?? 0)) {
          previous = key;
          html = value;
        }
      if (previous !== undefined) open.delete(previous);
      if (code.trim() !== '')
        try {
          html = draw(code);
        } catch {}
      open.set(code, html);
      // Fences that closed leave their last state behind.
      if (open.size > 16) open.delete(open.keys().next().value!);
      return html;
    },
  };
}
