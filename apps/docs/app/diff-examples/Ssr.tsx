import { FileDiff } from '@pierre/diff-ui/lit';

export function Ssr() {
  return (
    <FileDiff code="<h1>Hello from FileDiff!</h1><p>This is some HTML content.</p>">
      <p>Diff annotation here</p>
    </FileDiff>
  );
}
