'use client';

import * as React from 'react';
import type { ReactNode } from 'react';

// React 19.2 / Next 16 ship the View Transitions integration as the
// experimental `unstable_ViewTransition` component. It is not present in the
// stable `@types/react` surface (and is absent entirely in browsers without
// the View Transitions API), so we resolve it off the React namespace at
// runtime and fall back to a passthrough. Wrapping shared elements on two
// routes with the same `name` lets the browser morph one into the other during
// an App Router navigation (see `experimental.viewTransition` in next.config).
interface ViewTransitionProps {
  name?: string;
  children?: ReactNode;
}

const ResolvedViewTransition = (
  React as unknown as {
    unstable_ViewTransition?: React.ComponentType<ViewTransitionProps>;
  }
).unstable_ViewTransition;

export function ViewTransition({ name, children }: ViewTransitionProps) {
  if (ResolvedViewTransition == null) {
    return <>{children}</>;
  }
  return (
    <ResolvedViewTransition name={name}>{children}</ResolvedViewTransition>
  );
}
