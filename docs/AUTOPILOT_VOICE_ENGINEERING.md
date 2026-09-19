# SENTINEL Autopilot + Voice core: engineering notes

Headless feature core for standing purchase mandates (Autopilot) and spoken input (Voice).
No UI was added or changed; see [AUTOPILOT_VOICE_UI_CONTRACT.md](AUTOPILOT_VOICE_UI_CONTRACT.md)
for the integration surface.

## What is real, what is demo, what is not built

| | Capability |
| --- | --- |
| **Real** | Autopilot policy model and validation (bounded, strict, integer cents, CAD) |
| **Real** | Policy lifecycle DRAFT -> ACTIVE <-> PAUSED with explicit confirmation to grant authority |
| **Real** | Timezone- and DST-correct schedule evaluation (`calculateNextRunAt`, `isPolicyDue`), idempotent per slot, no back-fill after downtime |
| **Real** | Budget ledger (weekly authority, holds, remaining authority) and the pure mandate decision engine |
| **Real** | ProductIntent generation using the shared `productIntentSchema` (Autopilot is another intent source) |
| **Real** | Search step that delegates to the existing `RequestMissionService` (only when explicitly requested) and authorization bound to server-side search results |
| **Real** | Auditable run records with factual events |
| **Real** | Browser voice adapter over native `SpeechRecognition` / `webkitSpeechRecognition` |
| **Real** | Deterministic voice command interpretation and `POST /api/voice/interpret` |
| **Demo / fixture** | The café restock policy (`fixtureId: "cafe-drinks-restock"`), created only by `POST /api/autopilot/demo` in development/test |
| **Demo / fixture** | Commerce responses in automated tests (a fake mirroring the mission cache contract); no test touches the network |
| **Blocked / not implemented** | Autonomous real-money purchasing (the existing `assertRealPurchasesEnabled()` lock is untouched and still always throws) |
| **Blocked / not implemented** | Any checkout or dispatch from Autopilot (no such capability is wired in; Agnic sandbox checkout is also still externally blocked) |
| **Not implemented** | A persistent or hosted recurring scheduler; nothing runs in the background |
| **Not implemented** | Durable storage (Autopilot state is in process memory) |
| **Not implemented** | Visual inventory detection; INVENTORY_BELOW uses caller-supplied counts |
| **Not implemented** | AI-based voice interpretation (extension point documented below) |

## Layout

```
src/lib/autopilot/            pure unless marked (server-only)
  money.ts        integer-cent formatting and arithmetic
  time.ts         Intl-only timezone math: wall time <-> instant, ISO weeks
  policy.ts       zod schemas, limits, types, status transitions
  schedule.ts     calculateNextRunAt, isPolicyDue, no-back-fill rule
  trigger.ts      SCHEDULED and INVENTORY_BELOW evaluation
  intent.ts       policy item -> shared ProductIntent (+ source envelope)
  ledger.ts       holds/spend -> AutopilotBudgetSummary
  decision.ts     pure mandate decision engine
  run.ts          run record and audit event types
  requests.ts     route body schemas
  store.ts        (server-only) repository interfaces + bounded in-memory store
  service.ts      (server-only) lifecycle orchestration
  demo.ts         (server-only) café DEMO fixture + dev/test gate
  runtime.ts      (server-only) wiring to the existing mission service
  http.ts         (server-only) route helpers
src/lib/voice/
  browser-speech.ts   BROWSER ONLY speech adapter
  text.ts amounts.ts catalog.ts schedule-phrases.ts interpreter.ts commands.ts   pure, server-safe
src/app/api/autopilot/**, src/app/api/voice/interpret   thin route handlers
```

Pure modules import no server, framework or model code (enforced by
`tests/autopilot-voice-boundaries.test.ts`).

## Design decisions

**One intent contract.** Autopilot produces the same `ProductIntent` as Request, Inspect and
Build, validated by the same `productIntentSchema`. Source metadata (`source: "AUTOPILOT"`,
policy and item ids) sits in an `AutopilotIntent` envelope around it, so the shared schema is
unchanged and the existing search pipeline consumes the intent as-is.

