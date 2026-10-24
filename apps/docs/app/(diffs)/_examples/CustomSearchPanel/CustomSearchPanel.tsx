'use client';

import {
  type EditorOptions,
  resolveEditorCommandFromKeyboardEvent,
  resolveFindAgainShortcut,
  type SearchPanelContext,
  type SearchPanelState,
} from '@pierre/diffs/edit';
import { File } from '@pierre/diffs/react';
import type { PreloadedFileResult } from '@pierre/diffs/ssr';
import {
  IconArrowShort,
  IconChevronSm,
  IconRegex,
  IconReplace,
  IconReplaceAll,
  IconSearch,
  IconType,
  IconTypeWord,
  IconX,
} from '@pierre/icons';
import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import { FeatureHeader } from '@/components/FeatureHeader';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupIcon,
  InputGroupInput,
} from '@/components/ui/input-group';
import { Toggle } from '@/components/ui/toggle';
import { cn } from '@/lib/utils';

interface CustomSearchPanelProps {
  // Server-preloaded, highlighted File; hydrating from it avoids a highlight flash on load.
  prerenderedFile: PreloadedFileResult<undefined, undefined>;
}

// An open search panel: the element the editor slots over the code, the
// actions that drive Pierre's search, and the latest state the editor pushed.
interface OpenSearchPanel {
  element: HTMLElement;
  search: SearchPanelContext;
  state: SearchPanelState;
}

// Focuses the find input and selects its query so typing replaces it.
function focusFindInput(input: HTMLInputElement | null) {
  input?.focus();
  input?.select();
}

export function CustomSearchPanel({ prerenderedFile }: CustomSearchPanelProps) {
  const [panel, setPanel] = useState<OpenSearchPanel>();
  const inputRef = useRef<HTMLInputElement>(null);

  // The editor calls renderSearchPanel when find opens (Cmd/Ctrl+F). The
  // returned element lives in the page's light DOM, so the popup portaled into
  // it below uses the site's own components and styles. `mx-auto` moves it
  // from the built-in top-right spot to the top center of the code, and the
  // width keeps a gutter on narrow screens. It is also the container the
  // popup's layout queries.
  const editorOptions = useMemo<EditorOptions<'file', undefined, undefined>>(
    () => ({
      renderSearchPanel(search) {
        const element = document.createElement('div');
        element.className = '@container mx-auto w-[min(30rem,100%_-_2rem)]';
        return {
          element,
          update: (state) => setPanel({ element, search, state }),
          focus: () => focusFindInput(inputRef.current),
          cleanup: () => setPanel(undefined),
        };
      },
    }),
    []
  );

  return (
    <div className="space-y-5">
      <FeatureHeader
        id="custom-search-panel"
        title="Custom find and replace"
        description={
          <>
            Replace the editor&apos;s find panel with your own UI through{' '}
            <code>renderSearchPanel</code>. Diffs keeps search, highlighting,
            navigation, replacement, and undo; your panel renders in the
            page&apos;s light DOM, so it uses your app&apos;s styles. Click into
            the code and press <kbd>⌘F</kbd> (or <kbd>⌘⌥F</kbd> to replace).
          </>
        }
      />
      <File
        {...prerenderedFile}
        className="diff-container max-h-[420px] overflow-auto"
        edit
        editorOptions={editorOptions}
      />
      {panel != null &&
        createPortal(
          <SearchPopup
            search={panel.search}
            state={panel.state}
            inputRef={inputRef}
          />,
          panel.element
        )}
    </div>
  );
}

interface SearchPopupProps {
  search: SearchPanelContext;
  state: SearchPanelState;
  inputRef: RefObject<HTMLInputElement | null>;
}

