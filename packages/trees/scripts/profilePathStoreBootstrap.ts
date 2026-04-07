import {
  PathStoreTreesController,
  renderPathStoreTreesBootstrapShell,
} from '../src/path-store/index';

const controller = new PathStoreTreesController({
  paths: [
    'README.md',
    'package.json',
    'src/components/Button.tsx',
    'src/components/Card.tsx',
    'src/index.ts',
  ],
});

const snapshot = controller.getSnapshot();
const html = renderPathStoreTreesBootstrapShell(snapshot);

console.log(
  JSON.stringify(
    {
      controllerId: snapshot.controllerId,
      htmlLength: html.length,
      publicIdentity: snapshot.publicIdentity,
      visibleCount: snapshot.visibleCount,
    },
    null,
    2
  )
);

controller.destroy();
