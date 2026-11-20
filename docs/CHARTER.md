# Charter

DinkusKit Accounts lets a store's shoppers sign in, keep their addresses and
see their orders. Checking out as a guest always stays possible, as on Shopify
and WooCommerce.

## Decided

The owner decided these on 18 Nov 2026 (`accounts-own-plugin-20261118` in the
ledger). They replace Commerce's `shopper-accounts-v1-20261020`, which put
shopper accounts inside Commerce.

- **Its own plugin, separate from Commerce.** A store that does not want
  accounts does not install them, and Commerce gets back about 8.8 KB of its
  128 KiB Registry limit.
- **The first version** has:
  - sign-in with a 6-digit code sent by email, like Shopify;
  - saved addresses;
  - the account page;
  - **my orders**: a signed-in shopper sees their past orders.
- **Commerce drops all its shopper-account code** once this plugin replaces it.
- **Timing:** ideally before Commerce's stable 0.9.0.
- **Account forms are server pages.** A Save is refused when the signed-in
  shopper changed since the page was drawn (for example, after signing out and
  in as someone else in another tab), using a token tied to the shopper, as
  WooCommerce and Shopify do. No page script.
- **Checkout fills a signed-in shopper's saved address on the server** while
  drawing the page, not with a browser fetch afterwards.

## Not decided

- **How "my orders" reaches Commerce's orders.** EmDash keeps each plugin's
  storage separate and has no plugin-to-plugin calls, so Accounts cannot read
  orders and Commerce cannot check who is signed in. The design must let
  Commerce trust which shopper is asking without a new host or a shared
  secret the owner has to paste.
- **How checkout learns the signed-in shopper's saved address**, for the same
  reason.
- How the sign-in email is sent, and how long a shopper stays signed in.
- How shoppers' existing Commerce accounts move across. There are no real
  stores yet, so moving them may not be needed.

## Out of scope for the first version

Passwords, social sign-in, wish lists, store credit, and marketing email
preferences. None is ruled out for later.
