import { resolveFindAgainShortcut } from './command';
import { buildSearchReplacementText } from './pieceTable';
import { isPrimaryModifier } from './platform';
import { getEditorIconSvg, type SVGSpriteNames } from './sprite';
import type { TextDocument } from './textDocument';
import type { ResolvedTextEdit } from './types';
import { h } from './utils';

export type MatchRange = [startOffset: number, endOffset: number];

export type SearchPanelMode = 'find' | 'replace';

export interface SearchParams {
  text: string;
  replaceText: string;
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

/** Search state pushed to the search panel after every change. */
export interface SearchPanelState extends SearchParams {
  mode: SearchPanelMode;
  /** Number of matches for the current query. */
  matchCount: number;
  /** Zero-based index of the current match, or undefined when none is current. */
  currentMatchIndex: number | undefined;
}

/** Actions a search panel uses to drive the editor's search. */
export interface SearchPanelContext {
  /**
   * Updates the query, search options, replace text, or mode. Changing the
   * query or a search option re-runs the search.
   */
  setState(patch: Partial<SearchParams & { mode: SearchPanelMode }>): void;
  /** Selects the next or previous match, wrapping around the document. */
  navigate(direction: 'next' | 'previous'): void;
  /** Replaces the current match (or the next one) and moves past it. */
  replace(): void;
  /** Replaces every match as a single undo entry. */
  replaceAll(): void;
  /** Closes the panel and clears the match highlights. */
  close(): void;
}

/** Search panel UI returned from the editor's `renderSearchPanel` option. */
export interface SearchPanelView {
  /**
   * Panel root. The editor slots it over the top of the code from the light
   * DOM, so page styles apply. Position it with its own margins.
   */
  element: HTMLElement;
  /** Called with the latest search state after every change. */
  update(state: SearchPanelState): void;
  /**
   * Focuses the search input and selects its text. Called a frame after the
   * panel opens, when a find shortcut is pressed while it is open, and when an
   * editor re-render moves focus out of the panel.
   */
  focus(): void;
  /** Called once when the panel closes, after `element` is removed. */
  cleanup?(): void;
}

export interface SearchPanelOptions {
  textDocument: TextDocument;
  /** The panel is inserted before this element (the editor's `<pre>`). */
  containerElement: HTMLElement;
  /**
   * A custom panel from the editor's `renderSearchPanel` option and the light
   * DOM host its element is slotted from. Omit to use the built-in panel.
   */
  customPanel?: {
    render: (search: SearchPanelContext) => SearchPanelView;
    host: HTMLElement;
  };
  defaultQuery: string;
  mode?: SearchPanelMode;
  initialMatch?: MatchRange;
  scrollToMatch: (nextMatch: MatchRange) => void;
  applyReplace: (edits: ResolvedTextEdit[]) => void;
  onUpdate: (
    matches: MatchRange[],
    options?: { syncSelection?: boolean }
  ) => MatchRange | undefined;
  onClose: () => void;
}

const SEARCH_PANEL_SLOT_NAME = 'search-panel';

// One open find/replace session: the query, its matches, and the current
// match. The panel UI only renders the pushed state and acts through a
// SearchPanelContext, so the built-in panel and a custom `renderSearchPanel`
// share the same search, navigation, and replace behavior.
export class SearchPanel {
  #options: SearchPanelOptions;
  #params: SearchParams;
  #mode: SearchPanelMode;
  #matches: MatchRange[] = [];
  #currentMatch: MatchRange | undefined;
  #view?: SearchPanelView;
  #container: HTMLDivElement;
  #closed = false;
  #needsInitialSearch = true;

  constructor(options: SearchPanelOptions) {
    const { defaultQuery, mode = 'find', initialMatch } = options;
    this.#options = options;
    this.#params = {
      text: defaultQuery,
      replaceText: '',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    };
    this.#mode = mode;
    this.#currentMatch = initialMatch;
    this.#container = h('div', { dataset: 'searchPanel' });
  }

