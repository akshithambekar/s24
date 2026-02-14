#!/bin/bash
# validate-deployment.sh - Validates the full Solana Autopilot deployment on EC2
# Runs 8 checks and prints a PASS/FAIL summary
# Usage: bash validate-deployment.sh

set -uo pipefail

PASS=0
FAIL=0
RESULTS=()

check() {
  local name="$1"
  local result="$2"

  if [ "$result" -eq 0 ]; then
    RESULTS+=("[PASS] $name")
    PASS=$((PASS + 1))
  else
    RESULTS+=("[FAIL] $name")
    FAIL=$((FAIL + 1))
  fi
}

echo "============================================"
echo "Solana Autopilot Deployment Validation"
echo "Date: $(date)"
echo "============================================"
echo ""

export XDG_RUNTIME_DIR=/run/user/1000

# ---------- Check 1: Gateway listening on :18789 ----------
if ss -tlnp | grep -q ':18789 '; then
  check "Gateway listening on :18789" 0
else
  check "Gateway listening on :18789" 1
fi

# ---------- Check 2: API listening on :3001 ----------
if ss -tlnp | grep -q ':3001 '; then
  check "API listening on :3001" 0
else
  check "API listening on :3001" 1
fi

# ---------- Check 3: Market data adapter running ----------
if systemctl --user is-active --quiet market-data-adapter 2>/dev/null; then
  check "Market data adapter running" 0
else
  check "Market data adapter running" 1
fi

# ---------- Check 4: Skills installed (4+ directories) ----------
SKILLS_DIR=""
if [ -d "$HOME/.openclaw/skills" ]; then
  SKILLS_DIR="$HOME/.openclaw/skills"
elif [ -d "$HOME/.clawdbot/skills" ]; then
  SKILLS_DIR="$HOME/.clawdbot/skills"
fi

if [ -n "$SKILLS_DIR" ]; then
  SKILL_COUNT=$(find "$SKILLS_DIR" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
  if [ "$SKILL_COUNT" -ge 4 ]; then
    check "Skills installed (${SKILL_COUNT} found)" 0
  else
    check "Skills installed (${SKILL_COUNT} found, need 4+)" 1
  fi
else
  check "Skills installed (no skills dir found)" 1
fi

# ---------- Check 5: DB connectivity ----------
# Load DB credentials from the config directory
CONFIG_DIR=""
if [ -d "$HOME/.openclaw" ]; then
  CONFIG_DIR="$HOME/.openclaw"
elif [ -d "$HOME/.clawdbot" ]; then
  CONFIG_DIR="$HOME/.clawdbot"
fi

DB_OK=1
if [ -n "$CONFIG_DIR" ] && [ -f "$CONFIG_DIR/db-credentials.json" ]; then
  DB_HOST=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/db-credentials.json')); print(c['host'])" 2>/dev/null)
  DB_PORT=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/db-credentials.json')); print(c['port'])" 2>/dev/null)
  DB_NAME=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/db-credentials.json')); print(c['dbname'])" 2>/dev/null)
  DB_USER=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/db-credentials.json')); print(c['username'])" 2>/dev/null)
  DB_PASS=$(python3 -c "import json; c=json.load(open('$CONFIG_DIR/db-credentials.json')); print(c['password'])" 2>/dev/null)

  if [ -n "$DB_HOST" ]; then
    export PGPASSWORD="$DB_PASS"
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "SELECT 1" >/dev/null 2>&1; then
      DB_OK=0
    fi
  fi
fi

check "DB connectivity" $DB_OK

# ---------- Check 6: Table count (expect 9) ----------
TABLE_OK=1
if [ "$DB_OK" -eq 0 ]; then
  TABLE_COUNT=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT count(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null | tr -d ' ')
  if [ -n "$TABLE_COUNT" ] && [ "$TABLE_COUNT" -ge 9 ]; then
    TABLE_OK=0
    check "Table count (${TABLE_COUNT} tables)" $TABLE_OK
  else
    check "Table count (${TABLE_COUNT:-0} tables, need 9+)" 1
  fi
else
  check "Table count (skipped - no DB)" 1
fi

# ---------- Check 7: Market data fresh (row <30s old) ----------
TICK_OK=1
if [ "$DB_OK" -eq 0 ]; then
  TICK_AGE=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c \
    "SELECT EXTRACT(EPOCH FROM (NOW() - event_at))::int FROM market_ticks ORDER BY event_at DESC LIMIT 1" 2>/dev/null | tr -d ' ')
  if [ -n "$TICK_AGE" ] && [ "$TICK_AGE" -le 30 ]; then
    TICK_OK=0
    check "Market data fresh (${TICK_AGE}s old)" $TICK_OK
  else
    check "Market data fresh (${TICK_AGE:-N/A}s old, need <30s)" 1
  fi
else
  check "Market data fresh (skipped - no DB)" 1
fi

# ---------- Check 8: Trading config paper_mode=true ----------
TRADING_OK=1
PAPER_MODE="unknown"
TRADING_FILE=""
if [ -n "$CONFIG_DIR" ] && [ -f "$CONFIG_DIR/trading-config.json" ]; then
  TRADING_FILE="$CONFIG_DIR/trading-config.json"
fi

if [ -n "$TRADING_FILE" ]; then
  PAPER_MODE=$(python3 -c "import json; print(json.load(open('$TRADING_FILE'))['paper_mode'])" 2>/dev/null || echo "unknown")
  if [ "$PAPER_MODE" = "True" ]; then
    TRADING_OK=0
  fi
fi

check "Trading config (paper_mode=${PAPER_MODE})" $TRADING_OK

# ---------- Summary ----------
echo ""
echo "============================================"
echo "Results:"
echo "============================================"
for r in "${RESULTS[@]}"; do
  echo "  $r"
done

echo ""
echo "--------------------------------------------"
echo "TOTAL: $PASS passed, $FAIL failed (out of $((PASS + FAIL)))"
echo "--------------------------------------------"

if [ "$FAIL" -eq 0 ]; then
  echo "ALL CHECKS PASSED"
  exit 0
else
  echo "SOME CHECKS FAILED"
  exit 1
fi
