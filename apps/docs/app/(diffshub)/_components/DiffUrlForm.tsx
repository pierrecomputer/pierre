'use client';

import { useStableCallback } from '@pierre/diffs/react';
import { IconX } from '@pierre/icons';
import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useTransition,
} from 'react';
import { createPortal } from 'react-dom';

import { getPatchViewerHref } from '../(view)/_components/utils';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DiffUrlFormProps {
  className?: string;
  // When provided, the input restores to this value on blur or Escape. Also
  // controls the clear-button visibility: with an initialUrl set, the clear
  // button only shows when the input matches the committed URL or has an error
  // (i.e. not while the user is typing). Without an initialUrl the clear
  // button shows whenever the input has content.
  initialUrl?: string;
  inputClassName?: string;
  placeholder?: string;
  // Render prop for the submit button area. Receives the transition pending
  // state and current URL value so callers can conditionally render controls.
  children?: (isPending: boolean, url: string) => ReactNode;
}

// Shared URL input form used in both the viewer header and the home page.
// Handles URL state, validation via getPatchViewerHref, router navigation,
// the validation error popover (portal-based to escape contain-paint), and
// escape/blur restore behavior.
export function DiffUrlForm({
  className,
  initialUrl = '',
  inputClassName,
  placeholder,
  children,
}: DiffUrlFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [url, setURL] = useState(initialUrl);
  const [validationError, setValidationError] = useState<string | null>(null);
  // Tracks the input's viewport position when an error is shown so the portal
  // can be fixed-positioned outside any contain-paint boundary.
  const [errorAnchor, setErrorAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  // Preserves the last message so the popover still has content while fading out.
  const lastErrorText = useRef<string | null>(null);
  // Prevents the onBlur restore from firing when blur is caused by Enter.
  const isSubmittingRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setURL(initialUrl);
  }, [initialUrl]);

  // Keep the portal position in sync with the input whenever it's visible.
  // Resize (including DevTools opening) and scroll both change the input's
  // viewport position, so we re-measure on those events.
  useEffect(() => {
    if (errorAnchor === null) return;

    const updatePosition = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (rect != null) setErrorAnchor({ top: rect.bottom, left: rect.left });
    };

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [errorAnchor]);

  const handleSubmit = useStableCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      isSubmittingRef.current = false;
      const normalizedURL = url.trim();
      const viewerHref = getPatchViewerHref(normalizedURL);
      if (viewerHref == null) {
        const rect = inputRef.current?.getBoundingClientRect();
        if (rect != null) setErrorAnchor({ top: rect.bottom, left: rect.left });
        lastErrorText.current = 'Please enter a valid URL';
        setValidationError('Please enter a valid URL');
        return;
      }
      setValidationError(null);
      setURL(normalizedURL);
      startTransition(() => {
        router.push(viewerHref);
      });
    }
  );

  // Show the clear button when the input has content. When an initialUrl is
  // set (viewer header), hide it while the user is actively editing so it
  // doesn't distract — restore it once committed or on error.
  const showClear =
    url.length > 0 &&
    (initialUrl === '' || url === initialUrl || validationError !== null);

  return (
    <form
      className={cn('group flex min-w-0 items-center gap-1 w-full ', className)}
      noValidate
      onSubmit={handleSubmit}
    >
      <input
        ref={inputRef}
        className={cn(
          'focus:text-primary block field-sizing-content h-9 min-w-[24ch] rounded-md text-sm focus-visible:outline-none',
          inputClassName
        )}
        enterKeyHint="go"
        value={url}
        type="url"
        onChange={({ currentTarget }) => {
          setURL(currentTarget.value);
          if (validationError) setValidationError(null);
        }}
        onBlur={() => {
          if (isSubmittingRef.current) return;
          // Only restore the committed URL when the field is empty — if the
          // user typed something and clicked away, keep their draft.
          if (url.trim() === '') {
            setURL(initialUrl);
            setValidationError(null);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setURL(initialUrl);
            setValidationError(null);
            inputRef.current?.blur();
          } else if (e.key === 'Enter') {
            isSubmittingRef.current = true;
          }
        }}
        placeholder={placeholder}
      />
      {showClear && (
        <Button
          type="button"
          variant="ghost"
          size="icon-md"
          aria-label="Clear"
          className="opacity-0 transition-opacity duration-200 will-change-auto group-focus-within:opacity-50 group-hover:opacity-50 hover:opacity-75"
          onClick={() => {
            setURL('');
            setValidationError(null);
            inputRef.current?.focus();
          }}
        >
          <IconX className="size-4" />
        </Button>
      )}
      {children?.(isPending, url)}
      {/* Hidden submit ensures Enter triggers form submission in all browsers */}
      <button type="submit" hidden />
      {errorAnchor !== null &&
        createPortal(
          <div
            aria-live="polite"
            style={{ top: errorAnchor.top + 8, left: errorAnchor.left }}
            className={cn(
              'bg-foreground text-background pointer-events-none fixed z-50 rounded-md px-3 py-1.5 text-xs transition-opacity duration-150',
              validationError !== null ? 'opacity-100' : 'opacity-0'
            )}
            onTransitionEnd={() => {
              if (validationError === null) setErrorAnchor(null);
            }}
          >
            <div className="bg-foreground absolute -top-1 left-3 size-2.5 rotate-45 rounded-[2px]" />
            {lastErrorText.current}
          </div>,
          document.body
        )}
    </form>
  );
}
