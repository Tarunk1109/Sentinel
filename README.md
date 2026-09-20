# SENTINEL

SENTINEL turns a Request Mode prompt, an Inspect Mode photo of something broken, or a Build Mode reference photo of something to create, into real Agnic product discovery, an evidence-based shortlist, merchant preparation, and a safe checkout quote. The light dashboard shows actual server activity, fulfillment choices, budget blocks, and a separate sandbox checkout flow. See [PHASE4A_REPORT.md](PHASE4A_REPORT.md) (Inspect Mode) and [PHASE5_REPORT.md](PHASE5_REPORT.md) (Build Mode) for what changed in each phase.

**Real purchase execution is unconditionally disabled.** The only dispatch implementation is a separate test flow requiring either a server-verified test merchant or Agnic's exact documented Shopify gateway sandbox identity, an explicitly configured test-card alias, a fresh quote, and the user's confirmation.

**Current sandbox status:** the narrow `untitled-fidget.shop` exception follows Agnic's current testing documentation: this ordinary Shopify merchant intentionally reports `is_test=false` while Shopify Payments is in test mode. The primary Hex Token is currently unavailable; the official Paw Print Charm backup has a live C$1.15 checkout ceiling before a delivery address. No dispatch has been sent. A successful order is never claimed without a genuine Agnic order ID and terminal status.

## Real vs demo vs not implemented

- **Real:** Request, multimodal Inspect, Build reasoning and bill of materials, Agnic discovery and live quotes, the Autopilot mandate engine, deterministic transcript interpretation, and browser speech input where supported.
- **Demo/runtime only:** Autopilot policies and runs use bounded in-memory storage. They reset on restart and can differ across serverless instances. Development fixtures are explicitly labelled and are unavailable in production.
- **Not implemented:** a persistent background scheduler, production accounts/database, or real-money purchase execution. `Run now` evaluates a mandate and never purchases.

## Run locally

Use Node 24 (`.nvmrc`) and `npm ci`. Keep existing credentials in `.env.local`; `.env.example` lists supported configuration without secrets. Never use `NEXT_PUBLIC_*` for credentials.

```sh
npm run dev -- --port 3001
```

For a stable production preview:

```sh
npm run build
npm run start -- --port 3001
```

