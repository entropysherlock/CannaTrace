# CannaTrace

An original seed-to-sale inventory and compliance app for licensed cannabis operators. Built to be fast on a phone on a warehouse floor, with a permanent audit trail behind every change.

**Status: all 8 planned phases are built.** It has not been deployed or used by a real business yet. See "Before real use" below. See the checklist below for exactly what works.

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

## First sign-in

A new deployment starts empty. The first visitor is sent to **/setup** to enter the business name, the first licensed facility, and the owner account. That screen closes for good once any account exists.

## Accounts, teams, and roles

- **Sign up (/signup):** any business can create its own account. It becomes the owner of a separate business; nobody sees another business's data. New sign-ups are limited to `SIGNUPS_PER_HOUR` (default 20) across the site, and one account per email.
- **Invites (Team page):** an owner creates a one-time link for a person and a role, then sends it by text or email. The link works once, expires in 7 days, and can be cancelled. Only a hash of it is stored, so a lost link means making a new invite. CannaTrace does not send email itself yet.
- **Roles:** seven built-in roles, plus roles you build by ticking exactly what they allow. Changes apply on the person's next click. Only an owner can hand out team management, API keys, or the Owner role, and a business always keeps at least one active owner.

Before the register can sell, a manager must enter the store's real purchase limits and tax rates under **Register → Menu and store rules**. The register stays locked until then.

## State rules (compliance guard)

Each state is a rule pack in `src/lib/rules/packs/`: plain data where every rule carries its citation, a link to the official text, and the date it was checked. Packs today: **New Mexico, California, Michigan, Colorado**. The facility's state picks the pack.

- **Register:** the stricter of the store's and the state's purchase limits (including Michigan's combined flower-plus-concentrate cap), the state's minimum age, and no sale of product without a passing lab result where the state requires testing. Product whose latest lab result failed is never sold, in any state.
- **Failed lab results:** a package whose latest result failed (or that was split from one) can't be released, picked for an order, shipped, or used in production until a retest passes. Tally Watch raises a critical recall finding for failed product that already shipped or sold, naming the manifests and receipts.
- **Destroying waste:** the state's hold period and mixing confirmation (New Mexico: 72 hours, 50%).
- **Compliance → State rules:** a score out of 100, issues to fix, and every rule with its source. The dashboard shows the score; the assistant can explain it.
- **Adding a state:** read the regulator's official text, write a pack with citations, add it to `PACKS`, and extend `tests/rules-engine.test.ts`. Never add a number you have not checked against the official source.

## The assistant (Claude)

Every page has an **Ask CannaTrace** button (or press Ctrl+J). People ask in plain English and Claude answers from the business's live data: inventory, sales, orders, unpaid invoices, plants, production, state reporting, and the audit trail.

- **Turn it on:** create an API key at console.anthropic.com, add it in Vercel as `ANTHROPIC_API_KEY`, and redeploy. Set a monthly spending limit in the Anthropic Console. Optional: `ANTHROPIC_MODEL` (default `claude-sonnet-5-5`).
- **It only sees what the person can see:** their own business and facility, and only the tools their role allows.
- **Changes wait for Confirm:** it can move packages, hold or release them, and correct quantities, but only by showing a card that the person must confirm within 15 minutes. The same inventory checks run, and the audit trail records "(via assistant)".
- **Creates from plain English:** "receive these 12 packages from Green Valley", "make a wholesale order for Dispensary X with these items", "start a production run of 200 gummy packs" (inputs picked oldest first). New packages always need real state tags; Tally asks for them rather than inventing any.
- **Plans multi-step jobs:** "close out this harvest" records the dry weight, makes the packages, logs the waste, prepares labels, and finishes the harvest. The card lists every step. Before it appears, the whole plan is run for real and rolled back, so a problem shows up before anything is saved. One Confirm then runs it all or nothing (a label problem alone never stops the job).
- **One-click Undo:** every Tally change gets an **Undo this** button on its card and on the Audit trail page, or say "undo that". Undo reverses the whole change as one unit by walking its audit entries backwards. History is never erased: the reversals are added to the audit trail and reported to the state (packages are zeroed as entry errors, harvests reopened). Undo is blocked if anything it touched was changed again since, and needs the same permissions as the original change. Confirming the same card twice does it once.
- **Tally Watch** (on the Dashboard): Tally checks each facility on its own every morning (cron `/api/watch/run`, same `CRON_SECRET`) and whenever the page is opened (at most every 15 minutes). The checks are plain database queries, not AI, so findings are exact: failed lab tests still sellable, packages that don't match the state system, failed or hand-entry state reports, high-severity state-rule problems, open orders shipping to an expiring license, new packages with no label, harvests and production runs left open, and overdue customers with orders about to ship. Where a fix is safe to prepare, it opens as a Tally plan card (approve once, Undo after); otherwise there's **Ask Tally** or **Open**. Findings resolve by themselves when the problem is gone, reopen if it comes back, and stay dismissed if a person dismisses them. Each finding is shown only to roles that can see that area.
- **State match without an integrator connection:** export the Packages list from the state system as a CSV (for example Metrc → Packages → Active → Export) and upload it under Tally Watch on the Dashboard. Watch flags packages missing on either side and quantity differences, converting units where it can.
- **Attachments:** the **+** next to Tally's message box (or drag-and-drop, or paste a screenshot) attaches up to 5 files per message: images (PNG, JPG, WEBP, up to 15 MB), PDFs (20 MB, 100 pages), spreadsheets (CSV and XLSX, 10 MB), and documents (DOCX 10 MB, TXT 2 MB). Files upload in 3 MB pieces, are checked by their actual bytes, and are read on the server: images re-encoded (camera and GPS data stripped) and sent to Claude as images, PDFs sent as PDFs (text and page images), Word and text files as extracted text (pictures inside them aren't read, and Tally says so), spreadsheets as a preview plus tools to read more rows (`attachment_rows`) and compare with live inventory (`compare_attachment_inventory`, read-only). Files are private to the person who attached them at that facility, encrypted at rest with `AI_KEY_ENCRYPTION_KEY`, never served back as downloads, and deleted after `TALLY_FILE_RETENTION_HOURS` (default 24; also cleaned by the daily jobs). Uploads per person per day: `TALLY_UPLOADS_PER_DAY` (default 100). File contents are labelled to Claude as customer data, never instructions, and nothing changes records without a Confirm. Files go to Anthropic on the business's own Claude account; the menu says so.
- Automated tests use a scripted stand-in (`ASSISTANT_FAKE=1`), so they need no key.

