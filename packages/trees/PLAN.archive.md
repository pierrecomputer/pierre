# PRD — `@pierre/trees` Path-Store-Powered Rebuild

## Metadata

- **Source spec:** `.omx/specs/deep-interview-trees-path-store-powered.md`
- **Context snapshot:**
  `.omx/context/trees-path-store-powered-20260406T224005Z.md`
- **Planning mode:** ralplan / consensus
- **Scope:** planning only, no implementation

## Requirements Summary

Rebuild `@pierre/trees` as a new path-store-native product that preserves the
current **implementation possibilities** of the existing trees experience while
explicitly rejecting API and code compatibility as design constraints.

Grounded repo facts:

- `packages/trees` currently centers the product around a loader-driven,
  headless-tree/core-style seam with feature modules layered over it.
- `packages/path-store` now exposes a path-first topology/projection core with
  visible slices, typed events, mutation APIs, async child-load primitives,
  cleanup, and an optional scheduler helper.
- The strongest current proxy for the replacement feature bar is the demo set
  under `apps/docs/app/trees-dev`.
- The user explicitly wants:
  - vanilla/non-React APIs as the first-class system
  - React support to come later as a React-appropriate wrapper/hook layer
  - virtualization to be effectively always enabled in the new product
  - many concrete phases, each to be re-planned before implementation

## RALPLAN-DR Summary

### Principles

1. **Treat this as a new trees product, not a compatibility retrofit.**
2. **Keep path-store native; do not bend architecture around the old core
   seam.**
3. **Vanilla first, React later.**
4. **Always-virtualized rendering is a product property, not an optional mode.**
5. **Recover capabilities through phased demos and verification, then delete
   legacy.**

### Decision Drivers

1. The user explicitly rejected API/code compatibility as a planning goal.
2. Path-store’s main advantages come from owning projection/visibility, so
   compatibility layers that restore the old state model risk negating the win.
3. The current `trees-dev` demos provide a concrete capability bar that can be
   phased and verified incrementally.

### Viable Options

#### Option A — Side-by-side new entrypoint with path-store-native kernel (recommended)

**Approach**

- Introduce a clearly separate new trees entrypoint/product surface inside the
  repo/package.
- Build a new always-virtualized vanilla kernel around path-store.
- Recover capabilities phase by phase while old trees remains available.
- Promote/replace only after the new system clears the capability bar.

**Pros**

- Best matches the clarified non-compatibility goal.
- Keeps the new system free of loader/core baggage.
- Makes deletion criteria and phased demos straightforward.
- Allows React to be designed against a stable vanilla system later.

**Cons**

- Duplicates product surfaces for a while.
- Requires parallel demo/test infrastructure during migration.
- Delays final public unification until late in the plan.

#### Option B — In-place root replacement behind current `FileTree` APIs

**Approach**

- Swap internals under the existing root entrypoints and incrementally reshape
  the public APIs.

**Pros**

- Fewer parallel surfaces during migration.
- Smaller documentation split in the short term.

**Cons**

- Strong risk of compatibility drag.
- Encourages re-creating the current controlled/loader seams.
- Harder to evaluate the new product on its own merits.

#### Option C — Separate package/product (`trees-next`, similar)

**Approach**

- Build the new product in a separate package and deprecate the old one later.

**Pros**

- Maximal architectural isolation.
- Minimal risk of accidental coupling to old trees internals.

**Cons**

- Highest publish/discovery overhead.
- Splits brand/docs/adoption unnecessarily.
- More repo/package churn than the user asked for.

### Recommended Option

**Choose Option A.**

Build a side-by-side new entrypoint inside `@pierre/trees`, keep it explicitly
path-store-native, phase capabilities through new demos and tests, and only
remove the legacy core after the new system proves it can cover the desired
feature surface.

## Architect Review Synthesis

### Steelman antithesis

The strongest case against Option A is that a side-by-side lane may overinvest
in migration scaffolding, duplicate demos/docs for too long, and defer “real”
consumer validation behind architecture work. Since compatibility is already a
non-goal, one could argue that replacing the root entrypoints directly would
force faster convergence and avoid carrying two product stories through a long
rewrite.

