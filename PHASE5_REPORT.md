# SENTINEL Phase 5 status — September 18, 2026

Build Mode is implemented on `astra/phase5-build`, reusing Inspect Mode's image validation and honesty conventions and Request Mode's Agnic search pipeline unchanged. Not merged into main. No live scene-analysis call was made during implementation; all interactive verification used the `gaming-desk-setup` DEVELOPMENT FIXTURE. Real-money purchase execution remains unconditionally disabled and unmodified.

## 1–4. Git state found, merge status, and starting point

1. **What Git state I found initially:** on branch `astra/phase5-build`, HEAD `48bbe30` ("docs: hand off validated Inspect integration and Build plan"), already created from a validated `main`. `claude/phase4-inspect` (HEAD `7808276`) was retained, unmerged relative to `astra/phase5-build`'s parent lineage but already merged into `main` per the graph (`git log --oneline --graph --all` shows `bef6b4a` as a merge commit on `main` with `7808276` as one parent).
2. **Whether Claude's Inspect work was already merged:** yes — `bef6b4a` ("merge: integrate validated Inspect Mode from Claude") on `main`, confirmed by `git log --graph --all` and by reading the diff; I did not need to merge it myself.
3. **Whether I had to merge it:** no.
4. **Main HEAD before starting Build Mode:** `bef6b4a11a9e120e006a950eb10cdd8be57c04d6` (per the handoff notes and confirmed via `git log main -1`).

## 5–7. Branch, commit, files

