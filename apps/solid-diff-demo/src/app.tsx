import { MetaProvider } from '@solidjs/meta';
import { Router } from '@solidjs/router';
import type { RouteSectionProps } from '@solidjs/router';
import { FileRoutes } from '@solidjs/start/router';
import { Suspense } from 'solid-js';

export default function App() {
  return (
    <Router
      root={(props: RouteSectionProps) => (
        <MetaProvider>
          <Suspense>{props.children}</Suspense>
        </MetaProvider>
      )}
    >
      <FileRoutes />
    </Router>
  );
}