### Tradeoff tensions

1. **clean side-by-side validation** vs **temporary duplication and churn**
2. **vanilla-first purity** vs **earlier React/consumer feedback**
3. **many bounded phases** vs **risk of losing momentum to process overhead**

### Synthesis

Keep Option A, but make it earn its cost:

- keep the new export surface intentionally narrow at first
- freeze the old lane except for bug fixes while the new lane grows
- require an early real workflow proof by the selection phase, not just kernel
  correctness
- keep React later, but explicitly on the critical path rather than an
  indefinite someday phase

## Critic Criteria for Approval

This plan is only acceptable if it preserves all of the following:

- path-store-native architecture as the default, not a soft preference
- mutable `PathStore` as the baseline runtime unless later evidence changes it
- explicit capability/demo-to-phase mapping so parity remains concrete
- per-phase exit criteria with visible proof, not just internal scaffolding
- a real old-core deletion gate
- a dedicated React phase instead of early pressure to recreate controlled
  wrappers by habit

## Proposed Architecture Direction

### 1. Product shape

Plan for a **new trees surface inside the package** rather than forcing the new
implementation through the current root exports on day one.

Directionally:

- old surface remains in place during migration
- new surface gets a clearly named provisional entrypoint/subpath
- final promotion to the root export is a late migration phase, not a starting
  assumption

The exact export names can be refined in a later phase plan, but the migration
should assume a deliberate side-by-side lane first.

### 2. Kernel shape

The new kernel should be centered on:

- a mutable `PathStore` for canonical topology + projection
- a renderer/controller that consumes `getVisibleCount()` and
  `getVisibleSlice()` directly
- small adjacent state domains only when path-store should not own the concern
  directly (for example selection, search session state, context-menu UI state)
- typed subscriptions/events rather than controlled-prop-first state loops

The new kernel should **not** preserve:

- the current generic feature layering
- the old loader-driven `getItem/getChildren` mental model
- path↔id compatibility helpers that only exist to preserve current APIs

Initial runtime bias:

- mutable `PathStore` is the baseline runtime for the new lane
- `StaticPathStore` is explicitly optional follow-up material, not a required
  first-lane dependency

### 3. Rendering model

The new product should assume:

- virtualization is always on
- the renderer consumes path-store visible slices directly
- “unvirtualized” rendering is not a product goal
- performance work should optimize the real visible-window path, not a fallback
  full-render mode

### 4. State model direction

The plan should reserve room for three categories of state:

1. **Path-store-owned state**
   - canonical topology
   - expansion
   - visible projection
   - async child load state
   - path-store-native mutations and events

2. **Adjacent lightweight stores / controllers**
   - likely candidates: selection, focus, search session state, rename draft
     state, context menu visibility/anchor state
   - use only when a concern should not distort path-store’s performance model

3. **Renderer/UI-local state**
   - hover/open-menu/temporary DOM interaction details

Whether a concern belongs in category 1 vs 2 should be decided phase by phase,
with the default bias toward protecting path-store’s performance guarantees.

### 5. API philosophy

The new APIs should optimize for:

- explicit subscriptions and actions
- composable vanilla flows first
- React wrappers/hooks built on top of those flows later
- end-user implementation possibilities, not API continuity

This means the migration may legitimately replace:

- controlled props
- old imperative setters
- loader callbacks
- old search/rename interaction contracts

### 6. Identity and ownership boundary

The overarching plan should lock one early rule: **do not let unstable internal
node IDs become the durable public identity of the new trees product by
accident**.

Directionally:

- path-store numeric node/row IDs may be used internally for fast rendering
- the new public trees APIs should prefer durable, user-meaningful identifiers
  (most likely canonical paths, unless a later phase deliberately proves a
  better contract)
- adjacent stores such as selection/focus/search should default to the durable
  public identity, not to internal IDs that may be invalidated by cleanup or
  compaction choices
- if a later phase wants to expose path-store IDs publicly, that must be an
  explicit phase decision with documented lifecycle semantics

Related ownership boundary:

