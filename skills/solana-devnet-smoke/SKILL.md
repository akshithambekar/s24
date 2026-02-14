---
name: solana-devnet-smoke
description: Solana devnet RPC health checks and connectivity tests
requires: bash, curl, jq, psql
---

## Overview

Operational health checks for the Solana devnet RPC. No PnL impact — purely infrastructure monitoring.

## Run Smoke Test

```bash
exec bash {baseDir}/scripts/smoke-test.sh
```

With custom RPC URL:

```bash
exec bash {baseDir}/scripts/smoke-test.sh https://custom-rpc-url.example.com
```

## View Past Runs

```bash
exec bash -c 'CREDS=$(cat ~/.openclaw/db-credentials.json) && PGPASSWORD=$(echo $CREDS | jq -r .password) psql -h $(echo $CREDS | jq -r .host) -p $(echo $CREDS | jq -r .port) -U $(echo $CREDS | jq -r .username) -d $(echo $CREDS | jq -r .database) -c "SELECT run_id, status, rpc_latency_ms, wallet_check, tx_simulation, ran_at FROM devnet_smoke_runs ORDER BY ran_at DESC LIMIT 10;"'
```

## Notes

This is an operational check only. Results are recorded in devnet_smoke_runs but have no effect on trading, positions, or PnL.
