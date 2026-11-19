import { UNSAFE_CSS_ATTRIBUTE } from '../constants';
import {
  resolveFindAgainShortcut,
  resolveSearchShortcut,
} from '../editor/command';
import {
  getEditorIconSvg,
  type SVGSpriteNames,
  SVGSpriteSheet,
} from '../editor/sprite';
import { h } from '../editor/utils';
import { i18n } from '../i18n/I18n';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import { wrapUnsafeCSS } from '../utils/cssWrappers';
import {
  type MatchRange,
  type SearchOptionDefaults,
  type SearchPanelMode,
  type SearchPanelState,
  type SearchParams,
} from './index';
import searchPanelCSS from './SearchPanelWidget.css?inline';

export interface SearchResult<TMatch> {
  matches: TMatch[];
  preferredMatch?: TMatch;
  searching?: boolean;
}

export interface SearchPanelReplaceHandlers<TMatch> {
  replaceMatch: (
    match: TMatch,
    searchParams: SearchParams
  ) => TMatch | undefined;
  replaceAll: (matches: TMatch[], searchParams: SearchParams) => void;
}

export interface SearchPanelOptions<TMatch = MatchRange> {
  containerElement: HTMLElement;
  unsafeCSS?: string;
  defaultQuery: string;
  defaults?: SearchOptionDefaults;
  mode?: SearchPanelMode;
  search: (searchParams: SearchParams) => SearchResult<TMatch>;
  scrollToMatch: (nextMatch: TMatch, retainFocus: boolean) => void;
  /**
   * Whether the current match was made current without being scrolled to. The
   * next find step then goes to it instead of the match after it.
   */
  currentMatchNeedsReveal?: () => boolean;
  replace?: SearchPanelReplaceHandlers<TMatch>;
  /** Query text or matching options changed; excludes replacement text and refreshes. */
  onQueryChange?: () => void;
  /**
   * Called with every new list of matches. Returns the index of the current
   * match in that list, or undefined when no match is current.
   */
  onUpdate: (
    result: SearchResult<TMatch>,
    options?: { skipNavigation?: boolean }
  ) => number | undefined;
  /** Reports the panel state on open and after every change. */
  onStateChange?: (state: SearchPanelState) => void;
  /**
   * Called before each find step, so the host can bring its matches up to
   * date first.
   */
  onBeforeNavigate?: () => void;
  onClose: () => void;
}