  // Mount only after the editor owns this session: renderer and update
  // callbacks may initialize its state or close it immediately.
  mount(): void {
    if (this.#closed) {
      return;
    }
    const { containerElement, customPanel } = this.#options;

    const render = customPanel?.render ?? createDefaultSearchPanel;
    const view = render(this.#createContext());
    if (this.#closed) {
      view.element.remove();
      view.cleanup?.();
      return;
    }
    this.#view = view;
    if (customPanel === undefined) {
      this.#container.append(this.#view.element);
    } else {
      // A custom panel stays in the light DOM and is projected into the panel
      // position through a slot, so the page's styles reach it.
      this.#view.element.slot = SEARCH_PANEL_SLOT_NAME;
      this.#container.append(h('slot', { name: SEARCH_PANEL_SLOT_NAME }));
      customPanel.host.append(this.#view.element);
    }
    containerElement.before(this.#container);
    this.#emit();

    // Focus before the initial search, but preserve any query and navigation
    // the custom view has already initialized before this frame.
    requestAnimationFrame(() => {
      if (this.#closed) {
        return;
      }
      view.focus();
      if (this.#needsInitialSearch) {
        this.updateMatches();
      }
    });
  }

  // Whether keyboard focus is inside the panel UI. The built-in panel lives in
  // the editor's shadow root and a custom one in the page, so read focus from
  // whichever root the panel element belongs to.
  hasFocus(): boolean {
    const element = this.#view?.element;
    if (element === undefined) {
      return false;
    }
    const { activeElement } = element.getRootNode() as Document | ShadowRoot;
    return activeElement != null && element.contains(activeElement);
  }

  // Returns focus to the panel when an editor re-render moved it elsewhere.
  restoreFocus(): void {
    if (!this.hasFocus()) {
      this.#view?.focus();
    }
  }

  // Selects the next or previous match relative to the current one, wrapping
  // around the ends of the document.
  navigate(direction: 'next' | 'previous'): void {
    const matches = this.#matches;
    let nextMatch: MatchRange | undefined = matches[0];
    if (direction === 'previous') {
      const searchOffset = this.#currentMatch?.[0] ?? 0;
      nextMatch = matches.at(-1);
      for (const match of matches) {
        if (match[1] <= searchOffset) {
          nextMatch = match;
        } else {
          break;
        }
      }
    } else {
      const searchOffset = this.#currentMatch?.[1] ?? 0;
      for (const match of matches) {
        if (match[0] >= searchOffset) {
          nextMatch = match;
          break;
        }
      }
    }
    if (nextMatch === undefined) {
      return;
    }
    this.#currentMatch = nextMatch;
    this.#options.scrollToMatch(nextMatch);
    this.#emit();
  }

  // Re-runs the search and lets the editor pick the current match. After a
  // document edit, pass `syncSelection: false` so the selection stays put.
  updateMatches(options?: { syncSelection?: boolean }): void {
    if (this.#closed || this.#view === undefined) {
      return;
    }
    this.#needsInitialSearch = false;
    const { textDocument, onUpdate } = this.#options;
    this.#matches =
      this.#params.text !== '' ? textDocument.search(this.#params) : [];
    // An empty query and a query with zero hits are the same "no results"
    // state. Both push an empty match set so the editor drops its highlights.
    this.#currentMatch =
      this.#matches.length === 0
        ? onUpdate([])
        : onUpdate(this.#matches, options);
    this.#emit();
  }

  // Switches between find and find/replace for the editor's find shortcuts,
  // then returns focus to the panel.
  setMode(mode: SearchPanelMode): void {
    this.#mode = mode;
    this.#emit();
    this.#view?.focus();
  }

  // Tears the panel down the way the close button and Escape-in-input do:
  // removes the UI and runs onClose so the editor clears its match highlights.
  // Prefer this over cleanup() for any user-initiated dismissal.
  close(): void {
    if (this.#closed) {
      return;
    }
    this.cleanup();
    this.#options.onClose();
  }

  // UI-only teardown. Does NOT run onClose, so it leaves the editor's match
  // highlights in place; only use it when the caller clears that state itself
  // (e.g. a full editor reset). User-initiated dismissals should call close().
  cleanup(): void {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    this.#container.remove();
    const view = this.#view;
    this.#view = undefined;
    view?.element.remove();
    view?.cleanup?.();
  }

  // The actions handed to the panel UI. Calls that arrive after the panel
  // closed are ignored.
  #createContext(): SearchPanelContext {
    const ifOpen = (action: () => void) => {
      if (!this.#closed) {
        action();
      }
    };
    return {
      setState: (patch) => ifOpen(() => this.#setState(patch)),
      navigate: (direction) => ifOpen(() => this.navigate(direction)),
      replace: () => ifOpen(() => this.#replace()),
      replaceAll: () => ifOpen(() => this.#replaceAll()),
      close: () => this.close(),
    };
  }

  #setState({
    mode,
    ...params
  }: Partial<SearchParams & { mode: SearchPanelMode }>): void {
    const previous = this.#params;
    const next = { ...previous, ...params };
    this.#params = next;
    this.#mode = mode ?? this.#mode;
    // Renderer-time preferences are applied before the first search, once
    // the returned view is mounted and can receive state updates.
    if (this.#view === undefined) {
      return;
    }
    if (
      next.text !== previous.text ||
      next.caseSensitive !== previous.caseSensitive ||
      next.wholeWord !== previous.wholeWord ||
      next.regex !== previous.regex
    ) {
      this.updateMatches();
    } else {
      this.#emit();
    }
  }

  #replace(): void {
    if (this.#matches.length === 0) {
      return;
    }
    if (this.#currentMatch === undefined) {
      this.navigate('next');
    }
    const currentMatch = this.#currentMatch;
    if (currentMatch === undefined) {
      return;
    }

    const [start, end] = currentMatch;
    const edit = this.#buildReplacementEdit(start, end);
    this.#options.applyReplace([edit]);

    // Collapse after the replacement so the next search pass advances.
    const caret = start + edit.text.length;
    this.#options.scrollToMatch([caret, caret]);
    this.#currentMatch = undefined;
    this.updateMatches();
  }

  #replaceAll(): void {
    if (this.#matches.length === 0) {
      return;
    }
    this.#options.applyReplace(
      this.#matches.map(([start, end]) =>
        this.#buildReplacementEdit(start, end)
      )
    );
    this.#currentMatch = undefined;
    this.updateMatches();
  }