Open [SENTINEL](http://127.0.0.1:3001). Scripts bind loopback only. Rebuild and restart production after source changes. The local checkout safety journal requires a persistent filesystem; do not enable sandbox dispatch on an ephemeral serverless deployment.

## Architecture

| Area | Main files |
| --- | --- |
| Typed domain and strict inputs | `src/lib/domain/commerce.ts`, `checkout.ts` |
| Reasoning and inference budget | `src/lib/server/adapters/openai.ts`, `ai-provider.ts`, `ai-budget.ts` |
| Agnic discovery and quotes | `src/lib/server/adapters/agnic.ts` |
| Explore, merchant metadata and sandbox execution | `src/lib/server/adapters/agnic-checkout.ts` |
| Mission and checkout orchestration | `src/lib/server/services/request-mission.ts`, `checkout.ts`, `live-contracts.ts`, `runtime.ts` |
| Server safety and dispatch journal | `src/lib/server/safety.ts`, `dispatch-journal.ts`, `http.ts`, `checkout-route.ts`, `provider-error.ts` |
| Inspect Mode: image validation, analysis, conversion | `src/lib/server/image-validation.ts`, `services/inspection.ts`, `lib/domain/inspection.ts` |
| Build Mode: scene analysis, plan, dependencies, session store | `src/lib/domain/build.ts`, `src/lib/server/services/build.ts`, `demo/build-fixtures.ts` |
| Light dashboard and checkout UI | `src/components/sentinel/`, `src/hooks/`, `src/app/globals.css` |
| API boundaries | `src/app/api/missions/`, `checkout/`, `sandbox/`, `status/`, `inspect/`, `build/` |

All credentials and authenticated requests stay server-side. Agnic adapters use a fixed origin, allowlisted operations, disabled redirects, bounded timeouts, and sanitized errors. Browser data contains normalized public fields, never raw provider responses, card information, delivery profiles, or internal signed browser URLs. Legacy demo data remains only for offline regression tests; live failures do not fall back to invented products.

## Inspect Mode

Inspect Mode turns a photo - taken on the spot or already on the device - into the same `ProductIntent` Request Mode produces, then hands it to the identical discovery pipeline:

```
Take Photo or Upload Image → same preview/validation → InspectionAnalysis (multi-object
  scene, primary subject, condition, recommended action) → resolved user decision →
  ProductIntent → existing Agnic search, ranking, selection, and checkout review
```

- **Take Photo or Upload Image, one shared pipeline:** `InspectUpload` (`src/components/sentinel/inspect-upload.tsx`) offers both as equally prominent actions; both call the same `useInspection().selectFile(file, source)` (`src/hooks/use-inspection.ts`), which validates, previews, and hands off to analysis identically either way - `source` ("camera" | "upload") is display-only (a small "Captured photo"/"Uploaded image" label) and is never sent to the server or read by the analysis pipeline. Take Photo uses a plain `<input type="file" accept="image/*,..." capture="environment">`, so no WebRTC/live camera stream is involved; camera capture behavior (whether it opens the rear camera directly, a camera app, or a file picker) depends on the device/browser and isn't something this can guarantee universally. A HEIC/HEIF photo (some phone cameras' default format) gets a specific "retake as JPG/PNG, or upload another image" message rather than the generic unsupported-type one, since the server still only decodes JPG/PNG/WEBP.
- **Live:** server-side validation (magic-byte sniffing, 10 MB cap, JPG/PNG/WEBP only) is unchanged and applies to both sources identically, the single multimodal analysis call (`analyzeInspectionImage` in `src/lib/server/adapters/openai.ts`, model configurable via `SENTINEL_INSPECT_MODEL`), conversion to a `ProductIntent` (`buildProductIntentFromInspection` in `src/lib/domain/inspection.ts`), and the full existing Agnic search/rank/select/checkout flow via `RequestMissionService.runFromIntent`, which reuses `filterCandidates`/`applyEvaluations`/`rankCandidates` unchanged and skips the text-understanding call entirely.
- **Multi-object grounding:** the analysis lists every distinct object it sees (`detectedObjects`, each with its own scoped evidence) and picks one `primarySubjectId`, or asks the user to choose when two+ objects are comparably prominent (`primarySubjectAmbiguous` / a lightweight subject picker) — a foreground item's attributes are never merged with a background item's.
- **Condition is not an action:** `condition.status` (DAMAGED / MISSING_PART / EMPTY_OR_DEPLETED / INTACT / POSSIBLE_HAZARD / UNCERTAIN) only describes what's physically true; `recommendedAction` decides what to do about it. An intact, undamaged object never auto-generates a search — `buildProductIntentFromInspection` enforces this in code (not only in the prompt): it refuses to build an intent unless the model's own evidence already justifies one, or the user explicitly chose an action ("Find another one" / "Find an upgrade" / "Find an accessory", or a confirmed search after a clarifying question).
- **Honesty rules:** the model never fills in a brand, model, or dimension it cannot see; unknown compatibility facts (e.g. an unmeasured caster stem) are carried into the intent as explicit "not confirmed by the uploaded photo" caveats, so the existing evaluator continues to require exact-device evidence before marking anything `VERIFIED`. Possible safety hazards (e.g. exposed wiring) are phrased with hedged language ("may", "appears"), never as a diagnosis.
- **Fixture-tested:** `src/lib/server/demo/inspection-fixtures.ts` provides fixtures for both real failures this mode has hit in live testing (a merged multi-object hallucination, an auto-replacement-of-an-intact-item bug) plus ambiguous-subject, missing-part, and outcome-failure cases, all used by the automated test suite; never used in normal execution. A local, explicit `SENTINEL_INSPECT_FIXTURE=<name>` env var can bypass the paid call during development only — the UI always marks that result as **DEVELOPMENT FIXTURE**.
- **Cost control:** at most one multimodal call per inspection, plus the same optional second ranking call Request Mode already makes. No recursive vision calls, no automatic retries, no analysis while the user is still choosing a file.
- **Still blocked:** checkout selection from an inspected product reaches the same Agnic sandbox merchant blocker described below and in `PHASE3_REPORT.md`; nothing in this phase changes that.

