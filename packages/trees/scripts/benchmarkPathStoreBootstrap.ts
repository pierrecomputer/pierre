import { PathStoreTreesController } from '../src/path-store/index';

const controller = new PathStoreTreesController({
  paths: [
    'README.md',
    'package.json',
    'src/components/Button.tsx',
    'src/components/Card.tsx',
    'src/index.ts',
  ],
});

const start = performance.now();
for (let index = 0; index < 1_000; index += 1) {
  controller.getSnapshot();
}
const durationMs = performance.now() - start;

console.log(
  JSON.stringify(
    {
      bootstrapSnapshotCalls: 1_000,
      durationMs: Number(durationMs.toFixed(3)),
      visibleCount: controller.getSnapshot().visibleCount,
    },
    null,
    2
  )
);

controller.destroy();
