import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';

const CODE_GLOBAL = `:root {
  --pjs-font-family: 'Berkeley Mono', monospace;
  --pjs-font-size: 14px;
  --pjs-line-height: 1.5;
}`;

const CODE_INLINE = `<FileDiff
  style={{
    '--pjs-font-family': 'JetBrains Mono, monospace',
    '--pjs-font-size': '13px'
  } as React.CSSProperties}
  // ... other props
/>`;

export function Styling() {
  return (
    <section className="space-y-4">
      <h2>Styling</h2>
      <p>You can customize fonts and other styles using CSS variables:</p>
      <SimpleCodeBlock
        code={CODE_GLOBAL}
        className="rounded-lg overflow-hidden border"
      />
      <p>Or apply inline styles to the container:</p>
      <SimpleCodeBlock
        code={CODE_INLINE}
        className="rounded-lg overflow-hidden border"
      />
    </section>
  );
}