## Build Mode

Build Mode turns a reference photo ("I want to build something like this") into a commerce-ready bill of materials, reusing Inspect's image-validation and honesty conventions without importing its one-primary-subject assumption — a build scene intentionally has many relevant components, not one:

```
reference image + goal/already-own/requirements → one bounded scene-analysis call → BuildAnalysis
  (scene, components with ESSENTIAL/RECOMMENDED/OPTIONAL/DECORATIVE roles and a
   PURCHASABLE/INTEGRATED_FEATURE/ACCESSORY/DECORATIVE componentKind, dependencies,
   existingItems) → BuildPlan (weighted budget allocation over purchasable components
   only, owned items and integrated features excluded from purchasing) → user
   reviews/edits the component checklist → up to 3 components searched per click through
   the existing Agnic pipeline unchanged → browse total
```

- **Live:** image upload (identical validation to Inspect Mode), the single scene-analysis call (`analyzeBuildScene` in `src/lib/server/adapters/openai.ts`, model configurable via `SENTINEL_BUILD_MODEL`). The analyze → search flow is stateless: analyze signs the validated analysis/plan into an opaque token (`BuildSessionSigner` in `src/lib/server/build-session-token.ts`) instead of storing anything server-side, so search works across separate requests without relying on shared in-memory state - see "Safety, persistence, and limits" below. Each selected component becomes a `ProductIntent` (`buildProductIntentFromComponent` in `src/lib/domain/build.ts`) and reuses `RequestMissionService.runFromIntent` completely unmodified: no separate commerce client, no extra AI call beyond the one Request Mode already makes per search.
- **Essential vs. decorative:** `createBuildPlan` allocates a stated budget by weighted functional role (ESSENTIAL > RECOMMENDED > OPTIONAL > DECORATIVE) and quantity, never equally and never exceeding the total; it is a coherent estimate, not a claimed optimization. A component the user says they already own is matched against the analysis's `existingItems` and kept for dependency context but is never allocated budget or auto-included for purchase.
- **Purchasable vs. integrated feature:** `role` says how important a component is; `componentKind` says whether it is ever its own line item at all. A component the model marks `INTEGRATED_FEATURE` (e.g. a desk's built-in pull-out keyboard tray or lower storage compartment, a chair's attached armrests) never gets a plan item, a budget allocation, a selection checkbox, or its own search - `createBuildPlan` excludes it entirely, folding its name and requirements into its `parentComponentId`'s own `ProductIntent` instead (a desk with a keyboard tray searches for "desk with pull-out keyboard tray", not two separate products). `PURCHASABLE`/`ACCESSORY`/`DECORATIVE` all remain ordinary, independently selectable components; only `INTEGRATED_FEATURE` is excluded. A dependency edge naming an integrated feature is dropped for the same reason - it will never have its own search result to verify a compatibility claim against.
- **Bounded, user-controlled search:** nothing is searched automatically after analysis. The user reviews the component checklist (essentials/recommended pre-checked, decorative unchecked), optionally unchecks/rechecks items, then clicks **Find Products**, which searches at most 3 pending components per click; a **Find N More Products** button appears while any remain. Re-selecting components recomputes the plan and allocation before the next search. A component whose exact search returns zero results gets exactly one deterministic, non-AI broader retry (`broadenSearchQuery` strips low-priority style/color/material words - "black office desk" -> "office desk" - never invents a query or changes the product category); the UI says so honestly ("No exact desk matches found. Broadened search to..."), and a still-empty result shows "No suitable products found," never a silent retry loop.
- **Target, not a hard cap:** `BuildPlanItem.targetAllocation` (labelled "Target: C$X" in the UI) is a planning split of the user's *overall* stated budget, not a per-component search filter - `buildProductIntentFromComponent` passes the overall budget to the search, never the narrow target, so a real product priced just above an internal planning split is never silently filtered out of the results. `selectBuildPick` prefers a same-compatibility-tier candidate that IS within target when the top-ranked one isn't, and otherwise keeps the top-ranked one with an explicit "Above target by C$X" note rather than a silent swap or a silent label.
- **SENTINEL PICK vs. TOP MATCH:** a candidate is only ever labelled SENTINEL PICK when it is within target (or no target is set) *and* the shared evaluator found real supporting evidence (`VERIFIED`/`LIKELY_COMPATIBLE`) - never just because it ranked first. Everything else that still has a result shows the more modest TOP MATCH, or no label at all.
- **Cross-component compatibility, never hallucinated:** `evaluateBuildDependencies` checks a dependency (e.g. "the monitor arm must support the monitor's VESA pattern and weight") only against real, quoted measurement text present in both selected listings; without a shared quoted measurement it stays `NEEDS_VERIFICATION` - the same "quote it or it's unknown" rule Request Mode's evaluator already applies.
- **Browse total, never a final price:** `calculateBuildTotal` sums whichever product `selectBuildPick` actually recommends per component (never blindly the top-ranked one) once every included, non-owned component has a result; an incomplete selection shows "Pending remaining searches" rather than a misleadingly low partial sum. Underspend on one component can offset overspend on another - only the running total against the user's overall budget is a hard constraint, never each component individually - and exceeding it shows a "BUILD OVER BUDGET" block with the exact overage, without ever silently raising the budget.
- **Fixture-tested:** `src/lib/server/demo/build-fixtures.ts` provides three named scenes (`gaming-desk-setup`, `home-office-setup`, `simple-streaming-setup`), each with matching invented product results per component, clearly labelled `(DEVELOPMENT FIXTURE)` / "Fixture Demo Merchant (invented, not real)" and never routed through the real mission/checkout pipeline. A local, explicit `SENTINEL_BUILD_FIXTURE=<name>` env var can bypass the paid call during development only, and is rejected outright outside development/test - never a silent live fallback.
- **Still blocked:** a selected Build component's checkout reaches the same Agnic sandbox merchant blocker described below; nothing in this phase touches that code path. See [PHASE5_REPORT.md](PHASE5_REPORT.md) for what is live, fixture-tested, and not yet live.

