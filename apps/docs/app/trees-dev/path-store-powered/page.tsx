import {
  PathStoreTreesController,
  renderPathStoreTreesBootstrapShell,
} from '@pierre/trees/path-store';

import { sharedDemoFileTreeOptions } from '../demo-data';
import { pathStoreCapabilityMatrix } from './capabilityMatrix';

export default function PathStorePoweredBootstrapPage() {
  const controller = new PathStoreTreesController({
    flattenEmptyDirectories:
      sharedDemoFileTreeOptions.flattenEmptyDirectories ?? true,
    paths: sharedDemoFileTreeOptions.initialFiles,
  });
  const shellHtml = renderPathStoreTreesBootstrapShell(
    controller.getSnapshot()
  );
  controller.destroy();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
          Path-store lane · provisional
        </p>
        <h1 className="text-2xl font-bold">Bootstrap Smoke</h1>
        <p className="text-muted-foreground max-w-3xl text-sm">
          This route is the Phase 0 smoke proof for the new path-store-powered
          trees lane. It shows that the lane exists publicly, can own a real
          path-store-backed controller, and can render an SSR-safe bootstrap
          shell without claiming the real virtualized render/scroll work that
          belongs to Phase 1.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Bootstrap shell proof</h2>
        <div
          className="rounded-md border p-4"
          dangerouslySetInnerHTML={{ __html: shellHtml }}
        />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Capability / phase matrix</h2>
        <p className="text-muted-foreground text-sm">
          This committed matrix maps the existing `trees-dev` proof surfaces to
          the phased migration plan for the new lane.
        </p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40">
              <tr>
                <th className="px-3 py-2 font-medium">Current demo</th>
                <th className="px-3 py-2 font-medium">Target phase(s)</th>
                <th className="px-3 py-2 font-medium">Notes</th>
              </tr>
            </thead>
            <tbody>
              {pathStoreCapabilityMatrix.map((row) => (
                <tr key={row.currentDemo} className="border-t">
                  <td className="px-3 py-2 font-medium">{row.currentDemo}</td>
                  <td className="px-3 py-2">
                    {row.targetPhases
                      .map((phase) => `P${String(phase)}`)
                      .join(', ')}
                  </td>
                  <td className="text-muted-foreground px-3 py-2">
                    {row.notes}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
