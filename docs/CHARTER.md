# Charter

DinkusKit Accounts lets a store's shoppers sign in and keep their addresses.
Checking out as a guest always stays possible, as on Shopify and WooCommerce.

## Decided

The owner decided these on 18 Nov 2026 and narrowed them on 21 Nov 2026
(`accounts-v1-scope-20261121` in the ledger, which supersedes
`accounts-own-plugin-20261118`). They replace Commerce's
`shopper-accounts-v1-20261020`, which put shopper accounts inside Commerce.
They follow DinkusKit's plugin architecture
(`dinkuskit-plugin-architecture-20261121` in dinkuskit/dinkuskit): separate
plugins, with every store's data kept in the store's own database.

- **Its own plugin, separate from Commerce.** A store that does not want
  accounts does not install them, and Commerce gets back about 8.8 KB of its
  128 KiB Registry limit.
- **The first version** has:
  - sign-in with a 6-digit code sent by email, like Shopify (the code lasts
    10 minutes and allows 5 tries; a shopper stays signed in for 30 days, as
    in Commerce today);
  - saved addresses;
  - the account page.
- **Shoppers are not EmDash users.**
- **Account forms are server pages.** A Save is refused when the signed-in
  shopper changed since the page was drawn (for example, after signing out and
  in as someone else in another tab), using a token tied to the shopper, as
  WooCommerce and Shopify do. No page script.
- **Checkout fills a signed-in shopper's saved address on the server.** While
  drawing the checkout page, the store's server asks Accounts for the saved
  address and fills in the form. Commerce never knows about accounts. An
  address typed at checkout is not saved to the account in the first version;
  shoppers change it on the account page.
- **My orders is deferred.** A signed-in shopper sees no orders list yet.
  Instead, Commerce gets an order lookup page like WooCommerce's "Track your
  order": order number plus email shows that one order. When my orders comes
  back, the choice is between Commerce writing read-only order summaries to a
  hidden content collection that Accounts reads by email, and a signed pass
  from Accounts that a Commerce route checks. Earlier guest orders with the
  same email will be included.
- **Commerce drops all its shopper-account code**, including its my-orders
  code, once this plugin replaces it.
- **Timing:** ideally before Commerce's stable 0.9.0.

## Not decided

- How the sign-in email is sent.
- How shoppers' existing Commerce accounts move across. There are no real
  stores yet, so moving them may not be needed.

## Out of scope for the first version

Passwords, social sign-in, wish lists, store credit, and marketing email
preferences. None is ruled out for later.