export class SearchPanelWidget<TMatch = MatchRange> {
  #host: HTMLDivElement;
  #widgetElement: HTMLDivElement;
  #inputElement: HTMLInputElement;
  #initializeMatches: () => void;
  #mount?: () => void;
  #closed = false;
  #updateMatches?: (options?: { skipNavigation?: boolean }) => void;
  #applyMode?: (mode: SearchPanelMode) => void;
  #setReplaceHandlers?: (
    handlers: SearchPanelReplaceHandlers<TMatch> | undefined
  ) => void;
  #navigate?: (findPrevious: boolean) => void;
  #setQuery?: (text: string) => void;
  #hasReplaceHandlers?: () => boolean;
  #close?: () => void;

  constructor(options: SearchPanelOptions<TMatch>) {
    const {
      containerElement,
      unsafeCSS,
      defaultQuery,
      defaults,
      mode = 'find',
      search,
      scrollToMatch,
      currentMatchNeedsReveal,
      replace,
      onQueryChange,
      onUpdate,
      onStateChange,
      onBeforeNavigate,
      onClose,
    } = options;

    let replaceHandlers = replace;
    let requestedMode = mode;
    const normalizeMode = (nextMode: SearchPanelMode): SearchPanelMode =>
      replaceHandlers != null ? nextMode : 'find';

    const searchParams: SearchParams = {
      text: defaultQuery,
      replaceText: '',
      caseSensitive: defaults?.caseSensitive === true,
      wholeWord: defaults?.wholeWord === true,
      regex: defaults?.regex === true,
    };

    const matches: { all: TMatch[]; currentIndex: number | undefined } = {
      all: [],
      currentIndex: undefined,
    };

    const getSearchParamsSnapshot = (): SearchParams => ({ ...searchParams });

    const emitState = () => {
      if (onStateChange == null || this.#closed) {
        return;
      }
      onStateChange({
        ...getSearchParamsSnapshot(),
        mode: normalizeMode(requestedMode),
        canReplace: replaceHandlers != null,
        matchCount: matches.all.length,
        searching,
        currentMatchIndex: matches.currentIndex,
      });
    };

    // A query the panel opens with is searching until its first results
    // arrive.
    let searching = defaultQuery !== '';

    const matchResultElement = h('div', { dataset: { matches: '' } });
    // Keep the count slot empty when there are no matches. Searching remains
    // visible because it communicates an in-progress result rather than an
    // empty result.
    const showNoMatches = () => {
      matchResultElement.textContent = searching ? i18n.t('searching') : '';
      matchResultElement.toggleAttribute('data-no-matches', !searching);
    };
    // Shown on open, before any search runs.
    showNoMatches();

    const updateCurrentMatch = (currentIndex: number | undefined) => {
      matchResultElement.textContent =
        currentIndex != null
          ? i18n.t('searchResultPosition', {
              index: currentIndex + 1,
              count: matches.all.length,
            })
          : i18n.t('searchResultCount', { count: matches.all.length });
      matches.currentIndex = currentIndex;
    };

    let matchesUpdated = false;
    const updateMatches = (options?: { skipNavigation?: boolean }) => {
      matchesUpdated = true;
      const result =
        searchParams.text !== ''
          ? search(getSearchParamsSnapshot())
          : { matches: [] };
      matches.all = result.matches;
      searching = result.searching === true;
      replaceButton.disabled = searching;
      replaceAllButton.disabled = searching;
      const noMatches = matches.all.length === 0;
      prevButton.disabled = noMatches;
      nextButton.disabled = noMatches;

      // An empty query and a query with zero hits are the same "no results"
      // state. Both push an empty match set through onUpdate so the editor
      // drops #matches and clears the painted highlights.
      if (noMatches) {
        showNoMatches();
        matches.currentIndex = undefined;
        onUpdate(result, options);
      } else {
        delete matchResultElement.dataset.noMatches;
        updateCurrentMatch(onUpdate(result, options));
      }
      emitState();
    };
    this.#updateMatches = updateMatches;

    const updateSearchParam = <
      K extends Exclude<keyof SearchParams, 'replaceText'>,
    >(
      key: K,
      value: SearchParams[K]
    ) => {
      if (searchParams[key] !== value) {
        onQueryChange?.();
      }
      searchParams[key] = value;
      updateMatches();
    };

    const findNextMatch = (
      findPrevious: boolean = false,
      retainFocus: boolean = false
    ) => {
      onBeforeNavigate?.();
      // The host reports to its own callbacks while it catches up, and one of
      // them may close the panel.
      if (this.#closed) {
        return;
      }
      const { all, currentIndex } = matches;
      if (all.length > 0) {
        let nextIndex: number;
        if (currentIndex == null) {
          nextIndex = findPrevious ? all.length - 1 : 0;
        } else if (currentMatchNeedsReveal?.() === true) {
          nextIndex = currentIndex;
        } else {
          nextIndex =
            (currentIndex + (findPrevious ? -1 : 1) + all.length) % all.length;
        }
        updateCurrentMatch(nextIndex);
        scrollToMatch(all[nextIndex], retainFocus);
      } else {
        matches.currentIndex = undefined;
      }
      emitState();
    };
    // Keep focus in the panel when stepping through matches from the inputs.
    this.#navigate = (findPrevious: boolean) =>
      findNextMatch(findPrevious, true);

    const replaceCurrentMatch = () => {
      const replace = replaceHandlers;
      if (
        searching ||
        replace === undefined ||
        searchParams.text === '' ||
        matches.all.length === 0
      ) {
        return;
      }

      const currentIndex = matches.currentIndex ?? 0;
      if (matches.currentIndex == null) findNextMatch(false, true);
      const currentMatch = matches.all[currentIndex];

      const nextMatch = replace.replaceMatch(
        currentMatch,
        getSearchParamsSnapshot()
      );

      // Collapse after the replacement so the next search pass advances.
      if (nextMatch !== undefined) {
        scrollToMatch(nextMatch, true);
      }
      matches.currentIndex = undefined;
      updateMatches();
    };

    const replaceAllMatches = () => {
      const replace = replaceHandlers;
      if (
        searching ||
        replace === undefined ||
        searchParams.text === '' ||
        matches.all.length === 0
      ) {
        return;
      }

      replace.replaceAll(matches.all.slice(), getSearchParamsSnapshot());
      matches.currentIndex = undefined;
      updateMatches();
    };

    // The host hears about the close while the panel is still in the page, so
    // it can tell whether the panel held focus.
    const close = () => {
      onClose();
      this.cleanup();
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
      i18n.t('matchCase'),
      'caseSensitive'
    );
    const wholeWordToggle = makeToggle(
      'whole-word',
      i18n.t('wholeWord'),
      'wholeWord'
    );
    const regexToggle = makeToggle(
      'regex',
      i18n.t('regularExpression'),
      'regex'
    );

    this.#inputElement = h('input', {
      type: 'text',
      placeholder: i18n.t('searchPlaceholder'),
      dataset: 'search',
      value: defaultQuery,
      oninput: (e: Event) => {
        matches.currentIndex = undefined;
        updateSearchParam('text', (e.target as HTMLInputElement).value);
      },
      onkeydown: (e: KeyboardEvent) => {
        if (e.isComposing || e.keyCode === 229) {
          return;
        }
        const shortcut = resolveSearchShortcut(e);
        if (e.key === 'Escape') {
          e.preventDefault();
          close();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          findNextMatch(e.shiftKey, true);
        } else if (shortcut === 'next' || shortcut === 'previous') {
          // Override the native browser find-again shortcut so cmd+g steps to
          // the next match and cmd+shift+g to the previous one.
          e.preventDefault();
          findNextMatch(shortcut === 'previous', true);
        } else if (shortcut != null) {
          // Prevent the default browser search panel and switch the panel mode
          // in place (cmd+f -> find, cmd+opt+f -> find/replace).
          e.preventDefault();
          applyMode(shortcut);
        }
      },
    });

    // Hosts replace the query programmatically; the next focus() selects it so
    // typing replaces it like a seeded default query.
    this.#setQuery = (text: string) => {
      if (this.#inputElement.value === text) {
        return;
      }
      this.#inputElement.value = text;
      matches.currentIndex = undefined;
      updateSearchParam('text', text);
    };

    // Search options occupy the grid cell that previously held the count.
    const searchTogglesElement = h('div', {
      dataset: 'searchToggles',
      children: [caseSensitiveToggle, wholeWordToggle, regexToggle],
    });

    // The result count shares the fixed-width find box with the input. Its
    // intrinsic width reduces the input's available space without moving any
    // controls as counts gain digits.
    const findInputBox = h('div', {
      dataset: { inputBox: '', find: '' },
      children: [this.#inputElement, matchResultElement],
    });

    // Held so the no-results state can toggle their native disabled flag.
    const prevButton = iconButton({
      icon: 'arrow-up',
      label: i18n.t('previousMatch'),
      onClick: () => {
        findNextMatch(true);
      },
    });
    const nextButton = iconButton({
      icon: 'arrow-down',
      label: i18n.t('nextMatch'),
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
      label: i18n.t('closeSearch'),
      onClick: close,
      dataset: { searchClose: '' },
    });

    const replaceInputElement = h('input', {
      type: 'text',
      placeholder: i18n.t('replacePlaceholder'),
      dataset: 'replace',
      value: '',
      oninput: (e: Event) => {
        searchParams.replaceText = (e.target as HTMLInputElement).value;
        emitState();
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

    const replaceButton = iconButton({
      icon: 'replace',
      label: i18n.t('replaceMatch'),
      onClick: replaceCurrentMatch,
    });
    const replaceAllButton = iconButton({
      icon: 'replace-all',
      label: i18n.t('replaceAllMatches'),
      onClick: replaceAllMatches,
    });
    const replaceActionsElement = h('div', {
      dataset: { replaceActions: '', replaceCell: '' },
      children: [replaceButton, replaceAllButton],
    });

    // Keep the replace row reachable without its keyboard shortcut.
    const replaceToggleElement = iconButton({
      icon: 'chevron',
      label: i18n.t('toggleReplace'),
      dataset: { replaceToggle: '' },
      onClick: () => {
        if (gridElement.dataset.mode === 'replace') {
          applyMode('find');
        } else {
          applyMode('replace');
          replaceInputElement.focus();
        }
      },
    });

    // Cells are positioned by CSS grid-template-areas (see SearchPanelWidget.css), so DOM
    // order here only drives tab/reading order, not layout. Keep the replace
    // input directly after the find input so Tab walks
    // chevron -> find -> replace before reaching the nav arrows and close
    // button.
    const gridElement = h('div', {
      dataset: { searchGrid: '', mode: normalizeMode(mode) },
      children: [
        replaceToggleElement,
        findInputBox,
        replaceInputBox,
        replaceActionsElement,
        searchTogglesElement,
        navElement,
        closeElement,
      ],
    });

    // Puts the panel's mode, and whether it can replace at all, on the grid
    // and the replace toggle. The stylesheet lays the grid out from these.
    const syncReplaceControls = () => {
      const canReplace = replaceHandlers != null;
      const currentMode = normalizeMode(requestedMode);
      gridElement.dataset.mode = currentMode;
      gridElement.toggleAttribute('data-can-replace', canReplace);
      replaceToggleElement.hidden = !canReplace;
      replaceToggleElement.ariaExpanded = String(currentMode === 'replace');
    };
    syncReplaceControls();

    this.#hasReplaceHandlers = () => replaceHandlers != null;
    this.#setReplaceHandlers = (handlers) => {
      replaceHandlers = handlers;
      syncReplaceControls();
      emitState();
    };

    // Toggles the panel between find and find/replace modes by showing or
    // hiding the replace cells, then returns focus to the find input.
    const applyMode = (next: SearchPanelMode) => {
      requestedMode = next;
      syncReplaceControls();
      this.#inputElement.focus();
      this.#inputElement.select();
      emitState();
    };
    this.#applyMode = applyMode;

    this.#host = h('div', {
      dataset: 'searchPanel',
    });
    const shadowRoot = this.#host.attachShadow({ mode: 'open' });
    const spriteContainer = document.createElement('div');
    spriteContainer.innerHTML = SVGSpriteSheet;
    const spriteElement = spriteContainer.firstElementChild;
    if (spriteElement instanceof SVGElement) {
      shadowRoot.appendChild(spriteElement);
    }
    h('style', { textContent: searchPanelCSS }, shadowRoot);
    if (unsafeCSS != null) {
      h(
        'style',
        { textContent: wrapUnsafeCSS(unsafeCSS) },
        shadowRoot
      ).setAttribute(UNSAFE_CSS_ATTRIBUTE, '');
    }

    this.#widgetElement = h('div', {
      dataset: 'editorWidget',
      children: [gridElement],
    });
    h(
      'div',
      {
        dataset: 'searchPanel',
        children: [this.#widgetElement],
      },
      shadowRoot
    );

    // Hosts install the panel before its initial results can be delivered.
    // An earlier input or refresh has already done that work; closing the
    // panel also makes this deferred update obsolete. Select the initial query
    // on mount so this frame never changes the user's later focus or input
    // caret.
    this.#initializeMatches = () => {
      if (matchesUpdated || this.#closed) {
        return;
      }
      updateMatches();
    };

    this.#mount = () => {
      containerElement.before(this.#host);
      this.#inputElement.select();
      emitState();
      queueRender(this.#initializeMatches);
    };
  }

  // Inserts the panel and reports its initial state. Separate from the
  // constructor so the host holds the panel before any callback can close it.
  mount(): void {
    this.#mount?.();
  }

  getHostElement(): HTMLDivElement {
    return this.#host;
  }

  getBounds(): DOMRect {
    return this.#widgetElement.getBoundingClientRect();
  }

  hasQuery(): boolean {
    return this.#inputElement.value !== '';
  }

  hasReplaceHandlers(): boolean {
    return this.#hasReplaceHandlers?.() === true;
  }

  focus(): void {
    this.#inputElement.focus();
  }

  navigate(findPrevious: boolean): void {
    this.#initializeMatches();
    if (this.#closed) {
      return;
    }
    this.#navigate?.(findPrevious);
  }

  setQuery(text: string): void {
    this.#setQuery?.(text);
  }

  updateMatches(options?: { skipNavigation?: boolean }): void {
    this.#updateMatches?.(options);
  }

  setMode(mode: SearchPanelMode): void {
    this.#applyMode?.(mode);
  }

  setReplaceHandlers(
    handlers: SearchPanelReplaceHandlers<TMatch> | undefined
  ): void {
    this.#setReplaceHandlers?.(handlers);
  }

  // Tears the panel down the way the close button and Escape-in-input do: runs
  // onClose so the editor clears its match highlights, then removes the DOM.
  // Prefer this over cleanup() for any user-initiated dismissal.
  close(): void {
    this.#close?.();
  }

  // DOM-only teardown. Does NOT run onClose, so it leaves the editor's match
  // highlights in place; only use it when the caller clears that state itself
  // (e.g. a full editor reset). User-initiated dismissals should call close().
  cleanup(): void {
    this.#closed = true;
    dequeueRender(this.#initializeMatches);
    this.#host.remove();
  }
}
