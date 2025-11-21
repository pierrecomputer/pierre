import { render } from 'solid-js/web';

function App() {
  return (
    <div>
      <h1>Hello, World!</h1>
      <p>This is a minimal SolidJS app running with Bun.</p>
    </div>
  );
}

render(() => <App />, document.getElementById('root')!);
