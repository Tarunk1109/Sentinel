# Autopilot + Voice: UI integration contract

For whoever connects the UI to the headless Autopilot and Voice core. This is an API and
behaviour reference only. It does not prescribe any layout, component, colour or copy.

## Ground rules

- **Nothing here spends money.** No route places, quotes, confirms or dispatches an order.
  `AUTO_AUTHORIZED` means only that the user's standing mandate permits an action. Every run
  carries `purchaseExecuted: false`. Checkout stays the existing, separate, explicit flow.
- **Voice never acts on its own.** `/api/voice/interpret` returns a *command* for the UI to
  act on. Nothing is created, activated, searched or bought by interpreting speech.
- **Explicit confirmation** is required, as a literal `{ "confirm": true }` body, to activate
  a draft or resume a paused autopilot. Show the user what they are confirming first.
- **Session scoped.** Everything is scoped to the `sentinel_session` HttpOnly cookie, the same
  as Request Mode. Send requests from the same origin with credentials (the default for
  same-origin `fetch`).
- **Money** is always integer minor units (cents) in `CAD`. `7000` means C$70.00. Autopilot
  supports CAD only.
- All mutation bodies are strict JSON: unknown fields are rejected with `400`.

## Autopilot lifecycle

```
POST /policies (DRAFT) --activate {confirm:true}--> ACTIVE <--pause / resume {confirm:true}--> PAUSED
                                                      |
            evaluate ("run now")  or  run-due (scheduled slot)
                                                      v
   run: NO_ACTION | ACTION_REQUIRED | COMMERCE_UNAVAILABLE | SEARCH_READY
                                                      |  (SEARCH_READY only)
            search {runId, itemId}   (the existing SENTINEL commerce search, per item)
                                                      v
            authorize {runId, selections}  ->  AUTO_AUTHORIZED | NEEDS_APPROVAL | BLOCKED
```

`search` and `authorize` are separate explicit actions. `evaluate` never searches.

## Routes

All routes live under `/api/autopilot`. Responses are JSON with `Cache-Control: no-store`.

| Method and route | Body | Success response |
| --- | --- | --- |
| `GET /policies` | - | `200 { autopilots: AutopilotPolicyView[] }` |
| `POST /policies` | `AutopilotPolicyInput` | `201 { autopilot: AutopilotPolicyView }` (always `DRAFT`) |
| `GET /policies/:id` | - | `200 { autopilot }` |
| `PATCH /policies/:id` | any subset of `name, goal, budget, schedule, trigger, allowedCategories, items, authorization` | `200 { autopilot }` |
| `POST /policies/:id/activate` | `{ "confirm": true }` | `200 { autopilot }` (DRAFT -> ACTIVE) |
| `POST /policies/:id/pause` | none, or `{}` | `200 { autopilot }` (ACTIVE -> PAUSED, idempotent) |
| `POST /policies/:id/resume` | `{ "confirm": true }` | `200 { autopilot }` (PAUSED -> ACTIVE) |
| `POST /policies/:id/evaluate` | none, `{}`, or `{ inventory: [{ itemId, units }] }` | `200 { run: AutopilotRun }` |
| `POST /policies/:id/search` | `{ runId, itemId }` | `200 { run, mission: RequestMission }` |
| `POST /policies/:id/authorize` | `{ runId, selections: [{ itemId, missionId, productId }] }` | `200 { run }` |
| `GET /policies/:id/runs` | - | `200 { runs: AutopilotRun[] }` newest first, up to 20 |
| `POST /run-due` | none, or `{}` | `200 { runs: AutopilotRun[] }` for this session's due policies |
| `POST /demo` | none, `{}`, or `{ timezone }` | `200 { autopilot }` - development/test only |

`POST /api/voice/interpret` - body `{ transcript: string, timezone?: string }` - returns
`200 { command: VoiceCommand }`.

`mission` from `search` is the same `RequestMission` shape Request Mode already renders
(`products`, `steps`, `summary`, `warnings`, ...). `selections` must reference a `missionId`
and `productId` from a search made **for that run and item**; prices are read on the server.
Missions expire 15 minutes after the search (then `409 SELECTION_EXPIRED`: search again).

## Shapes