## Autopilot and Voice

The dashboard now connects the headless core to a review-first UI. **Autopilot** turns a standing mandate ("keep Coke, Sprite and Fanta stocked, weekly, at most C$70") into scheduled or on-demand runs that generate the same `ProductIntent` Request Mode uses, search through the existing commerce pipeline only when explicitly asked, and return an auditable mandate decision: `AUTO_AUTHORIZED`, `NEEDS_APPROVAL` or `BLOCKED`. `AUTO_AUTHORIZED` means the mandate permits the action; nothing is ever purchased, and every run carries `purchaseExecuted: false`. **Voice** uses browser `SpeechRecognition` plus a deterministic, zero-model-call transcript interpreter. A voice instruction becomes a visible draft that the user must review and confirm. Unsupported browsers retain the text input. No audio is stored. Autopilot state is in memory and there is no background scheduler. See [docs/AUTOPILOT_VOICE_ENGINEERING.md](docs/AUTOPILOT_VOICE_ENGINEERING.md) and [docs/AUTOPILOT_VOICE_UI_CONTRACT.md](docs/AUTOPILOT_VOICE_UI_CONTRACT.md).

## Deployment environment

Configure these server-only values; never use `NEXT_PUBLIC_*` for secrets:

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | OpenAI server credential |
| `AGNIC_API_KEY` or `AGNIC_TOKEN` | Agnic server credential |
| `SENTINEL_ALLOW_PAID_AI` | Explicit paid-model opt-in; keep `false` until ready |
| `SENTINEL_REAL_PURCHASES_ENABLED` | Keep `false`; compiled real execution remains locked |
| `SENTINEL_DEVELOPMENT_MODE` | Keep `false` in production |
| `SENTINEL_BUILD_SESSION_SECRET` | Shared HMAC secret for multi-instance Build sessions |
| `SENTINEL_APP_ORIGIN` | Exact production origin allowed by API origin checks |
| `SENTINEL_SANDBOX_MERCHANT_ID` | Documented Agnic sandbox merchant identity |
| `SENTINEL_SANDBOX_CARD_ALIAS_ID` | Hosted vaulted test-card alias only |
| `SENTINEL_SANDBOX_CARD_CONFIRMED` | Server assertion that the alias is a test card |
| `SENTINEL_SANDBOX_SHIP_TO_JSON` | Gitignored CA/US sandbox destination; contains personal data |

