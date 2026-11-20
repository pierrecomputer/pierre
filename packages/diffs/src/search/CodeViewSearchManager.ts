import type {
  CodeView,
  CodeViewContextItem,
  CodeViewDiffItemContext,
  CodeViewOpenSearchOptions,
  CodeViewOptions,
  CodeViewSearchScope,
  LineAnchor,
  LineScrollPosition,
  PendingLineTarget,
  ScrollAnchor,
} from '../components/CodeView';
import { DEFAULT_COLLAPSED_CONTEXT_THRESHOLD } from '../constants';
import { resolveSearchShortcut } from '../editor/command';
import { getSearchQueryFromSelection } from '../editor/selection';
import {
  BACKGROUND_TASK_BUDGET_MS,
  dequeueBackgroundTask,
  queueBackgroundTask,
} from '../managers/BackgroundTaskQueue';
import {
  dequeueRender,
  queueRender,
} from '../managers/UniversalRenderingManager';
import type { FileDiffMetadata } from '../types';
import { getComposedSelectionRange } from '../utils/getComposedSelectionRange';
import { getLineIndexForDiff } from '../utils/getLineIndexForDiff';
import {
  areCodeViewSearchMatchesEqual,
  areOptionalCodeViewSearchMatchesEqual,
  type CodeViewSearchItem,
  type CodeViewSearchMatch,
  CodeViewSearchScan,
} from './codeViewSearch';
import {
  type MatchRange,
  MAX_SEARCH_MATCHES,
  type SearchParams,
} from './index';
import { revealMatchHorizontally } from './revealMatchHorizontally';
import {
  SearchHighlighter,
  type SearchHighlightRange,
} from './SearchHighlighter';
import {
  type SearchPanelReplaceHandlers,
  SearchPanelWidget,
  type SearchResult,
} from './SearchPanelWidget';

// Where the view was scrolled to: the item or line at its top and how far
// down the viewport it sat, or the very top of the view.
export type CodeViewSearchViewport = ScrollAnchor | 'top';

export interface CodeViewSearchState {
  // Where to go back to: the view's place before find's automatic jumps.
  originalViewport: CodeViewSearchViewport | undefined;
  // Where find's own scroll last left the view.
  matchViewport: CodeViewSearchViewport | undefined;
  scope: { itemId: string } | undefined;
  matches: CodeViewSearchMatch[];
  scan: CodeViewSearchScan | undefined;
  // Tracks navigation that find state.
  // `jump`: a new query's first match is not known yet. Select it and scroll
  // to it when it is.
  // `select`: the same, but the user or the host scrolled after the query, so
  // select it without scrolling.
  // `reveal`: the current match is selected but the view never reached it.
  // The next find step scrolls to it.
  pendingNavigation: 'jump' | 'select' | 'reveal' | undefined;
  current: CodeViewSearchMatch | undefined;
  // Once a result requires scrolling, center subsequent navigation until the
  // query or scope changes. Background match refreshes preserve this choice.
  centerNavigation: boolean;
  pendingHorizontalReveal: boolean;
  // Where the current match is drawn inside its item, measured while it is
  // rendered. Undefined when it is not rendered or has not been measured.
  currentPosition: LineScrollPosition | undefined;
}

// Find and replace for a CodeView: the panel, the search over the view's
// items, the painted matches, and stepping from match to match. The view
// creates one and tells it when items, focus or the scroll position change.
export class CodeViewSearchManager<LAnnotation, Caret> {
  public readonly state: CodeViewSearchState = {
    originalViewport: undefined,
    matchViewport: undefined,
    scope: undefined,
    matches: [],
    scan: undefined,
    pendingNavigation: undefined,
    current: undefined,
    centerNavigation: false,
    pendingHorizontalReveal: false,
    currentPosition: undefined,
  };
  private panel: SearchPanelWidget<CodeViewSearchMatch> | undefined;
  private matchesDirty = false;
  private highlighter: SearchHighlighter | undefined;

  constructor(private readonly view: CodeView<LAnnotation, Caret>) {}

  public open(options?: CodeViewOpenSearchOptions): void {
    const { view } = this;
    const { container } = view;
    const root = view.getContainerElement();
    if (root == null || container == null) {
      return;
    }
    const { mode = 'replace', scope = 'focused', query } = options ?? {};

    this.setScope(this.resolveScope(scope));
    let { panel } = this;
    if (panel != null) {
      if (query != null) {
        panel.setQuery(query);
      }
      panel.setMode(mode);
      panel.focus();
      return;
    }

    this.highlighter ??= SearchHighlighter.create(container.ownerDocument);
    panel = new SearchPanelWidget<CodeViewSearchMatch>({
      // Ahead of a CodeView header, so the panel stays pinned to the top of the
      // scroll view instead of starting below the header.
      containerElement: view.getHeaderElement() ?? container,
      themeCSS: view.getSearchPanelThemeCSS(),
      unsafeCSS: view.options.unsafeCSS,
      defaultQuery: query ?? this.getQueryFromScope(),
      defaults: view.options.searchOptions?.defaults,
      mode,
      replace: this.getReplaceHandlers(),
      onStateChange: (state) => {
        // While a refresh is pending the counts still describe the previous
        // scope or contents; the refresh reports the settled state.
        if (this.matchesDirty) {
          return;
        }
        const { onSearchStateChange } = view.options;
        onSearchStateChange?.(state);
      },
      onQueryChange: () => {
        if (this.panel?.hasQuery() === false) {
          this.restoreViewport();
        }
        this.invalidateScan();
        this.setResults(this.state.matches, undefined);
        this.state.pendingNavigation = undefined;
        this.state.centerNavigation = false;
      },
      search: (searchParams) => this.search(searchParams),
      scrollToMatch: (match) => {
        this.forgetViewport();
        this.state.pendingNavigation = undefined;
        this.scrollToMatch(match);
      },
      currentMatchNeedsReveal: () => {
        const { current, pendingNavigation } = this.state;
        return (
          pendingNavigation === 'reveal' &&
          current != null &&
          !this.isMatchInView(current)
        );
      },
      onUpdate: this.updateResults,
      onBeforeNavigate: this.settleCutOffMatch,
      onClose: () => {
        this.close();
      },
    });
    this.panel = panel;
    // The panel runs its first search a frame from now. A scroll before then
    // still comes after the query.
    if (panel.hasQuery()) {
      this.state.pendingNavigation = 'jump';
    }
    panel.mount();
    // The state callback may close the panel while it mounts.
    if (this.panel !== panel) {
      return;
    }
    root.addEventListener('click', this.handleMatchClick);
    root.ownerDocument.addEventListener('focusin', this.handleFocusIn);
    panel.getHostElement().addEventListener('focusout', this.handlePanelBlur);
    // The panel overlays the code without blocking clicks on it.
    panel.getHostElement().dataset.searchPanelOverlay = '';
    panel.focus();
  }

