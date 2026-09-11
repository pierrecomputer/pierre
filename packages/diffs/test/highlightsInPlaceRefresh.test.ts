import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { FileDiff } from '../src/components/FileDiff';
import type { CodeHighlighter } from '../src/highlighter/code_highlighter';
import { setHighlighter } from '../src/highlighter/code_highlighter';
import { shikiHighlighter } from '../src/highlighter/shiki_highlighter';
import highlightsHighlighter from '../src/highlights';
import { parseDiffFromFile } from '../src/utils/parseDiffFromFile';
import { installDom } from './domHarness';

let dom: ReturnType<typeof installDom>;

beforeAll(async () => {
  dom = installDom();
  setHighlighter(highlightsHighlighter);
  await highlightsHighlighter.load({
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
      ...highlightsHighlighter,
      name: 'marked-highlights',
      codeToTokens(code, options) {
        const result = highlightsHighlighter.codeToTokens(code, options);
        for (const line of result.tokens)
          for (const token of line) {
            token.htmlAttrs = { ...token.htmlAttrs, 'data-refresh-marker': '' };
          }
        return result;
      },
    };
    setHighlighter(marked);
    instance.render(renderArgs);
    expect(wrapper.querySelector('diffs-container')).toBe(container);
    expect(
      container?.shadowRoot?.querySelector('[data-refresh-marker]')
    ).not.toBeNull();
    expect(container?.shadowRoot?.textContent).toContain('newValue');

    setHighlighter(highlightsHighlighter);
    instance.cleanUp();
    wrapper.remove();
  });
});