**Budget semantics.** The intent's `budget.maxAmount` is the policy's per-run cap, never a
per-item share, because `filterCandidates` treats it as a hard price filter (the same lesson as
Build Mode's target-vs-cap fix). The combined run total is enforced by the decision engine
against both the per-run cap and the remaining weekly authority.

**Server-bound pricing.** `authorize` accepts only references (`missionId`, `productId`) to
results the server already holds. Prices come from `missionService.getSelection`, and the
selected mission's intent must equal the run's own intent for that item (key-order-independent
comparison), so a client cannot substitute a cheaper price or a product found for a different
item. This mirrors how `CheckoutService` already consumes selections.

**Holds, not spending.** An `AUTO_AUTHORIZED` decision records an `AUTHORIZATION_HOLD` in the
ledger so repeated authorizations cannot jointly exceed the weekly mandate. Re-authorizing a
run replaces its own hold. `CONFIRMED_SPEND` exists in the type for a future checkout
integration; nothing writes it today.

**Atomicity.** Budget check + hold, status changes, edits and schedule advancement run under
`store.withPolicyLock`. A test proves that, without the lock, two concurrent C$50
authorizations both pass a C$70 mandate; with it, exactly one does. A durable store must
implement `withPolicyLock` as a transaction or row lock.

**Scheduling.** `calculateNextRunAt` resolves local wall time per IANA zone using only `Intl`:
schedules keep their local time across DST, nonexistent times move forward past the gap, and
ambiguous times take the earlier instant. Budget weeks are ISO weeks (Monday 00:00) in the
policy's timezone. Each scheduled slot can be claimed once (`claimSlot`), so concurrent
`run-due` calls produce one run. After a late run, scheduling resumes from now: missed slots are
never back-filled, so downtime cannot cause a burst of catch-up purchase runs. `runDue(owner)`
is the single entry point a future cron / Vercel Cron / Cloud Scheduler caller would use.

**Fail closed.** Unknown price -> `NEEDS_APPROVAL`; category or item outside the mandate ->
`BLOCKED`; over mandate -> `NEEDS_APPROVAL` or `BLOCKED` per policy; inactive policy -> cannot
run; policy changed after a run started -> `AUTOPILOT_RUN_STALE`; commerce not configured ->
`COMMERCE_UNAVAILABLE`, never a fabricated result. Validation rejects rather than clamps.

**Dev-server state.** `next dev` re-evaluates server modules when it first compiles a route,
which wiped module-level state mid-flow in a live test. The Autopilot store is therefore held on
`globalThis` for the life of the process (no effect under `next start`). The existing mission
cache that Autopilot's search reuses was not changed and keeps its existing dev-mode behaviour.

## Voice

**Browser adapter.** `createBrowserVoiceService()` wraps the native API with `start`, `stop`,
`abort`, `supported`, `listening` and `onStart` / `onInterimTranscript` /
`onFinalTranscript` / `onError` / `onEnd`. It reports `supported: false` when the API is
missing (and on the server), maps browser error strings to a fixed message set, and never
touches audio: no `getUserMedia`, `MediaRecorder`, storage or network APIs (enforced by test).
Browsers may send audio to their vendor's speech service; SENTINEL never receives it.

**Deterministic interpreter.** The interpreter runs on text only and makes no model calls. It
classifies in a fixed order: purchase-confirmation phrases are refused first; then pause /
resume; autopilot creation; run-now; shopping requests; otherwise `UNKNOWN`. Creation extracts
items, cadence, budget and currency, and asks (`NEEDS_CLARIFICATION`) rather than guessing when
anything is missing, conflicting or unsupported (e.g. "every two weeks", USD, a bare daily
amount). Brands become preferences (`brandMatch: "PREFERRED"`). Control commands resolve an
autopilot by name and never choose between several matches. Every result is validated against
the strict `voiceCommandSchema`; the route fails closed to `UNKNOWN` if validation fails.

**Why no AI interpreter yet.** Wiring one into the existing OpenAI adapter would mean editing
`openai.ts`, `live-contracts.ts` and `ai-provider.ts`, which Request, Inspect and Build all
depend on. The required phrases are handled deterministically, so this phase adds no model
surface. Extension point: implement `VoiceCommandInterpreter` (`src/lib/voice/commands.ts`)
with at most one structured model call per interpretation, no retries, a strict schema, and
output that must pass `voiceCommandSchema` (the route already enforces this). An AI interpreter
still could not activate, purchase or dispatch, because no such command type exists.

**Transcript as data.** Transcripts are normalized (control characters removed, 1000-character
cap) and can only select one of seven fixed command shapes. `REQUEST` text is forwarded
verbatim for Request Mode's own safeguards. The interpreter never reads or writes environment
variables (enforced by test).

## Limits

| Limit | Value |
| --- | --- |
| Items per autopilot | 8 |
| Weekly authority | C$2,000.00 (`200000`) |
| Per-item quantity | 1-10 (the ProductIntent ceiling) |
| Autopilots per session / in total | 20 / 500 |
| Runs kept per autopilot | 20 |
| Events per run | 60 |
| Transcript length | 1000 characters |
| Policy body / other bodies | 16 KB / 8 KB |

## Known limitations

- In-memory, single-process storage: restart clears autopilots, runs and holds.
- No background scheduler: `due` is computed, but runs happen only when `run-due` or `evaluate` is called.
- INVENTORY_BELOW needs caller-supplied counts; there is no visual counting.
- Autopilot supports CAD / Canada only, like Inspect and Build.
- The voice catalogue knows a small set of soft-drink brands and category keywords; other
  items are drafted generically, and an item with no recognizable category is asked about.
  Spoken counts ("12 cans") are not converted to quantities (a listing may itself be a pack).
- Autopilot's explicit search step reuses the existing commerce pipeline, which may make its
  existing bounded compatibility-model call. Evaluation, authorization and voice make none.

## Tests

`tests/autopilot-policy.test.ts`, `autopilot-schedule.test.ts`, `autopilot-decision.test.ts`,
`autopilot-service.test.ts`, `autopilot-routes.test.ts`, `autopilot-runtime.test.ts`,
`voice-browser.test.ts`, `voice-interpreter.test.ts`, `voice-routes.test.ts` and
`autopilot-voice-boundaries.test.ts`. They use fakes and a fixed clock only, and assert that no
network call, dispatch, checkout or model call occurs.
