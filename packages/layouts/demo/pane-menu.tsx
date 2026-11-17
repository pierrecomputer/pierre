// A reference pane menu on `Layout.usePaneMenu(open)`: the WAI-ARIA menu button
// pattern, with `Layout.MoveHandle` as its trigger. A drag of the handle
// moves the pane; a click, Enter, Space, or Arrow Down opens the menu, and
// Arrow Up opens it on its last item. In the menu, the arrows move, Home and
// End jump, Enter or Space runs an item, Arrow Right opens "Move to…", Arrow
// Left closes it, and Escape or Tab closes the menu. After an item runs, the
// focus goes back to the handle. The library ships no menu component: an app
// renders the same items in its own.
import {
  type JSX,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import * as Layout from '../src/react';
import type { PaneMenuItem } from '../src/react';

type Start = 'first' | 'last';

// The renders of the pane menu triggers, which the e2e tests read: a closed
// menu does not render for a change of the layout.
const page = { triggerRenders: 0 };
Object.assign(window, { __paneMenu: page });

function countTriggerRender(): void {
  page.triggerRenders += 1;
}

export function PaneMenu(): JSX.Element {
  const [open, setOpen] = useState<Start | null>(null);
  const items = Layout.usePaneMenu(open !== null);
  countTriggerRender();
  const trigger = useRef<HTMLElement | null>(null);
  const triggerId = useId();
  const menuId = useId();
  const close = (refocus: boolean): void => {
    setOpen(null);
    if (refocus) trigger.current?.focus();
  };
  return (
    <>
      <Layout.MoveHandle
        ref={trigger}
        id={triggerId}
        aria-expanded={open !== null}
        aria-controls={open === null ? undefined : menuId}
        onClick={() => setOpen((value) => (value === null ? 'first' : null))}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
          event.preventDefault();
          setOpen(event.key === 'ArrowDown' ? 'first' : 'last');
        }}
      />
      {open !== null &&
        createPortal(
          <Menu
            id={menuId}
            labelledBy={triggerId}
            start={open}
            anchor={trigger}
            onClose={close}
            onDone={() => close(true)}
            items={items}
          />,
          document.body
        )}
    </>
  );
}

function Menu({
  id,
  labelledBy,
  start,
  anchor,
  onClose,
  onDone,
  items,
  sub = false,
}: {
  id: string;
  labelledBy: string;
  start: Start;
  anchor: RefObject<HTMLElement | null>;
  /** Escape, Arrow Left, or Tab: close this menu. */
  onClose: (refocus: boolean) => void;
  /** An item ran: close every menu, and focus the trigger. */
  onDone: () => void;
  items: readonly PaneMenuItem[];
  /** A submenu, at the right of its item, which its menu closes. */
  sub?: boolean;
}): JSX.Element {
  const menu = useRef<HTMLDivElement | null>(null);
  const [submenu, setSubmenu] = useState<Start | null>(null);
  const subId = useId();
  const [box, setBox] = useState({ left: 0, top: 0 });
  // Place the menu under its trigger, or to the right of its submenu item,
  // inside the window.
  useLayoutEffect(() => {
    const rect = anchor.current?.getBoundingClientRect();
    const height = menu.current?.offsetHeight ?? 0;
    if (rect === undefined) return;
    const top = sub ? rect.top : rect.bottom + 4;
    setBox({
      left: sub ? rect.right + 2 : rect.left,
      top: Math.max(8, Math.min(top, innerHeight - height - 8)),
    });
  }, [anchor, sub]);
  const elements = (): HTMLElement[] => [
    ...(menu.current?.querySelectorAll<HTMLElement>(
      ':scope > [role="menuitem"]'
    ) ?? []),
  ];
  useEffect(() => {
    const list = elements();
    (start === 'first' ? list[0] : list.at(-1))?.focus();
  }, [start]);
  // A press outside the menu closes it.
  useEffect(() => {
    if (sub) return;
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (
        !(menu.current?.contains(target) ?? false) &&
        !(anchor.current?.contains(target) ?? false) &&
        !(document.getElementById(subId)?.contains(target) ?? false)
      )
        onClose(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  });
  const run = (item: PaneMenuItem): void => {
    if (item.disabled) return;
    if (item.items !== undefined) {
      setSubmenu('first');
      return;
    }
    item.run();
    onDone();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const list = elements();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const focus = (index: number): void =>
      list[(index + list.length) % list.length]?.focus();
    const item = items[at];
    if (event.key === 'ArrowDown') focus(at + 1);
    else if (event.key === 'ArrowUp') focus(at - 1);
    else if (event.key === 'Home') focus(0);
    else if (event.key === 'End') focus(list.length - 1);
    else if (event.key === 'Enter' || event.key === ' ') {
      if (item !== undefined) run(item);
    } else if (event.key === 'ArrowRight' && item?.items !== undefined)
      setSubmenu('first');
    else if (event.key === 'Escape' || event.key === 'ArrowLeft') onClose(true);
    else if (event.key === 'Tab') onClose(false);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  const opener = useRef<HTMLDivElement | null>(null);
  return (
    <div
      className="demo-menu"
      ref={menu}
      id={id}
      role="menu"
      aria-labelledby={labelledBy}
      style={box}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => {
        const separated = index > 0 && items[index - 1].group !== item.group;
        return [
          separated && <div key={`${item.id}:separator`} role="separator" />,
          <div
            key={item.id}
            ref={item.items === undefined ? undefined : opener}
            role="menuitem"
            tabIndex={-1}
            aria-disabled={item.disabled || undefined}
            aria-haspopup={item.items === undefined ? undefined : 'menu'}
            aria-expanded={
              item.items === undefined ? undefined : submenu !== null
            }
            onClick={() => run(item)}
          >
            {item.label}
          </div>,
        ];
      })}
      {submenu !== null &&
        createPortal(
          <Menu
            id={subId}
            labelledBy={id}
            start={submenu}
            anchor={opener}
            items={items.find((item) => item.items !== undefined)?.items ?? []}
            sub
            onClose={(refocus) => {
              setSubmenu(null);
              if (refocus) opener.current?.focus();
              else onClose(false);
            }}
            onDone={onDone}
          />,
          document.body
        )}
    </div>
  );
}
