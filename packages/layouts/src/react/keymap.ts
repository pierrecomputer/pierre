// The keys of the layout's commands (`DEC-layouts-pane-commands`). Each
// command has an ID and default keys; `Root`'s `keymap` prop changes or
// removes the keys of a command by its ID.

/**
 * The key commands of the library and their default keys. Only F6,
 * Shift+F6, and Escape have keys: every other cross-platform key conflicts
 * with a screen reader, text editing, or the browser. An app lists these in
 * its own shortcut settings, and binds a command through the `keymap` prop.
 */
export const defaultKeys: Readonly<Record<string, readonly string[]>> = {
  'focus.next': ['F6'],
  'focus.previous': ['Shift+F6'],
  'zoom.restore': ['Escape'],
  'zoom.toggle': [],
};

/**
 * True when a key string names the key of an event, with exactly its
 * modifiers. A key string is modifiers and a key, joined with `+`, for
 * example `Mod+Shift+ArrowLeft`: `Ctrl`, `Alt`, `Shift`, `Meta`, and `Mod`
 * (Meta on Apple platforms, Ctrl elsewhere), then a `KeyboardEvent.key`
 * value. A letter or a digit compares by `KeyboardEvent.code`, as Option
 * changes the key value on a Mac.
 */
export function matchesKey(binding: string, event: KeyboardEvent): boolean {
  const parts = binding.split('+');
  const key = parts.pop() ?? '';
  const apple = /Mac|iP/.test(navigator.platform);
  const has = (name: string, mod: boolean): boolean =>
    parts.includes(name) || (mod && parts.includes('Mod'));
  return (
    event.ctrlKey === has('Ctrl', !apple) &&
    event.metaKey === has('Meta', apple) &&
    event.altKey === has('Alt', false) &&
    event.shiftKey === has('Shift', false) &&
    (/^[a-z\d]$/i.test(key)
      ? event.code === (/\d/.test(key) ? 'Digit' : 'Key') + key.toUpperCase()
      : event.key === key)
  );
}
