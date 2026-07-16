import { type MatchRange, type SearchParams } from '../search';
import { resolveFindAgainShortcut } from './command';
import { isPrimaryModifier } from './platform';
import { getEditorIconSvg, type SVGSpriteNames } from './sprite';
import { h } from './utils';

export type SearchPanelMode = 'find' | 'replace';

export type { MatchRange, SearchParams } from '../search';

export interface SearchPanelReplaceHandlers<TMatch> {
  replaceMatch: (
    match: TMatch,
    searchParams: SearchParams
  ) => TMatch | undefined;
  replaceAll: (matches: TMatch[], searchParams: SearchParams) => void;
}

export interface SearchPanelOptions<TMatch = MatchRange> {
  containerElement: HTMLElement;
  defaultQuery: string;
  mode?: SearchPanelMode;
  initialMatch?: TMatch;
  search: (searchParams: SearchParams) => TMatch[];
  isSameMatch?: (a: TMatch, b: TMatch) => boolean;
  scrollToMatch: (nextMatch: TMatch, retainFocus: boolean) => void;
  replace?: SearchPanelReplaceHandlers<TMatch>;
  onUpdate: (
    matches: TMatch[],
    options?: { syncSelection?: boolean }
  ) => TMatch | undefined;
  onClose: () => void;
}

export class SearchPanelWidget<TMatch = MatchRange> {
  #container: HTMLDivElement;
  #inputElement: HTMLInputElement;
  #updateMatches?: (options?: { syncSelection?: boolean }) => void;
  #applyMode?: (mode: SearchPanelMode) => void;
  #navigate?: (findPrevious: boolean) => void;
  #close?: () => void;