```ts
AutopilotPolicyView = { policy: AutopilotPolicy; due: boolean; budget: AutopilotBudgetSummary }

AutopilotPolicy = {
  id: string; version: number; status: "DRAFT" | "ACTIVE" | "PAUSED";
  name: string;                       // <= 80 chars
  goal: string;                       // <= 300 chars
  currency: "CAD";
  budget: { maximumPerWeekMinor: number; maximumPerRunMinor: number };  // cents, <= 200000
  schedule: { cadence: "DAILY" | "WEEKLY" | "MONTHLY"; timezone: string; timeOfDay: "HH:MM";
              dayOfWeek?: 1..7 /* Monday = 1, WEEKLY only */; dayOfMonth?: 1..28 /* MONTHLY only */;
              nextRunAt: string | null /* ISO; null unless ACTIVE */ };
  trigger: { type: "SCHEDULED" } | { type: "INVENTORY_BELOW"; thresholds: { itemId: string; minimumUnits: number }[] };
  allowedCategories: Category[];      // every item's category must be allowed
  items: { id: string; label: string; category: Category; searchQuery: string; productType: string;
           preferredBrands: string[]; brandMatch: "PREFERRED"; quantity: 1..10 }[];   // 1-8 items
  authorization: { autoAuthorizeWithinMandate: boolean; requireApprovalAboveMinor: number | null;
                   overMandate: "REQUIRE_APPROVAL" | "BLOCK" };
  demo: boolean; fixtureId: string | null; createdAt: string; updatedAt: string;
}
Category = "BEVERAGES" | "SNACKS" | "PANTRY" | "CLEANING_SUPPLIES" | "PAPER_GOODS"
         | "OFFICE_SUPPLIES" | "PERSONAL_CARE" | "PET_SUPPLIES"

AutopilotBudgetSummary = {
  currency: "CAD"; windowStart: string; windowEnd: string;  // ISO week, Monday 00:00 in the policy timezone
  weeklyAuthorityMinor: number; perRunCapMinor: number;
  heldMinor: number;       // authority held by AUTO_AUTHORIZED decisions (no money moved)
  spentMinor: number;      // confirmed purchases - always 0 until checkout is integrated
  committedMinor: number;  // held + spent
  remainingMinor: number;
}

AutopilotRun = {
  id: string; policyId: string; policyName: string; policyVersion: number; demo: boolean;
  trigger: "SCHEDULE" | "MANUAL"; triggerReason: string; scheduledFor: string | null;
  status: RunStatus;
  intents: { source: "AUTOPILOT"; policyId: string; itemId: string; itemLabel: string; category: Category;
             intent: ProductIntent /* the same contract Request, Inspect and Build use */ }[];
  searches: { itemId: string; missionId: string; status: "ready" | "no-results"; candidateCount: number; searchedAt: string }[];
  selections: { itemId: string; missionId: string; productId: string; productName: string; merchantName: string;
                unitPrice: { amountMinor: number; currency: string } | null; quantity: number; lineTotalMinor: number | null }[];
  decision: null | { decision: "AUTO_AUTHORIZED" | "NEEDS_APPROVAL" | "BLOCKED"; reasons: string[];
                     proposedTotalMinor: number | null; currency: "CAD";
                     remainingBudgetBeforeMinor: number; remainingBudgetAfterMinor: number; decidedAt: string };
  budget: AutopilotBudgetSummary;
  events: { type: AuditEventType; timestamp: string; message: string }[];   // <= 60, oldest first
  purchaseExecuted: false;
  createdAt: string; updatedAt: string;
}
```

`reasons` and event `message`s are short, factual, user-facing sentences. They never contain
model reasoning.

### Run statuses

| Status | Meaning | Next action available |
| --- | --- | --- |
| `NO_ACTION` | Evaluated; nothing needed (e.g. all counted stock at or above minimum) | none |
| `ACTION_REQUIRED` | Needs input to continue (INVENTORY_BELOW policy evaluated without counts) | `evaluate` again with `inventory` |
| `COMMERCE_UNAVAILABLE` | Intents generated, but the Agnic integration is not configured | none; nothing was searched or bought |
| `SEARCH_READY` | One search intent per item is ready | `search`, then `authorize` |
| `AUTO_AUTHORIZED` | The standing mandate permits the selected products. **No purchase happened.** | re-`search` / re-`authorize` |
| `NEEDS_APPROVAL` | Outside the auto-authorization rules; a person must decide | re-`search` / re-`authorize` |
| `BLOCKED` | The mandate forbids the selection (category, item, currency, inactive policy, or over mandate when `overMandate` is `BLOCK`) | re-`search` / re-`authorize` |