  #buildReplacementEdit(
    matchStart: number,
    matchEnd: number
  ): ResolvedTextEdit {
    const { textDocument } = this.#options;
    return {
      start: matchStart,
      end: matchEnd,
      text: buildSearchReplacementText(
        (offset) => textDocument.positionAt(offset),
        (position) => textDocument.offsetAt(position),
        (line) => textDocument.getLineText(line),
        this.#params,
        matchStart,
        matchEnd
      ),
    };
  }

  // Pushes the current search state to the panel UI.
  #emit(): void {
    const currentMatch = this.#currentMatch;
    const currentMatchIndex =
      currentMatch === undefined
        ? -1
        : this.#matches.findIndex(
            ([start, end]) =>
              start === currentMatch[0] && end === currentMatch[1]
          );
    this.#view?.update({
      ...this.#params,
      mode: this.#mode,
      matchCount: this.#matches.length,
      currentMatchIndex:
        currentMatchIndex === -1 ? undefined : currentMatchIndex,
    });
  }
}

// Pierre's built-in find/replace panel. It renders inside the editor's shadow
// root, where editor.css styles it, and acts only through `search`, the same
// context a custom `renderSearchPanel` receives.
export function createDefaultSearchPanel(
  search: SearchPanelContext
): SearchPanelView {
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
        search.setState({ [key]: button.ariaPressed !== 'true' });
      },
    });
    return button;
  };

  const caseSensitiveToggle = makeToggle('case', 'Match Case', 'caseSensitive');
  const wholeWordToggle = makeToggle('whole-word', 'Whole Word', 'wholeWord');
  const regexToggle = makeToggle('regex', 'Regexp', 'regex');

  const focus = () => {
    inputElement.focus();
    inputElement.select();
  };

  const replaceInputElement = h('input', {
    type: 'text',
    placeholder: 'Replace',
    dataset: 'replace',
    value: '',
    oninput: (e: Event) => {
      search.setState({ replaceText: (e.target as HTMLInputElement).value });
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      const findAgain = resolveFindAgainShortcut(e);
      if (e.key === 'Escape') {
        e.preventDefault();
        search.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        search.replace();
      } else if (findAgain !== undefined) {
        e.preventDefault();
        search.navigate(findAgain);
      }
    },
  });

  const inputElement = h('input', {
    type: 'text',
    placeholder: 'Search',
    dataset: 'search',
    value: '',
    oninput: (e: Event) => {
      search.setState({ text: (e.target as HTMLInputElement).value });
    },
    onkeydown: (e: KeyboardEvent) => {
      if (e.isComposing || e.keyCode === 229) {
        return;
      }
      const findAgain = resolveFindAgainShortcut(e);
      if (e.key === 'Escape') {
        e.preventDefault();
        search.close();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        search.navigate(e.shiftKey ? 'previous' : 'next');
      } else if (findAgain !== undefined) {
        // Override the native browser find-again shortcut so cmd+g steps to
        // the next match and cmd+shift+g to the previous one.
        e.preventDefault();
        search.navigate(findAgain);
      } else if (isPrimaryModifier(e) && (e.key === 'f' || e.code === 'KeyF')) {
        // Prevent the default browser search panel and switch the panel mode
        // in place (cmd+f -> find, cmd+opt+f -> find/replace).
        e.preventDefault();
        search.setState({ mode: e.altKey ? 'replace' : 'find' });
        focus();
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
    children: [inputElement, searchTogglesElement],
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
        onClick: search.replace,
      }),
      iconButton({
        icon: 'replace-all',
        label: 'Replace All',
        onClick: search.replaceAll,
      }),
    ],
  });

  const matchResultElement = h('div', { dataset: 'matches' });

  // Held so the no-results state can toggle their native disabled flag.
  const prevButton = iconButton({
    icon: 'arrow-up',
    label: 'Previous',
    onClick: () => search.navigate('previous'),
  });
  const nextButton = iconButton({
    icon: 'arrow-down',
    label: 'Next',
    onClick: () => search.navigate('next'),
  });

  const navElement = h('div', {
    dataset: 'searchNav',
    children: [prevButton, nextButton],
  });

  const closeElement = iconButton({
    icon: 'close',
    label: 'Close',
    onClick: search.close,
    dataset: { searchClose: '' },
  });

  // Cells are positioned by CSS grid-template-areas (see editor.css), so DOM
  // order here only drives tab/reading order, not layout. Keep the replace
  // input directly after the find input (and its toggles) so Tab walks
  // find -> replace before reaching the nav arrows and close button.
  const gridElement = h('div', {
    dataset: 'searchGrid',
    children: [
      findInputBox,
      replaceInputBox,
      replaceActionsElement,
      matchResultElement,
      navElement,
      closeElement,
    ],
  });

  return {
    element: h('div', { dataset: 'editorWidget', children: [gridElement] }),
    update(state) {
      const { matchCount, currentMatchIndex } = state;
      // The mode shows or hides the replace cells.
      gridElement.dataset.mode = state.mode;
      if (inputElement.value !== state.text) {
        inputElement.value = state.text;
      }
      if (replaceInputElement.value !== state.replaceText) {
        replaceInputElement.value = state.replaceText;
      }
      caseSensitiveToggle.ariaPressed = String(state.caseSensitive);
      wholeWordToggle.ariaPressed = String(state.wholeWord);
      regexToggle.ariaPressed = String(state.regex);
      matchResultElement.textContent =
        matchCount === 0
          ? 'No results'
          : currentMatchIndex === undefined
            ? `${matchCount} results`
            : `${currentMatchIndex + 1} of ${matchCount}`;
      matchResultElement.toggleAttribute('data-no-matches', matchCount === 0);
      prevButton.disabled = matchCount === 0;
      nextButton.disabled = matchCount === 0;
    },
    focus,
  };
}