  constructor(options: SearchPanelOptions<TMatch>) {
    const {
      containerElement,
      defaultQuery,
      mode = 'find',
      initialMatch,
      search,
      isSameMatch = Object.is,
      scrollToMatch,
      replace,
      onUpdate,
      onClose,
    } = options;

    const canReplace = replace !== undefined;
    const normalizeMode = (nextMode: SearchPanelMode): SearchPanelMode =>
      canReplace ? nextMode : 'find';

    const searchParams: SearchParams = {
      text: defaultQuery,
      replaceText: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };

    const matches = {
      all: [] as TMatch[],
      current: undefined as TMatch | undefined,
    };

    const getSearchParamsSnapshot = (): SearchParams => ({ ...searchParams });
    const getMatchIndex = (match: TMatch): number =>
      matches.all.findIndex((candidate) => isSameMatch(candidate, match));

    // Default to the empty-query "no results" state so it shows on open before
    // any search runs.
    const matchResultElement = h('div', {
      dataset: { matches: '', noMatches: '' },
      textContent: 'No results',
    });

    const updateCurrentMatch = (currentMatch: TMatch | undefined) => {
      if (currentMatch === undefined) {
        matchResultElement.textContent = `${matches.all.length} results`;
      } else {
        const index = getMatchIndex(currentMatch);
        matchResultElement.textContent = `${index + 1} of ${matches.all.length}`;
      }
      matches.current = currentMatch;
    };

    const updateMatches = (options?: { syncSelection?: boolean }) => {
      matches.all =
        searchParams.text !== '' ? search(getSearchParamsSnapshot()) : [];
      const noMatches = matches.all.length === 0;
      prevButton.disabled = noMatches;
      nextButton.disabled = noMatches;

      // An empty query and a query with zero hits are the same "no results"
      // state. Both push an empty match set through onUpdate so the editor
      // drops #matches and clears the painted highlights.
      if (noMatches) {
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
      let nextMatch: TMatch | undefined = allMatches[0];
      if (allMatches.length > 0) {
        const currentIndex =
          matches.current !== undefined ? getMatchIndex(matches.current) : -1;
        if (findPrevious && currentIndex === -1) {
          nextMatch = allMatches.at(-1);
        } else if (findPrevious) {
          nextMatch = allMatches.at(currentIndex - 1);
          nextMatch ??= allMatches.at(-1);
        } else if (currentIndex === -1) {
          nextMatch = allMatches[0];
        } else {
          nextMatch = allMatches[currentIndex + 1] ?? allMatches[0];
        }
      }
      if (nextMatch !== undefined) {
        updateCurrentMatch(nextMatch);
        scrollToMatch(nextMatch, retainFocus);
      }
      matches.current = nextMatch;
    };
    // Keep focus in the panel when stepping through matches from the inputs.
    this.#navigate = (findPrevious: boolean) =>
      findNextMatch(findPrevious, true);

    const replaceCurrentMatch = () => {
      if (
        replace === undefined ||
        searchParams.text === '' ||
        matches.all.length === 0
      ) {
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

      const nextMatch = replace.replaceMatch(
        currentMatch,
        getSearchParamsSnapshot()
      );

      // Collapse after the replacement so the next search pass advances.
      if (nextMatch !== undefined) {
        scrollToMatch(nextMatch, true);
      }
      matches.current = undefined;
      updateMatches();
    };

    const replaceAllMatches = () => {
      if (
        replace === undefined ||
        searchParams.text === '' ||
        matches.all.length === 0
      ) {
        return;
      }

      replace.replaceAll(matches.all.slice(), getSearchParamsSnapshot());
      matches.current = undefined;
      updateMatches();
    };

    const close = () => {
      this.cleanup();
      onClose();
    };
    this.#close = close;

    // Shared builder for the panel's icon controls. Every clickable control is a
    // real <button> so it gets focus, keyboard activation, and native disabled
    // handling for free; `getEditorIconSvg` marks the glyph aria-hidden, so the
    // accessible name comes from `label` (also used as the hover title).
    const iconButton = (opts: {
      icon: SVGSpriteNames;
      label: string;
      size?: number;
      dataset?: Record<string, string>;
      onClick: () => void;
    }) =>
      h('button', {
        type: 'button',
        title: opts.label,
        ariaLabel: opts.label,
        dataset: { searchIcon: '', ...opts.dataset },
        innerHTML: getEditorIconSvg(opts.icon, opts.size ?? 16),
        onclick: opts.onClick,
      });

    // Builds an always-visible icon button that toggles one boolean search
    // option (case/whole-word/regex). The button reflects its on/off state via
    // `aria-pressed` so the stylesheet can highlight it and assistive tech can
    // announce it.
    const makeToggle = (
      icon: SVGSpriteNames,
      title: string,
      key: 'caseSensitive' | 'wholeWord' | 'regex'
    ) => {
      const button = iconButton({
        icon,
        label: title,
        size: 14,
        onClick: () => {
          const next = !searchParams[key];
          button.ariaPressed = String(next);
          updateSearchParam(key, next);
        },
      });
      button.ariaPressed = String(searchParams[key]);
      return button;
    };

    const caseSensitiveToggle = makeToggle(
      'case',
      'Match Case',
      'caseSensitive'
    );
    const wholeWordToggle = makeToggle('whole-word', 'Whole Word', 'wholeWord');
    const regexToggle = makeToggle('regex', 'Regexp', 'regex');

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
        if (e.isComposing || e.keyCode === 229) {
          return;
        }
        const findAgain = resolveFindAgainShortcut(e);
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          findNextMatch(e.shiftKey, true);
        } else if (findAgain !== undefined) {
          // Override the native browser find-again shortcut so cmd+g steps to
          // the next match and cmd+shift+g to the previous one.
          e.preventDefault();
          findNextMatch(findAgain === 'previous', true);
        } else if (
          isPrimaryModifier(e) &&
          (e.key === 'f' || e.code === 'KeyF')
        ) {
          // Prevent the default browser search panel and switch the panel mode
          // in place (cmd+f -> find, cmd+opt+f -> find/replace).
          e.preventDefault();
          applyMode(e.altKey ? 'replace' : 'find');
        }
      },
    });

    // The three search-option toggles are overlaid on the right edge of the
    // find input instead of sitting beside it.
    const searchTogglesElement = h('div', {
      dataset: 'searchToggles',
      children: [caseSensitiveToggle, wholeWordToggle, regexToggle],
    });

    const findInputBox = h('div', {
      dataset: { inputBox: '', find: '' },
      children: [this.#inputElement, searchTogglesElement],
    });

    // Held so the no-results state can toggle their native disabled flag.
    const prevButton = iconButton({
      icon: 'arrow-up',
      label: 'Previous',
      onClick: () => {
        findNextMatch(true);
      },
    });
    const nextButton = iconButton({
      icon: 'arrow-down',
      label: 'Next',
      onClick: () => {
        findNextMatch();
      },
    });
    prevButton.disabled = true;
    nextButton.disabled = true;

    const navElement = h('div', {
      dataset: 'searchNav',
      children: [prevButton, nextButton],
    });

    const closeElement = iconButton({
      icon: 'close',
      label: 'Close',
      onClick: close,
      dataset: { searchClose: '' },
    });

    const gridChildren: Node[] = [findInputBox];
    if (canReplace) {
      const replaceInputElement = h('input', {
        type: 'text',
        placeholder: 'Replace',
        dataset: 'replace',
        value: '',
        oninput: (e: Event) => {
          searchParams.replaceText = (e.target as HTMLInputElement).value;
        },
        onkeydown: (e: KeyboardEvent) => {
          if (e.isComposing || e.keyCode === 229) {
            return;
          }
          const findAgain = resolveFindAgainShortcut(e);
          if (e.key === 'Escape') {
            e.preventDefault();
            close();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            replaceCurrentMatch();
          } else if (findAgain !== undefined) {
            e.preventDefault();
            findNextMatch(findAgain === 'previous', true);
          }
        },
      });

      // The replace input and its action buttons are tagged as replace cells so
      // they can be hidden together when the panel is in find-only mode.
      const replaceInputBox = h('div', {
        dataset: { inputBox: '', replace: '', replaceCell: '' },
        children: [replaceInputElement],
      });

      const replaceActionsElement = h('div', {
        dataset: { replaceActions: '', replaceCell: '' },
        children: [
          iconButton({
            icon: 'replace',
            label: 'Replace',
            onClick: replaceCurrentMatch,
          }),
          iconButton({
            icon: 'replace-all',
            label: 'Replace All',
            onClick: replaceAllMatches,
          }),
        ],
      });

      gridChildren.push(replaceInputBox, replaceActionsElement);
    }

    gridChildren.push(matchResultElement, navElement, closeElement);

    // Cells are positioned by CSS grid-template-areas (see editor.css), so DOM
    // order here only drives tab/reading order, not layout. Keep the replace
    // input directly after the find input (and its toggles) so Tab walks
    // find -> replace before reaching the nav arrows and close button.
    const gridElement = h('div', {
      dataset: { searchGrid: '', mode: normalizeMode(mode) },
      children: gridChildren,
    });

    // Toggles the panel between find and find/replace modes by showing or
    // hiding the replace cells, then returns focus to the find input.
    const applyMode = (next: SearchPanelMode) => {
      gridElement.dataset.mode = normalizeMode(next);
      this.#inputElement.focus();
      this.#inputElement.select();
    };
    this.#applyMode = applyMode;

    this.#container = h('div', {
      dataset: 'searchPanel',
      children: [
        h('div', {
          dataset: 'editorWidget',
          children: [gridElement],
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

  navigate(findPrevious: boolean): void {
    this.#navigate?.(findPrevious);
  }

  updateMatches(options?: { syncSelection?: boolean }): void {
    this.#updateMatches?.(options);
  }

  setMode(mode: SearchPanelMode): void {
    this.#applyMode?.(mode);
  }

  // Tears the panel down the way the close button and Escape-in-input do:
  // removes the DOM and runs onClose so the editor clears its match highlights.
  // Prefer this over cleanup() for any user-initiated dismissal.
  close(): void {
    this.#close?.();
  }

  // DOM-only teardown. Does NOT run onClose, so it leaves the editor's match
  // highlights in place; only use it when the caller clears that state itself
  // (e.g. a full editor reset). User-initiated dismissals should call close().
  cleanup(): void {
    this.#container.remove();
  }
}