- the new vanilla controller should own the live path-store instance internally
- it should expose explicit load/replace/mutation/subscription APIs for
  consumers rather than controlled-file props being the only source of truth
- the exact controller surface can be refined later, but the architecture should
  assume **controller-owned state with explicit actions** as the default

## Capability Bar / Replacement Target

The replacement bar is the **capability surface** represented by the existing
`apps/docs/app/trees-dev` demos, interpreted as product behaviors rather than
API requirements:

- rendering
- dynamic files / mutations
- drag and drop
- git status decoration
- header slot / composition surface
- context menu
- search modes
- state workflows
- virtualization
- custom icons / icon tiers
- SSR/hydration use cases

Interpretation rules:

- all of these should ideally return at least simply
- they do not need to return with the same APIs
- they do not all need to arrive in early phases
- non-virtualized rendering is explicitly excluded from the replacement bar

Capability-to-phase mapping:

| Capability / demo surface                                       | Primary phase(s) |
| --------------------------------------------------------------- | ---------------- |
| Rendering + virtualization                                      | 1                |
| Expansion/collapse portions of state workflows                  | 2                |
| Focus/navigation portions of state workflows                    | 3                |
| Selection + adjacent-pane workflow                              | 4                |
| Dynamic files / mutations                                       | 5                |
| Async / lazy loading                                            | 6                |
| Search modes                                                    | 7                |
| Renaming                                                        | 8                |
| Drag and drop / keyboard DnD                                    | 9                |
| Git status, header slot, context menu, custom icons, icon tiers | 10               |
| Vanilla SSR / hydration                                         | 11               |
| React wrapper / hooks / React demos                             | 12               |
| Final sweep + promotion + deletion                              | 13               |

Notes:

- some current pages such as `rendering` and `state` intentionally span multiple
  phases
- this mapping is about capability recovery, not one-for-one page migration
- every mapped capability should exist at least simply before final cutover

## Phased Migration Plan

This plan intentionally uses many phases. Any phase may split further during its
own follow-up planning pass.

### Phase 0 — Bootstrap the new product lane

**Goal**

- Establish the separate new trees lane without touching the old core.

**Deliverables**

- provisional new entrypoint/subpath(s)
- new docs/dev demo lane separate from `apps/docs/app/trees-dev`
- a required capability/demo-to-phase matrix that maps current `trees-dev` proof
  surfaces to the new migration phases
- new benchmark/profile/test lane for the path-store-powered implementation
- initial architectural skeleton for controller + renderer around path-store
- explicit draft of the new controller boundary: action/subscription model and
  durable public identity rule

**Exit criteria**

- old and new lanes can coexist cleanly in the repo/package
- future phases have a stable place to land code, demos, and tests

### Phase 1 — Always-virtualized rendering + scroll

**Goal**

- Render a path-store-backed tree window and support scroll-driven visible-slice
  updates.

**Deliverables**

- vanilla controller constructs and owns a `PathStore`
- renderer consumes `getVisibleCount()` + `getVisibleSlice()`
- path-store-backed virtual list with basic row rendering
- performance checkpoints for visible-window render/scroll

**Exit criteria**

- large-tree render + scroll demo works
- no fallback non-virtualized mode is required

### Phase 2 — Expansion / collapse

**Goal**

- Add user-visible tree shape changes through path-store-native expansion.

**Deliverables**

- expand/collapse actions and subscriptions
- expansion-triggered visible slice invalidation/render updates
- flatten-aware row rendering where applicable

**Exit criteria**

- expansion/collapse demo works in the new lane
- expansion behavior is path-store-native rather than emulated through the old
  core

### Phase 3 — Focus / navigation

**Goal**

- Add keyboard and focus movement through the virtualized tree.

**Deliverables**

- focus state model
- item-to-item navigation over visible rows
- DOM focus synchronization and scroll-into-view behavior
- baseline tree keyboard navigation

**Exit criteria**

- focus/navigation demo works for the new lane
- navigation remains correct under virtualization and expansion

### Phase 4 — Selection

**Goal**

- Support single/multi-selection and realistic adjacent-UI workflows.

**Deliverables**