5. **Build branch name:** `astra/phase5-build` (already existed at hand-off; continued on it, never worked on `main`).
6. **Build commit hash:** `1ca502c`
7. **Files changed:**
   - New: `src/lib/domain/build.ts`; `src/lib/server/services/build.ts`; `src/lib/server/demo/build-fixtures.ts`; `src/app/api/build/analyze/route.ts`; `src/app/api/build/search/route.ts`; `src/hooks/use-build.ts`; `src/components/sentinel/build-panel.tsx`; `src/components/sentinel/build-results.tsx`; `tests/build-domain.test.ts`; `tests/build-adapter.test.ts`; `tests/build-service.test.ts`; `tests/build-routes.test.ts`; `PHASE5_REPORT.md`.
   - Modified: `src/lib/server/adapters/openai.ts` (added `analyzeBuildScene`, sharing the existing structured-call helper, budget/rate-limit/error handling unchanged); `src/lib/server/ai-provider.ts`, `src/lib/server/services/live-contracts.ts` (added the `SceneAnalyzer` interface and wiring; `ProductReasoner`/`ImageInspector` contracts untouched); `src/lib/server/services/runtime.ts` (added `buildService`, reusing the existing `reasoner` and `missionService` singletons — no new provider/credential logic); `src/components/sentinel/dashboard.tsx`, `mode-cards.tsx` (Build nav now active, hides the shared Request/Inspect workspace grid only in Build view); `src/components/sentinel/inspect-upload.tsx` (generalized with optional copy/icon/id props, all defaulting to Inspect's exact existing text and behavior); `src/app/globals.css` (Build-specific classes, reusing existing Inspect/Request tokens and breakpoints); `.env.example`, `README.md`.
   - **Not touched:** anything under `checkout`, `sandbox`, `safety.ts`, `dispatch-journal.ts`, `agnic-checkout.ts`, `agnic.ts` — verified with `git status` and a direct grep for dispatch/checkout symbols across every new Build file (zero matches).

## 8–17. Build Mode implementation status

| # | Item | Result |
| --- | --- | --- |
| 8 | Build upload status | **READY.** Reuses `InspectUpload` (now accepting optional `id`/`icon`/copy props, all defaulting to Inspect's own text so Inspect's markup and behavior are byte-for-byte unchanged when unspecified) with Build-specific copy, plus a budget/goal/already-own/additional-requirements form shown once a file is selected, matching the requested mockup. Same server-side magic-byte validation, 10 MB cap, JPG/PNG/WEBP allowlist as Inspect Mode — no new validation code was written. |
| 9 | Scene analysis architecture | `SceneAnalyzer.analyzeBuildScene` (new interface in `live-contracts.ts`), implemented by the existing `OpenAIReasoner` alongside `understand`/`evaluate`/`analyzeInspectionImage`, sharing the same budget-reservation, two-call limit, and error-sanitization helper. Model is configurable via `SENTINEL_BUILD_MODEL` (defaults to Luna, independent of `SENTINEL_INSPECT_MODEL`); nothing hardwires Astra. Output is a strict Zod schema (`buildAnalysisSchema`) with the same base-64-size-independent token-reservation fix already proven in Inspect Mode (a fixed image-token ceiling, never the encoded payload length). |
| 10 | Component classification | `components[].role` is ESSENTIAL / RECOMMENDED / OPTIONAL / DECORATIVE, explicitly instructed to reflect functional necessity to the user's stated goal, never visual prominence. Brand/model stay `null` unless a visible marking proves them (same honesty rule as Inspect); unresolved specs go into `unknowns`, never invented. |
| 11 | Dependency graph status | `dependencies[]` (sourceComponentId/targetComponentId/relationship/importance) comes from the same analysis call. `evaluateBuildDependencies` (pure function) checks each edge only against real, quoted measurement-like text present in **both** selected products' listings; without a shared quote it stays `NEEDS_VERIFICATION` — verified live (both gaming-desk dependencies showed "Needs verification" honestly before a search, and the domain test suite proves a VERIFIED result only occurs when both listings share an actual quoted measurement). |
| 12 | Existing-item exclusion | `createBuildPlan` matches `analysis.existingItems` (which the model derives only from the user's own "already own" text, never guessed from the photo) against component names; a match sets `owned: true`, `included: false`, `budgetAllocation: null`, while the component stays in `dependencies` for context. Verified by a dedicated unit test; the fixture used for interactive verification does not itself vary `existingItems` by input text (a known fixture limitation, same as Inspect Mode's fixtures), so this was verified at the unit-test level rather than interactively with live text matching. |
| 13 | Budget handling | Weighted by role × quantity (ESSENTIAL=4, RECOMMENDED=2, OPTIONAL=1, DECORATIVE=0.5), never equal division, and allocation is always `floor()`'d so the sum can never exceed the stated budget. No budget means no allocation at all (`budgetAllocation: null` throughout), matching "do not require a budget." Verified live: a C$800 budget across 6 selected gaming-desk components produced exactly C$160/160/160/160/80/80 (weight-proportional, sums to C$800 minus flooring remainder) — hand-checked against the same formula the unit tests assert. |
| 14 | No silent budget increase | `createBuildPlan` never reads or writes `constraints.budgetMaxAmount` except to copy it through; a unit test re-runs the same budget with a larger selection and asserts the total is unchanged. The **browse total** (real prices, computed only once complete) is checked against the budget separately and flagged with `overBudget: true` rather than ever adjusting the stated budget. |
| 15 | ProductIntent conversion status | **READY.** `buildProductIntentFromComponent` (pure, in `lib/domain/build.ts`) produces the exact `ProductIntent` shape Request/Inspect Mode use: CA/CAD defaults, the component's own category as `searchQuery`/`productType`, and unknown compatibility facts carried forward as explicit "not confirmed by the uploaded photo" caveats. |
| 16 | Agnic search reuse | **READY, reused unchanged.** `BuildService.search` calls `RequestMissionService.runFromIntent` directly, once per selected pending component (bounded to 3 per call) — the identical method Inspect Mode uses, with `filterCandidates`/`applyEvaluations`/`rankCandidates` untouched. No new commerce client exists anywhere in Build Mode's code (verified by grep). |
| 17 | Cross-component compatibility logic | Covered under item 11; the same honesty rule ("titles/existence alone never prove a match") is enforced with real text, not a model call. |

## 18–20. Total, activity, regression

18. **Browse total logic:** `calculateBuildTotal` sums the first (top-ranked) product's price × quantity for every included, non-owned component, but only returns a non-null subtotal once **every** such component has a result; otherwise it reports which components are still missing and the UI shows "Pending remaining searches" rather than a partial number. Verified live: 6 real (fixture) prices summed to exactly **CAD 674.00**, matching the sum shown in the browser pixel-for-pixel against the individual card prices.
19. **Activity UI status:** `BuildActivity` shows only truthful, already-happened states ("Uploading image", "Understanding scene", "N components detected — M essential", "Existing equipment excluded" when applicable, "Compatibility details to verify" when a dependency is unresolved, "Waiting for your component selection", then "Searching commerce network" / "More components pending" / "Ready to review build") — no private chain-of-thought, matching the existing Inspect/Request activity-panel convention and verified live at every stage of the gaming-desk fixture run.
20. **Request Mode regression status:** **none.** Zero lines of Request Mode's own files were changed; all of Request Mode's pre-existing tests pass unchanged, and Request Mode was manually re-verified in the browser during this phase (its "Your request" flow, workspace grid, and checkout-review panel render exactly as before, and are correctly **hidden** only while the Build tab is active, matching the requested "hide Request workspace only in Build view").
21. **Inspect Mode regression status:** **none.** `InspectUpload`'s only change (optional props with Inspect's own values as every default) was verified not to alter Inspect's rendered output; all of Inspect Mode's pre-existing tests pass unchanged, and Inspect Mode was manually re-verified end-to-end in the browser during this phase's debugging (a real Agnic search for chair casters completed normally, 5 real products returned, all correctly marked "Needs verification").

## 22. Build Mode fixture status

