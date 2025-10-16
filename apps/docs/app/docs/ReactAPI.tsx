import { SimpleCodeBlock } from '@/components/SimpleCodeBlock';

const CODE = `import { FileDiff, type FileContents} from '@pierre/precision-diffs';

const oldFile: FileContents = {
  name: 'example.tsx',
  contents: 'const greeting = "Hello";'
};

const newFile: FileContents = {
  name: 'example.tsx',
  contents: 'const greeting = "Hello, World!";'
};

export default function MyComponent() {
  return (
    <FileDiff
      oldFile={oldFile}
      newFile={newFile}
    />
  );
}`;

export function ReactAPI() {
  return (
    <section className="space-y-4">
      <h2>React API</h2>
      <h3>Basic Usage</h3>
      <p>
        Here&lsquo;s a basic example of using the React FileDiff component to
        render a diff between two files:
      </p>
      <SimpleCodeBlock code={CODE} language="tsx" />
    </section>
  );
}
