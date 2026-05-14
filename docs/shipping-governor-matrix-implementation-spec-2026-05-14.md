# Shipping Governor implementation spec for The Matrix

Status: implementation-ready
Owner lane: dollyops handoff -> dollycode implementation
Workspace cwd: /home/openclaw/hermes-workspace-the-matrix
Source task: t_b4f9e976
Child implementation task: t_c86879f2
Child QA task: t_2f47b3d3

## Verified repo surfaces

These are the existing insertion points confirmed in this workspace:

1. `src/server/swarm-kanban-canonical.ts`
   - Already parses canonical acceptance `key: value` text blocks from comments.
   - Best place to add a reusable line-based parser/helper for Shipping Governor task metadata.

2. `src/server/swarm-kanban-query.ts`
   - Already reads canonical SQLite tasks and returns card/task-detail payloads for `/api/swarm-kanban`.
   - Best place to surface parsed shipping metadata on cards and task detail.

3. `src/server/swarm-kanban-attention.ts`
   - Already computes board-wide attention and `suggestedActions` for `/api/swarm-attention`.
   - Best place to compute portfolio counts and over-limit warnings.

4. `src/screens/swarm2/swarm2-kanban-board.tsx`
   - Current Matrix Kanban dashboard/control-plane surface.
   - Already has top summary pills, lane cards, and task drill-down.
   - Best primary UI surface for Shipping Governor portfolio state.

5. `src/components/swarm/widget-rail.tsx`
   - Legacy Swarm attention rail consuming `/api/swarm-attention`.
   - Optional secondary surface for a compact warning/summary.

6. `src/routes/api/swarm-attention.ts`
   - Thin route wrapper around `getMatrixAttentionSnapshot()`.
   - Likely no logic change beyond updated response shape.

## Verified live data shape

Current canonical Kanban root store already contains body-level Shipping Governor metadata:

- `shipping_state: candidate`
- `shipping_state: active_build`
- `active_slot_type: none | build`

Live query on `/home/openclaw/.hermes/kanban.db` returned 2 rows using this pattern:
- `t_790ee895` -> `shipping_state: candidate`
- `t_b4f9e976` -> `shipping_state: active_build`

So the first implementation can safely treat task body `key: value` lines as the source of truth for now.

## Recommended implementation slice

### Goal
Add a read-only Shipping Governor portfolio summary + warning gate inside The Matrix so Dolly can see slot pressure before routing more build work.

### Safety posture
Ship this as advisory/guardrail first, not auto-mutation.

Why:
- metadata coverage is still sparse
- current tasks only prove `candidate` and `active_build`
- hard-blocking create/dispatch before coverage is proven risks false negatives and operator friction

So phase 1 should:
- parse and expose portfolio metadata
- show slot counts and warnings
- mark when a task looks like it would consume a limited slot
- not auto-promote, auto-park, auto-archive, or silently rewrite cards

## Data model to add

Add a shared parsed metadata shape, for example:

```ts
export type ShippingState = 'idea' | 'candidate' | 'active_build' | 'shipped' | 'parked' | 'killed'
export type ActiveSlotType = 'build' | 'research_plan' | 'none'

export type ShippingGovernorMeta = {
  shippingState: ShippingState | null
  activeSlotType: ActiveSlotType | null
  ownerLane: string | null
  acceptanceCriteria: string | null
  doneDefinition: string | null
  dummyOrNoSecretsPlan: string | null
  codexAcpSpecReady: 'true' | 'false' | 'n/a' | null
  displacesOrParks: string | null
  lastShippingReviewAt: string | null
}
```

Recommended helper approach:
- add a generic `parseKeyValueTextBlock()` helper in `src/server/swarm-kanban-canonical.ts`
- add `parseShippingGovernorMeta(text: string): ShippingGovernorMeta | null`
- reuse the existing acceptance-parser style rather than inventing YAML/frontmatter

## API/server changes

### 1. `src/server/swarm-kanban-query.ts`
Add parsed shipping metadata to:
- card payloads
- task detail payloads

Suggested additions:

```ts
shipping?: ShippingGovernorMeta | null
```

Also add a board-level portfolio summary on the overall query result when cards are loaded:

```ts
shippingGovernor?: {
  activeBuildCount: number
  activeBuildLimit: 2
  activeResearchPlanCount: number
  activeResearchPlanLimit: 3
  candidateCount: number
  ideaCount: number
  parkedCount: number
  killedCount: number
  shippedCount: number
  overActiveBuildLimit: boolean
  overResearchPlanLimit: boolean
  warnings: string[]
}
```

