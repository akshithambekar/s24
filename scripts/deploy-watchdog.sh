#!/bin/bash
# deploy-watchdog.sh - Installs a service watchdog on the OpenClaw EC2 instance
# Monitors openclaw-gateway, autopilot-api, and market-data-adapter
# Restarts crashed services and optionally pushes CloudWatch metrics
# Run via SSM: push this to the instance, then execute

set -euo pipefail

echo "Installing Service Watchdog..."

# Create the watchdog directory
mkdir -p /home/ubuntu/watchdog

# Write the watchdog check script
cat > /home/ubuntu/watchdog/check-services.sh << 'WATCHDOG'
#!/bin/bash
# check-services.sh - Check and restart crashed services
# Called by systemd timer every 60 seconds

LOG_FILE="/home/ubuntu/watchdog/watchdog.log"
REGION="${AWS_REGION:-us-east-1}"
RESTART_COUNT=0

log() {
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $1" | tee -a "$LOG_FILE"
}

export XDG_RUNTIME_DIR=/run/user/1000

# Trim log file if it gets too large (keep last 1000 lines)
if [ -f "$LOG_FILE" ] && [ "$(wc -l < "$LOG_FILE")" -gt 5000 ]; then
  tail -1000 "$LOG_FILE" > "$LOG_FILE.tmp" && mv "$LOG_FILE.tmp" "$LOG_FILE"
fi

# ---------- Check 1: OpenClaw Gateway (port 18789) ----------
if ss -tlnp | grep -q ':18789 '; then
  GATEWAY_STATUS="healthy"
else
  GATEWAY_STATUS="unhealthy"
  log "WARN: Gateway not listening on :18789, attempting restart..."
  if systemctl --user restart openclaw-gateway 2>/dev/null; then
    log "INFO: Restarted openclaw-gateway"
    RESTART_COUNT=$((RESTART_COUNT + 1))
  elif systemctl --user restart clawdbot-gateway 2>/dev/null; then
    log "INFO: Restarted clawdbot-gateway"
    RESTART_COUNT=$((RESTART_COUNT + 1))
  else
    log "ERROR: Failed to restart gateway"
  fi
fi

# ---------- Check 2: Autopilot API (port 3001) ----------
if ss -tlnp | grep -q ':3001 '; then
  API_STATUS="healthy"
else
  API_STATUS="unhealthy"
  log "WARN: Autopilot API not listening on :3001, attempting restart..."
  if systemctl --user restart autopilot-api 2>/dev/null; then
    log "INFO: Restarted autopilot-api"
    RESTART_COUNT=$((RESTART_COUNT + 1))
  else
    log "ERROR: Failed to restart autopilot-api"
  fi
fi

# ---------- Check 3: Market Data Adapter (systemd status) ----------
if systemctl --user is-active --quiet market-data-adapter 2>/dev/null; then
  ADAPTER_STATUS="healthy"
else
  ADAPTER_STATUS="unhealthy"
  log "WARN: market-data-adapter not active, attempting restart..."
  if systemctl --user restart market-data-adapter 2>/dev/null; then
    log "INFO: Restarted market-data-adapter"
    RESTART_COUNT=$((RESTART_COUNT + 1))
  else
    log "ERROR: Failed to restart market-data-adapter"
  fi
fi

# ---------- Push CloudWatch metrics (optional, best-effort) ----------
if command -v aws >/dev/null 2>&1; then
  HEALTHY_COUNT=0
  [ "$GATEWAY_STATUS" = "healthy" ] && HEALTHY_COUNT=$((HEALTHY_COUNT + 1))
  [ "$API_STATUS" = "healthy" ] && HEALTHY_COUNT=$((HEALTHY_COUNT + 1))
  [ "$ADAPTER_STATUS" = "healthy" ] && HEALTHY_COUNT=$((HEALTHY_COUNT + 1))

  aws cloudwatch put-metric-data \
    --namespace "SolanaAutopilot" \
    --region "$REGION" \
    --metric-data \
      "MetricName=HealthyServices,Value=${HEALTHY_COUNT},Unit=Count" \
      "MetricName=ServiceRestarts,Value=${RESTART_COUNT},Unit=Count" \
    2>/dev/null || true
fi

if [ "$RESTART_COUNT" -gt 0 ]; then
  log "INFO: Watchdog cycle complete - restarted $RESTART_COUNT service(s)"
fi
WATCHDOG

chmod +x /home/ubuntu/watchdog/check-services.sh

# Create systemd oneshot service for the watchdog
mkdir -p /home/ubuntu/.config/systemd/user

cat > /home/ubuntu/.config/systemd/user/watchdog.service << 'WDSVC'
[Unit]
Description=Solana Autopilot Service Watchdog

[Service]
Type=oneshot
ExecStart=/home/ubuntu/watchdog/check-services.sh
Environment=AWS_REGION=us-east-1
WDSVC

# Create systemd timer (runs every 60 seconds)
cat > /home/ubuntu/.config/systemd/user/watchdog.timer << 'WDTIMER'
[Unit]
Description=Run service watchdog every 60 seconds

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
AccuracySec=5s

[Install]
WantedBy=timers.target
WDTIMER

# Enable and start the timer
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user daemon-reload
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user enable watchdog.timer
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user start watchdog.timer

sleep 2
echo "Watchdog Timer Status:"
XDG_RUNTIME_DIR=/run/user/1000 systemctl --user status watchdog.timer --no-pager || true

echo ""
echo "Watchdog installed. Timer runs every 60s."
echo "Log file: /home/ubuntu/watchdog/watchdog.log"
echo "Done!"
