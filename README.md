# DinkusKit Accounts

Shopper accounts for [DinkusKit Commerce](https://github.com/dinkuskit/commerce) stores on [EmDash](https://emdashcms.com): sign in with an emailed code, saved addresses and past orders.

## Status

Scaffold. Shoppers cannot sign in through this plugin yet and nothing is published. Until it is ready, shopper accounts still live in DinkusKit Commerce.

What exists:

- An EmDash Registry plugin, `dinkus-accounts`, with one admin page, **Shopper accounts**, that says shoppers cannot sign in yet. It asks for no capability, no network host and no public route.

What the first version will do, and what is still open, is in [docs/CHARTER.md](docs/CHARTER.md).

## How it fits with Commerce

- **Accounts owns** the shopper: signing in with an emailed 6-digit code, staying signed in, saved addresses and the account pages.
- **Commerce owns** products, prices, carts, checkout, orders and money. Accounts never changes any of them, and shoppers can always check out as guests.
- Shoppers are not EmDash users. Staff sign in to the EmDash admin; shoppers sign in to the store.
- EmDash keeps each plugin's data to itself, so Accounts cannot read Commerce's orders directly. How "my orders" and the saved checkout address cross that line is still being decided ([docs/CHARTER.md](docs/CHARTER.md)).

## Install type

Registry only. The plugin is built for the EmDash plugin Registry and runs sandboxed. It is not listed in the Registry yet.

## Develop

Node 24 (`.nvmrc`).

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

`npm test` builds the plugin, packages it the way the Registry does (failing if the backend passes 128 KiB), and runs the tests.

## Pull requests

Every pull request to `main` runs CI and gets a ClawSweeper review. Only the reviewed commit may merge.

## License

MIT
