import { isPrimaryModifier } from './platform';
import type { Range, TextDocument } from './textDocument';
import { h } from './utils';

export type SearchKind =
  | 'findNext'
  | 'findPrevious'
  | 'findAll'
  | 'replace'
  | 'replaceAll';

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
  initialMatch?: [number, number];
  postSearch: (
    kind: SearchKind,
    match: [number, number],
    retainFocus?: boolean
  ) => void;
  getCurrentSearchRange: () => Range | undefined;
  onClose: () => void;
}

export class SearchPanelWidget {
  #textDocument: TextDocument<unknown>;
  #container: HTMLDivElement;
  #inputElement: HTMLInputElement;
  #matchesElement: HTMLDivElement;
  #searchParams: SearchParams = {
    text: '',
    replaceText: '',
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  };
  #allMatches: [number, number][] = [];

  constructor(options: SearchPanelOptions) {
    const {
      textDocument,
      containerElement,
      defaultQuery,
      initialMatch,
      postSearch,
      getCurrentSearchRange,
      onClose,
    } = options;

    const close = () => {
      this.cleanup();
      onClose();
    };

    const updateSearchParam = <K extends keyof SearchParams>(
      key: K,
      value: SearchParams[K]
    ) => {
      this.#searchParams[key] = value;
      updateAllMatches();
      this.updateMatches();
    };

    const updateAllMatches = () => {
      this.#allMatches =
        this.#searchParams.text !== ''
          ? this.#textDocument.search('findAll', this.#searchParams)
          : [];
      this.#container
        .querySelectorAll<HTMLElement>('[data-disabled]')
        .forEach((element) => {
          element.dataset.disabled = String(this.#allMatches.length === 0);
        });
    };

    const search = (kind: SearchKind, retainFocus?: boolean) => {
      const matches = this.#textDocument.search(
        kind,
        this.#searchParams,
        getCurrentSearchRange()
      );
      if (matches.length === 0) {
        return;
      }
      const firstMatch = matches[0];
      this.updateMatches(firstMatch);
      postSearch(kind, firstMatch, retainFocus);
    };

    const settingsSwitch = h('div', {
      dataset: { icon: 'settings' },
      title: 'Settings',
      innerHTML: `<svg width="16" height="16" viewBox="0 0 20 20">
      <line x1="3" y1="6" x2="10" y2="6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
      <circle cx="12.5" cy="6" r="2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle>
      <line x1="15" y1="6" x2="17" y2="6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
      <line x1="17" y1="14" x2="10" y2="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
      <circle cx="7.5" cy="14" r="2.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle>
      <line x1="5" y1="14" x2="3" y2="14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
    </svg>
    `,
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
              checked: this.#searchParams.caseSensitive,
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
              checked: this.#searchParams.wholeWord,
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
              checked: this.#searchParams.regex,
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
        closeSettingsPanelTimeout = setTimeout(() => {
          settingsPanel.replaceWith(settingsSwitch);
        }, 500);
      },
      onmouseenter: () => {
        clearTimeout(closeSettingsPanelTimeout);
        closeSettingsPanelTimeout = undefined;
      },
    });

    let closeSettingsPanelTimeout: ReturnType<typeof setTimeout> | undefined;

    this.#textDocument = textDocument;
    this.#searchParams.text = defaultQuery;

    this.#inputElement = h('input', {
      type: 'text',
      placeholder: 'Search',
      dataset: 'search',
      value: defaultQuery,
      oninput: (e: Event) => {
        this.#searchParams.text = (e.target as HTMLInputElement).value;
        updateAllMatches();
        this.updateMatches();
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          search('findNext', true);
        } else if (e.key === 'f' && isPrimaryModifier(e)) {
          // prevent the default browser search panel open behavior
          e.preventDefault();
        }
      },
    });
    this.#matchesElement = h('div', { dataset: 'matches' });
    this.#container = h('div', {
      dataset: 'searchPanel',
      children: [
        h('div', {
          dataset: 'searchPanelRow',
          children: [
            h('div', {
              dataset: { icon: 'search' },
              innerHTML: `<svg width="16" height="16" viewBox="0 0 20 20">
                <line x1="16.5" y1="16.5" x2="12.0355" y2="12.0355" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
                <circle cx="8.5" cy="8.5" r="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></circle>
                </svg>
              `,
            }),
            this.#inputElement,
            this.#matchesElement,
            h('div', {
              dataset: { icon: 'arrow-up', disabled: 'true' },
              title: 'Previous',
              innerHTML: `<svg width="14" height="14" viewBox="0 0 20 20">
                <polyline points="12.5 3.5 6 10 12.5 16.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polyline>
                </svg>
              `,
              onclick: () => {
                search('findPrevious');
              },
            }),
            h('div', {
              dataset: { icon: 'arrow-down', disabled: 'true' },
              title: 'Next',
              innerHTML: `<svg width="14" height="14" viewBox="0 0 20 20">
                <polyline points="7.5 16.5 14 10 7.5 3.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></polyline>
                </svg>
              `,
              onclick: () => {
                search('findNext');
              },
            }),
            h('div', { dataset: 'spacer' }),
            settingsSwitch,
            h('div', {
              dataset: { icon: 'close' },
              title: 'Close',
              innerHTML: `<svg width="16" height="16" viewBox="0 0 20 20">
                <line x1="5" y1="5" x2="15" y2="15" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
                <line x1="5" y1="15" x2="15" y2="5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"></line>
                </svg>
              `,
              onclick: close,
            }),
          ],
        }),
      ],
    });
    containerElement.before(this.#container);

    requestAnimationFrame(() => {
      if (initialMatch !== undefined) {
        updateAllMatches();
        this.updateMatches(initialMatch);
      }
      this.#inputElement.select();
    });
  }

  updateMatches(currentMatch: [number, number] = this.#allMatches[0]): void {
    const allMatches = this.#allMatches;
    const searchText = this.#searchParams.text;

    if (searchText === '') {
      this.#matchesElement.textContent = '';
      delete this.#matchesElement.dataset.noMatches;
      return;
    }

    if (allMatches.length === 0) {
      this.#matchesElement.textContent = 'No results';
      this.#matchesElement.dataset.noMatches = '';
    } else {
      delete this.#matchesElement.dataset.noMatches;
      const index = allMatches.findIndex(
        (m) => m[0] === currentMatch[0] && m[1] === currentMatch[1]
      );
      this.#matchesElement.textContent =
        index !== -1 ? `${index + 1} of ${allMatches.length}` : 'No results';
    }
  }

  focus(): void {
    this.#inputElement.select();
  }

  cleanup(): void {
    this.#container.remove();
  }
}
