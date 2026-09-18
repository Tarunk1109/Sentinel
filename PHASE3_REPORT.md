# SENTINEL Phase 3 status — September 18, 2026

Backend implementation is ready for further live integration testing; the complete sandbox purchase is **blocked by Agnic setup/service responses**. The user prioritized backend completion over further UI polish. No Phase 4 work was started.

| Requested report item | Verified result |
| --- | --- |
| 1. Light UI | White/off-white, cobalt accent, responsive Request workspace, real product images/evidence, activity timeline, separate checkout and sandbox sections. Current UI retained; further polish deferred. |
| 2. Files changed | Phase 3 implementation inventory is in README. This final backend batch changes `services/checkout.ts`, `adapters/agnic-checkout.ts`, provider/service tests, `.env.example`, `package.json`, and README; adds `scripts/check-agnic.mjs`, this report, and `AGNIC_SUPPORT_MESSAGE.md`. |
| 3. Demo states | Request landing, real shortlist, selected-product checkout review, and honest sandbox blocker are visible. Fulfillment/receipt states are implemented and tested with offline fixtures; they are not live purchase proof. |
| 4. Real search | Passed the earlier browser check: mechanical keyboard under C$150 produced ten listings, nine within browse constraints, and five ranked results. Two Luna calls and one Agnic search; no invented products. No paid model calls in the September 18 backend completion run. |
| 5. Merchant explore | Endpoint integrated, bounded and tested. Earlier selected Staples flow failed. Fresh official-store exploration returned HTTP 500 / `db_error`, without an order ID. No successful live readiness transition can be claimed. |
| 6. Fulfillment | Real returned options, explicit selection, and re-quote implemented; offline tests pass. Live verification awaits a usable merchant/profile. |
| 7. Quote | Safe quote, final-versus-ceiling semantics, budget enforcement, freshness, and changed-quote refusal pass offline tests. No complete live quote obtained because merchant preparation remains blocked. |
| 8. Official test merchant | Read `merchant_untitled_fidget_shop` from Agnic. HTTP 200; `is_test=false`, `catalog_error=merchant_not_linked`. The returned merchant list contained no designated test merchant. This is not proof that none exist outside that bounded list. |
| 9. End-to-end sandbox | BLOCKED. Current official docs explicitly describe this shop as gateway test mode but not a designated test merchant. The user's stricter server-verified `is_test=true` requirement is preserved. |
| 10. Live dispatch count | **0** throughout this Phase 3 work. Mock dispatch assertions in automated tests are not network calls. |
| 11. Real merchant dispatch | **None.** No real-merchant purchase was attempted. |
| 12. Order status/proof | Known-order polling, bounded timeouts, manual status checks, sanitized evidence URLs, test success, decline, and unknown outcomes are implemented and fixture-tested. No live receipt is displayed or fabricated. |
| 13. Duplicate prevention | Concurrent confirmation, durable exclusive claims, uncertain outcomes, expiry, and restart tests pass. Stable private keys bind browser owner + merchant + SKU; a new checkout ID cannot repeat the same selection for that owner. Clearing cookies or another application is outside this local guard. |
| 14. Real purchase lock | Unconditional server lock remains in place; environment configuration cannot enable real purchase execution. Frontend merchant/test/price overrides are rejected. |
| 15. C$5 cap | Unchanged. It budgets OpenAI inference only, not free Agnic API calls. Real purchase spend remains zero. |
| 16. AI behavior | Existing OpenAI provider retained: Luna for intent/simple comparisons; Astra only when technical product evidence warrants it. Up to two calls per uncached request; no automatic retries. |
| 17. Gateway readiness | Server interface/extension point and model setting documented. No Agnic AI Gateway adapter or assumed model activated. |
| 18. Tests/security | **172 automated tests passed across 10 suites.** Lint and TypeScript passed. Existing credentials matched zero of 44 browser artifacts, zero tracked files, zero Git-history patches, and zero preview-log files. Further UI tests/polish deferred per the user's revised priority. |
| 19. Production build | Passed. Local production preview starts at http://127.0.0.1:3001. |
| 20. Manual setup | Organizer must resolve merchant linking/explore errors and provide a verifiable designated test merchant plus current low-price variant. Hosted test-card alias and any required hosted profile/mandate setup remain outstanding; no card/profile data was collected. Organizer draft is in `AGNIC_SUPPORT_MESSAGE.md`. |

## Reproduce the blocker without spending AI credits

`npm run check:agnic` performs two read-only metadata calls. Add `-- --explore` to deliberately run one non-purchasing merchant exploration; it does not retry. The final diagnostic returned:

- Merchant metadata: HTTP 200; `is_test=false`; `merchant_not_linked`.
- Returned merchant list: HTTP 200; no entries with `is_test=true`.
- Explore: HTTP 500; `db_error`; no trackable job returned.
- Calls in that diagnostic: 3 Agnic calls, 0 model calls, 0 dispatch calls.

An organizer-provided replacement merchant ID can be configured server-side through `SENTINEL_SANDBOX_MERCHANT_ID`; its live test status is still mandatory. The current catalogue discovery is tailored to the documented C$1 fidget products; a replacement store's supplied variant may require a small catalogue adapter adjustment after its contract is known. Do not bypass the test flag or fabricate a SKU.

## Validation boundaries and spending

The earlier browser run checked live search, selection, preparation failure, and the sandbox blocker. Desktop layout checks at 1440/1920 and mobile at 390 found no horizontal document overflow. They do not substitute for a successful live checkout. Real-merchant rejection and duplicate confirmation are verified with controlled server tests; a forged frontend test flag also returned HTTP 400 from the running API.

The local AI ledger is C$0.0282376 with no pending reservations, up from C$0.0108916 at the Phase 2 report. This conservative token-accounting total includes intervening local app usage; it is not an OpenAI invoice or account balance. The final backend completion run made zero paid inference calls. The zero-money statement below refers to **purchase spending**, not earlier authorized model-credit usage.

The app still assumes one local process and persistent disk. Checkout UI state is not restored after a restart; inspect saved Agnic order evidence after any ambiguous outcome. Never clear the dispatch journal or browser identity to repeat an uncertain order. Agnic HTTP 202 hosted-approval responses are stopped for manual review; this version deliberately does not issue a second dispatch.

Sources: [Agnic testing](https://docs.agnic.ai/docs/agentic-commerce/testing), [REST checkout](https://docs.agnic.ai/docs/api-reference/checkout). The testing documentation's gateway-mode description does not satisfy the current explicit `is_test=true` safety rule.

REAL-MONEY PURCHASE EXECUTION: DISABLED
SANDBOX CHECKOUT: BLOCKED
REAL MONEY SPENT DURING PHASE 3: C$0.00