Authorizing a run again replaces that run's earlier hold; it never stacks.

### Audit event types

`POLICY_EVALUATED`, `TRIGGER_MATCHED`, `TRIGGER_NOT_MATCHED`, `INPUT_REQUIRED`,
`INTENT_GENERATED`, `COMMERCE_SEARCH_READY`, `COMMERCE_UNAVAILABLE`,
`COMMERCE_SEARCH_REQUESTED`, `COMMERCE_SEARCH_COMPLETED`, `CANDIDATE_SELECTED`,
`BUDGET_CHECKED`, `DECISION_RECORDED`.

## What AUTO_AUTHORIZED means

It is a mandate decision: the selected products are items in the policy, in permitted
categories, priced in CAD, within the per-run cap and the remaining weekly authority, and the
policy allows automatic authorization (with no approval threshold exceeded). It records an
`AUTHORIZATION_HOLD` against the weekly budget so repeated authorizations cannot exceed the
mandate. It does **not** place an order, create a checkout, or move money. Checkout would be a
separate, explicit step through the existing checkout flow, which remains authoritative and
currently cannot execute real purchases.

## Voice

### Browser speech (client only)

```ts
import { createBrowserVoiceService } from "@/lib/voice/browser-speech";
const voice = createBrowserVoiceService();       // call in the browser, e.g. in an effect
voice.supported;                                 // false -> offer typing instead; never faked
voice.start({ onStart, onInterimTranscript, onFinalTranscript, onError, onEnd }, { lang?, interimResults? });
voice.stop();    // stop listening and let the browser deliver the final transcript
voice.abort();   // stop immediately and discard; does not report an error
voice.listening;
```

- Uses the native `SpeechRecognition`, falling back to `webkitSpeechRecognition`.
- One utterance per `start()`. A second `start()` while listening returns `ALREADY_LISTENING`.
- `onError` receives `{ code, message }` with a fixed safe message. Codes: `NOT_SUPPORTED`,
  `ALREADY_LISTENING`, `PERMISSION_DENIED`, `NO_SPEECH`, `AUDIO_CAPTURE`, `NETWORK`, `ABORTED`,
  `LANGUAGE_NOT_SUPPORTED`, `START_FAILED`, `UNKNOWN`.
- SENTINEL never receives or stores audio. The browser itself may send audio to its vendor's
  speech service (Chrome does); that is outside SENTINEL's control.
- Do not import this module from server code.

### Interpreting a transcript

`POST /api/voice/interpret` with `{ transcript, timezone }` (pass the browser's
`Intl.DateTimeFormat().resolvedOptions().timeZone`). Transcripts are 1-1000 characters.
Interpretation is deterministic and makes no model calls.

| `command.type` | Payload | What the UI does with it |
| --- | --- | --- |
| `REQUEST` | `{ text }` | Prefill Request Mode with `text`. Nothing runs until the user submits there. |
| `AUTOPILOT_CREATE` | `{ requiresConfirmation: true, summary, draft }` | Show the draft for review. `draft` is a valid `POST /policies` body with `status: "DRAFT"`. Activation is a later `activate {confirm:true}`. |
| `AUTOPILOT_PAUSE` | `{ requiresConfirmation: false, policy: {id, name, status} }` | May call `pause` directly. |
| `AUTOPILOT_RESUME` | `{ requiresConfirmation: true, policy }` | Confirm with the user, then `resume {confirm:true}`. |
| `AUTOPILOT_RUN_NOW` | `{ requiresConfirmation: false, policy }` | May call `evaluate` (it never searches or buys). |
| `NEEDS_CLARIFICATION` | `{ about, reason, missing, candidates, understood }` | Ask for what is `missing` (`items`, `cadence`, `budget`, `currency`, `policy`). `candidates` lists matching autopilots when the reference was ambiguous; `understood` holds what was already heard. |
| `UNKNOWN` | `{ reason }` | Show `reason`; offer typing. |

