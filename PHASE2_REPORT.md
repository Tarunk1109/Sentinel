# SENTINEL Phase 2 engineering report

Validated locally on September 17, 2026. Running at http://127.0.0.1:3001.

| Requested item | Result |
| --- | --- |
| 1. Files changed | Full grouped inventory is in README.md under Architecture and changed files. Principal changes: dashboard components and hook, domain schemas, OpenAI/Agnic adapters, mission orchestration, three API routes, safety/configuration/HTTP helpers, persistent AI budget, tests and documentation. Existing credential values were preserved. |
| 2. Architecture | Server-only provider interfaces; strict schemas; streamed real activity; normalized product data; evidence-checked ranking; server-owned selections; bounded request/quote caches; unconditional purchase lock. No new database, background worker or payment infrastructure. |
| 3. GPT-6 Astra LIVE? | OpenAI authentication and Luna inference are live. Astra model access was confirmed with HTTP 200 from a read-only model lookup. The Astra structured inference adapter is implemented and tested with fixtures; no billable Astra inference was needed or live-tested because catalogue results lacked technical specifications. |
| 4. Agnic authentication | Works with the existing server token using the documented X-Agnic-Token header. No credential printed or sent to the browser. |
| 5. Agnic search LIVE? | Yes. All four requested prompts reached real Agnic product search. |
| 6. Products REAL? | Yes. Examples included ASUS ZenScreen monitors, Keychron/Cherry keyboards, and Helix/Belkin USB-C chargers. Browse prices, merchant names and variant identifiers came from Agnic. No demo fallback. |
| 7. Compatibility evaluation LIVE? | Live model evaluation checks relevance and listing evidence. Technical/device compatibility remains NEEDS_VERIFICATION without adequate specs. Unsupported model evidence is rejected; exact VERIFIED status is deliberately withheld. |
| 8. Quote/preview | Read-only Shopify quote adapter and UI implemented. Exact/ceiling, changed price, fulfillment, unavailable, budget and setup behavior tested offline. Live selection and preview routes verified; tested merchants needed onboarding, so no finalized live Agnic quote was obtained and no quote network call was made. No merchant was onboarded. |
| 9. Model calls/request | One Luna intent call, plus at most one Luna/Astra evaluation. Empty filtered lists skip evaluation. Cached requests make zero model calls. No automatic retries. |
| 10. Agnic calls/request | One search per uncached mission. Up to one additional non-charging quote only after Check Final Price, if merchant setup permits it. Selection and cached requests make zero provider calls. |
| 11. Setup still required | To obtain a complete quote, an eligible/onboarded merchant and any required account/delivery/fulfillment setup are needed. This phase does not create that setup, collect addresses or vault cards. |
| 12. Blockers/limits | Current search metadata cannot prove exact device compatibility. Tested merchants need onboarding before live quotes. Some catalogue candidates have unresolved required features and are explicitly labeled unverified. Local caches expire after 15 minutes or a server restart. No Phase 3 work performed. |
| 13. API usage/cost | Live validation made 8 Luna inference calls and 5 Agnic searches, including one monitor retest after fixing irrelevant catalogue results; one free Astra model-access lookup. Estimated model cost: USD 0.0054458, conservatively accounted as CAD 0.0108916 using the app's 2× USD buffer. No pending cost reservations. App cap C$5; per-call cap C$0.75. This is token-based accounting, not an account invoice or balance reading. |
| 14. Secrets server-side | Confirmed. Scanned 34 generated frontend artifacts for existing credential values: zero matches. Environment files and the usage ledger are excluded from Git. Provider exceptions/headers/profile data are not exposed. |
| 15. Money spent | No merchant payment, purchase, card charge, sandbox order or spending-limit change occurred. A small amount of OpenAI API credit was consumed with the user's explicit permission, as estimated above. It would be inaccurate to claim zero API cost. |
| 16. Purchase execution | **REAL-MONEY PURCHASE EXECUTION: DISABLED.** No commerce network path can move money. The only external app operations are OpenAI inference and documented Agnic search/non-charging quote. `placeOrder()` always throws without network, even if environment flags are changed. |

## Live prompt checks

| Prompt | Discovery / filter / shortlist | Outcome |
| --- | --- | --- |
| Portable monitor under C$200 for MacBook | 10 / 7 / 5 | Actual ASUS monitor variants. Unrelated catalogue matches removed by a cheap relevance check. MacBook compatibility remains unverified. |
| Mechanical keyboard under C$150 | 10 / 9 / 5 | Actual keyboard listings, with mechanical models ranked first and an unresolved switch-type candidate labeled unverified. Browser submission, selection and setup-required preview verified. |
| USB-C laptop charger under C$80 | 10 / 10 / 5 | Actual USB-C charging products; laptop-model/protocol compatibility remains unverified. |
| Gaming laptop under C$1 | 10 / 0 / 0 | Honest no-results state; budget remained C$1; second model call skipped. |

Repeating identical requests was tested through both API and browser: cache hits showed zero model and zero Agnic calls. Typing/example chips do not start execution. Browser submission disables the form while running. Real progress, product evidence and setup-required price review were visually checked. The localhost/127.0.0.1 origin mismatch found during browser testing was fixed and regression-tested.

## Quality and safety audit

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 77 tests passed across six files.
- `npm run build`: passed, including all three dynamic API routes.
- Reviewed purchase/payment/charge/dispatch/place-order occurrences in application source, tests, configuration and documentation. Matches are UI text, schemas/interfaces, disabled guards, read-only quote amount semantics, documentation or offline test assertions. No execution endpoint exists in application code. Vendored dependencies and generated assets were not treated as authored commerce implementations; generated frontend artifacts were separately scanned for secrets.
- No `any` types, `ts-ignore` or `eslint-disable` suppressions were added.

## Next milestone — requires later approval

Add authoritative product specifications and exact device clarification, then explicitly authorize a test-merchant/fulfillment setup and a separate sandbox-checkout exercise with genuine proof. Keep the real-money purchase lock intact. Do not onboard merchants, store cards, execute sandbox transactions or begin real checkout based on this report alone.