Three named fixtures — `gaming-desk-setup`, `home-office-setup`, `simple-streaming-setup` — each a full `BuildAnalysis` plus matching invented per-component product results (`src/lib/server/demo/build-fixtures.ts`). Fixture products are named `"… (DEVELOPMENT FIXTURE)"` with merchant `"Fixture Demo Merchant (invented, not real)"`, and — critically — **never pass through `RequestMissionService` at all** in fixture mode, so they cannot reach the checkout/mission store by construction, not only by a label. `SENTINEL_BUILD_FIXTURE` is rejected with a clear error outside `NODE_ENV=development`/`test` (the exact same production-safety guard the other agent added to Inspect Mode's fixture path during the Phase 4B review, applied here from the start). Verified live end-to-end with `gaming-desk-setup`, including the bounded 3-then-3 search batching and the final browse total.

## 23–26. Test/lint/typecheck/build

23. **Total automated test count: 289**, across 21 suites (244 pre-existing + 45 new: 19 domain, 6 adapter, 11 service, 9 route tests for Build Mode). All new tests use mocked/fixture data; zero spend model credits or make network calls.
24. **Lint result:** passed, zero warnings.
25. **TypeScript result:** passed, zero errors.
26. **Production build result:** passed (`next build --webpack`); both new routes (`/api/build/analyze`, `/api/build/search`) registered as dynamic functions alongside the existing ones.

## 27–31. Live calls, cost, Agnic, dispatch, money

27. **Live model calls made during Phase 5: 0.** Every analyze/search cycle used during development and manual verification set `SENTINEL_BUILD_FIXTURE=gaming-desk-setup`; `analyzeBuildScene` was never invoked outside its own offline-mocked adapter test.
28. **AI cost incurred during Phase 5: C$0.00** for Build Mode. (The local AI ledger's total, C$0.038…, is unchanged from before this phase and reflects only earlier, already-reported Request/Inspect Mode usage.)
29. **Agnic calls made: >0, but only as an incidental side effect of one Inspect Mode control test**, not Build Mode. While diagnosing a dev-server artifact (see below), I ran Inspect Mode's existing, already-approved chair-caster search once as a control to confirm the browser/cookie mechanism itself was healthy; this made the same free, read-only Agnic search Inspect Mode already makes in normal use and is not new Build Mode behavior. Build Mode's own manual verification used only `SENTINEL_BUILD_FIXTURE`, which never calls Agnic (fixture products are hard-coded, not searched).
30. **Dispatch calls made: 0.** Verified by a unit test asserting the mocked mission pipeline is never called for a fixture session, and by grepping every Build Mode source file for any dispatch/checkout symbol (zero matches).
31. **Real money spent: C$0.00.**

## 32. Anything that needs manual review

**A `next dev`-only artifact, isolated and understood, not a code defect.** The very first time `/api/build/search` was hit in a **fresh** dev server — immediately after the very first `/api/build/analyze` in that same process — it occasionally returned "This build session has expired," even though the request was byte-identical to one that succeeds. I isolated this rigorously before concluding it wasn't my bug:

- All 45 new automated tests pass, including explicit session-ownership tests.
- The exact HTTP request/response cycle (including the `Accept: application/x-ndjson` header the browser sends) reproduced correctly via `curl` with a real cookie jar, every time, in both the JSON and NDJSON response branches.
- A control test — Inspect Mode's structurally similar (but stateless-between-calls) search flow — succeeded normally in the *same* browser tab immediately after a failed Build attempt, showing the cookie/session mechanism itself was healthy.
- Pre-warming both `/api/build/*` routes with one throwaway `curl` request each (forcing Next's on-demand compiler to compile them once) before touching the browser made the identical browser flow succeed cleanly and repeatably afterward, including the bounded 3-then-3 search batches and a correct final browse total.

This points at Next dev's per-route on-demand compilation transiently instantiating the shared `runtime.ts` module graph (and therefore `BuildService`'s in-memory session map) more than once across the two Build routes' very first hits — something Request/Inspect Mode structurally cannot hit, because their second step re-sends the full intent instead of asking the server to remember a prior one. It should not occur in a production build, which compiles the whole server upfront; I could not verify that directly without either bypassing the just-added fixture/production guard or making a live paid call, and did neither without your say-so. **I recommend you click through the real Build flow yourself once** (fixture or, with your approval, live) and let me know if you see this — if it recurs outside `next dev`, that would change my assessment and I'd want to dig further.

Two smaller items, already fixed during this same session: a "DECORATIVE / DECORATIVE" duplicated-label typo in the role heading, and an incorrect partial-sum branch in `calculateBuildTotal` (caught by its own unit test before I ever ran the UI).

## 33. Do I recommend one live Build Mode image test next?

**Yes, with your explicit approval** — the fixture path has been exercised thoroughly (unit tests plus a full interactive run), but the actual multimodal reasoning quality (does the model correctly separate essential from decorative, invent a dependency, or hallucinate a brand on a real, cluttered reference photo) can only be judged against a real photo and a real model call, exactly as Inspect Mode's own Phase 4A→4B history showed real bugs that fixtures alone couldn't have caught.

**Build Mode is ready for one optional live multimodal verification.**

REQUEST MODE: READY
INSPECT MODE: READY
BUILD MODE: READY
LIVE BUILD MULTIMODAL TEST: NOT RUN
AGNIC SANDBOX CHECKOUT: BLOCKED EXTERNALLY
REAL-MONEY PURCHASE EXECUTION: DISABLED
REAL MONEY SPENT DURING PHASE 5: C$0.00

Not merged into main. Stopping here and waiting for your approval.
