#!/bin/bash
set -euo pipefail

# ---------------------------------------------------------------------------
# Solana devnet smoke test
# Checks RPC health and slot sync, then records the result in the database.
# Usage: smoke-test.sh [RPC_URL]
# ---------------------------------------------------------------------------

RPC_URL="${1:-https://api.devnet.solana.com}"

# ------- 1. getHealth -------------------------------------------------------

HEALTH_RAW=$(curl -s -w '\n%{time_total}' -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' "$RPC_URL")

# Last line is the timing value; everything before it is the JSON response.
HEALTH_RESPONSE=$(echo "$HEALTH_RAW" | sed '$d')
HEALTH_TIME=$(echo "$HEALTH_RAW" | tail -1)

# Convert seconds to milliseconds (integer).
RPC_LATENCY_MS=$(echo "$HEALTH_TIME" | awk '{printf "%d", $1 * 1000}')

HEALTH_RESULT=$(echo "$HEALTH_RESPONSE" | jq -r '.result // empty')

# ------- 2. getSlot ---------------------------------------------------------

SLOT_RESPONSE=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot"}' "$RPC_URL")

SLOT=$(echo "$SLOT_RESPONSE" | jq -r '.result // empty')

# ------- 3. Determine status ------------------------------------------------

if [[ "$HEALTH_RESULT" == "ok" ]] && [[ -n "$SLOT" ]] && [[ "$SLOT" -gt 0 ]] 2>/dev/null; then
  STATUS="passed"
else
  STATUS="failed"
fi

# ------- 4. Record to database -----------------------------------------------

CREDS_FILE="$HOME/.openclaw/db-credentials.json"

if [[ -f "$CREDS_FILE" ]]; then
  CREDS=$(cat "$CREDS_FILE")
  DB_HOST=$(echo "$CREDS" | jq -r '.host')
  DB_PORT=$(echo "$CREDS" | jq -r '.port')
  DB_USER=$(echo "$CREDS" | jq -r '.username')
  DB_NAME=$(echo "$CREDS" | jq -r '.database')
  DB_PASS=$(echo "$CREDS" | jq -r '.password')

  PGPASSWORD="$DB_PASS" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c \
    "INSERT INTO devnet_smoke_runs (run_id, status, rpc_latency_ms, wallet_check, tx_simulation, ran_at)
     VALUES (gen_random_uuid(), '$STATUS', $RPC_LATENCY_MS, 'skipped', 'skipped', NOW());"
else
  echo "WARNING: $CREDS_FILE not found — skipping database insert." >&2
fi

# ------- 5. Print JSON result ------------------------------------------------

RAN_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat <<EOF
{
  "status": "$STATUS",
  "rpc_latency_ms": $RPC_LATENCY_MS,
  "slot": $SLOT,
  "rpc_url": "$RPC_URL",
  "ran_at": "$RAN_AT"
}
EOF