There is no voice command that purchases, checks out, approves a purchase or activates an
autopilot. Purchase-confirmation phrases ("buy this", "confirm the purchase", "place the
order", "checkout") always return `UNKNOWN`.

The café example: *"Keep Coke, Sprite and Fanta stocked every week and spend at most 70
Canadian dollars."* returns `AUTOPILOT_CREATE` with a WEEKLY, CAD, `maximumPerWeekMinor: 7000`
draft whose items are Coca-Cola, Sprite and Fanta with `brandMatch: "PREFERRED"`.

## Errors

Every error is `{ error: { code, message } }` with a safe `message` suitable to show. No stack
traces or provider details are ever returned.

| HTTP | `code` | When |
| --- | --- | --- |
| 400 | `INVALID_REQUEST` | Schema violation; `message` names the first problem (e.g. "Weekly maximum must be greater than zero.") |
| 400 | `INVALID_JSON` | Body is not valid JSON |
| 400 | `AUTOPILOT_CONFIRMATION_REQUIRED` | `activate`/`resume` without `{ "confirm": true }` |
| 400 | `AUTOPILOT_SELECTION_INVALID` | Selected item is not in the run, or more than one product per item |
| 403 | `ORIGIN_REJECTED` | Cross-site or non-local request |
| 404 | `AUTOPILOT_POLICY_NOT_FOUND` | Unknown id, or another session's autopilot |
| 404 | `AUTOPILOT_RUN_NOT_FOUND` | Unknown or pruned run |
| 409 | `AUTOPILOT_INVALID_TRANSITION` | e.g. pausing a draft, resuming a draft |
| 409 | `AUTOPILOT_POLICY_ACTIVE` | Editing budget/items/schedule/trigger/authorization while ACTIVE (pause first) |
| 409 | `AUTOPILOT_POLICY_NOT_ACTIVE` | Evaluating or searching a DRAFT or PAUSED autopilot |
| 409 | `AUTOPILOT_POLICY_LIMIT` | More than 20 autopilots in one session |
| 409 | `AUTOPILOT_RUN_STALE` | The autopilot changed after the run started; evaluate again |
| 409 | `AUTOPILOT_RUN_NOT_SEARCHABLE` | The run has no searches to perform or authorize (e.g. `COMMERCE_UNAVAILABLE`) |
| 409 | `AUTOPILOT_SELECTION_MISMATCH` | The product did not come from this run's search for that item |
| 409 | `SELECTION_EXPIRED` | The search result expired (15 min) or is unknown; search again |
| 413 | `BODY_TOO_LARGE` | Body over the route's size limit |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Non-JSON body (including any audio upload attempt) |
| 429 | `MISSION_BUSY` | A search is already running for this session (from the shared commerce engine) |
| 503 | `COMMERCE_UNAVAILABLE` | Search requested while the Agnic integration is not configured |
| 503 | `AUTOPILOT_DEMO_DISABLED` | `/demo` outside development/test |
| 503 | `AUTOPILOT_STORAGE_FULL` | Demo storage limit reached; restart the server |

## Demo fixture

`POST /api/autopilot/demo` (development/test only) creates, once per session, the café
fixture: `fixtureId: "cafe-drinks-restock"`, name "Café Drinks Restock (DEMO)", `demo: true`,
ACTIVE, due immediately, weekly C$70.00 authority, items Coca-Cola / Sprite / Fanta (brand
preferences), auto-authorize within the mandate, anything above it needs approval. Runs from
it carry `demo: true`. Always label demo data as a demo; it must never be handed to checkout.

## Known behaviour to design around

- Autopilot storage is in server memory: restarting the server clears autopilots and runs.
- Only one commerce search runs per session at a time (`429 MISSION_BUSY`); search items one by one.
- In `next dev`, Request/Inspect search results live in the existing in-memory mission cache,
  which resets when the dev server compiles a route for the first time. If an `authorize`
  returns `SELECTION_EXPIRED` right after a first-time route compile, search again.
- There is no background scheduler. A policy becomes `due` when its slot arrives; runs happen
  when `run-due` or `evaluate` is called.