- selection state model (likely adjacent lightweight store/controller)
- selection subscriptions/actions for vanilla consumers
- proof-of-use-case demo such as tree selection driving an adjacent detail pane

**Exit criteria**

- simple selection workflows are ergonomic in vanilla
- selection architecture does not compromise path-store guarantees

### Phase 5 — Composition surfaces (slots, context menu shell, icons)

**Goal**

- Re-establish the compositional UI surfaces that make the product extensible.

**Deliverables**

- header composition slot/surface
- context-menu trigger/open/close plumbing
- custom icon/decorator hooks sufficient for simple demos
- icon-tier rendering strategy for the new row model

**Exit criteria**

- header slot, context menu, and icon demos have simple equivalents in the new
  lane

### Phase 6 — Dynamic files / mutation API

**Goal**

- Reintroduce topology-changing workflows in the new API model.

**Deliverables**

- vanilla mutation API strategy built around path-store operations
- dynamic file demo equivalent
- clear mutation event/subscription contract

**Exit criteria**

- developers can drive path changes without leaning on legacy controlled file
  APIs
- dynamic-files demo has a working new-lane equivalent

### Phase 7 — Search

**Goal**

- Add a new search/filter model that fits the new architecture.

**Deliverables**

- search controller/store strategy
- injection points or built-in matching modes as later phase planning decides
- search-mode demos in the new lane

**Exit criteria**

- the new lane supports practical tree search without requiring old controlled
  search props

### Phase 8 — Renaming

**Goal**

- Re-establish rename workflows atop the new mutation/state model.

**Deliverables**

- rename action/draft/commit API
- focus/selection interplay during rename
- rename demo proof

**Exit criteria**

- rename works end to end without relying on legacy rename internals

### Phase 9 — Git-status + row decoration refinement

**Goal**

- Restore rich row decoration workflows.

**Deliverables**

- git-status decoration pipeline
- row decoration contracts consistent with icon/composition choices
- git-status demo parity in the new lane

**Exit criteria**

- path-store-powered rows can express status decorations cleanly and efficiently

### Phase 10 — Drag and drop

**Goal**

- Rebuild drag/drop on top of the new controller/mutation model.

**Deliverables**

- pointer drag/drop
- keyboard drag/drop (may split into 10A/10B if needed)
- collision/move semantics using the new mutation APIs
- drag/drop demo parity in the new lane

**Exit criteria**

- drag/drop no longer depends on legacy tree-core assumptions

### Phase 11 — Async / lazy loading

**Goal**

- Reintroduce lazy/async tree growth through path-store-native async contracts.

**Deliverables**

- path-store async primitive integration (`beginChildLoad`, patch, complete,
  fail)
- scheduler helper integration only when justified
- async loading API for vanilla consumers

**Exit criteria**

- async/lazy loading exists in the new lane without restoring old loader-shaped
  contracts

### Phase 12 — SSR / hydration + shadow-host integration

**Goal**

- Re-establish server-rendered and hydrated flows for the new system.

**Deliverables**

- new SSR preload surface
- hydration path for the vanilla system
- explicit shadow-host/custom-element integration as implementation detail

**Exit criteria**

- SSR/hydration demos work in the new lane
- custom element remains an implementation detail, not the public center of the
  architecture

### Phase 13 — React hooks / wrapper

**Goal**

- Build the React experience _after_ the vanilla system is trustworthy.

**Deliverables**

- hook-based React integration surface (for example `useTrees`-style controller
  hooks)
- React wrapper built over the vanilla controller model
- deliberate replacement for old controlled props where appropriate
- React demos for the new lane

**Exit criteria**

- React usage feels native to React rather than being a thin compatibility trap

### Phase 14 — Capability sweep, promotion, and legacy deletion

**Goal**

- Verify the new lane covers the target product possibilities, then remove the
  legacy core.

**Deliverables**

- final parity matrix against the chosen demo/capability bar
- root export promotion decision and migration docs
- removal of legacy headless-tree/core-backed stores and obsolete demos/tests

**Exit criteria**

- agreed replacement bar is met
- legacy deletion is safe and deliberate

## Risks and Mitigations

### Risk 1 — New lane gets dragged back into compatibility mode