Vercel can host the UI and non-durable demo paths, but sandbox dispatch must remain disabled there: the once-only dispatch journal and AI budget ledger require persistent local storage. Autopilot state is also runtime-only. Use a persistent Node host before enabling the sandbox alias on a public deployment.

## Request and checkout flow

1. **Submit explicitly.** Example chips only fill the input. Luna extracts constraints with CA/CAD defaults. One search retrieves up to ten real listings; no typing calls or automatic retries run.
2. **Filter and compare.** Budgets, quantity, market, stock signals, and relevance constrain the shortlist. A second model call is optional. Claims require supporting listing snippets; missing specifications remain unknown. Browse-price filtering does not imply shipping and tax fit the budget.
3. **Choose a product.** Checkout references a session-owned server selection. The browser cannot supply a replacement merchant, SKU, amount, or test flag.
4. **Prepare the merchant.** An explicit action may call read-only Agnic explore, then resolve the same variant and merchant. Existing merchants are verified directly. The app polls only the returned exploration ID, with bounded polling and an actionable timeout; it never fabricates readiness.
5. **Request a quote.** Real fulfillment options come from Agnic. A user choice triggers a new quote for that option. No arbitrary paid shipping option is silently selected. An unresolved choice or missing amount cannot become a complete quote.
6. **Review constraints.** `amount_is_final=true` shows a final quoted total. Otherwise the amount is a maximum ceiling, not an exact final charge. Browse price stays separate. Over-budget or changed quotes block continuation; the original budget is never silently increased. Unknown shipping, tax, or delivery timing stays unknown.
7. **Sandbox only.** A separate catalogue checks the official merchant's server metadata. Confirmation is available only after test verification, hosted test-card setup, and a complete quote. The explicit **Confirm Test Purchase** action rechecks merchant metadata and quote consistency before one dispatch attempt. Selection, preparation, quoting, and page load never dispatch.
8. **Track actual outcomes.** Once an order ID exists, only its status is polled. Success proof requires provider success and its test indicator. Unknown outcomes, declines, or timeouts never produce a fabricated receipt. A safe Agnic `order_url` may be shown as checkout evidence.

The UI supports these workflows, but current live operation availability depends on Agnic's responses and account setup. Consult the Phase 3 report for which steps were actually verified.

## Local API

All mutation bodies are strict JSON. Same-origin/loopback checks, bounded bodies, HttpOnly session ownership, and fixed public errors protect the local boundary.

| Method and route | Input / purpose |
| --- | --- |
| `GET /api/status` | Credential detection and local AI budget; no authentication probe |
| `POST /api/missions` | `{prompt}`; JSON result or NDJSON activity stream |
| `POST /api/inspect/analyze` | `{imageBase64, mimeType}`; one bounded multimodal analysis, or a labelled dev fixture |
| `POST /api/inspect/search` | `{intent}`; runs the same mission pipeline as `/api/missions`, skipping intent extraction |
| `POST /api/build/analyze` | `{imageBase64, mimeType, constraints?}`; one bounded scene analysis, or a labelled dev fixture |
| `POST /api/build/search` | `{token, selectedIds, priorResults?, clarification?}`; `token` is the signed session from `/api/build/analyze` response, verified server-side; searches ≤3 pending components via the same mission pipeline; JSON result or NDJSON activity stream |
| `POST /api/checkout/session` | `{missionId, productId}`; create/reuse owned selection |
| `POST /api/checkout/prepare` | `{checkoutId}`; verify or explore selected merchant |
| `POST /api/checkout/quote` | `{checkoutId, fulfillmentId?}`; safe quote or fulfillment re-quote |
| `GET /api/checkout/status?checkoutId=…` | Read the existing exploration/order; never redispatch |
| `POST /api/checkout/preview` | Legacy read-only `{missionId, productId}` preview |
| `POST /api/sandbox/catalog` | `{}`; inspect the server-selected official test merchant |
| `POST /api/sandbox/session` | `{productId}` from the verified sandbox catalogue |
| `POST /api/sandbox/confirm` | `{checkoutId, quoteId, confirmed:true, confirmationText:"Confirm Test Purchase"}` |
| `GET`/`POST /api/autopilot/policies` | List this session's autopilots / create a DRAFT |
| `GET`/`PATCH /api/autopilot/policies/:id` | Read / edit (mandate fields only while DRAFT or PAUSED) |
| `POST /api/autopilot/policies/:id/{activate,pause,resume}` | Lifecycle; activate and resume require `{confirm:true}` |
| `POST /api/autopilot/policies/:id/evaluate` | Run now: trigger check + intent generation; never searches |
| `POST /api/autopilot/policies/:id/search` | `{runId, itemId}`; existing mission pipeline for one run item |
| `POST /api/autopilot/policies/:id/authorize` | `{runId, selections}`; mandate decision on server-held results; never buys |
| `GET /api/autopilot/policies/:id/runs` | Recent runs with audit events |
| `POST /api/autopilot/run-due` | Evaluate this session's due policies once per slot |
| `POST /api/autopilot/demo` | Development/test only: café DEMO autopilot |
| `POST /api/voice/interpret` | `{transcript, timezone?}`; text only, returns a command, acts on nothing |

