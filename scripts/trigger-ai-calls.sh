#!/usr/bin/env bash
# Self-hosted trigger for the AI voice-call SLA escalation. Run this every few
# minutes from the server's crontab so breached quotations get an AI call soon
# after the 15-min SLA elapses. The route is idempotent (per-day guard), so a
# tight schedule never double-dials.
#
# Suggested crontab (every 5 min, 9am-9pm IST — adjust to your calling hours):
#   */5 9-21 * * *  /path/to/agentic-crm/scripts/trigger-ai-calls.sh >> /var/log/ai-calls.log 2>&1
#
# Usage:
#   scripts/trigger-ai-calls.sh                  # real run against $APP_URL
#   APP_URL=https://crm.safestorage.in scripts/trigger-ai-calls.sh
#   DRY_RUN=1 scripts/trigger-ai-calls.sh        # preview targets, dial nothing
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env.local"

APP_URL="${APP_URL:-http://localhost:3000}"
DRY_RUN="${DRY_RUN:-0}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Create it on the server (it is gitignored)." >&2
  exit 1
fi

CRON_SECRET="$(grep -E '^CRON_SECRET=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"'"'"'' )"
if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "ERROR: CRON_SECRET is empty/missing in $ENV_FILE." >&2
  exit 1
fi

BODY='{}'
[[ "$DRY_RUN" == "1" ]] && BODY='{"dryRun":true}'

echo "[$(date '+%Y-%m-%d %H:%M:%S')] POST $APP_URL/api/followup/ai-call (dryRun=$DRY_RUN)"
curl -sS --max-time 290 \
  -X POST "$APP_URL/api/followup/ai-call" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d "$BODY" \
  -w '\nHTTP %{http_code}\n'
