# CannaTrace

An original seed-to-sale inventory and compliance app for licensed cannabis operators. Built to be fast on a phone on a warehouse floor, with a permanent audit trail behind every change.

**Status: Phase 1 of 8 (foundation) plus the first slice of Phase 2 (inventory).** See the checklist below for exactly what works.

## Stack

- Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS 4
- PostgreSQL 16 with Drizzle ORM (SQL migrations in `drizzle/`)
- Email and password sign-in, signed session cookie, seven roles
- Vitest for unit tests, GitHub Actions for CI

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
| `npm test` | Unit tests |
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
- [x] CI: lint, typecheck, tests, migrate, seed, build
- [ ] Password reset and user deactivation screens
- [ ] End-to-end browser tests (Playwright)

### Phase 2: Inventory and warehouse
- [x] Items, categories, packages with unique tags, lots, locations
- [x] Receive, move, adjust with required reason codes
- [x] Search by tag, item, SKU, or lot (works with a keyboard-style barcode scanner)
- [x] Per-package history and audit trail
- [ ] Split and merge packages (math is written and tested; screens are not)
- [ ] Holds and quarantine actions, cycle counts
- [ ] Lab results and COA upload
- [ ] Phone camera scanning, printable labels
- [ ] Screens to manage items, categories, and locations

### Not started
- [ ] Phase 3: Cultivation
- [ ] Phase 4: Manufacturing
- [ ] Phase 5: Distribution
- [ ] Phase 6: Retail POS
- [ ] Phase 7: Compliance sync (Metrc, BioTrack, Mock)
- [ ] Phase 8: Reporting, CSV import and export, REST API, webhooks
