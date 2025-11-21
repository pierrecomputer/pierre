import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';

function App() {
  const [count, setCount] = createSignal(0);

  return (
    <div>
      <h1>Hello, World!</h1>
      <p>This is a minimal SolidJS app running with Bun.</p>
      <div>
        <button onClick={() => setCount(count() + 1)}>
          Count: {count()}
        </button>
      </div>
    </div>
  );
}

render(() => <App />, document.getElementById('root')!);