**Mitigation**

- keep the new lane separate from the root exports initially
- reject phase work that restores old APIs solely for continuity

### Risk 2 — State concerns leak into path-store in ways that hurt performance

**Mitigation**

- treat selection/search/rename/focus as deliberate ownership decisions
- bias toward adjacent lightweight controllers when unsure

### Risk 3 — React arrives too early and distorts vanilla architecture

**Mitigation**

- make React a late dedicated phase
- require vanilla proof before React abstractions land

### Risk 4 — Feature parity becomes hand-wavy

**Mitigation**

- use a mirrored docs/demo lane and explicit capability matrix
- require demo-backed exit criteria phase by phase

### Risk 5 — Drag/drop and async loading explode phase size

**Mitigation**

- explicitly allow subphases
- keep the overarching plan granular and re-plan those phases before execution

## Verification Strategy

Across the migration, each phase should add or update:

- focused unit/integration tests near the new kernel/controller code
- demo proof in the new docs/dev lane
- the capability/demo-to-phase matrix when a phase claims new coverage or splits
  a previous phase
- targeted benchmark/profile coverage where the phase affects render,
  virtualization, expansion, mutation, or async behavior
- package-level `tsc`, tests, build, and relevant E2E checks

The plan should prefer **phase-local proof** over waiting for one giant parity
pass at the end.

## ADR

### Decision

Build a side-by-side, path-store-native new trees product lane inside
`@pierre/trees`, phase capabilities through many small milestones, keep vanilla
first-class, delay React until later, and delete the legacy core only after the
new lane clears the desired capability bar.

### Drivers

- Compatibility is explicitly not a goal.
- Path-store’s value comes from native ownership of projection/visibility.
- The repo already has a concrete demo-based feature bar to phase against.

### Alternatives considered

- In-place replacement under current APIs
- Separate package/product

### Why chosen

It offers the cleanest route to a genuinely better product without letting the
old architecture dominate the new design.

### Consequences

- The repo will temporarily carry two trees lanes.
- Documentation/demos/tests will need parallel structure during migration.
- The final promotion/removal step becomes an explicit late milestone.

### Follow-ups

- Phase-specific deep interviews and plans before execution
- export naming decision in Phase 0/1 planning
- dedicated React API planning once vanilla phases mature

## Available Agent Types / Suggested Staffing

Useful roles for later execution:

- `architect` — boundary decisions, export surface, state ownership splits
- `executor` — controller/renderer implementation phases
- `test-engineer` — phase-local test and demo proof design
- `verifier` — phase completion evidence and parity checks
- `writer` — migration/docs/demo guidance
- `critic` — review on especially risky phases (async, drag/drop, React)

Suggested reasoning-by-lane:

- architecture/state ownership phases: **high**
- render/controller implementation: **high**
- demo/test harness work: **medium**
- docs/migration notes: **medium**
- parity verification: **high**

## Staffing Guidance

### If executed via `$ralph`

Use one-owner sequential delivery for early kernel phases:

- Phase 0–4 are good Ralph candidates because architecture and feedback loops
  are tightly coupled.
- Keep verifier review at the end of each phase before moving on.

### If executed via `$team`

Use coordinated lanes when a phase has disjoint workstreams.

Example team splits:

- **Lane 1:** kernel/controller implementation
- **Lane 2:** docs/demo lane + examples
- **Lane 3:** tests/benchmarks/verification
- **Lane 4:** API/docs migration notes when needed

Suggested launch hints later:

- `$team <phase-plan-path>` when a phase clearly splits into kernel/demo/test
  lanes
- `$ralph <phase-plan-path>` when the phase is architecture-heavy or tightly
  coupled

## Team Verification Path

For any execution phase, require:

1. targeted unit/integration tests for the new code path
2. updated new-lane demo proof in docs
3. relevant performance or interaction benchmark/profile checks when applicable
4. `bun ws trees tsc`
5. `bun ws trees test`
6. `bun ws trees build`
7. phase-specific E2E/SSR verification when the phase touches those flows

Do not promote or delete legacy surfaces until the new-lane proof is collected
for the required phases.
