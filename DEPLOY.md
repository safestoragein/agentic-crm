# Self-hosted deploy (own server, no Vercel)

This app is deployed directly to our own server. Because there is no Vercel,
the **Vercel Cron in `vercel.json` does NOT run** — the daily follow-up email
fallback is triggered by a system cron instead (see step 4). `vercel.json` is
kept only for reference / a possible future Vercel deploy; it is inert here.

## 1. Get the code on the server
`git push` / pull as usual. Note: `.env.local` is **gitignored**, so it is NOT
carried by git — you must create it on the server (step 2).

## 2. Environment variables (`.env.local` on the server)
Copy `.env.example` to `.env.local` in the app root and fill in real values:

```
NEXT_PUBLIC_API_BASE=https://safestorage.in/back
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx   # send-only key
CRON_SECRET=<long random string>                      # shared secret for the cron
# Optional (defaults shown):
# FALLBACK_FROM_EMAIL=SafeStorage <followups@safestorage.in>
# FALLBACK_REPLY_TO=safestorage.in@gmail.com
```

The `followups@safestorage.in` sending domain is already verified in Resend.

## 3. Build & run
```bash
npm ci
npm run build
npm run start        # serves on port 3000 by default
```
Run it under a process manager (pm2 / systemd) so it restarts on reboot, e.g.:
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
