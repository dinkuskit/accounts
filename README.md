# DinkusKit Accounts

Shopper accounts for [DinkusKit Commerce](https://github.com/dinkuskit/commerce) stores on [EmDash](https://emdashcms.com): sign in with an emailed code and saved addresses.

## Status

Version 0.1.0 is set up to publish to the EmDash Registry as `dinkus-accounts`; the owner approved publishing on 2026-11-23. DinkusKit Commerce no longer has shopper accounts of its own. The store template's sign-in and account pages come back in a template release after this one is published; until then the template's account link leads to Commerce's order lookup.

What exists:

- An EmDash Registry plugin, `dinkus-accounts`, on EmDash 1.5.
- **Sign-in with an emailed code.** A shopper gives their email and gets a 6-digit code from the store's own email setup in EmDash. The code lasts 10 minutes and allows 5 tries; a new one can be asked for after 30 seconds. A right code starts a session that lasts 30 days. Expired codes and sessions are cleared twice a day.
- **One delivery address and one phone number** per shopper, as Commerce saves today. The store's account page saves them and its checkout page fills them in. Billing is not saved; checkout keeps "same as delivery".
- One admin page, **Shopper accounts**, that says what works today.
- It asks for one capability, `email:send`, and no network host.

The store's account and checkout pages that call these routes are built in the template store.

### Shopper routes

The store's own server pages call these (public, never cached). Writes must come from the store: its server page sends `Origin`, a browser sends `Sec-Fetch-Site: same-origin`. Every answer is JSON; a refusal is `{ "ok": false, "error": { "code", "message" } }` with a message a shopper can read.

| Route | Method | Sends | Answers |
|---|---|---|---|
| `sign-in/start` | POST | `{ "email" }` | `{ "ok": true, "email", "expiresAt" }` and emails the code |
| `sign-in/verify` | POST | `{ "email", "code" }` | `{ "ok": true, "email", "session", "expiresAt" }` |
| `session` | GET | header `x-dinkus-accounts-session` | `{ "ok": true, "email", "expiresAt" }` |
| `sign-out` | POST | header `x-dinkus-accounts-session` | `{ "ok": true, "signedOut": true }` |
| `account` | GET | header `x-dinkus-accounts-session` | `{ "ok": true, "email", "phone", "delivery", "formToken", "expiresAt" }` |
| `account` | POST | the header, and `{ "formToken", "phone"?, "delivery"? }` | the same as GET, after saving |

`delivery` has Commerce checkout's shape: `name`, `line1`, `line2` (optional), `city`, `region` (optional), `postalCode` and a two-letter `country`. Each saved key is optional and `null` clears it. `formToken` comes from the GET that drew the page; a Save whose token belongs to an earlier sign-in (another tab signed out and in) is refused with `STALE_FORM`.

The store should keep `session` in an HttpOnly cookie and passes it back in the `x-dinkus-accounts-session` header. Only a hash of it is stored.

What the first version will do, and what is still open, is in [docs/CHARTER.md](docs/CHARTER.md).

## How it fits with Commerce

- **Accounts owns** the shopper: signing in with an emailed 6-digit code, staying signed in, saved addresses and the account pages.
- **Commerce owns** products, prices, carts, checkout, orders and money. Accounts never changes any of them, and shoppers can always check out as guests.
- Shoppers are not EmDash users. Staff sign in to the EmDash admin; shoppers sign in to the store.
- EmDash keeps each plugin's data to itself, so Accounts cannot read Commerce's orders directly. At checkout, the store's own checkout page asks Accounts for the signed-in shopper's saved address and fills it in. A list of past orders is deferred; until then Commerce offers an order lookup by order number and email ([docs/CHARTER.md](docs/CHARTER.md)).

## Install type

Registry only, sandboxed. The listing copy is in `docs/registry-listing/` and its icon in `assets/listing/`.

## Develop

Node 24 (`.nvmrc`).

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
npm run test:runtime
```

`npm test` builds the plugin, packages it the way the Registry does (failing if the backend passes 128 KiB), and runs the unit tests.
`npm run test:runtime` runs the built plugin inside EmDash 1.5's production Cloudflare sandbox runner (workerd and a real D1 database, through `@emdash-cms/plugin-test`) and signs a shopper in and out through EmDash's own route dispatcher.

## Release

`.github/workflows/release.yml` publishes to the EmDash Registry when a `vX.Y.Z` tag matching `package.json`'s version is pushed (Run workflow on the tag retries). It runs the checks, prepares the bundle with the pinned `emdash-plugin release prepare`, signs its build provenance, publishes with the pinned EmDash release-action (listing icon included), waits up to 30 minutes for the owner's approval at releases.emdashcms.com, and passes only when the Registry record carries exactly the prepared bundle. The service accepts releases only from a public repository. [`docs/proof/registry-release-authority/`](docs/proof/registry-release-authority/) shows how the service binds a release to the approved repository and workflow, and checks that authority again before it writes.

## Pull requests

Every pull request to `main` runs CI and gets a ClawSweeper review. Only the reviewed commit may merge.

## License

MIT
