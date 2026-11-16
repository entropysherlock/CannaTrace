# CannaTrace

An original seed-to-sale inventory and compliance app for licensed cannabis operators. Built to be fast on a phone on a warehouse floor, with a permanent audit trail behind every change.

**Status: Phases 1 to 7 of 8 are built (foundation, inventory and warehouse, cultivation, manufacturing, distribution, retail POS, compliance sync).** See the checklist below for exactly what works.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- PostgreSQL 16 with Drizzle ORM (SQL migrations in `drizzle/`)
- Email and password sign-in, signed session cookie, seven roles
- Vitest for unit and database tests, Playwright for browser tests, GitHub Actions for CI

## Run it on your computer

You need Node 22 and a PostgreSQL database.

```bash
npm install
cp .env.example .env        # then set DATABASE_URL and AUTH_SECRET
npm run db:migrate          # create the tables
npm run db:seed             # load demo data
npm run dev                 # open http://localhost:3000
```

Generate an `AUTH_SECRET` with `openssl rand -base64 32`.

## Demo sign-ins

Every demo account uses the password `demo1234`.

| Email | Role |
| --- | --- |
| owner@demo.test | Owner (everything) |
| manager@demo.test | Manager |
| inventory@demo.test | Inventory |
| cultivation@demo.test | Cultivation |
| sales@demo.test | Sales |
| budtender@demo.test | Budtender |
| readonly@demo.test | Read-only |

These are for demos only. Do not seed a real deployment with them.

## Deploy (Vercel + hosted Postgres)

1. Create a Postgres database (Neon and Supabase both work) and copy its connection string.
2. Import this repository into Vercel.
3. In Vercel, set two environment variables: `DATABASE_URL` and `AUTH_SECRET`.
4. From your computer, point `DATABASE_URL` at the hosted database and run `npm run db:migrate`.
5. Deploy.

## How inventory stays trustworthy

- Every record belongs to an organization and a facility (license). Every query is scoped to both.
- Quantities never change by direct edit. They change only through transactions (receive, move, adjust), each recorded with the before and after amounts.
- Every change writes an audit entry: who, what, when, before, after, and why.
- The audit log and the transaction history are locked at the database level. A trigger rejects any update or delete.
- Quantities use exact decimal math, never floating point.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app for development |
| `npm run build` | Production build |
| `npm test` | Unit tests, plus inventory engine tests when `DATABASE_URL` points at a migrated database |
| `npm run test:e2e` | Browser tests. Needs a build and a seeded database. Use `PW_CHANNEL=chrome` to run in an installed Chrome |
| `npm run lint` / `npm run typecheck` | Code checks |
| `npm run db:generate` | Create a migration after changing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations |
| `npm run db:seed` | Load demo data into an empty database |

## Feature checklist

### Phase 1: Foundation
- [x] Organizations, facilities (licenses), users, seven roles with a permission table
- [x] Sign-in, sign-out, protected routes, facility switcher
- [x] App shell with desktop sidebar and phone bottom navigation
- [x] Demo seed data
- [x] CI: lint, typecheck, tests, migrate, seed, build, browser tests
- [ ] Password reset and user deactivation screens

### Phase 2: Inventory and warehouse
- [x] Items, categories, and locations, with screens to add them and retire items
- [x] Packages with unique tags, lots, cost, and parent/child lineage
- [x] Receive, move, adjust with required reason codes
- [x] Split into new packages and merge same-lot packages (weighted average cost)
- [x] Hold, quarantine, release, and destroy, each with a required reason
- [x] Cycle counts by location, with automatic corrections
- [x] Lab results with COA upload (PDF, PNG, JPEG up to 4 MB); a failing result quarantines the package
- [x] Search by tag, item, SKU, or lot; works with keyboard-style barcode scanners
- [x] Phone camera scanning (see "Known limits")
- [x] Printable Code 128 package labels
- [x] Per-package history and audit trail

### Phase 3: Cultivation
- [x] Strains
- [x] Plant batches of untagged clones or seeds
- [x] Tagging plants from a batch, by tag run (first tag and count) or scanned list
- [x] Growth phases (vegetative, flowering) with day counts, changed in bulk
- [x] Moving plants between rooms and destroying plants, in bulk, with reasons
- [x] Harvests: one strain each, wet weight, dry weight, moisture loss
- [x] Waste log for harvests, plants, and batches
- [x] Packaging a harvest into inventory; the harvest name becomes the lot number
- [x] Finishing a harvest only when every dried gram is packaged or logged as waste
- [x] Simple task list with due dates and rooms
- [ ] Mother plants and cloning from a tagged plant
- [ ] Recurring or assigned tasks

### Phase 4: Manufacturing
- [x] Recipes (bills of materials): inputs for one batch and how much one batch makes
- [x] Production runs for any number of batches, including part batches
- [x] Inputs taken from tagged packages, with a live needed/used/remaining view
- [x] Removing an input puts the product back in its package
- [x] Completing a run creates the output package, linked to every input package
- [x] Yield against plan, and weight loss when everything is measured by weight
- [x] Cost rollup: input cost plus labor and other cost, spread over what was made
- [x] Lot number carried over when every input shares one; otherwise the run name
- [ ] More than one output package or by-product per run (split the output package for now)
- [ ] Editing a saved recipe (retire it and save a new one for now)