## Demo data (local testing only)

`npm run db:seed` loads a made-up company, "High Desert Demo Co.", for development and the automated tests. Every demo account (`owner@demo.test`, `manager@demo.test`, and so on) uses the password `demo1234`. Production never loads it, and a deploy removes it automatically if an older deploy did.

## Deploy (Vercel + Neon)

1. In Vercel, choose **Add New → Project** and import this GitHub repository. Leave the build settings as they are.
2. Add these environment variables:
   - `AUTH_SECRET`: a random string of at least 32 characters
   - `CRON_SECRET`: another random string of at least 16 characters
3. In the project's **Storage** tab, add **Neon** from the Marketplace and connect it. It fills in `DATABASE_URL` for you.
4. Deploy (or redeploy if the first one ran before the database was connected), then open the site and complete **/setup**.

Every deploy runs `npm run vercel-build`, which updates the database tables before building. A deploy fails with a plain message if `DATABASE_URL` or a strong `AUTH_SECRET` is missing.

`vercel.json` sends state reports and webhooks once a day, the most the free Hobby plan allows. Use **Send now** on State reporting in between, or a paid plan or outside scheduler for more often.

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
- [x] Sign-in, sign-out, protected routes, facility switcher; owners can limit each person to some facilities, and sign-in returns people to the facility they last used
- [x] Each facility keeps time in its state's time zone (ages, daily limits, license expiry, invoices, end of day, dates sent to the state)
- [x] App shell with desktop sidebar and phone bottom navigation
- [x] Demo seed data
- [x] CI: lint, typecheck, tests, migrate, seed, build, browser tests
- [x] Password reset (one-time links from the Team page; change your own under Password) and user deactivation

### Phase 2: Inventory and warehouse
- [x] Items, categories, and locations, with screens to add them and retire items
- [x] Packages with unique tags, lots, cost, and parent/child lineage
- [x] Receive, move, adjust with required reason codes
- [x] Split into new packages and merge same-lot packages (weighted average cost)
- [x] Hold, quarantine, release, and destroy, each with a required reason
- [x] Cycle counts by location, with automatic corrections
- [x] Lab results with COA upload (PDF, PNG, JPEG up to 4 MB); a failing result quarantines the package, and it stays out of sales, orders and production until a retest passes
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
- [x] Credit memos on invoices (product returns are received as packages)
- [ ] Multi-stop routes (one order per manifest for now)

