# SENTINEL handoff — Phase 5 not yet implemented

Paused at the user's request on September 18, 2026 so Claude can continue.

## Verified repository state

- Initially on `claude/phase4-inspect`, HEAD `b066173`. Main was `1286bd7`; Inspect was not merged.
- Initial generated `next-env.d.ts` change normalized during the production build. No user work was discarded.
- Reviewed Claude's Inspect implementation and fixed three actual intent defects: conflicting INTACT + SEARCH action now requires explicit intent; ambiguous subject selection uses the selected object's category without borrowing global attributes; accessory searches also set the accessory product type.
- Inspect fixtures now fail explicitly outside development/test, without falling back to paid inference.
- Fix commit: `7808276` (four files: inspection domain/service and their decision/service tests).
- Normal, non-destructive merge into main: `bef6b4a11a9e120e006a950eb10cdd8be57c04d6`.
- Main and the retained `claude/phase4-inspect` branch were pushed successfully.
- Created the exact requested branch `astra/phase5-build` from validated main. No Build implementation exists yet.
- All 244 tests, lint, TypeScript, production build and secret scan passed before AND after merge. Secret scan covered 144 source/build files plus Git history, with zero current-secret matches.
- No application model calls, Agnic calls, dispatch calls or purchases made during this handoff work. Local AI ledger stayed C$0.03805000000000001, with no pending reservations. Incremental app AI cost: C$0.00.

## Continue here

Read the user's complete Phase 5 request, supplied as the latest pasted attachment, and existing AGENTS.md. The request is at:
`/Users/tarunkarnati/.codex/attachments/9e601133-0465-4868-a01b-7b900bbb1047/pasted-text.txt`.

Implement Build Mode on `astra/phase5-build`. Preserve the premium light UI and existing Request/Inspect behavior. Reuse image validation, the OpenAI abstraction and Agnic search pipeline. Do not rebuild those systems. No checkout, payment, dispatch, sandbox workaround, spending-limit or real-purchase safety changes.

Do not make a live Build analysis call during implementation. Tests and browser verification must use clearly labeled development-only fixtures. Do not launch product searches after analysis automatically. One economical, configurable scene call per explicit image submission; no retries or per-component AI ranking. Search three selected components per explicit batch using the existing commerce service/cache, show 2–3 options per component, and retain unknown compatibility.

No implementation agent remains active. The UI agent only read files and proposed a plan; it never received permission to begin editing. There are no partial Build edits to preserve.

## Proposed contracts (design only, not code)

Suggested module: `src/lib/domain/build.ts`.

- `BuildConstraints`: budgetMaxAmount nullable; goal, alreadyOwn, requirements strings; country/currency default CA/CAD.
- `BuildAnalysis`: scene title/description/confidence; multiple components with scoped evidence, nullable brand/model, ESSENTIAL/RECOMMENDED/OPTIONAL/DECORATIVE role, inferred requirements, unknowns, compatibility requirements and quantity; dependency edges; existingItems; missingInformation; up to three questions; summary. Reuse Inspect's common object fields where sensible without importing its primary-subject assumption.
- `createBuildPlan(analysis, constraints, selectedIds?)`: title, original budget, country, items (componentId/name/role/quantity/owned/included/budgetAllocation/intent), dependencies, warnings and shipping/tax reserve. Allocate by functional priority/category, not equally; never increase the total budget. Exclude owned items from purchasing while retaining dependency context.
- `BuildSession`: id, analysis, constraints, plan, source live/fixture, usage, expiresAt. Store only analysis/plan metadata in a bounded owner-scoped memory cache; never images/base64.
- Analyze API: POST `/api/build/analyze`, payload `{imageBase64,mimeType,constraints}`, response `{session}`. Reuse `readJson`, session ownership, byte sniffing and 10 MB limit. Add concurrent-call guards to prevent duplicate paid submissions.
- Search API: POST `/api/build/search`, payload `{planId,selectedIds,clarification?}`. Rebuild intents from the server-owned session. Search at most three pending components per click. Optional NDJSON activity/complete/error events; events describe actual actions/results only.
- `BuildSearchResponse`: plan, cumulative results for the current selection/clarification, remainingIds, usage. Changing selection/notes invalidates old results/allocations.
- `BuildComponentResult`: componentId, products, mission (`RequestMission` for live results, null for fixtures), source agnic/fixture, error nullable. Fixture options must be labeled invented and never enter checkout.
- `evaluateBuildDependencies(plan,selections)` and `calculateBuildTotal(plan,selections)` pure helpers. Use exact evidence for narrow compatibility checks; absent dimensions/load/connector data stays NEEDS_VERIFICATION. Sum integer minor units with quantities; clearly mark incomplete totals and budget violations.
- Extend `RequestMissionService.runFromIntent` with an explicit Build catalogue-only evaluation option; keep current Request/Inspect defaults unchanged. Build searches need no extra model call. Cache keys must separate evaluation modes. Keep live missions in the existing selection store so the existing ApprovalPanel can review a chosen component.
- Self-contained `BuildPanel` + `useBuild` hook. Make Build navigation active and hide Request workspace only in Build view. Reuse InspectUpload with optional copy/ID props, preserving Inspect defaults. Include objectURL cleanup, abort handling and synchronous submit guards. Display up to three questions and pass optional clarification notes only on explicit search.
- Dev fixtures: gaming-desk-setup, home-office-setup, simple-streaming-setup. Both analysis and product fixtures must be explicit and rejected in production. No silent live fallback.

The existing shared OpenAI Responses adapter supports image inputs and strict Zod structured output. Official docs were checked: https://developers.openai.com/api/docs/guides/images-vision and https://developers.openai.com/api/docs/guides/structured-outputs. Keep existing configured economical model/provider; Build-specific model can be configured. Preserve existing budget caps and store:false. No new SDK is needed.

## Required finish

Add offline tests covering the user's 28 areas; run full tests/lint/typecheck/build/secret scan; verify the fixture flow at 1440+ and 390px without horizontal overflow. Update README and create PHASE5_REPORT.md with the requested 33 report items and explicit LIVE/FIXTURE-TESTED/NOT YET LIVE boundaries. Commit/push stable changes, but do not merge Build into main without approval.

Stop before any paid verification and say: “Build Mode is ready for one optional live multimodal verification.”

Known Agnic issue remains external: official merchant `merchant_untitled_fidget_shop` returns catalog:null / merchant_not_linked, with no verified C$1 SKU. Do not revisit it this phase. Real-money purchase execution remains disabled.