There is no real-commerce dispatch route. Frontend `is_test` or merchant/amount overrides are rejected by input schemas. Server metadata is fetched again immediately before sandbox dispatch.

## Safety, persistence, and limits

`REAL_COMMERCE_MODE` permits discovery, explore, and preview. `assertRealPurchasesEnabled()` always throws, even if environment flags are changed. Keep `SENTINEL_REAL_PURCHASES_ENABLED=false` and `SENTINEL_DEVELOPMENT_MODE=true`.

`SANDBOX_COMMERCE_MODE` is separate. `assertSandboxMerchant()` normally requires Agnic's `is_test=true` and the Shopify rail. Its only exception is the exact merchant ID, domain, rail, currency, quantity, and support-confirmed SKUs for Agnic's documented Shopify Payments test-mode shop. No frontend flag can create that identity. No raw card fields are collected, and the account default card is never selected by this code.

The service joins concurrent operations and disables confirmation before execution. Before dispatch it exclusively creates a durable attempt file under `.sentinel/sandbox-attempts/`, then records the returned order ID/status atomically. Failed or uncertain attempts remain claimed and must not be retried. The private attempt key derives from the browser owner, verified merchant ID, and variant SKU. It blocks another dispatch of that selection after checkout expiry or server restart. This deliberately permits only one attempt per selection and browser owner in the demo. Clearing browser cookies or using another application is outside this local guard; it is not provider-wide idempotency.

Mission, checkout, quote, and selection state is bounded and held in memory. A restart clears those sessions; the private AI ledger and dispatch journal survive. After a restart or ambiguous order outcome, inspect the saved order in Agnic rather than starting another checkout. Do not delete these safety files to bypass a block. This architecture assumes one local server process and a persistent filesystem for those routes; it is not designed for multi-instance or ephemeral deployment. No database, accounts, or public authentication infrastructure was added.

Build session/plan state is the one exception: it is not held in memory at all. `/api/build/analyze` signs the validated analysis, constraints, owner, and an expiry into an opaque, HMAC-signed token (`src/lib/server/build-session-token.ts`) and returns it to the browser; `/api/build/search` verifies that token's signature, owner, and expiry and reconstructs everything it trusts from the verified payload alone, never from a server-side lookup. A component id, budget, or any other field the browser sends outside the token itself can only ever select or exclude from what was already signed - it cannot alter the analysis, budget, or a component's role, because that would invalidate the signature. This is what makes the analyze -> search flow correct across separate API requests that don't share process/module memory - including a dev-server module reload between the two calls, or, in a real deployment, two calls landing on different worker instances. The one thing that must still agree across those instances is the signing secret: set `SENTINEL_BUILD_SESSION_SECRET` for a genuine multi-instance deployment (shared config, no filesystem dependency), or leave it unset for local use, in which case a secret is generated once and persisted to `.sentinel/build-session-secret` so it survives restarts and Fast Refresh on a single machine. See [PHASE5_REPORT.md](PHASE5_REPORT.md) §32a for the root cause this replaced and how the fix was verified.