### Phase 5: Distribution
- [x] Customers with license number, type, expiry, and a recorded verification (who and when)
- [x] Orders cannot be confirmed or shipped to an unverified, expired, or inactive license
- [x] Price lists: a default list plus per-customer lists
- [x] Wholesale orders: draft, confirmed, packed, shipped, delivered, cancelled
- [x] Picking: take a whole package, or part of one into a new tagged package
- [x] Picked packages are set aside so nothing else can use, adjust, or destroy them
- [x] Short shipments: the invoice bills only what shipped
- [x] Drivers and vehicles, and a printable transfer manifest
- [x] Invoices with due dates from payment terms, and a printable invoice
- [x] Payments (cash, check, ACH, wire) with balance and overdue status
- [ ] Taxes on invoices
- [ ] Returns and credit memos
- [ ] Multi-stop routes (one order per manifest for now)

### Phase 6: Retail POS
- [x] Per-store menu with shelf prices and live stock
- [x] Customer check-in with an age and ID-expiry check; the birth date is not stored
- [x] Purchase limits for flower, concentrate, and edible THC, enforced when adding to the cart and again at payment
- [x] Discounts from a preset list
- [x] Cannabis excise tax and sales tax, with an optional medical exemption
- [x] Cash (with change) and debit payments
- [x] Stock sold oldest package first, with every package tag on the receipt
- [x] Cash drawer: opening float, expected cash, counted cash, and the difference
- [x] Printable receipt and end-of-day report
- [x] Voiding a sale during the same shift puts the product back in stock
- [ ] Returns after the shift has closed, and refunds to a card
- [ ] More than one register per store
- [ ] Limits tracked per customer per day (limits apply per purchase)
- [ ] Loyalty and customer profiles

### Phase 7: Compliance sync (state reporting)
- [x] Every change the state needs to hear about is queued in the same database transaction as the change itself, so none can be lost
- [x] Records are sent oldest first per facility; a failure holds back the records behind it
- [x] Automatic retries with backoff (1, 5, 30, 120, 720 minutes) for errors that can fix themselves
- [x] Plain-English explanation and next step for every kind of error, plus the state system's own message
- [x] Records a system cannot take automatically are listed for hand entry, with who marked them done
- [x] State reporting page, Send now button, dashboard warning, and a scheduled route for automatic sending
- [x] Practice mode (default): records are marked sent and nothing leaves CannaTrace
- [x] Metrc: sign-in with vendor and user keys, and package adjustments. **Not tested against a live Metrc account.**
- [ ] Metrc: every other record type (they are listed for hand entry for now)
- [ ] NMS2S (New Mexico): waiting on the state to publish the API software needs
- [ ] BioTrack: not built; New Mexico stopped using it in September 2026
- [ ] Pulling records back from the state to compare against CannaTrace

### Connecting a state system
Set these in your hosting settings (never in the code):

| Setting | What it is |
| --- | --- |
| `METRC_API_URL` | Your state's Metrc address, for example `https://api-mi.metrc.com` |
| `METRC_VENDOR_KEY` | CannaTrace's software key. Metrc issues it only after you apply and pass their integrator review |
| `METRC_USER_KEY` | The key a user at the licensed business creates in Metrc |
| `CRON_SECRET` | Any long random string. Call `/api/sync/run` with `Authorization: Bearer <CRON_SECRET>` every few minutes to send automatically |

Metrc adjustment reasons must match the names on your state's list in Metrc. CannaTrace sends its own reason names, so a state may reject them until they are matched.

### Known limits
- Camera scanning has not been tested on a real phone. It needs HTTPS (or localhost) and camera permission.
- COA files are stored in the database. That is fine to start; move them to file storage before heavy use.
- Labels are internal inventory labels. State-required consumer warnings and symbols are not included.
- Merging refuses packages from different lots. Some states allow it under conditions; that rule is not modelled.
- Locations cannot be renamed or removed yet.
- Harvests can only be packaged into items tracked by weight. Pre-packaged units (jars, pre-rolls) come in Phase 4.
- Bulk plant actions handle up to 500 plants at a time.
- Tax rates and purchase limits are whatever each store enters under Menu and store rules. The demo values are placeholders, not current rates for any state or city.
- Both taxes are charged on the discounted subtotal. If your state taxes differently (for example tax on tax), the totals will not match.
- Receipts do not include state-required warning text.
- The printed manifest is an internal document. It does not replace the manifest issued by the state track-and-trace system.
- License verification records that a person checked the state lookup; it does not query the state automatically.
- Cost per unit shows as unknown if any input package has no cost on record, rather than showing a partial figure.

### Not started
- [ ] Phase 8: Reporting, CSV import and export, REST API, webhooks
