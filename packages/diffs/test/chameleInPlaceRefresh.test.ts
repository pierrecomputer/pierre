import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import chameleHighlighter from '../src/chamele';
import { FileDiff } from '../src/components/FileDiff';
import type { CodeHighlighter } from '../src/highlighter/code_highlighter';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom } from './domHarness';

let dom: ReturnType<typeof installDom>;

beforeAll(async () => {
  dom = installDom();
  setHighlighter(chameleHighlighter);
  await chameleHighlighter.load({
    langs: [],
    themes: ['pierre-dark', 'pierre-light'],
  });
  const { customElements } = window;
  if (customElements.get('diffs-container') == null) {
    customElements.define(
      'diffs-container',
      class extends window.HTMLElement {
        constructor() {
          super();
          if (this.shadowRoot == null) {
            this.attachShadow({ mode: 'open' });
          }
        }
      }
    );
  }
});

afterAll(() => {
  setHighlighter(shikiHighlighter);
  dom.cleanup();
});

describe('in-place highlighter refresh', () => {
  test('a re-render after setHighlighter repaints without a remount', () => {
    const wrapper = document.createElement('div');
    document.body.appendChild(wrapper);
    const fileDiff = parseDiffFromFile(
      { name: 'a.ts', contents: 'const oldValue = 1;\n' },
      { name: 'a.ts', contents: 'const newValue = 2;\n' }
    );
    const instance = new FileDiff({
      disableFileHeader: true,
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'dark',
    });
    const renderArgs = { fileDiff, containerWrapper: wrapper };
    instance.render(renderArgs);
    const container = wrapper.querySelector('diffs-container');
    expect(container?.shadowRoot?.textContent).toContain('newValue');

    // an equal-props re-render alone serves the cached DOM
    instance.render(renderArgs);
    expect(
      container?.shadowRoot?.querySelector('[data-refresh-marker]')
    ).toBeNull();

    // after a switch, the same equal-props re-render must repaint through
    // the new implementation, in the same container (no remount)
    const marked: CodeHighlighter = {
      ...chameleHighlighter,
      name: 'marked-chamele',
      codeToHast(code, options) {
        // mark the line nodes; the render path extracts them from pre > code
        const root = chameleHighlighter.codeToHast(code, options);
        const pre = root.children[0];
        if (pre?.type !== 'element') return root;
        for (const codeNode of pre.children) {
          if (codeNode.type !== 'element') continue;
          for (const line of codeNode.children) {
            if (line.type === 'element') {
              line.properties['data-refresh-marker'] = '';
            }
          }
        }
        return root;
      },
    };
    setHighlighter(marked);
    instance.render(renderArgs);
    expect(wrapper.querySelector('diffs-container')).toBe(container);
    expect(
      container?.shadowRoot?.querySelector('[data-refresh-marker]')
    ).not.toBeNull();
    expect(container?.shadowRoot?.textContent).toContain('newValue');

    setHighlighter(chameleHighlighter);
    instance.cleanUp();
    wrapper.remove();
  });
});
