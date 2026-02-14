---
name: solana-risk-manager
description: Risk management and kill switch control for Solana paper trading
requires: curl, jq, psql
---

# Solana Risk Manager

## Overview

This skill manages trading risk controls for the OpenClaw Solana paper-trading system. It provides the agent with the ability to inspect and toggle the global kill switch, review configured position and loss limits, query recent risk events from the database, and enforce safety rules that protect the portfolio from runaway losses. All operations are performed inline using `curl` against the Status API on port 3001, `cat` for local config files, and `psql` for direct database queries.

## Kill Switch Status

Check whether the kill switch is currently active or inactive.

```bash
exec curl -s http://127.0.0.1:3001/api/deploy/kill-switch | jq .
```

The response includes an `enabled` boolean and the timestamp of the last update. When `enabled` is `true`, the trading engine rejects all new order executions with error code `KILL_SWITCH_ACTIVE`.

## Toggle Kill Switch

### Activate the Kill Switch

Immediately halt all new trade executions. Replace `<reason>` with a short description of why the switch is being activated.

```bash
exec curl -s -X POST -H "Content-Type: application/json" -d '{"enabled": true, "reason": "<reason>", "actor": "agent"}' http://127.0.0.1:3001/api/deploy/kill-switch
```

### Deactivate the Kill Switch

Resume normal trade execution. Only do this with explicit user authorization.

```bash
exec curl -s -X POST -H "Content-Type: application/json" -d '{"enabled": false, "reason": "<reason>", "actor": "agent"}' http://127.0.0.1:3001/api/deploy/kill-switch
```

Every toggle is recorded in the `kill_switch_events` table with the `enabled` state, `reason`, `actor`, and `created_at` timestamp.

## View Risk Limits

Read the current risk configuration from the local trading config file. This contains position size limits, maximum notional per order, daily loss thresholds, and cooldown periods.

```bash
exec cat ~/.openclaw/trading-config.json | jq .
```

## View Recent Risk Events

Query the last 20 risk events from the database. The connection string is built dynamically from the local credentials file.

```bash
exec bash -c 'CREDS=$(cat ~/.openclaw/db-credentials.json) && PGPASSWORD=$(echo $CREDS | jq -r .password) psql -h $(echo $CREDS | jq -r .host) -p $(echo $CREDS | jq -r .port) -U $(echo $CREDS | jq -r .username) -d $(echo $CREDS | jq -r .database) -c "SELECT risk_event_id, order_id, action, rule, created_at FROM risk_events ORDER BY created_at DESC LIMIT 20;"'
```

Each row represents a risk policy evaluation. The `action` column is one of `blocked`, `allowed`, or `warned`. The `rule` column identifies which risk policy triggered the event (e.g., `MAX_POSITION_NOTIONAL`, `MAX_NOTIONAL_PER_ORDER`).

## Safety Rules

1. **Refuse all trade proposals if the kill switch is active.** When the kill switch `enabled` field is `true`, do not propose, approve, or forward any trade. Return an explanation to the user that trading is halted.

2. **Recommend activating the kill switch if price moves more than 5% in less than 1 minute.** Monitor market tick data for abnormal volatility. If the mid price moves by more than 5% within a 60-second window, immediately recommend to the user that the kill switch be activated, and explain the observed price movement.

3. **Never deactivate the kill switch without explicit user authorization.** The agent must not autonomously re-enable trading. Deactivation requires a clear, affirmative instruction from the user.

4. **All kill switch toggles are logged in the `kill_switch_events` table.** Every activation and deactivation is persisted with the `event_id`, `enabled` state, `reason`, `actor`, and `created_at` timestamp. This provides a full audit trail for compliance review.
