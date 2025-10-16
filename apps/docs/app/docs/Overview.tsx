export function Overview() {
  return (
    <section className="space-y-4">
      <h2>Overview</h2>
      <p>
        Precision Diffs provides both React components and vanilla JavaScript
        renderers. The React components are lightweight wrappers around the core
        vanilla JS library. All diffs are rendered using Shadow DOM, CSS Grids,
        and modern web technologies for optimal performance and styling
        isolation.
      </p>
      <p>Choose the API that best fits your project:</p>
      <ul>
        <li>
          <strong>React API</strong>: Use the <code>FileDiff</code> component
          from <code>@pierre/precision-diffs</code> for React projects
        </li>
        <li>
          <strong>Vanilla JS API</strong>: Use the renderer classes from{' '}
          <code>@pierre/precision-diffs</code> for framework-agnostic usage
        </li>
      </ul>
    </section>
  );
}
