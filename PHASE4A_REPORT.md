# SENTINEL Phase 4A/4B status — September 18, 2026

**Phase 4B (reliability + reasoning refinement) is documented below the original Phase 4A report.** Phase 4A shipped Inspect Mode; two real live-multimodal tests then exposed a multi-object grounding bug and an over-eager "replace it anyway" bug, which Phase 4B fixes at the architecture level. Jump to [Phase 4B](#sentinel-phase-4b-status--september-18-2026) for that work.

---


Inspect Mode is implemented and reuses the existing Request Mode commerce pipeline end to end. No live paid vision call was made while building this phase; all interactive verification used the labelled `broken-office-chair-caster` DEVELOPMENT FIXTURE. Real-money purchase execution remains unconditionally disabled and unmodified.

| Requested report item | Result |
| --- | --- |
| 1. Branch | `claude/phase4-inspect` |
| 2. Files changed | New: `src/lib/domain/inspection.ts`; `src/lib/server/image-validation.ts`; `src/lib/server/services/inspection.ts`; `src/lib/server/demo/inspection-fixtures.ts`; `src/app/api/inspect/analyze/route.ts`; `src/app/api/inspect/search/route.ts`; `src/hooks/use-inspection.ts`; `src/components/sentinel/inspect-{panel,upload,results}.tsx`; 6 new test files; this report. Modified: `src/lib/server/adapters/openai.ts` (multimodal support in the existing structured-call helper); `src/lib/server/ai-provider.ts`, `services/live-contracts.ts`, `services/runtime.ts` (wiring); `src/lib/server/services/request-mission.ts` (added `runFromIntent`, refactored the shared pipeline out of `execute`); `src/lib/server/http.ts` (parameterized `readJson`'s byte cap); `src/components/sentinel/{dashboard,mode-cards}.tsx`, `src/hooks/use-mission.ts` (Inspect view wiring); `src/app/globals.css` (Inspect styles); `.env.example`, `README.md`. |
| 3. Inspect Mode UI status | **READY.** Nav tab is live (no "SOON" badge). Upload → preview → Analyze → results → optional clarification/budget → Search → the existing shortlist/activity/checkout-review UI, all verified interactively in a browser. |
| 4. Image upload status | **READY.** Client validates type/size before upload; server re-validates independently by sniffing magic bytes (JPEG/PNG/WEBP), rejecting any mismatch or file over 10 MB, regardless of the claimed MIME type. No image is written to disk, logged, or committed. |
| 5. Structured multimodal analysis architecture | `ImageInspector.analyzeInspectionImage` (new interface in `live-contracts.ts`), implemented by the existing `OpenAIReasoner` alongside `understand`/`evaluate`, sharing its budget/rate-limit/error-sanitization helper. Model is configurable via `SENTINEL_INSPECT_MODEL` (defaults to Luna); nothing hardwires Astra. Output is a strict Zod schema (`inspectionAnalysisSchema`) with an explicit `outcome` enum for no-object/blurry/dark/unsupported/unclear-need cases, honesty-forcing instructions (no invented brand/model/dimension), and 0–1 confidence fields. The image's base64 size is never used to estimate token cost (a fixed conservative ceiling is used instead), so a large photo cannot inflate or break the $0.75-per-call budget check. |
| 6. Live AI call made? | **No.** All interactive verification used `SENTINEL_INSPECT_FIXTURE=broken-office-chair-caster`, which the UI marks as **DEVELOPMENT FIXTURE**. Per your instruction, no paid vision call was made without approval. |
| 7. AI money spent | **C$0.00** for image analysis. The one live search performed during interactive verification made 1 free Agnic call and 1 Luna ranking call (the same second call Request Mode already makes) — no vision spend. |
| 8. ProductIntent conversion status | **READY.** `buildProductIntentFromInspection` (pure, in `lib/domain/inspection.ts`) produces the exact `ProductIntent` shape Request Mode uses: CA/CAD defaults, optional budget, and unknown compatibility facts carried forward as explicit "not confirmed by the uploaded photo" caveats rather than dropped or invented. |
| 9. Existing Agnic search integration | **READY, reused unchanged.** `RequestMissionService.runFromIntent` shares `filterCandidates`, `applyEvaluations`, and `rankCandidates` with Request Mode; only the text-understanding step is skipped. Verified live: an uploaded photo → fixture analysis → "Search for Replacement" returned 5 real caster products from Agnic (Staples, shopSafety.ca) with real prices and merchant links. |
| 10. Compatibility behavior | Preserved. Because unknown measurements are injected into the intent as unresolved caveats, the existing evaluator's rule ("titles alone never prove device compatibility," "without interface/device evidence use NEEDS_VERIFICATION") continues to apply — verified live (all 5 results returned "Needs verification") and by a unit test asserting a cautious `NEEDS_VERIFICATION` verdict from the evaluator is never upgraded to `VERIFIED`. |
| 11. Request Mode regression status | **None.** All 172 pre-existing tests pass unchanged; a manual click-through of Request Mode after these changes behaved identically. |
| 12. Test count | **209 automated tests passed across 16 suites** (172 pre-existing + 37 new, covering image validation, schema honesty rules, the multimodal adapter, the inspection service, the shared-pipeline `runFromIntent` addition, and both new API routes). |
| 13. Lint result | Passed, zero warnings. |
| 14. TypeScript result | Passed, zero errors. |
| 15. Production build result | Passed (`next build --webpack`); both new routes (`/api/inspect/analyze`, `/api/inspect/search`) registered as dynamic functions. |
| 16. Secret scan result | Zero matches: grepped tracked and untracked source/tests for the live `OPENAI_API_KEY`/`AGNIC_API_KEY`/`AGNIC_TOKEN` values from `.env.local`, and for `console.log`/hardcoded-secret patterns in every new file. None found. |
| 17. Dispatch call count | **0.** Inspect Mode's server code has no path to `dispatchSandbox` or `placeOrder`; a unit test asserts both remain uncalled through `runFromIntent`. |
| 18. Real money spent | **C$0.00.** |
| 19. Manual action needed | None required to review this branch. If you want a live (paid) multimodal call verified against a real photo, say so explicitly — see the note below. |

## What is live vs. fixture-tested vs. still blocked

- **Live and verified in this session:** image upload/preview/validation, the fixture-driven analysis response and its honest confidence/unknown-compatibility display, conversion to a `ProductIntent`, and a real Agnic product search from that intent (5 real listings returned, all correctly marked "Needs verification"), through to the existing checkout-review panel reaching the same known Agnic sandbox blocker documented in `PHASE3_REPORT.md`.
- **Fixture-tested only (offline, no network):** the OpenAI adapter's `analyzeInspectionImage` request shape, honesty instructions, budget reservation behavior, and error handling — verified with mocked `fetch`, the same pattern `tests/openai.test.ts` already uses for `understand`/`evaluate`.
- **Not run, intentionally:** a real (paid) OpenAI vision call against an uploaded photo. `SENTINEL_ALLOW_PAID_AI=true` and a real `OPENAI_API_KEY` are present in this environment's `.env.local`, so this was deliberately avoided rather than assumed safe.
- **Still blocked, unchanged from Phase 3:** live sandbox checkout. Selecting an Inspect-sourced product and clicking "Prepare Merchant" reaches the same `merchant_not_linked` / `is_test=false` Agnic blocker described in `PHASE3_REPORT.md` and `AGNIC_SUPPORT_MESSAGE.md`. Nothing in this phase touches that code path.

## Manual verification performed

Ran the dev server on a scratch port (3002) with `SENTINEL_INSPECT_FIXTURE=broken-office-chair-caster` so no vision credits were spent, uploaded a synthetic test PNG through the real file-input flow (drag/drop target + hidden input, both wired), and confirmed: the DEVELOPMENT FIXTURE badge renders, the honesty-first results panel (object/issue/what-you-may-need/compatibility-to-verify/confidence/clarification questions) matches the spec's mock-up almost line for line, the client-truthful activity timeline updates correctly, "Search for Replacement" hands off into the real shared `ProductResults`/`ActivityPanel`/`ApprovalPanel` components, and product selection reaches the existing checkout-review UI unmodified. Desktop layout at ~1490px was visually confirmed; the added CSS reuses the exact class-naming and breakpoint conventions (`max-width: 800px` / `560px`) already shipped for Request Mode, but a live narrow-viewport screenshot was not captured in this session (the browser-automation window resize did not visibly change the captured viewport) — treat mobile layout as implemented-by-convention, not independently re-verified pixel-for-pixel this session.

## Optional live test

Inspect Mode is ready. One live multimodal call is optional for verification — say so explicitly and I will run it (it will spend a small, budget-capped amount of real OpenAI credit, no more than the existing $0.75-per-call / $5-total caps allow). I did not make that call without your approval.

INSPECT MODE: READY
LIVE MULTIMODAL TEST: NOT RUN
REAL-MONEY PURCHASE EXECUTION: DISABLED
REAL MONEY SPENT: C$0.00

---

# SENTINEL Phase 4B status — September 18, 2026

Two real live-multimodal tests (run with your explicit approval after the Phase 4A report above) exposed two distinct bugs. Both are fixed at the schema/application-logic level, not with prompt-only patches, and both now have permanent regression fixtures and tests built directly from the failures.

## The two real-world failures

**Test 1 — damaged USB-C cable + wall adapter.** The photo contained a damaged USB-C cable in the foreground and a separate, undamaged wall adapter in the background. SENTINEL merged attributes from both into one hallucinated object, "two-pin AC power cord" — a multi-object grounding failure: the model had no schema concept of "more than one object," so it collapsed two real things into one invented one.

**Test 2 — intact water bottle.** The photo showed an undamaged reusable water bottle. SENTINEL correctly identified it, then incorrectly offered "Search for Replacement" anyway — a condition/action conflation failure: the schema had no way to say "I looked, and nothing is wrong here," so an object simply existing was implicitly treated as a reason to shop.

## What was fixed

**Multi-object grounding (`src/lib/domain/inspection.ts`).** `InspectionAnalysis` no longer has one singular `object` field the model can fill inconsistently. It now has `detectedObjects: DetectedObject[]` (each with its own `id`, `label`, `category`, `brand`, `model`, `role`, `confidence`, and — critically — its own `visibleEvidence` list that must not borrow facts from another object), plus `primarySubjectId` and `primarySubjectAmbiguous`. Removing the old free-floating `object` field is itself part of the fix: there is no longer a second place for the model to (re-)describe the subject inconsistently with its own `detectedObjects` entry. The model prompt (`analyzeInspectionImage` in `src/lib/server/adapters/openai.ts`) was rewritten as an explicit numbered procedure: list objects separately first, keep each object's evidence scoped to itself, then choose one primary subject from prominence/focus/damage signals — or flag ambiguity instead of guessing.

**Condition vs. action separation.** `condition: {status, summary, visibleIssues, confidence}` (DAMAGED / MISSING_PART / EMPTY_OR_DEPLETED / INTACT / POSSIBLE_HAZARD / UNCERTAIN) describes only what is physically true of the primary subject. `recommendedAction: {action, reason}` (SEARCH_REPLACEMENT / SEARCH_PART / SEARCH_REFILL / ASK_USER_INTENT / ASK_CLARIFICATION / CHOOSE_SUBJECT / NO_ACTION) is a separate field for what to do about it. An INTACT object always maps to ASK_USER_INTENT, never to a SEARCH_* action, at the prompt level.

**The guard lives in code, not only the prompt (your Part 13 requirement).** `resolveInspectionStep(analysis, selectedSubjectId)` in `src/lib/domain/inspection.ts` is a pure function, independent of any model call, that decides the UI step from `recommendedAction`/`primarySubjectAmbiguous`. `buildProductIntentFromInspection` calls it and **refuses to build a ProductIntent** unless either (a) the model's own `recommendedAction` is already one of the three SEARCH_* actions, or (b) the caller supplies an explicit `decision.userIntent` representing a real user choice. This means even if a future prompt regression made the model recommend a search for an intact object, the application code would still block it — verified directly in `tests/inspection-decision.test.ts` by calling the function with the intact-bottle fixture and confirming it throws without an explicit override.

**User intent can still override visual condition (your Part 22 requirement).** When condition is INTACT (or the subject was disambiguated from an ambiguous scene), the UI shows a small set of explicit choices — "Find another one" / "Find an upgrade" / "Find an accessory" — and clicking one supplies the `decision.userIntent` override that unblocks `buildProductIntentFromInspection`. A user can also type an explicit note (e.g. "I want a bigger one") that flows into `originalRequest`. Nothing to shop for is ever assumed from the photo alone; it always comes from either visible damage or an explicit click.

**Safety hedging (POSSIBLE_HAZARD).** The prompt requires hedged language ("may", "appears", "visible damage suggests") for anything that could expose wiring or similar risk, and forbids presenting it as a diagnosis. Verified live: the cable fixture's warning reads "may pose an electrical safety risk," not "is dangerous."

**Generic placeholders (Part 11).** The clarification input's example changed from the chair-specific "It's a Herman Miller Aeron" to "e.g. brand, model, size, or anything else you know"; the extra-requirement example changed from "safe for hardwood floors" to "e.g. a specific size, color, or feature." Verified live for both the cable and bottle scenarios.

**UI language (Part 12).** "COMPATIBILITY TO VERIFY" now only renders on the actual search-ready branch (the "DETAILS I CAN VERIFY" heading), instead of always appearing regardless of whether it made sense. Non-search branches show "WHAT WOULD YOU LIKE HELP WITH?" (intact) or the subject picker (ambiguous) instead.

**Context-aware CTAs (Part 25).** The final button reads "Search for Replacement," "Search for Replacement Part," "Search for Refill," "Find an Upgrade," "Find an Accessory," or "Find a Similar Item" depending on the resolved action — verified live (the bottle's CTA correctly changes to "Find an Upgrade" after that button is clicked).

## Updated inspection decision model

```
IMAGE
 → detect all objects (each with its own scoped evidence)
 → choose ONE primary subject, or flag ambiguity
 → assess that subject's condition (DAMAGED / MISSING_PART / EMPTY_OR_DEPLETED / INTACT / POSSIBLE_HAZARD / UNCERTAIN)
 → recommend an action, separately from condition
      SEARCH_REPLACEMENT / SEARCH_PART / SEARCH_REFILL  → auto-justified, code allows building an intent
      ASK_USER_INTENT / ASK_CLARIFICATION / CHOOSE_SUBJECT / NO_ACTION → code REQUIRES an explicit user decision first
 → only THEN, ProductIntent → existing Agnic search/rank/select/checkout pipeline (unchanged)
```

## Regression fixture coverage (`src/lib/server/demo/inspection-fixtures.ts`)

| Fixture | Covers |
| --- | --- |
| `damaged-usb-cable-with-adapter` | Real Test 1: two objects, correct grounding, POSSIBLE_HAZARD, SEARCH_REPLACEMENT |
| `damaged-single-cable` | Regression: the single-object path still works unchanged |
| `intact-water-bottle` | Real Test 2: INTACT → ASK_USER_INTENT, never an automatic search; also the base for user-override tests (upgrade / find-similar / accessory / explicit replacement) |
| `ambiguous-desk-objects` | Two unrelated, comparably prominent objects → CHOOSE_SUBJECT, no guess |
| `missing-part-visible` | MISSING_PART → SEARCH_PART (part-level, not whole-item) |
| `broken-office-chair-caster` | Known category, unknown exact compatibility → caveats, never invented specs |
| `image-too-blurry` | Outcome failure — never reaches step resolution or intent creation |
| `irrelevant-photo` | Non-shoppable subject → NO_ACTION, blocked even with an override |

37 new/updated automated tests exercise these fixtures and the pure decision functions directly (`tests/inspection-decision.test.ts`, plus updates to `tests/inspect-mission.test.ts` and `tests/inspection-adapter.test.ts`); none call a live model or Agnic.

## Manual UI review performed (fixture mode, zero AI calls)

Ran the dev server on a scratch port with `SENTINEL_INSPECT_FIXTURE` set to each of the four required scenarios in turn, uploading a synthetic test image through the real upload flow each time:

- **Damaged cable + wall adapter:** results correctly show only the cable under "WHAT I CAN SEE," a separate "Also visible in this photo: Wall power adapter. Only usb-c charging cable drove this recommendation" line, the hedged hazard warning, and the honest "Device being charged / Required wattage / Data transfer capability / Cable length / USB generation" unknowns — never "two-pin AC power cord" anywhere.
- **Intact water bottle:** no "Search for Replacement" button appears automatically; only "Find another one / Find an upgrade / Find an accessory" render. Clicking "Find an upgrade" reveals the budget/requirement fields and a CTA that now reads "Find an Upgrade."
- **Ambiguous two-object scene:** "MULTIPLE ITEMS DETECTED" with an "Office chair" / "Desk lamp" picker; clicking "Desk lamp" correctly shows only that object under "WHAT I CAN SEE," notes the chair as "Also visible," and proceeds to the same intent-choice buttons as the intact case (condition was genuinely unknown for the ambiguous scene, so no auto-search there either).
- **Damaged single object (no companion):** unaffected — still reaches "Ready to search" cleanly, confirming the multi-object schema change didn't regress the common single-object path.
- **Mobile (390px viewport):** confirmed no horizontal overflow; the budget/requirement grid collapses to one column and the confidence row stacks vertically, matching the existing Request Mode breakpoints reused for these new elements.

## Remaining limitations / what would benefit from another live test

- `compatibilityRequirements` and `condition` are scoped to a single subject per analysis call. If a user picks a different subject than the model's own best guess in an ambiguous scene, SENTINEL does not re-derive detailed condition/compatibility for that specific object from the same photo — it falls back to the same generic "what would you like help with" choice used for intact objects. This is a deliberate simplicity trade-off (see Part 23: kept reusable for Build Mode, not specific to this bug) rather than a second model call.
- All verification in this phase used fixtures with clean, deliberately-written evidence. The real fix quality (does the model actually keep evidence scoped per-object on a genuinely cluttered real photo, does it correctly judge prominence for ambiguity) can only be confirmed with a real photo and a real model call.
- I recommend one more live multimodal test, ideally re-using a photo similar to the original USB-C cable + wall adapter photo that first exposed the bug, to confirm the hardened prompt actually keeps the two objects separate against the real model rather than only against fixtures we wrote to match the desired shape. **I have not made that call and will not without your explicit approval.**

## Final report

1. **Branch:** `claude/phase4-inspect` (still not merged into main)
2. **New commit hash:** recorded below after committing
3. **Files changed:** `src/lib/domain/inspection.ts`, `src/lib/server/adapters/openai.ts`, `src/lib/server/demo/inspection-fixtures.ts`, `src/hooks/use-inspection.ts`, `src/components/sentinel/inspect-panel.tsx`, `src/components/sentinel/inspect-results.tsx`, `src/app/globals.css`, `tests/inspection-adapter.test.ts`, `tests/inspect-mission.test.ts`, plus new `tests/inspection-decision.test.ts` and this report. No files outside Inspect Mode were touched.
4. **Multi-object grounding status:** READY — `detectedObjects[]` with per-object scoped evidence; verified against both fixtures and a live manual UI pass.
5. **Primary subject selection status:** READY — prominence/focus/damage-based selection, with explicit `primarySubjectAmbiguous`/`CHOOSE_SUBJECT` fallback when genuinely unclear; no guessing.
6. **Intact-object behavior status:** READY — INTACT condition never auto-generates a search; requires an explicit user choice, enforced in application code independent of the model prompt.
7. **Inspection outcome model:** `outcome` (image-level analyzability) + `condition.status` (physical state) + `recommendedAction.action` (next step) — three separate, independently testable fields instead of one overloaded outcome enum.
8. **Action / CTA logic:** `resolveInspectionStep` drives five UI branches (CHOOSE_SUBJECT / ASK_USER_INTENT / ASK_CLARIFICATION / READY_TO_SEARCH / NO_ACTION); CTA label is context-aware per resolved action.
9. **ProductIntent gating logic:** enforced in `buildProductIntentFromInspection` itself — throws unless the model's own evidence justifies a search or the caller supplies an explicit user decision; independent of prompt wording.
10. **Clarification behavior:** at most 2 questions (schema-enforced), asked only for genuine condition uncertainty (ASK_CLARIFICATION), separate from the non-blocking compatibility-detail clarification already used on the search-ready path.
11. **Compatibility evidence behavior:** unchanged philosophy — verified/likely/unknown per subject, unknowns always carried into the ProductIntent as caveats, never invented; a cautious NEEDS_VERIFICATION verdict from the shared evaluator is never upgraded.
12. **Regression fixture results:** all 8 fixtures (including both real-failure reproductions) pass their assertions; 37 new/updated tests, 0 failures.
13. **Request Mode regression status:** none — zero lines changed outside Inspect Mode; all pre-existing tests pass unchanged.
14. **Total test count:** **237 automated tests passed across 17 suites.**
15. **Lint result:** passed, zero warnings.
16. **TypeScript result:** passed, zero errors.
17. **Production build result:** passed; both Inspect routes still register correctly.
18. **Secret scan result:** zero matches against live `.env.local` credential values or logging patterns in any changed file.
19. **AI calls made during this refinement:** **0.** All development and verification used `SENTINEL_INSPECT_FIXTURE`.
20. **Agnic calls made during this refinement:** **0.** No search was triggered during this phase's manual UI review (only analysis, not "Search for Replacement," was exercised).
21. **Dispatch call count:** **0.**
22. **Real money spent:** **C$0.00.**
23. **Recommend another live image test:** yes, specifically re-testing a cable+adapter-style photo against the hardened prompt with your explicit approval (see "Remaining limitations" above).

INSPECT MODE RELIABILITY: READY
MULTI-OBJECT GROUNDING: READY
INTACT-OBJECT ACTION LOGIC: READY
LIVE AI CALLS DURING REFINEMENT: 0
REAL-MONEY PURCHASE EXECUTION: DISABLED
REAL MONEY SPENT: C$0.00