## AI budget and optional gateway

The unchanged **C$5 cap controls OpenAI inference only**. It never limited Agnic discovery/explore/quote calls and does not authorize purchases. Real purchase spend remains zero; sandbox execution has its own merchant, consent, card, quote, and amount checks.

- Default `AI_PROVIDER=openai`. GPT-5.6 Luna handles intent and simple comparisons; GPT-6 Astra is reserved for technical compatibility with sufficient product specifications.
- At most two model calls per uncached request; cache hits avoid repeated calls. No model tools, recursive loops, or automatic retries.
- `.sentinel/ai-usage.json` reserves conservative costs before calls, enforces C$5 overall and C$0.75 per call, and retains reservations when provider usage is unknown. Its 2 CAD/USD accounting factor is a safety buffer, not a current FX quote. It does not know account-wide usage or the remaining account balance.
- `SENTINEL_ALLOW_PAID_AI=true` enables the explicitly authorized, billable model calls. Both private state directories are Git-ignored.
- Agnic Gateway at `https://api.agnic.ai/v1` is an **extension point, not an implemented adapter**. `AGNIC_AI_MODEL` is documented with no default model. Choosing `AI_PROVIDER=agnic` currently returns an explicit unavailable-provider error; it does not silently replace Astra or use credits. A future adapter must first verify model availability, structured-output support, and budgeting semantics.

## Manual Agnic setup

1. Keep `SENTINEL_SANDBOX_MERCHANT_ID=merchant_untitled_fidget_shop`. SENTINEL re-fetches and verifies the exact `untitled-fidget.shop` Shopify/CAD identity and allows only the two support-confirmed variant IDs. This follows Agnic's documented statement that this gateway sandbox reports `is_test=false` by design.
2. Use [Agnic's hosted card setup](https://app.agnic.ai/partner/cards/new) with its documented **test** payment method only. Store only the resulting alias in `SENTINEL_SANDBOX_CARD_ALIAS_ID` and set `SENTINEL_SANDBOX_CARD_CONFIRMED=true` after verifying it is a test card. Never put card numbers, expiry, or CVV in code, environment files, or SENTINEL input fields. If hosted test setup is unavailable, stop and ask Agnic.
3. Configure a Canadian or US test destination only in the gitignored local `SENTINEL_SANDBOX_SHIP_TO_JSON` environment value. SENTINEL validates it server-side, binds the identical destination into quote and dispatch, and never returns or logs it. Do not commit personal address data.
4. Restart after configuration changes, verify the sandbox merchant, obtain a fresh quote, then explicitly confirm in the TEST PURCHASE modal. Do not repeat an existing or uncertain order.

## Free backend diagnostics

Run `npm run check:agnic` to inspect the configured merchant and the returned list of designated test merchants. It prints only selected public metadata and setup booleans. It never runs OpenAI inference or dispatch, and never prints tokens, addresses, raw provider errors, or card aliases.

`npm run check:agnic -- --explore` additionally makes **one read-only exploration** of the configured merchant. Use it deliberately, not as a polling loop; it never retries. On September 18 this returned HTTP 500 / `db_error`, while merchant metadata returned `is_test=false` and `catalog_error=merchant_not_linked`. See `AGNIC_SUPPORT_MESSAGE.md` for the organizer message.

## Validation and references

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Automated integration tests use injected provider fixtures and never spend AI money. See [PHASE3_REPORT.md](PHASE3_REPORT.md) for Phase 3's measured results, [PHASE4A_REPORT.md](PHASE4A_REPORT.md) for Inspect Mode's live/fixture-tested/blocked status, and [PHASE5_REPORT.md](PHASE5_REPORT.md) for Build Mode's.

Official references: [Agnic REST checkout](https://docs.agnic.ai/docs/api-reference/checkout), [test checkout](https://docs.agnic.ai/docs/agentic-commerce/testing), [pricing](https://docs.agnic.ai/docs/agentic-commerce/limits-and-pricing), [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Phase 5 stops here. Real cards and real orders are not implemented. Live Build checkout selection remains blocked by the same external Agnic sandbox issue documented in `AGNIC_SUPPORT_MESSAGE.md`.