// App-styled find/replace popup. Every action goes through `search`, so
// matching, navigation, and replacement behave exactly like the built-in panel.
function SearchPopup({ search, state, inputRef }: SearchPopupProps) {
  const { matchCount, currentMatchIndex } = state;
  const hasMatches = matchCount > 0;

  // React mounts the portal after the editor's open-time focus() call, so the
  // popup focuses its own input when it first renders.
  useEffect(() => {
    focusFindInput(inputRef.current);
  }, [inputRef]);

  // Keep the built-in input shortcuts, including IME confirmation, while
  // letting the app own the panel's controls and focus.
  const handleKeyDown =
    (onEnter: (event: KeyboardEvent) => void) => (event: KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        return;
      }
      const command = resolveEditorCommandFromKeyboardEvent(event.nativeEvent);
      const findAgain = resolveFindAgainShortcut(event.nativeEvent);
      if (event.key === 'Enter') {
        event.preventDefault();
        onEnter(event);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        search.close();
      } else if (findAgain !== undefined) {
        event.preventDefault();
        search.navigate(findAgain);
      } else if (
        command === 'openSearchPanel' ||
        command === 'openSearchReplacePanel'
      ) {
        event.preventDefault();
        search.setState({
          mode: command === 'openSearchReplacePanel' ? 'replace' : 'find',
        });
        focusFindInput(inputRef.current);
      }
    };

  return (
    // The slotted element inherits color and font from the editor, so the
    // popup sets its own. Three columns keep the find and replace inputs the
    // same width; narrow popups move each row's actions under its input.
    <div className="bg-background/95 text-foreground grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1 rounded-xl border p-1.5 font-sans shadow-lg backdrop-blur @max-md:grid-cols-[auto_minmax(0,1fr)]">
      <Button
        variant="ghost"
        size="icon-md"
        aria-label="Toggle replace"
        aria-expanded={state.mode === 'replace'}
        onClick={() =>
          search.setState({
            mode: state.mode === 'replace' ? 'find' : 'replace',
          })
        }
      >
        <IconChevronSm
          className={cn(
            'transition-transform',
            state.mode === 'find' && '-rotate-90'
          )}
        />
      </Button>
      <InputGroup>
        <InputGroupIcon>
          <IconSearch size={14} />
        </InputGroupIcon>
        <InputGroupInput
          ref={inputRef}
          className="h-8 pr-20 pl-9"
          placeholder="Find"
          value={state.text}
          onChange={(event) => search.setState({ text: event.target.value })}
          onKeyDown={handleKeyDown((event) =>
            search.navigate(event.shiftKey ? 'previous' : 'next')
          )}
        />
        <div className="absolute right-1 flex items-center">
          <OptionToggle
            label="Match case"
            pressed={state.caseSensitive}
            onPressedChange={(caseSensitive) =>
              search.setState({ caseSensitive })
            }
          >
            <IconType />
          </OptionToggle>
          <OptionToggle
            label="Match whole word"
            pressed={state.wholeWord}
            onPressedChange={(wholeWord) => search.setState({ wholeWord })}
          >
            <IconTypeWord />
          </OptionToggle>
          <OptionToggle
            label="Use regular expression"
            pressed={state.regex}
            onPressedChange={(regex) => search.setState({ regex })}
          >
            <IconRegex />
          </OptionToggle>
        </div>
      </InputGroup>
      <div className="flex items-center gap-1 @max-md:col-start-2">
        <span className="text-muted-foreground min-w-16 flex-1 px-1 text-xs whitespace-nowrap tabular-nums">
          {!hasMatches
            ? 'No results'
            : currentMatchIndex === undefined
              ? `${matchCount} results`
              : `${currentMatchIndex + 1} of ${matchCount}`}
        </span>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Previous match"
          disabled={!hasMatches}
          onClick={() => search.navigate('previous')}
        >
          <IconArrowShort className="rotate-90" />
        </Button>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Next match"
          disabled={!hasMatches}
          onClick={() => search.navigate('next')}
        >
          <IconArrowShort className="-rotate-90" />
        </Button>
        <Button
          variant="ghost"
          size="icon-md"
          aria-label="Close"
          onClick={search.close}
        >
          <IconX />
        </Button>
      </div>
      {state.mode === 'replace' && (
        <>
          <InputGroupInput
            className="col-start-2 h-8"
            placeholder="Replace"
            value={state.replaceText}
            onChange={(event) =>
              search.setState({ replaceText: event.target.value })
            }
            onKeyDown={handleKeyDown(search.replace)}
          />
          <div className="flex items-center gap-1 @max-md:col-start-2">
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="Replace"
              disabled={!hasMatches}
              onClick={search.replace}
            >
              <IconReplace />
            </Button>
            <Button
              variant="ghost"
              size="icon-md"
              aria-label="Replace all"
              disabled={!hasMatches}
              onClick={search.replaceAll}
            >
              <IconReplaceAll />
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

interface OptionToggleProps {
  label: string;
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
  children: ReactNode;
}

// A search option toggle (match case, whole word, regex) with a hover title.
function OptionToggle({
  label,
  pressed,
  onPressedChange,
  children,
}: OptionToggleProps) {
  return (
    <Toggle
      className="size-6 min-w-0 px-0"
      aria-label={label}
      title={label}
      pressed={pressed}
      onPressedChange={onPressedChange}
    >
      {children}
    </Toggle>
  );
}