  public close(): void {
    this.restoreViewport();
    this.closeInPlace();
  }

  // Closes find at the current scroll position.
  public closeInPlace(): void {
    const { panel } = this;
    const panelHadFocus = this.isPanelFocused();
    const { scope } = this.state;
    this.removeListeners();
    this.panel = undefined;
    this.resetState();
    if (panel == null) {
      return;
    }
    panel.cleanup();
    if (panelHadFocus) {
      this.view.restoreFocus(scope?.itemId);
    }
    const { onSearchStateChange } = this.view.options;
    onSearchStateChange?.(undefined);
  }

  public isOpen(): boolean {
    return this.panel != null;
  }

  public navigate(direction: 'next' | 'previous'): void {
    this.flushMatches();
    this.panel?.navigate(direction === 'previous');
  }

  // Capture search keys at the root ahead of child editors so Escape and
  // find-again act on CodeView's panel instead of the editor's selection
  // handling, and navigation uses CodeView's line scrolling instead of the
  // editor's caret scrolling. Editors CodeView creates run with
  // `searchPanel: 'host'`, so the find shortcuts belong to CodeView whether or
  // not it handles them here.
  public handleKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) {
      return;
    }

    if (event.key === 'Escape' && this.panel !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      this.close();
      return;
    }

    const shortcut = resolveSearchShortcut(event);
    if (shortcut === 'next' || shortcut === 'previous') {
      if (this.panel == null) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      this.navigate(shortcut);
      return;
    }

    if (
      shortcut != null &&
      this.view.options.searchOptions?.disableShortcuts !== true
    ) {
      // Prevent browser find and open CodeView's panel with the focused scope.
      // Both find shortcuts open the same panel: the replace row follows the
      // scope rather than the key.
      event.preventDefault();
      event.stopPropagation();
      this.open();
    }
  };

  // Whether an event came from inside the find panel.
  public ownsEvent(event: Event): boolean {
    const host = this.panel?.getHostElement();
    return host != null && event.composedPath().includes(host);
  }

  // The user scrolled the view by hand, so find stops moving it.
  public userScrolled(): void {
    this.state.pendingHorizontalReveal = false;
    this.keepView();
  }

  // Items were added to the end of the view's list.
  public addItems(count: number): void {
    const { scan, scope } = this.state;
    if (scope == null) scan?.addItems(count);
    this.markMatchesDirty();
  }

  // An item is about to be removed from the view's list.
  public removeItem(itemId: string): void {
    const { scan } = this.state;
    const position = this.getItemPosition(itemId);
    if (position != null) scan?.removeItem(position);
  }

  // An item got a new id.
  public renameItem(oldId: string, newId: string): void {
    const { state } = this;
    if (state.scope?.itemId === oldId) {
      state.scope = { itemId: newId };
    }
    state.originalViewport = renameViewport(
      state.originalViewport,
      oldId,
      newId
    );
    state.matchViewport = renameViewport(state.matchViewport, oldId, newId);
    this.invalidateScan();
    this.markMatchesDirty();
  }

  // The view's options changed. Searches again when the change affects which
  // text is searched.
  public optionsChanged(
    previousOptions: CodeViewOptions<LAnnotation, Caret>,
    nextOptions: CodeViewOptions<LAnnotation, Caret>
  ): void {
    this.syncTheme();
    if (hasSearchIndexOptionChanged(previousOptions, nextOptions)) {
      this.invalidateScan();
      this.markMatchesDirty();
    }
  }

  public syncTheme(): void {
    this.panel?.setThemeCSS(this.view.getSearchPanelThemeCSS());
  }

  // An item's editor drew its rows again.
  public editorRendered(itemId: string): void {
    this.queueHighlightPaint();
    if (
      this.state.scope?.itemId === itemId &&
      this.panel?.hasReplaceHandlers() === false
    ) {
      this.markMatchesDirty();
    }
  }

  private isPanelFocused(): boolean {
    return this.panel?.getHostElement().shadowRoot?.activeElement != null;
  }

  private setScope(scope: CodeViewSearchState['scope']): void {
    if (this.state.scope?.itemId === scope?.itemId) {
      return;
    }
    this.invalidateScan();
    this.state.scope = scope;
    this.state.pendingNavigation = undefined;
    this.state.centerNavigation = false;
    this.markMatchesDirty();
  }

  // Editor callbacks identify the owner. Document focus is only needed to
  // clear scope when focus leaves the panel or moves to non-editor content.
  private handleFocusIn = (event: FocusEvent): void => {
    if (
      this.view.shouldFixContainerFocus &&
      event.composedPath()[0] === this.view.getContainerElement()
    ) {
      return;
    }
    this.syncFocus();
  };

  // Native blur can finish before the next target receives focus. Resolve it
  // on the next frame so moving into the panel does not briefly widen search.
  private handlePanelBlur = (): void => {
    queueRender(this.syncFocus);
  };

  public syncFocus = (): void => {
    if (this.panel == null || this.isPanelFocused()) {
      return;
    }
    this.setScope(
      this.view.focusedEditor != null
        ? { itemId: this.view.focusedEditor.id }
        : undefined
    );
  };

  // A click on highlighted text picks the match without scrolling to it.
  private handleMatchClick = (event: MouseEvent): void => {
    const { highlighter, state, view } = this;
    const { current, matches, scan } = state;
    if (scan == null || highlighter == null || this.ownsEvent(event)) return;
    const row = getClickedCodeRow(event);
    if (row == null) return;
    const root = row.getRootNode();
    if (
      !(root instanceof ShadowRoot) ||
      getComposedSelectionRange(root)?.collapsed === false
    ) {
      return;
    }
    const item = view
      .getRenderedItems()
      .find(({ element }) => element === root.host);
    const position = item != null ? this.getItemPosition(item.id) : undefined;
    if (position == null) return;
    const start = highlighter.getMatchStartAtPoint(
      row,
      event.clientX,
      event.clientY
    );
    if (start == null) return;
    const lineNumber = SearchHighlighter.getLineNumber(row);
    const match = scan.getFirstMatchAtOrAfter(
      position,
      lineNumber,
      start,
      SearchHighlighter.getLineSide(row)
    );
    if (
      match?.lineNumber !== lineNumber ||
      match.startCharacter !== start ||
      areOptionalCodeViewSearchMatchesEqual(match, current)
    ) {
      return;
    }

    dequeueRender(this.revealCurrentMatch);
    this.forgetViewport();
    state.pendingNavigation = undefined;
    state.pendingHorizontalReveal = false;
    this.setResults(matches, match);
    this.matchesDirty = true;
    this.flushMatches();
  };

  private removeListeners(): void {
    const { view, panel } = this;
    const root = view.getContainerElement();
    dequeueRender(this.syncFocus);
    root?.removeEventListener('click', this.handleMatchClick);
    root?.ownerDocument.removeEventListener('focusin', this.handleFocusIn);
    panel
      ?.getHostElement()
      .removeEventListener('focusout', this.handlePanelBlur);
  }

  private resolveScope(
    scope: CodeViewSearchScope
  ): CodeViewSearchState['scope'] {
    if (scope === 'all') {
      return undefined;
    }
    if (scope === 'focused') {
      if (this.isPanelFocused()) {
        return this.state.scope;
      }
      return this.view.focusedEditor != null
        ? { itemId: this.view.focusedEditor.id }
        : undefined;
    }
    const item = this.view.idToItem.get(scope.itemId);
    return item != null && this.view.isItemInEditMode(item)
      ? { itemId: scope.itemId }
      : undefined;
  }

  // A panel scoped to an editor opens on that editor's selection, or the
  // word under its caret, like the standalone editor's find. Searching every
  // item opens on the text selected in a code line, when there is some.
  private getQueryFromScope(): string {
    const { scope } = this.state;
    if (scope == null) {
      return this.getSelectedLineText();
    }
    const editor = this.view.getEditor(scope.itemId);
    const document = editor?.getEditState()?.document;
    if (editor == null || document == null) {
      return '';
    }
    return getSearchQueryFromSelection(
      document,
      editor.getViewState().selections?.at(-1)
    );
  }

  // The text selected with the browser's own selection, when all of it sits in
  // one code line of a rendered item. Empty otherwise.
  private getSelectedLineText(): string {
    const { firstIndex, lastIndex } = this.view.renderState;
    for (let index = firstIndex; index >= 0 && index <= lastIndex; index++) {
      const shadowRoot = this.view.items[index]?.element?.shadowRoot;
      if (shadowRoot == null) {
        continue;
      }
      const selected = getComposedSelectionRange(shadowRoot);
      if (selected == null || selected.collapsed) {
        continue;
      }
      const line = getCodeLineElement(selected.startContainer);
      if (
        line == null ||
        !shadowRoot.contains(line) ||
        line !== getCodeLineElement(selected.endContainer)
      ) {
        continue;
      }
      const range = document.createRange();
      range.setStart(selected.startContainer, selected.startOffset);
      range.setEnd(selected.endContainer, selected.endOffset);
      const text = range.toString();
      return text.includes('\n') ? '' : text;
    }
    return '';
  }

  private resetState(): void {
    dequeueRender(this.flushMatches);
    dequeueRender(this.paintHighlights);
    dequeueRender(this.revealCurrentMatch);
    this.highlighter?.clear();
    this.forgetViewport();
    this.state.scope = undefined;
    this.state.matches = [];
    this.invalidateScan();
    this.state.pendingNavigation = undefined;
    this.state.current = undefined;
    this.state.centerNavigation = false;
    this.matchesDirty = false;
    this.state.pendingHorizontalReveal = false;
    this.state.currentPosition = undefined;
  }

  // Remembers where the view is as the place to go back to, unless find's own
  // jump is what put it there.
  private rememberViewport(): void {
    const { state } = this;
    if (state.originalViewport != null && this.isAtMatchViewport()) return;
    state.originalViewport = this.getViewport();
    state.matchViewport = undefined;
  }

  // Takes the item or line at the top of the view, or the top itself.
  private getViewport(): CodeViewSearchViewport | undefined {
    const { view } = this;
    const scrollTop = view.getScrollTop();
    return scrollTop > 0 ? view.getScrollAnchor(scrollTop) : 'top';
  }

  // Drops both places when find no longer has a return to make.
  private forgetViewport(): void {
    const { state } = this;
    state.originalViewport = undefined;
    state.matchViewport = undefined;
  }

  // Notes where find's own scroll left the view, while there is a place to
  // go back to.
  private recordMatchViewport(): void {
    const { state } = this;
    if (state.originalViewport != null) {
      state.matchViewport = this.getViewport();
    }
  }

  // Whether the view is at a remembered place.
  private isAtViewport(viewport: CodeViewSearchViewport | undefined): boolean {
    const { view } = this;
    return viewport === 'top'
      ? view.getScrollTop() <= 0
      : viewport != null && view.isAtScrollAnchor(viewport);
  }

  // Whether find is scrolling to a match or the view is still where it stopped.
  private isAtMatchViewport(): boolean {
    const { state, view } = this;
    const { pendingScrollTarget } = view;
    return (
      (pendingScrollTarget?.type === 'line' &&
        pendingScrollTarget.searchMatch === true) ||
      this.isAtViewport(state.matchViewport)
    );
  }

  // Undoes find's automatic jumps since the view was last placed by the user.
  private restoreViewport(): void {
    const { state, view } = this;
    const { originalViewport } = state;
    const shouldReturn = this.isAtMatchViewport();
    this.forgetViewport();
    if (originalViewport == null || !shouldReturn) {
      return;
    }
    const behavior = view.options.searchOptions?.scrollBehavior ?? 'instant';
    if (originalViewport === 'top') {
      view.requestScroll({ type: 'position', position: 0, behavior });
    } else {
      view.scrollToAnchor(originalViewport, behavior);
    }
  }

  // Check whether the match's line is visible in the viewport below the sticky
  // header. Lines hidden in collapsed diff context are treated as offscreen.
  private isMatchInView(match: CodeViewSearchMatch): boolean {
    const item = this.view.idToItem.get(match.itemId);
    if (item == null) {
      return false;
    }
    // A collapsed file is stood in for by its header. A line in collapsed
    // context resolves to the separator that hides it.
    const rect =
      item.item.collapsed === true
        ? { top: item.top, height: item.height }
        : this.view.getScrollTargetRect({
            type: 'line',
            id: match.itemId,
            lineNumber: match.lineNumber,
            side: match.side,
            align: 'nearest',
          });
    if (rect == null) return false;
    const top = this.view.getItemTopOffset() + rect.top;
    const bottom = top + rect.height;
    const scrollTop = this.view.getScrollTop();
    const visibleTop = scrollTop + this.view.getStickyHeaderOffset();
    const visibleBottom = scrollTop + this.view.getHeight();
    return (
      (top >= visibleTop && bottom <= visibleBottom) ||
      (top <= visibleTop && bottom >= visibleBottom)
    );
  }

  private scrollToMatch(match: CodeViewSearchMatch): void {
    this.state.pendingHorizontalReveal = true;
    this.state.current = match;
    this.view.render();
    const item = this.view.idToItem.get(match.itemId);
    if (item != null && this.isMatchHidden(item, match)) {
      this.revealMatch(item, match);
    } else {
      this.paintRanges();
      const rect = this.measureCurrentMatch();
      const visible =
        rect != null
          ? this.isMatchRectVisible(rect)
          : this.isMatchInView(match);
      if (visible && !this.state.centerNavigation) {
        this.view.clearPendingScroll();
        this.recordMatchViewport();
        return;
      }
    }
    this.state.centerNavigation = true;
    // Centered in the part of the viewport that the sticky file header and
    // the find panel leave uncovered.
    const target: PendingLineTarget = {
      type: 'line',
      id: match.itemId,
      lineNumber: match.lineNumber,
      side: match.side,
      align: 'center',
      offset: -this.getTopInset() / 2,
      behavior: this.view.options.searchOptions?.scrollBehavior ?? 'instant',
      searchMatch: true,
    };
    this.view.requestScroll(target, () => this.recordMatchViewport());
  }

  // The user or the host has scrolled, so find leaves the view where it was
  // put. A first match still to come is selected without scrolling, and a
  // match find was scrolling to is left for the next find step.
  public keepView(): void {
    const { state, view } = this;
    const { pendingScrollTarget } = view;
    if (state.pendingNavigation === 'jump') {
      state.pendingNavigation = 'select';
    } else if (
      pendingScrollTarget?.type === 'line' &&
      pendingScrollTarget.searchMatch === true
    ) {
      state.pendingNavigation = 'reveal';
    }
  }

  private isMatchHidden(
    item: CodeViewContextItem<LAnnotation, Caret>,
    match: CodeViewSearchMatch
  ): boolean {
    if (item.item.collapsed === true) {
      return true;
    }
    return (
      item.type === 'diff' &&
      item.instance.isLineInCollapsedContext(match.lineNumber, match.side)
    );
  }

  // Opens whatever hides a match: the collapsed file it is in, and the
  // collapsed context around its line.
  private revealMatch(
    item: CodeViewContextItem<LAnnotation, Caret>,
    match: CodeViewSearchMatch
  ): void {
    const { item: collapsedItem } = item;
    if (collapsedItem.collapsed === true) {
      const openedItem = {
        ...collapsedItem,
        collapsed: false,
        version: (collapsedItem.version ?? 0) + 1,
      };
      this.view.updateItem(openedItem);
      const { onItemCollapsedChange } = this.view.options;
      onItemCollapsedChange?.(collapsedItem, openedItem);
    }
    if (
      item.type === 'diff' &&
      item.instance.isLineInCollapsedContext(match.lineNumber, match.side)
    ) {
      item.instance.revealLine(match.lineNumber, match.side);
    }
  }

  // How far down from the top of the viewport find's own chrome reaches: the
  // sticky file header or the find panel, whichever is lower.
  private getTopInset(): number {
    const { panel, view } = this;
    const root = view.getContainerElement();
    const stickyHeaderOffset = view.getStickyHeaderOffset();
    if (root == null || panel == null) {
      return stickyHeaderOffset;
    }
    const panelBottom =
      panel.getBounds().bottom -
      root.getBoundingClientRect().top -
      root.clientTop;
    return Math.max(stickyHeaderOffset, panelBottom);
  }

  // Records where the painted current match is drawn, as a position inside
  // its item, for a find scroll to aim at. Returns its place on screen, or
  // undefined while the match is not rendered.
  public measureCurrentMatch(): DOMRect | undefined {
    this.state.currentPosition = undefined;
    const { panel, view } = this;
    const root = view.getContainerElement();
    const { current } = this.state;
    const item =
      current != null ? view.idToItem.get(current.itemId) : undefined;
    const panelBounds = panel?.getBounds();
    // A panel without a box means nothing here is laid out.
    if (
      root == null ||
      item == null ||
      panelBounds == null ||
      panelBounds.width === 0 ||
      panelBounds.height === 0
    ) {
      return undefined;
    }
    const rect = this.highlighter?.currentMatchRange?.getBoundingClientRect();
    if (rect == null) {
      return undefined;
    }
    const viewportTop = root.getBoundingClientRect().top + root.clientTop;
    this.state.currentPosition = {
      top:
        rect.top -
        viewportTop +
        root.scrollTop +
        view.scrollPageOffset -
        view.getItemTopOffset() -
        item.top,
      height: rect.height,
    };
    return rect;
  }

  // Whether all of a match can be seen: inside the viewport, below the sticky
  // file header, and not under the find panel.
  private isMatchRectVisible(rect: DOMRect): boolean {
    const { panel, view } = this;
    const root = view.getContainerElement();
    if (root == null || panel == null) {
      return false;
    }
    const viewportTop = root.getBoundingClientRect().top + root.clientTop;
    if (
      rect.top < viewportTop + view.getStickyHeaderOffset() ||
      rect.bottom > viewportTop + root.clientHeight
    ) {
      return false;
    }
    const panelBounds = panel.getBounds();
    return !(
      rect.top < panelBounds.bottom &&
      rect.bottom > panelBounds.top &&
      rect.left < panelBounds.right &&
      rect.right > panelBounds.left
    );
  }

  // Bind replacement to the scoped editor's live document. The panel receives
  // a collapsed match at the replacement end so its next search advances.
  private getReplaceHandlers():
    | SearchPanelReplaceHandlers<CodeViewSearchMatch>
    | undefined {
    const scope = this.state.scope;
    const editor =
      scope != null ? this.view.getEditor(scope.itemId) : undefined;
    const document = editor?.getEditState()?.document;
    if (editor == null || document == null) {
      return undefined;
    }
    const toOffsets = (match: CodeViewSearchMatch): MatchRange => [
      document.offsetAt({
        line: match.lineIndex,
        character: match.startCharacter,
      }),
      document.offsetAt({
        line: match.lineIndex,
        character: match.endCharacter,
      }),
    ];
    return {
      replaceMatch: (match, params) => {
        this.forgetViewport();
        const next = editor.replaceSearchMatches([toOffsets(match)], params);
        if (next == null) {
          return undefined;
        }
        const position = document.positionAt(next[1]);
        return {
          ...match,
          lineIndex: position.line,
          lineNumber: position.line + 1,
          startCharacter: position.character,
          endCharacter: position.character,
        };
      },
      replaceAll: (matches, params) => {
        this.forgetViewport();
        editor.replaceSearchMatches(matches.map(toOffsets), params);
      },
    };
  }

  // Has the panel read the matches again on the next render, and holds the
  // background search until then.
  public markMatchesDirty(): void {
    const { advanceScan, state, panel, view } = this;
    const { idToItem, focusedEditor } = view;
    const { scope } = state;
    dequeueBackgroundTask(advanceScan);
    const scopedItem = scope != null ? idToItem.get(scope.itemId) : undefined;
    if (focusedEditor != null) {
      const focusedItem = idToItem.get(focusedEditor.id);
      if (focusedItem == null || !view.isItemInEditMode(focusedItem)) {
        view.focusedEditor = undefined;
      }
    }
    if (
      scope != null &&
      (scopedItem?.item.edit !== true || scopedItem.item.collapsed === true)
    ) {
      this.invalidateScan();
      state.scope = undefined;
      state.pendingNavigation = undefined;
      state.centerNavigation = false;
    }
    // Flag the refresh before rebinding so its state report waits for the read.
    const needsRefresh = panel?.hasQuery() === true;
    if (needsRefresh) this.matchesDirty = true;
    panel?.setReplaceHandlers(this.getReplaceHandlers());
    if (needsRefresh) view.render();
  }

  // Called before each find step. When the current match stands for the
  // cut-off part of a line, this finishes searching its item and has the
  // panel read the matches again. If the line was just expanded, the step
  // then starts from the match the stand-in really was, and stays in that
  // line instead of skipping it.
  private settleCutOffMatch = (): void => {
    const { scan, current } = this.state;
    if (scan == null || current?.cutOff !== true) {
      return;
    }
    const position = this.getItemPosition(current.itemId);
    if (position == null) {
      return;
    }
    while (scan.isItemPending(position) && !scan.finished) {
      if (scan.advance(BACKGROUND_TASK_BUDGET_MS, position)) {
        this.matchesDirty = true;
      }
    }
    this.flushMatches();
  };

  public flushMatches = (): void => {
    dequeueRender(this.flushMatches);
    if (!this.matchesDirty) {
      return;
    }

    this.matchesDirty = false;
    if (this.panel === undefined) {
      return;
    }

    this.panel.updateMatches({ skipNavigation: true });
  };

  private setResults(
    matches: CodeViewSearchMatch[],
    current: CodeViewSearchMatch | undefined
  ): void {
    const currentChanged = !areOptionalCodeViewSearchMatchesEqual(
      this.state.current,
      current
    );

    this.state.matches = matches;
    this.state.current = current;
    if (current == null) this.state.pendingHorizontalReveal = false;
    if (currentChanged) this.state.currentPosition = undefined;

    // The current highlight moves with the current match. New matches are
    // repainted by whatever put them on screen.
    if (currentChanged) {
      this.view.render();
    } else if (matches.length === 0) {
      // Nothing puts an empty list on screen, so the old matches come off here.
      this.highlighter?.clear();
    }
  }

  // Takes each new list of matches from the find panel, scrolls to a match
  // when a new query asks for it, and returns the index of the current match.
  private updateResults = (
    result: SearchResult<CodeViewSearchMatch>,
    options?: { skipNavigation?: boolean }
  ): number | undefined => {
    const { matches, searching } = result;
    const { state } = this;
    const { current, scan, scope, pendingNavigation } = state;
    // A refresh carries on with what is left from the last query. A new query
    // starts with `jump`, unless a scroll has already come after it.
    const pending =
      options?.skipNavigation === true || pendingNavigation === 'select'
        ? pendingNavigation
        : 'jump';
    const picksMatch = pending === 'jump' || pending === 'select';
    // A replace leaves an empty match at the end of the inserted text. The
    // next match is the first one after it.
    const replacementEnd =
      current != null &&
      current.itemId === scope?.itemId &&
      current.startCharacter === current.endCharacter
        ? current
        : undefined;
    let jumpTarget: CodeViewSearchMatch | undefined;
    if (picksMatch && scan != null) {
      if (replacementEnd != null) {
        const position = this.getItemPosition(replacementEnd.itemId);
        if (position != null && !scan.isItemPending(position)) {
          jumpTarget = scan.getFirstMatchAtOrAfter(
            position,
            replacementEnd.lineNumber,
            replacementEnd.endCharacter
          );
        }
      } else {
        jumpTarget = this.getStartingMatch(scan);
      }
    }

    if (picksMatch) {
      state.pendingNavigation =
        jumpTarget != null
          ? pending === 'select'
            ? 'reveal'
            : undefined
          : searching === true
            ? pending
            : undefined;
    }

    const target = jumpTarget ?? current;
    const position =
      target != null ? this.getItemPosition(target.itemId) : undefined;
    const nextIndex =
      target != null && position != null
        ? scan?.getMatchIndex(position, target)
        : undefined;
    const nextCurrent = nextIndex != null ? matches[nextIndex] : undefined;
    const currentItemPending =
      jumpTarget == null &&
      position != null &&
      scan?.isItemPending(position) === true;
    this.setResults(matches, currentItemPending ? current : nextCurrent);
    if (jumpTarget != null && pending === 'jump') {
      if (replacementEnd == null) {
        this.rememberViewport();
      }
      this.scrollToMatch(jumpTarget);
    } else if (
      current?.cutOff === true &&
      nextCurrent != null &&
      nextCurrent.cutOff !== true
    ) {
      // The current match stood for the cut-off part of a line, and that part
      // shows now. Go to where the match really is, once its row is rendered.
      queueRender(this.revealCurrentMatch);
    }
    return nextIndex;
  };

  // Scrolls to the current match. Queued to run after the frame's render, so
  // the match is measured in the rows that are on screen by then.
  private revealCurrentMatch = (): void => {
    const { current } = this.state;
    if (current != null) {
      this.rememberViewport();
      this.scrollToMatch(current);
    }
  };

  private queueHighlightPaint = (): void => {
    if (this.panel != null) {
      queueRender(this.paintHighlights);
    }
  };

  // Paints the highlights for a frame, then scrolls the current match's code
  // column sideways if navigation asked for it. The sideways scroll only runs
  // here, once per frame: split columns copy each other's scroll position a
  // frame late, and a second scroll in between would be overwritten.
  public paintHighlights = (): void => {
    dequeueRender(this.paintHighlights);
    this.paintRanges();
    if (this.state.pendingHorizontalReveal) {
      const range = this.highlighter?.currentMatchRange;
      this.state.pendingHorizontalReveal =
        range == null || !revealMatchHorizontally(range);
    }
  };

  // DOM ranges belong to the mounted text nodes. Rebuild them after rendering
  // so scrolling, tokenization, and edits cannot leave ranges on recycled rows.
  private paintRanges(): void {
    const { highlighter } = this;
    if (highlighter == null) return;
    highlighter.clear();
    if (this.state.matches.length === 0) return;
    const { firstIndex, lastIndex } = this.view.renderState;
    const { scan } = this.state;
    for (let index = firstIndex; index >= 0 && index <= lastIndex; index++) {
      const item = this.view.items[index];
      const root = item.element?.shadowRoot;
      const position = this.getItemPosition(item.item.id);
      const itemMatches =
        position != null ? scan?.getItemMatches(position) : undefined;
      if (
        root != null &&
        scan != null &&
        position != null &&
        itemMatches != null
      ) {
        highlighter.paint(root, (lineNumber, side) => {
          const span = scan.getLineMatches(position, lineNumber, side);
          if (span == null) return undefined;
          const ranges: SearchHighlightRange[] = [];
          const { current } = this.state;
          for (
            let matchIndex = span.startIndex;
            matchIndex < span.endIndex;
            matchIndex++
          ) {
            const match = itemMatches[matchIndex];
            ranges.push({
              startCharacter: match.startCharacter,
              endCharacter: match.endCharacter,
              current:
                current != null &&
                areCodeViewSearchMatchesEqual(match, current),
            });
          }
          return ranges;
        });
      }
    }
  }

  // The scan position of an item in the current scope.
  private getItemPosition(itemId: string): number | undefined {
    const { state, view } = this;
    const { idToItem } = view;
    const { scope } = state;
    const item = idToItem.get(itemId);
    return item != null && (scope == null || scope.itemId === itemId)
      ? scope != null
        ? 0
        : item.index
      : undefined;
  }

  // An item's current searchable text and diff.
  private getSearchItem = (position: number): CodeViewSearchItem => {
    const { state, view } = this;
    const { items, idToItem, options } = view;
    const { scope } = state;
    const item = scope != null ? idToItem.get(scope.itemId) : items[position];
    if (item == null)
      throw new Error(
        `CodeViewSearchManager.getSearchItem: position ${position} does not exist`
      );
    const { id: itemId } = item.item;
    const document = view.getEditor(itemId)?.getEditState()?.document;
    const contents = document?.getText();
    const lineCuts = item.instance.getLineCutsForSearch();
    return item.type === 'file'
      ? {
          itemId,
          type: 'file',
          lineCuts,
          contents: contents ?? item.item.file.contents,
        }
      : {
          itemId,
          type: 'diff',
          lineCuts,
          fileDiff: this.getSearchDiff(item),
          additionContents: contents,
          diffStyle: options.diffStyle ?? 'split',
          additionsOnly: scope?.itemId === itemId,
        };
  };

  // The diff to search for an item: the editor's while it is being edited.
  private getSearchDiff(
    item: CodeViewDiffItemContext<LAnnotation, Caret>
  ): FileDiffMetadata {
    const { view } = this;
    const { id, fileDiff } = item.item;
    const document = view.getEditor(id)?.getEditState()?.document;
    return document != null
      ? (item.instance.getDiffForSearch() ?? fileDiff)
      : fileDiff;
  }

  // Drops the current search and stops its background work.
  public invalidateScan(): void {
    dequeueBackgroundTask(this.advanceScan);
    const { state } = this;
    state.scan = undefined;
  }

  // Searches one item again after its text changed.
  public rescanItem(itemId: string): void {
    const { scan } = this.state;
    const position = this.getItemPosition(itemId);
    if (position != null) {
      scan?.rescanItem(position);
    }
    this.markMatchesDirty();
  }

  // Whether an item on screen is still waiting to be searched.
  private hasPendingRenderedItems(scan: CodeViewSearchScan): boolean {
    const { state, view } = this;
    const { renderState } = view;
    const { firstIndex, lastIndex } = renderState;
    return state.scope == null
      ? scan.hasPendingItems(firstIndex, lastIndex + 1)
      : scan.isItemPending(0);
  }

  // Searches for one slice from the first item on screen.
  private runSlice(scan: CodeViewSearchScan): boolean {
    const { state, view } = this;
    const { renderState } = view;
    const { firstIndex } = renderState;
    return state.scope == null
      ? scan.advance(BACKGROUND_TASK_BUDGET_MS, firstIndex)
      : scan.advance(BACKGROUND_TASK_BUDGET_MS);
  }

  // Searches for one more slice in the background, and has the panel read the
  // matches again when there are new ones. Only a slice that could have
  // searched an item on screen asks for a render.
  private advanceScan = (): void => {
    const { scan } = this.state;
    if (scan == null) {
      throw new Error(
        'CodeViewSearchManager.advanceScan: queued scan is missing'
      );
    }
    const renderedItemsPending = this.hasPendingRenderedItems(scan);
    const changed = this.runSlice(scan);
    if (!scan.finished) queueBackgroundTask(this.advanceScan);
    if (changed) {
      this.matchesDirty = true;
      if (renderedItemsPending) {
        this.view.render();
      } else {
        queueRender(this.flushMatches);
      }
    }
  };

  // Returns the matches found so far for the panel's query. Starts the search
  // at the items on screen when there is none running. Searches for one slice
  // first when an item on screen is waiting, so its highlights are not late.
  private search(
    searchParams: SearchParams
  ): SearchResult<CodeViewSearchMatch> {
    const { state, view, getSearchItem } = this;
    const { items, idToItem, renderState } = view;
    const { scope } = state;
    const itemCount =
      scope != null ? (idToItem.has(scope.itemId) ? 1 : 0) : items.length;
    let { scan } = state;
    if (scan == null) {
      const { firstIndex } = renderState;
      scan = new CodeViewSearchScan(
        searchParams,
        itemCount,
        getSearchItem,
        MAX_SEARCH_MATCHES,
        scope == null ? Math.max(0, firstIndex) : 0
      );
      state.scan = scan;
      this.runSlice(scan);
      view.render();
    } else if (this.hasPendingRenderedItems(scan)) {
      this.runSlice(scan);
    }
    if (!scan.finished) {
      queueBackgroundTask(this.advanceScan);
    }
    return {
      matches: scan.getMatches(),
      searching: !scan.finished,
    };
  }

  // The first fully visible match, then the first below, then the first in
  // the first item that has any.
  private getStartingMatch(
    scan: CodeViewSearchScan
  ): CodeViewSearchMatch | undefined {
    const { state, view } = this;
    const { idToItem } = view;
    const { scope } = state;
    const anchor = view.getScrollAnchor(view.getScrollTop());
    const anchoredItem = anchor != null ? idToItem.get(anchor.id) : undefined;
    const scopedItem = scope != null ? idToItem.get(scope.itemId) : undefined;
    const position =
      scopedItem != null
        ? anchoredItem != null && anchoredItem.index > scopedItem.index
          ? 1
          : 0
        : (anchoredItem?.index ?? 0);
    const first = scan.getFirstMatchedEntryAtOrAfter(position);
    if (first == null) {
      return scan.finished
        ? scan.getFirstMatchedEntryAtOrAfter(0)?.matches[0]
        : undefined;
    }
    if (scan.hasPendingItems(position, first.position + 1)) {
      return undefined;
    }
    if (
      anchor?.type === 'line' &&
      anchoredItem != null &&
      first.matches[0].itemId === anchor.id
    ) {
      const candidate = this.findMatchAtAnchor(
        anchoredItem,
        first.matches,
        anchor
      );
      if (candidate != null) {
        return candidate;
      }
      const next = scan.getFirstMatchedEntryAtOrAfter(first.position + 1);
      if (next == null) {
        return scan.finished
          ? scan.getFirstMatchedEntryAtOrAfter(0)?.matches[0]
          : undefined;
      }
      return scan.hasPendingItems(first.position + 1, next.position + 1)
        ? undefined
        : next.matches[0];
    }
    return first.matches[0];
  }

  // The first match in an item on or after the line at the top of the
  // viewport. Relies on an item's matches being in row order.
  private findMatchAtAnchor(
    item: CodeViewContextItem<LAnnotation, Caret>,
    matches: readonly CodeViewSearchMatch[],
    anchor: LineAnchor
  ): CodeViewSearchMatch | undefined {
    const { options } = this.view;
    const diff = item.type === 'diff' ? this.getSearchDiff(item) : undefined;
    const rowIndex = options.diffStyle === 'unified' ? 0 : 1;
    let anchorRow = anchor.lineNumber;
    if (diff != null) {
      const indexes = getLineIndexForDiff(
        diff,
        anchor.lineNumber,
        anchor.side ?? 'additions'
      );
      if (indexes == null)
        throw new Error(
          'CodeViewSearchManager.findMatchAtAnchor: anchor row is missing'
        );
      anchorRow = indexes[rowIndex];
    }
    let start = 0;
    let end = matches.length;
    while (start < end) {
      const middle = Math.floor((start + end) / 2);
      const match = matches[middle];
      let row = match.lineNumber;
      if (diff != null) {
        const indexes = getLineIndexForDiff(
          diff,
          match.lineNumber,
          match.side ?? 'additions'
        );
        if (indexes == null)
          throw new Error(
            'CodeViewSearchManager.findMatchAtAnchor: matched row is missing'
          );
        row = indexes[rowIndex];
      }
      if (row < anchorRow) start = middle + 1;
      else end = middle;
    }
    return matches[start];
  }
}

