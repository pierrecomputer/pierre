// A value that a feature keeps for the life of a view and changes in its
// callbacks, outside the renders of `Root`, for example the boxes before a
// change. React state would render the view for each change.

/** A value that a feature reads and changes in its callbacks. */
export interface Cell<T> {
  get(): T;
  set(value: T): void;
}

/** A cell with a first value: `useState(() => cell(value))` keeps one for the view. */
export function cell<T>(value: T): Cell<T> {
  return {
    get: () => value,
    set(next) {
      value = next;
    },
  };
}
