import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';

export function Installation() {
  return (
    <section className="space-y-4">
      <h2>Installation</h2>
      <p>Install the Precision Diffs package using bun, pnpm, npm, or yarn:</p>
      <SimpleCodeBlock
        code="bun add @pierre/precision-diffs"
        language="bash"
        lineNumbers={false}
      />
    </section>
  );
}