// Keeps a remembered place attached to its item when its id changes.
function renameViewport(
  viewport: CodeViewSearchViewport | undefined,
  oldId: string,
  newId: string
): CodeViewSearchViewport | undefined {
  return viewport != null && viewport !== 'top' && viewport.id === oldId
    ? { ...viewport, id: newId }
    : viewport;
}

// Find the clicked row, leaving its buttons to handle their own clicks.
function getClickedCodeRow(event: MouseEvent): HTMLElement | undefined {
  for (const target of event.composedPath()) {
    if (target instanceof HTMLButtonElement) return undefined;
    if (
      target instanceof HTMLElement &&
      target.matches('[data-line][data-line-type]')
    ) {
      return target;
    }
  }
  return undefined;
}

// The code line row a node sits in, if any.
function getCodeLineElement(node: Node): Element | undefined {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest('[data-line]') ?? undefined;
}

function hasSearchIndexOptionChanged<LAnnotation, Caret>(
  previousOptions: CodeViewOptions<LAnnotation, Caret>,
  nextOptions: CodeViewOptions<LAnnotation, Caret>
): boolean {
  return (
    previousOptions.tokenizeMaxLineLength !==
      nextOptions.tokenizeMaxLineLength ||
    (previousOptions.diffStyle ?? 'split') !==
      (nextOptions.diffStyle ?? 'split') ||
    (previousOptions.expandUnchanged ?? false) !==
      (nextOptions.expandUnchanged ?? false) ||
    (previousOptions.collapsedContextThreshold ??
      DEFAULT_COLLAPSED_CONTEXT_THRESHOLD) !==
      (nextOptions.collapsedContextThreshold ??
        DEFAULT_COLLAPSED_CONTEXT_THRESHOLD)
  );
}
