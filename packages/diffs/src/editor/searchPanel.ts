import { buildSearchReplacementText } from './pieceTable';
import { isPrimaryModifier } from './platform';
import { getEditorIconSvg, type SVGSpriteNames } from './sprite';
import type { ResolvedTextEdit, TextDocument } from './textDocument';
import { h } from './utils';

export type MatchRange = [startOffset: number, endOffset: number];

export interface SearchParams {
  text: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface SearchPanelOptions {
  textDocument: TextDocument<unknown>;
  containerElement: HTMLElement;
  defaultQuery: string;
  initialMatch?: MatchRange;
  scrollToMatch: (nextMatch: MatchRange, retainFocus: boolean) => void;
  applyReplace: (edits: ResolvedTextEdit[]) => void;
  onUpdate: (
    matches: MatchRange[],
    options?: { syncSelection?: boolean }
  ) => MatchRange | undefined;
  onClose: () => void;
}

export class SearchPanelWidget {
  #container: HTMLDivElement;
  #inputElement: HTMLInputElement;
  #updateMatches?: (options?: { syncSelection?: boolean }) => void;

  constructor(options: SearchPanelOptions) {
    const {
      textDocument,
      containerElement,
      defaultQuery,
      initialMatch,
      scrollToMatch,
      applyReplace,
      onUpdate,
      onClose,
    } = options;

    const searchParams: SearchParams = {
      text: defaultQuery,
      replaceText: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };

    const matches = {
      all: [] as MatchRange[],
      current: undefined as MatchRange | undefined,
    };

    const matchResultElement = h('div', { dataset: 'matches' });
    const updateMatches = (options?: { syncSelection?: boolean }) => {
      matches.all =
        searchParams.text !== '' ? textDocument.search(searchParams) : [];
      this.#container
        .querySelectorAll<HTMLElement>('[data-disabled]')
        .forEach((element) => {
          element.dataset.disabled = String(matches.all.length === 0);
        });

      if (searchParams.text === '') {
        matchResultElement.textContent = '';
        delete matchResultElement.dataset.noMatches;
        return;
      }

      if (matches.all.length === 0) {
        matchResultElement.textContent = 'No results';
        matchResultElement.dataset.noMatches = '';
        matches.current = undefined;
        onUpdate([]);
        return;
      }

      delete matchResultElement.dataset.noMatches;
      if (options?.syncSelection === false) {
        const currentMatch = onUpdate(matches.all, { syncSelection: false });
        updateCurrentMatch(currentMatch);
        return;
      }

      updateCurrentMatch(onUpdate(matches.all));
    };
    this.#updateMatches = updateMatches;

    const updateCurrentMatch = (currentMatch: MatchRange | undefined) => {
      if (currentMatch === undefined) {
        matchResultElement.textContent = `${matches.all.length} results`;
      } else {
        const [start, end] = currentMatch;
        const index = matches.all.findIndex(
          (m) => m[0] === start && m[1] === end
        );
        matchResultElement.textContent = `${index + 1} of ${matches.all.length}`;
      }
      matches.current = currentMatch;
    };

    const updateSearchParam = <K extends keyof SearchParams>(
      key: K,
      value: SearchParams[K]
    ) => {
      searchParams[key] = value;
      updateMatches();
    };

    const findNextMatch = (
      findPrevious: boolean = false,
      retainFocus: boolean = false
    ) => {
      const allMatches = matches.all;
      let nextMatch: MatchRange | undefined = allMatches[0];
      if (allMatches.length > 0) {
        if (findPrevious) {
          const searchOffset = matches.current?.[0] ?? 0;
          nextMatch = allMatches.at(-1);
          for (const m of allMatches) {
            if (m[1] <= searchOffset) {
              nextMatch = m;
            } else {
              break;
            }
          }
        } else {
          const searchOffset = matches.current?.[1] ?? 0;
          for (const m of allMatches) {
            if (m[0] >= searchOffset) {
              nextMatch = m;
              break;
            }
          }
        }
      }
      if (nextMatch !== undefined) {
        updateCurrentMatch(nextMatch);
        scrollToMatch(nextMatch, retainFocus);
      }
      matches.current = nextMatch;
    };

    const buildReplacementEdit = (
      matchStart: number,
      matchEnd: number
    ): ResolvedTextEdit => ({
      start: matchStart,
      end: matchEnd,
      text: buildSearchReplacementText(
        (offset) => textDocument.positionAt(offset),
        (position) => textDocument.offsetAt(position),
        (line) => textDocument.getLineText(line),
        searchParams,
        matchStart,
        matchEnd
      ),
    });

    const replace = () => {
      if (searchParams.text === '' || matches.all.length === 0) {
        return;
      }

      let currentMatch = matches.current;
      if (currentMatch === undefined) {
        findNextMatch(false, true);
        currentMatch = matches.current;
        if (currentMatch === undefined) {
          return;
        }
      }

      const [start, end] = currentMatch;
      const edit = buildReplacementEdit(start, end);
      applyReplace([edit]);

      // Collapse after the replacement so the next search pass advances.
      scrollToMatch([start + edit.text.length, start + edit.text.length], true);
      matches.current = undefined;
      updateMatches();
    };

    const replaceAll = () => {
      if (searchParams.text === '' || matches.all.length === 0) {
        return;
      }

      applyReplace(
        matches.all.map(([start, end]) => buildReplacementEdit(start, end))
      );
      matches.current = undefined;
      updateMatches();
    };

    const close = () => {
      this.cleanup();
      onClose();
    };

    // Builds an always-visible icon button that toggles one boolean search
    // option (case/whole-word/regex). The button reflects its on/off state via
    // the `data-active` attribute so the stylesheet can highlight it.
    const makeToggle = (
      icon: SVGSpriteNames,
      title: string,
      key: 'caseSensitive' | 'wholeWord' | 'regex'
    ) => {
      const button = h('div', {
        dataset: { icon, active: String(searchParams[key]) },
        title,
        innerHTML: getEditorIconSvg(icon),
        onclick: () => {
          const next = !searchParams[key];
          button.dataset.active = String(next);
          updateSearchParam(key, next);
        },
      });
      return button;
    };

    const caseSensitiveToggle = makeToggle(
      'case',
      'Match Case',
      'caseSensitive'
    );
    const wholeWordToggle = makeToggle('whole-word', 'Whole Word', 'wholeWord');
    const regexToggle = makeToggle('regex', 'Regexp', 'regex');

    const replaceInputElement = h('input', {
      type: 'text',
      placeholder: 'Replace',
      dataset: 'replace',
      value: '',
      oninput: (e: Event) => {
        searchParams.replaceText = (e.target as HTMLInputElement).value;
      },
    });

    this.#inputElement = h('input', {
      type: 'text',
      placeholder: 'Search',
      dataset: 'search',
      value: defaultQuery,
      oninput: (e: Event) => {
        searchParams.text = (e.target as HTMLInputElement).value;
        matches.current = undefined;
        updateMatches();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          findNextMatch(false, true);
        } else if (e.key === 'f' && isPrimaryModifier(e)) {
          // prevent the default browser search panel open behavior
          e.preventDefault();
        }
      },
    });

    this.#container = h('div', {
      dataset: 'searchPanel',
      children: [
        h('div', {
          dataset: 'editorWidget',
          children: [
            h('div', {
              dataset: 'searchPanelRow',
              children: [
                h('div', {
                  dataset: 'inputBox',
                  children: [this.#inputElement, matchResultElement],
                }),
                caseSensitiveToggle,
                wholeWordToggle,
                regexToggle,
                h('div', { dataset: 'divider' }),
                h('div', {
                  dataset: { icon: 'arrow-up', disabled: 'true' },
                  title: 'Previous',
                  innerHTML: getEditorIconSvg('arrow-up'),
                  onclick: () => {
                    findNextMatch(true);
                  },
                }),
                h('div', {
                  dataset: { icon: 'arrow-down', disabled: 'true' },
                  title: 'Next',
                  innerHTML: getEditorIconSvg('arrow-down'),
                  onclick: () => {
                    findNextMatch();
                  },
                }),
                h('div', {
                  dataset: { icon: 'close' },
                  title: 'Close',
                  innerHTML: getEditorIconSvg('close'),
                  onclick: close,
                }),
              ],
            }),
            h('div', {
              dataset: { searchPanelRow: '', disabled: 'true' },
              children: [
                h('div', {
                  dataset: 'inputBox',
                  children: [replaceInputElement],
                }),
                h('div', {
                  dataset: { icon: 'replace' },
                  title: 'Replace',
                  innerHTML: getEditorIconSvg('replace'),
                  onclick: () => {
                    replace();
                  },
                }),
                h('div', {
                  dataset: { icon: 'replace-all' },
                  title: 'Replace All',
                  innerHTML: getEditorIconSvg('replace-all'),
                  onclick: () => {
                    replaceAll();
                  },
                }),
                h('div', {
                  dataset: 'spacing',
                }),
              ],
            }),
          ],
        }),
      ],
    });

    matches.current = initialMatch;
    containerElement.before(this.#container);

    requestAnimationFrame(() => {
      if (initialMatch !== undefined) {
        updateMatches();
      } else {
        onUpdate([]);
      }
      this.#inputElement.select();
    });
  }

  focus(): void {
    this.#inputElement.focus();
  }

  updateMatches(options?: { syncSelection?: boolean }): void {
    this.#updateMatches?.(options);
  }

  cleanup(): void {
    this.#container.remove();
  }
}
