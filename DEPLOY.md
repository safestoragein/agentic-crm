# Self-hosted deploy (own server, no Vercel)

This app is deployed directly to our own server. Because there is no Vercel,
the **Vercel Cron in `vercel.json` does NOT run** — the daily follow-up email
fallback is triggered by a system cron instead (see step 4). `vercel.json` is
kept only for reference / a possible future Vercel deploy; it is inert here.

## 1. Get the code on the server — automatic, via GitHub Actions
**`git push` to `main` is the whole deploy.** `.github/workflows/deploy.yml`
then runs `npm ci`, `npm run build`, writes a fresh `tmp/restart.txt` (which is
what makes cPanel/Passenger restart the app) and FTPS-uploads only the changed
files into the `/agentic-crm/` folder. Watch it with `gh run list` /
`gh run view <id> --log-failed`, or the repo's Actions tab.

Two consequences worth knowing:
- `.env*` and `node_modules/` are **excluded from the upload**, so server
  secrets and installed packages are never overwritten by a deploy (step 2).
- The build happens on the GitHub runner, which has **no env file**. Any
  `NEXT_PUBLIC_*` value is inlined at build time, so it must have a sane default
  in code rather than relying on the server — `NEXT_PUBLIC_MAIL_DOMAIN` already
  falls back to `safestorage.in` in `src/lib/mailboxes.js` for this reason.

If the FTP step fails with `Timeout (control socket)`, the build was fine and
nothing was uploaded — the FTP host simply did not answer. Check that FTP is
still enabled for the cPanel account and that the `FTP_SERVER` / `FTP_USERNAME`
/ `FTP_PASSWORD` repo secrets still match it. If the host has moved to
SFTP-only, this action cannot be used as configured and the workflow needs an
SFTP-capable step instead.

## 2. Environment variables (set on the SERVER, never in the repo)
Runtime secrets are read by the running app, not baked into the build, and the
deploy never uploads env files — so set them once on the server and they
survive every deploy. On cPanel that means **Setup Node.js App → your app →
Environment variables**; if the app is instead started from a shell, an
`.env.local` in the app root works the same way. Values:

```
NEXT_PUBLIC_API_BASE=https://safestorage.in/back
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # send-only key
CRON_SECRET=<long random string>                      # shared secret for the cron
# Optional (defaults shown):
# FALLBACK_FROM_EMAIL=SafeStorage <followups@safestorage.in>
# FALLBACK_REPLY_TO=safestorage.in@gmail.com

# --- Shared Outlook mailboxes (/mail, /mail/triage) ---
MS_TENANT_ID=<Entra directory (tenant) ID>
MS_CLIENT_ID=<Entra application (client) ID>
MS_CLIENT_SECRET=<the client secret VALUE, not the secret ID>
NEXT_PUBLIC_MAIL_DOMAIN=safestorage.in
```

The `followups@safestorage.in` sending domain is already verified in Resend.

**Without the three `MS_*` values every `/api/mail/*` route returns 503 and the
Mailboxes nav stays empty** — the app still runs, mail is simply unavailable.
They are server-only and read per request, so adding them takes effect on the
next app restart; no rebuild or redeploy is needed.

`NEXT_PUBLIC_MAIL_DOMAIN` is the exception: it is inlined at build time, and the
build runs on the GitHub runner where it is not set. The code defaults to
`safestorage.in`, so setting it on the server changes nothing — to point at a
different domain you must edit the default in `src/lib/mailboxes.js` or give the
workflow the value.

Two security steps that are NOT in the code and must be done in Azure/Exchange:

1. The Entra app currently holds **tenant-wide** `Mail.Read` / `Mail.ReadWrite` /
   `Mail.Send` — it can read and send as any mailbox in the tenant. Restrict it to
   the four shared mailboxes with an Exchange application access policy:
   ```powershell
   New-ApplicationAccessPolicy -AppId <MS_CLIENT_ID> -PolicyScopeGroupId CRM-Mailboxes@safestorage.in -AccessRight RestrictAccess -Description "Restrict agentic-CRM to shared mailboxes only"
   ```
2. Rotate `MS_CLIENT_SECRET` if it has ever been shared outside the server.

Optional: `AI_GATEWAY_API_KEY` enables the AI rewrite in the triage reply coach
(the rule-based score works without it), and `MAIL_ADMIN_EMAILS` grants `/mail`
access to addresses that aren't `role_id` 18.

## 3. Build & run
Normally you do **not** run these by hand — step 1 builds on the GitHub runner
and uploads the result, and Passenger restarts itself when `tmp/restart.txt`
changes. To restart without a deploy, touch that file on the server (cPanel →
Setup Node.js App → Restart does the same thing).

Only if you are running the app outside cPanel, from a shell:
```bash
npm ci
npm run build
npm run start        # serves on port 3000 by default
```
Under a process manager so it survives reboot:
```bash
pm2 start "npm run start" --name agentic-crm
```
Put nginx in front for TLS / the public domain if desired.

## 4. Daily email-fallback cron (replaces Vercel Cron)
A helper script lives at `scripts/send-followup-fallback.sh`. It reads
`CRON_SECRET` from `.env.local` and POSTs to the running app, which then emails
every customer whose follow-up WhatsApp failed that day. It is idempotent —
re-running the same day never double-emails a customer.

Add to the server crontab (`crontab -e`). The old Vercel schedule was
`0 14 * * *` UTC = **19:30 IST**. Pick the row matching the server timezone:

```cron
# If the server clock is UTC:
0 14 * * *  /path/to/agentic-crm-site/scripts/send-followup-fallback.sh >> /var/log/crm-followup.log 2>&1

# If the server clock is IST:
30 19 * * * /path/to/agentic-crm-site/scripts/send-followup-fallback.sh >> /var/log/crm-followup.log 2>&1
```

Preview without sending (prints who would be emailed):
```bash
DRY_RUN=1 ./scripts/send-followup-fallback.sh
```

If the app is reachable at a domain instead of `localhost:3000`:
```bash
APP_URL=https://crm.safestorage.in ./scripts/send-followup-fallback.sh
```