### Phase 6: Retail POS
- [x] Per-store menu with shelf prices and live stock
- [x] Customer check-in with an age and ID-expiry check; the birth date is not stored
- [x] Purchase limits for flower, concentrate, and edible THC, enforced when adding to the cart and again at payment
- [x] Discounts from a preset list
- [x] Cannabis excise tax and sales tax, with an optional medical exemption
- [x] Cash (with change) and debit payments
- [x] Stock sold oldest package first, with every package tag on the receipt
- [x] Cash drawers per person: each person opens and counts their own; clerks count blind (expected cash shows only on the report after closing); managers see every open drawer and can close one left open
- [x] Printable receipt and end-of-day report
- [x] Voiding a sale during the same shift puts the product back in stock
- [x] Returns on any day, partial or whole: sealed items back to stock or opened items written off; cash refunds from the open drawer, card refunds recorded (done on the card terminal)
- [x] More than one person ringing at once, each into their own drawer
- [x] Limits per customer per day (optional, by a one-way code of the ID number; ID scans fill it in)
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

### Phase 8: Reporting and integrations
- [x] Reports: inventory value at cost by category, inventory age, retail sales by day, wholesale owed and overdue, harvest and production yields, state reporting health
- [x] CSV download for packages, items, locations, customers, invoices, retail sales, and the audit trail (spreadsheet formulas in text are neutralised)
- [x] CSV import for items, locations, customers, and opening inventory, with templates; all rows or none, with every problem listed by line
- [x] REST API with per-facility keys (read-only or read and write); only a hash of each key is stored
- [x] Webhooks for 13 kinds of event, signed with HMAC-SHA256, retried for about 15 hours, public https addresses only
- [ ] API rate limiting
- [ ] More write endpoints (only package adjustments for now)

### Using the API and webhooks
Owners create keys and webhooks under **Integrations**, which also documents every endpoint. Send keys as `Authorization: Bearer ct_...`.

To check a webhook came from CannaTrace, read the `CannaTrace-Signature` header (`t=<seconds>,v1=<hex>`), compute HMAC-SHA256 of `"<t>.<raw body>"` with the webhook's secret, compare, and reject anything older than five minutes. `verifySignature` in `src/lib/integrations.ts` does exactly this.

### Sending on a schedule
State reports and webhooks are sent by calling `GET /api/sync/run` with `Authorization: Bearer <CRON_SECRET>`. On Vercel, set `CRON_SECRET` and add a cron job for that path; Vercel sends the header for you. Vercel's free plan only allows a daily cron, so use a paid plan or an outside scheduler for every few minutes. Without a schedule, records wait until someone presses **Send now** on State reporting.

### Known limits
- Camera scanning has not been tested on a real phone. It needs HTTPS (or localhost) and camera permission.
- COA files are stored in the database. That is fine to start; move them to file storage before heavy use.
- A scanned ID's earlier purchases that day always count toward its limits, even with the daily setting off; the setting adds the same for IDs typed by hand (it then asks for the ID number). Returned items don't reduce a customer's daily total (the stricter reading). Password reset links are made by an owner; there's no email sending yet.
- Merging refuses packages from different lots. Some states allow it under conditions; that rule is not modelled.
- Locations cannot be renamed or removed yet.
- Harvests can only be packaged into items tracked by weight. Pre-packaged units (jars, pre-rolls) come in Phase 4.
- Bulk plant actions handle up to 500 plants at a time.
- Tax rates and purchase limits are whatever each store enters under Menu and store rules. CannaTrace ships with none and does not look them up.
- Both taxes are charged on the discounted subtotal. If your state taxes differently (for example tax on tax), the totals will not match.
- Receipt warning text is whatever the store enters under Store rules; CannaTrace doesn't supply receipt wording. Label templates can use the store's label warning field, and New Mexico product labels are checked for the state's required warning.
- The printed manifest is an internal document. It does not replace the manifest issued by the state track-and-trace system.
- License verification records that a person checked the state lookup; it does not query the state automatically.
- Cost per unit shows as unknown if any input package has no cost on record, rather than showing a partial figure.


## Before real use

1. **Deploy** with a hosted Postgres and set `AUTH_SECRET`, `DATABASE_URL`, and `CRON_SECRET`, then complete /setup.
2. **Have a lawyer and the state rules checked**: tax rates, purchase limits, label and receipt wording, manifests, and record retention all depend on the state and city.
3. **State reporting**: Metrc requires applying as an integrator and getting a vendor key. New Mexico (NMS2S) has not published the API software needs, so records there are entered by hand for now.
4. **Security review**: there is no password reset, two-factor sign-in, or API rate limiting yet.
5. **Pilot** with one friendly operator before selling to anyone else.