Counting rule for phase 1:
- count only tasks with recognized metadata
- `shipping_state: active_build` + `active_slot_type: build` -> Active Build slot
- `active_slot_type: research_plan` -> research/planning slot
- `candidate`, `idea`, `parked`, `killed`, `shipped` are display states, not active slots unless metadata says otherwise

### 2. `src/server/swarm-kanban-attention.ts`
Extend the attention snapshot with the same `shippingGovernor` summary and add suggested actions when limits are at/over threshold.

Suggested action examples:
- `review_shipping_slots`
- `park_or_finish_before_new_build`
- `review_research_plan_pressure`

Important: suggested actions remain informational only in phase 1.

### 3. `src/routes/api/swarm-attention.ts`
No special business logic expected; just return the richer snapshot.

## UI changes

### Primary surface: `src/screens/swarm2/swarm2-kanban-board.tsx`
This should be the first-class surface.

Add:
1. Top summary pills/cards near existing counts:
   - `Active Builds 1/2`
   - `Research/Planning 0/3`
   - `Candidates N`
   - warning pill if any limit is reached/exceeded

2. Card-level shipping badges when metadata exists:
   - `Candidate`
   - `Active Build`
   - `Parked`
   - `Killed`
   - slot badge: `build slot` or `research plan slot`

3. Task drill-down section for Shipping Governor metadata:
   - state
   - slot type
   - owner lane
   - spec-ready flag
   - done definition
   - displaces/parks field
   - last shipping review timestamp

4. Guardrail text on create/dispatch controls:
   - if current selected task is tagged `shipping_state: active_build` and build slots are already full, show a visible warning
   - do not silently disable everything unless there is a precise reason string shown in UI

Recommended phase-1 behavior:
- show warning banner/pill
- optionally disable `Create ready` and `Request dispatch` only when the user is about to act on a task explicitly tagged `active_build` and the limit is exceeded
- if disabled, the reason must be explicit: `Active Build limit reached (2/2). Park/finish another build or record Stig override.`

### Secondary surface: `src/components/swarm/widget-rail.tsx`
Optional but useful:
- add one compact portfolio line under Attention, e.g. `Shipping Governor: Active Builds 1/2 · Research 0/3`
- if over limit, surface a warn-toned item

This is secondary. Do not let legacy rail work delay the main Kanban dashboard slice.

## Test plan

### Server tests to add/update
1. `src/server/swarm-kanban-query.test.ts`
   - parses `shipping_state` and `active_slot_type` from task bodies
   - returns shipping metadata in card/task detail payloads
   - returns correct board-level portfolio counts

2. `src/server/swarm-kanban-attention.test.ts`
   - returns `shippingGovernor` summary
   - warns when Active Build count exceeds 2
   - warns when research/planning count exceeds 3
   - keeps suggested actions advisory only

### UI tests to add/update
3. `src/screens/swarm2/swarm2-kanban-board.render.test.tsx`
   - renders portfolio counters
   - renders shipping badges on cards/detail
   - shows explicit warning text when a limit is reached

Optional:
4. `src/components/swarm/widget-rail.tsx` render test if the compact summary is added

## Verification commands

Run from:
`/home/openclaw/hermes-workspace-the-matrix`

Minimum verification:
```bash
pnpm test -- src/server/swarm-kanban-query.test.ts src/server/swarm-kanban-attention.test.ts src/screens/swarm2/swarm2-kanban-board.render.test.tsx
pnpm build
```

If a widget-rail render test is added, include it in the targeted test command.

## Implementation notes for dollycode

- Prefer a small shared parser/helper instead of duplicating regex parsing in query + attention.
- Keep the response additive. Do not break existing consumers of `/api/swarm-kanban` or `/api/swarm-attention`.
- Do not introduce automatic task-state mutation from portfolio warnings.
- Do not infer `shipping_state` from vague prose when the explicit key is missing. Unknown should stay unknown.
- If you add an override concept later, make it explicit in metadata; do not silently ignore limits.

## Scope boundaries / will_not_do

- Do not change auth, gateway, or provider config.
- Do not auto-promote, auto-archive, auto-park, or auto-close real tasks.
- Do not treat missing metadata as permission to guess a slot classification.
- Do not deploy from this implementation task unless a separate ops task requests it.
- Do not broaden this into upstream/general Hermes contribution work.

## Ready-for-code conclusion

This is ready for dollycode.

Safest first slice:
1. parse metadata in server helpers
2. expose summary in `/api/swarm-kanban` and `/api/swarm-attention`
3. render summary + badges in `swarm2-kanban-board.tsx`
4. keep enforcement advisory-first with explicit warning copy
5. prove behavior with focused Vitest coverage and `pnpm build`
