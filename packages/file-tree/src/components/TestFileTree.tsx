import type { JSX } from 'preact';

export function TestFileTree(): JSX.Element {
  return (
    <div>
      TestFileTree
      <button
        onClick={() => {
          console.log('clicked');
        }}
      >
        Click me
      </button>
    </div>
  );
}
