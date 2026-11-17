import { describe, expect, test } from 'bun:test';

import { nameHost } from '../src/react/parts/host-name';

// A pane host with the attribute methods that the module uses, and a part
// element inside it.
function hostWithPart() {
  const attributes = new Map<string, string>();
  const host = {
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  const part = { closest: () => host } as unknown as Element;
  return { host, part };
}

describe('the role and the name of a pane host', () => {
  test('a tab makes the host its tab panel, else a title names it, in any order', () => {
    const { host, part } = hostWithPart();
    const title = nameHost(part, 'title', 'heading');
    expect(host.getAttribute('aria-labelledby')).toBe('heading');
    expect(host.getAttribute('role')).toBeNull();
    const tab = nameHost(part, 'tab', 'tab');
    expect(host.getAttribute('role')).toBe('tabpanel');
    expect(host.getAttribute('aria-labelledby')).toBe('tab');
    tab?.();
    expect(host.getAttribute('role')).toBeNull();
    expect(host.getAttribute('aria-labelledby')).toBe('heading');
    title?.();
    expect(host.getAttribute('aria-labelledby')).toBeNull();
  });

  test('a tab that came after the title still names the host when the title goes', () => {
    const { host, part } = hostWithPart();
    const title = nameHost(part, 'title', 'heading');
    nameHost(part, 'tab', 'tab');
    title?.();
    expect(host.getAttribute('role')).toBe('tabpanel');
    expect(host.getAttribute('aria-labelledby')).toBe('tab');
  });

  test('a part outside a pane host names nothing', () => {
    const part = { closest: () => null } as unknown as Element;
    expect(nameHost(part, 'tab', 'tab')).toBeUndefined();
  });
});
