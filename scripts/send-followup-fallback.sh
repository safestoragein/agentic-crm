#!/usr/bin/env bash
# Self-hosted replacement for the Vercel Cron that triggers the follow-up email
# fallback. Run this once a day from the server's crontab (see DEPLOY.md).
#
# It reads CRON_SECRET from the app's .env.local and POSTs to the running
# Next.js app, which then pulls the day's failed WhatsApp follow-ups and emails
# each customer via Resend. Safe to run repeatedly — the route is idempotent.
#
# Usage:
#   scripts/send-followup-fallback.sh            # real run against $APP_URL
#   APP_URL=https://crm.safestorage.in scripts/send-followup-fallback.sh
#   DRY_RUN=1 scripts/send-followup-fallback.sh  # preview targets, send nothing
set -euo pipefail

# Resolve the app root (parent of this script's dir) so cron can call it by any path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env.local"

# Where the Next.js server is reachable. Override via env for a domain/port.
APP_URL="${APP_URL:-http://localhost:3000}"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Create it on the server (it is gitignored)." >&2
  exit 1
fi

# Pull CRON_SECRET out of .env.local without sourcing the whole file.
CRON_SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'"'"'' )"
if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "ERROR: CRON_SECRET is empty/missing in $ENV_FILE." >&2
  exit 1
fi

BODY='{}'
[[ "$DRY_RUN" == "1" ]] && BODY='{"dryRun":true}'

echo "[$(date '+%Y-%m-%d %H:%M:%S')] POST $APP_URL/api/followup/email-fallback (dryRun=$DRY_RUN)"
# -w prints the HTTP status on its own line after the JSON body so the log shows
# both. (Avoids --fail-with-body, which needs curl 7.76+.)
curl -sS --max-time 290 \
  -X POST "$APP_URL/api/followup/email-fallback" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w '\nHTTP %{http_code}\n'
