# Hosting, backups and monitoring

Plain steps to run Leaf2Sale for a real store. Do these before the first pilot.

## 1. Host it (about 20 minutes)
Follow "Deploy (Vercel + Neon)" in the README. Then:
- Use a **paid Vercel plan** and a **paid Neon plan** for anything holding a real store's data. The free tiers keep very little history and slow down when idle.
- Set `CRON_SECRET`, `AUTH_SECRET` and (for Tally) `AI_KEY_ENCRYPTION_KEY`. Save all three in a password manager. Losing `AI_KEY_ENCRYPTION_KEY` means stores must re-enter their Claude keys.
- Put the app on your own domain (Vercel > Settings > Domains).

## 2. Know your two safety nets
1. **Neon point-in-time restore.** Neon keeps a history so the database can be rewound to any moment inside your plan's window (Neon > Branches > Restore). It is the fast fix for "something went wrong an hour ago". Check the window length on your plan.
2. **Your own nightly copy (this repo).** `.github/workflows/backup.yml` saves an encrypted copy of the database every night for 30 days. This protects you if the Neon account itself has a problem. Turn it on by adding two repository secrets (GitHub > Settings > Secrets and variables > Actions):
   - `BACKUP_DATABASE_URL`: the production connection string
   - `BACKUP_PASSPHRASE`: a long random phrase. **Save it in your password manager.** Without it the backup cannot be opened.

   Run it once by hand (Actions > Nightly backup > Run workflow) and confirm a file appears under the run's Artifacts. To open one: `gpg --decrypt cannatrace.dump.gpg > cannatrace.dump`.

   You can also take a copy any time from your own computer: `DATABASE_URL=... scripts/backup.sh`.

## 3. Prove a backup works (do this once a month)
A backup nobody has restored is a guess.
```
ADMIN_DATABASE_URL=postgres://user:pass@localhost:5432/postgres scripts/restore-check.sh backups/<file>.dump
```
It restores into a throwaway database on a scratch server, prints row counts for the main tables, deletes the scratch database, and ends with "OK". It never touches production. If it fails, treat that as an emergency: take a fresh backup right away.

## 4. Know when it is down
`GET /api/health` answers `{"status":"ok"}` (200) when the app can reach the database, and 503 when it can't. It shows nothing about any business. Add it to a free monitor such as UptimeRobot or Better Stack, check every 1 to 5 minutes, and have it text or email you.

Daily jobs (state reports, Tally Watch) record each run; if they stop, the Dashboard's Tally Watch and the job log will show it.

## 5. Know when it crashes (Sentry)
Tally Watch checks the business data once a day; Sentry tells you the moment the app itself crashes for someone.
1. Free account at sentry.io → create a project (platform: Next.js) → copy its DSN.
2. In Vercel add `NEXT_PUBLIC_SENTRY_DSN` (the DSN). For readable stack traces also add `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT`; source maps are uploaded at build time and then deleted, never served.
3. Redeploy, then Support Console → Crash alerts → **Send a test crash**.

Reports carry the error, the stack and the page path only. Cookies, headers, request bodies, query strings, IP addresses, typed input, console output, local variable values and database query data are never sent (`src/lib/sentry-options.ts`).

## 6. If something goes wrong
| Problem | Do this |
| --- | --- |
| A bad change was made recently | Neon > Restore to a time just before it, onto a **new branch** first; look; then promote it |
| Neon account or database lost | Decrypt the newest nightly backup and `pg_restore` it into a new database; point `DATABASE_URL` at it; redeploy |
| Bad deploy | Vercel > Deployments > promote the last good one (no database change needed unless a migration ran) |
| App is down but health says ok | Check Vercel's status page and the latest deployment's logs |

Tell stores in writing what you promise: for example "backed up nightly, restore tested monthly". Only promise what you actually do.
