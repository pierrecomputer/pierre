# Path-Store Trees Controller Boundary Draft

This file is a **Phase 0 draft**, not a frozen public contract.

## Purpose

The path-store-powered trees lane needs a vanilla-first controller boundary that
later rendering and state phases can build on without reintroducing the legacy
loader/core seam.

## Draft rules

1. The controller owns the live `PathStore` instance.
2. Consumers integrate through **explicit actions and subscriptions**, not
   controlled props as the primary source of truth.
3. The controller boundary must stay **renderer/host agnostic** so later phases
   can support DOM, SSR, and hydration flows without browser-only assumptions.
4. Internal PathStore numeric IDs are **renderer/store tokens only**.
5. The default durable public identity is the canonical path string unless a
   later phase explicitly proves a better contract.

## Early-phase consequences

- SSR-safe usage is a design constraint immediately, even before the dedicated
  SSR phase lands.
- React-facing abstractions are intentionally deferred.
