Hey! We’re building SENTINEL for the hackathon and are blocked on test checkout.

`merchant_untitled_fidget_shop` returns `is_test: false` and `catalog_error: "merchant_not_linked"`. Calling `POST /api/autofill/explore` returns HTTP 500 with `error: "db_error"` (rechecked September 18, 2026).

Could you provide a working designated test merchant (`is_test: true`) and a C$1 product variant/SKU, or clarify the supported server-verifiable way to confirm sandbox status? Our app blocks real purchases. The testing docs describe untitled-fidget.shop as gateway test mode, but say it is not a designated test merchant.

Also, is any account linking, delivery-profile, test-card, or CAD mandate setup required before quoting?

Sanitized reproduction: `GET /api/autofill/merchants/merchant_untitled_fidget_shop` succeeds with the flags above. `POST /api/autofill/explore` with `merchant_url: "https://untitled-fidget.shop"`, a read-only checkout inspection goal, fulfillment preferences, and `currency: "CAD"` returns the database error without an order ID. No dispatch has been attempted.

References:
- https://docs.agnic.ai/docs/agentic-commerce/testing
- https://docs.agnic.ai/docs/api-reference/checkout
