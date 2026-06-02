import { isPrimaryModifier } from './platform';
import { getEditorIconSvg } from './sprite';
import type { TextDocument } from './textDocument';
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
  onUpdate: (matches: MatchRange[]) => MatchRange | undefined;
  onClose: () => void;
}

export class SearchPanelWidget {
  #container: HTMLDivElement;
  #inputElement: HTMLInputElement;
  #closeSettingsPanelTimeout: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SearchPanelOptions) {
    const {
      textDocument,
      containerElement,
      defaultQuery,
      initialMatch,
      scrollToMatch,
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
    const updateMatches = () => {
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
      } else {
        delete matchResultElement.dataset.noMatches;
        updateCurrentMatch(onUpdate(matches.all));
        return;
      }

      matches.current = undefined;
      onUpdate([]);
    };

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

    const close = () => {
      this.cleanup();
      onClose();
    };

    const settingsSwitch = h('div', {
      dataset: { icon: 'settings' },
      title: 'Settings',
      innerHTML: getEditorIconSvg('settings'),
      onclick: () => {
        settingsSwitch.replaceWith(settingsPanel);
      },
    });
    const settingsPanel = h('div', {
      dataset: 'settings',
      children: [
        h('label', {
          dataset: 'checkbox',
          children: [
            h('input', {
              type: 'checkbox',
              checked: searchParams.caseSensitive,
              onchange: (e: Event) => {
                updateSearchParam(
                  'caseSensitive',
                  (e.target as HTMLInputElement).checked
                );
              },
            }),
            'Match Case',
          ],
        }),
        h('label', {
          dataset: 'checkbox',
          children: [
            h('input', {
              type: 'checkbox',
              checked: searchParams.wholeWord,
              onchange: (e: Event) => {
                updateSearchParam(
                  'wholeWord',
                  (e.target as HTMLInputElement).checked
                );
              },
            }),
            'Whole Word',
          ],
        }),
        h('label', {
          dataset: 'checkbox',
          children: [
            h('input', {
              type: 'checkbox',
              checked: searchParams.regex,
              onchange: (e: Event) => {
                updateSearchParam(
                  'regex',
                  (e.target as HTMLInputElement).checked
                );
              },
            }),
            'Regexp',
          ],
        }),
      ],
      onmouseleave: () => {
        this.#closeSettingsPanelTimeout = setTimeout(() => {
          this.#closeSettingsPanelTimeout = undefined;
          settingsPanel.replaceWith(settingsSwitch);
        }, 500);
      },
      onmouseenter: () => {
        clearTimeout(this.#closeSettingsPanelTimeout);
        this.#closeSettingsPanelTimeout = undefined;
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
          dataset: 'searchPanelRow',
          children: [
            h('div', {
              dataset: { icon: 'search' },
              innerHTML: getEditorIconSvg('search'),
            }),
            this.#inputElement,
            matchResultElement,
            h('div', {
              dataset: { icon: 'arrow-up', disabled: 'true' },
              title: 'Previous',
              innerHTML: getEditorIconSvg('arrow-up', 14),
              onclick: () => {
                findNextMatch(true);
              },
            }),
            h('div', {
              dataset: { icon: 'arrow-down', disabled: 'true' },
              title: 'Next',
              innerHTML: getEditorIconSvg('arrow-down', 14),
              onclick: () => {
                findNextMatch();
              },
            }),
            h('div', { dataset: 'spacer' }),
            settingsSwitch,
            h('div', {
              dataset: { icon: 'close' },
              title: 'Close',
              innerHTML: getEditorIconSvg('close'),
              onclick: close,
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

  cleanup(): void {
    if (this.#closeSettingsPanelTimeout !== undefined) {
      clearTimeout(this.#closeSettingsPanelTimeout);
      this.#closeSettingsPanelTimeout = undefined;
    }
    this.#container.remove();
  }
}
